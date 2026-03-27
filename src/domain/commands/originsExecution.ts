/**
 * Origins-based execution logic for video transformation
 *
 * Builds CDN-CGI URLs, handles IMQuery/derivative dimensions,
 * performs fetch calls, and builds success responses.
 * Extracted from TransformVideoCommand.executeWithOrigins().
 */
import { DiagnosticsInfo, extractRequestHeaders } from '../../utils/debugHeadersUtils';
import { addBreadcrumb, getClientDiagnostics, RequestContext } from '../../utils/requestContext';
import { createCategoryLogger } from '../../utils/logger';
import { addVersionToUrl } from '../../utils/urlVersionUtils';
import { ResponseBuilder } from '../../utils/responseBuilder';
import { generateDebugPage } from '../../services/debugService';
import { Origin } from '../../services/videoStorage/interfaces';
import { SourceResolutionResult } from '../../services/origins/OriginResolver';
import { EnvVariables, getEnvironmentConfig } from '../../config/environmentConfig';
import { VideoTransformContext, VideoTransformOptions, R2Bucket, WorkerEnvironment } from './types';
import { classifyAndHandleOriginError } from './originsErrorHandler';
import { logErrorWithContext } from '../../utils/errorHandlingUtils';
import { getDerivativeDimensions } from '../../utils/imqueryUtils';
import { retryWithAlternativeOrigins } from '../../services/transformation/retryWithAlternativeOrigins';
import { CDN_CGI_SIZE_LIMIT, getContentLength } from '../../utils/httpUtils';
import { VideoConfigurationManager } from '../../config';
import { buildContainerInstanceKey } from '../../services/containerTransformService';
import type { ContainerNamespace } from '../../types/cloudflare';

const execLogger = createCategoryLogger('OriginsExecution');

/**
 * Parameters for executeWithOrigins
 */
export interface ExecuteWithOriginsParams {
  context: VideoTransformContext;
  requestContext: RequestContext;
}

/**
 * Build the CDN-CGI source URL based on source resolution type.
 *
 * @returns The source URL string
 */
function buildSourceUrl(
  sourceResolution: SourceResolutionResult,
  env: WorkerEnvironment | undefined,
  requestOrigin: string,
  requestQuery: string,
  requestHash: string,
  diagnosticsInfo: DiagnosticsInfo
): string {
  const sourcePath = sourceResolution.resolvedPath;

  switch (sourceResolution.originType) {
    case 'r2': {
      const bucketBinding = sourceResolution.source.bucketBinding || 'VIDEO_ASSETS';
      if (!env) {
        throw new Error('Environment variables not available for R2 bucket access');
      }
      if (!env[bucketBinding]) {
        throw new Error(`R2 bucket binding '${bucketBinding}' not available in environment`);
      }
      // CF cdn-cgi media transformation requires a proper HTTP URL for its HEAD/GET probe.
      // The r2: scheme is not a valid HTTP URL and causes 9402 errors.
      // Use publicUrl if configured (R2 custom domain or r2.dev URL), otherwise fall back
      // to the worker's own origin with ?__r2src=1 marker — the worker handles the cdn-cgi
      // subrequest by serving raw R2 content (see R2 subrequest handling in index.ts).
      if (sourceResolution.source.publicUrl) {
        const publicUrl = sourceResolution.source.publicUrl.replace(/\/+$/, '');
        return `${publicUrl}/${sourcePath}`;
      }
      // Use worker's own origin with __r2src marker — cdn-cgi will HEAD/GET this URL,
      // and the worker intercepts it to serve raw R2 content (avoiding infinite transform loop)
      return `${requestOrigin}/${sourcePath}?__r2src=${encodeURIComponent(bucketBinding)}`;
    }

    case 'remote':
    case 'fallback': {
      if (!sourceResolution.sourceUrl) {
        throw new Error(`No source URL available for ${sourceResolution.originType} source`);
      }
      const sourceUrl = sourceResolution.sourceUrl + requestQuery + requestHash;

      // Handle authentication if needed
      if (sourceResolution.source.auth?.enabled) {
        handleSourceAuthentication(sourceResolution, env, diagnosticsInfo);
      }
      return sourceUrl;
    }

    default:
      throw new Error(`Unknown source type: ${sourceResolution.originType}`);
  }
}

/**
 * Handle authentication for remote/fallback sources
 */
function handleSourceAuthentication(
  sourceResolution: SourceResolutionResult,
  env: WorkerEnvironment | undefined,
  diagnosticsInfo: DiagnosticsInfo
): void {
  const auth = sourceResolution.source.auth!;
  execLogger.debug('Source requires authentication', {
    sourceType: sourceResolution.originType,
    authType: auth.type,
  });

  if (auth.type === 'bearer' && auth.accessKeyVar) {
    const envRecord = env as unknown as Record<string, string | undefined>;
    const accessToken = envRecord[auth.accessKeyVar];

    if (accessToken) {
      execLogger.debug('Adding bearer token to source URL', {
        accessKeyVar: auth.accessKeyVar,
      });
      diagnosticsInfo.authentication = {
        type: 'bearer',
        tokenSource: auth.accessKeyVar,
        available: true,
      };
    } else {
      execLogger.debug('Bearer token not found in environment variable', {
        accessKeyVar: auth.accessKeyVar,
      });
      diagnosticsInfo.authentication = {
        type: 'bearer',
        tokenSource: auth.accessKeyVar,
        available: false,
        error: 'Token not found in environment variable',
      };
    }
  }
}

// ── Proactive source-size detection ────────────────────────────────────────
// The CDN-CGI transformation size limit is 256 MiB.  When the source is
// known to exceed that *before* we call cdn-cgi/media, we can route directly
// to the FFmpeg container — avoiding a wasted round-trip and double download.

/** Timeout for the lightweight HEAD probe on remote/fallback sources (ms). */
const HEAD_PROBE_TIMEOUT_MS = 2000;

/**
 * Attempt to determine the source size in bytes without downloading the body.
 *
 * - **R2 sources**: uses the local R2 binding `head()` call (fast, no subrequest).
 * - **Remote/fallback sources**: issues a HEAD request with a short timeout.
 *
 * Returns `null` when the size cannot be determined (HEAD unsupported,
 * timeout, missing Content-Length, etc.). The caller should fall through to
 * the normal cdn-cgi path in that case.
 */
export async function getSourceSizeBytes(
  sourceResolution: SourceResolutionResult,
  env: WorkerEnvironment | undefined,
  sourceUrl: string
): Promise<number | null> {
  try {
    if (sourceResolution.originType === 'r2') {
      const bucketBinding = sourceResolution.source.bucketBinding || 'VIDEO_ASSETS';
      if (!env || !env[bucketBinding]) return null;
      const r2Bucket = env[bucketBinding] as R2Bucket;
      const headResult = await r2Bucket.head(sourceResolution.resolvedPath);
      return headResult?.size ?? null;
    }

    // Remote / fallback — HEAD probe with a short timeout
    if (sourceResolution.originType === 'remote' || sourceResolution.originType === 'fallback') {
      if (!sourceUrl.startsWith('http://') && !sourceUrl.startsWith('https://')) return null;
      return await getContentLength(sourceUrl, { timeout: HEAD_PROBE_TIMEOUT_MS });
    }

    return null;
  } catch (err) {
    execLogger.debug('Proactive size check failed — will fall through to cdn-cgi', {
      error: err instanceof Error ? err.message : String(err),
      originType: sourceResolution.originType,
    });
    return null;
  }
}

/**
 * Serve the raw (untransformed) source directly to the client when the
 * source exceeds the cdn-cgi 256 MiB limit.
 *
 * This streams the original video immediately — no waiting for ffmpeg.
 * The video plays right away (just at its original dimensions/encoding).
 * This keeps the URL embeddable in `<video>` tags, social shares, etc.
 *
 * For R2 sources the object is fetched from the bucket binding directly.
 * For remote/fallback sources a fetch to the source URL is made.
 *
 * Returns a `Response` on success, or `null` if the passthrough cannot
 * be served (caller falls through to cdn-cgi which will fail with 9402).
 */
async function serveRawSourcePassthrough(
  sourceResolution: SourceResolutionResult,
  origin: Origin,
  env: WorkerEnvironment | undefined,
  requestContext: RequestContext,
  diagnosticsInfo: DiagnosticsInfo,
  sourceSizeBytes: number | null,
  path: string,
  sourceUrl: string
): Promise<Response | null> {
  execLogger.info('Source exceeds cdn-cgi limit — serving raw source passthrough', {
    sourceSizeMB: sourceSizeBytes ? Math.round(sourceSizeBytes / 1024 / 1024) : 'unknown',
    limitMB: Math.round(CDN_CGI_SIZE_LIMIT / 1024 / 1024),
    originType: sourceResolution.originType,
    origin: origin.name,
  });

  addBreadcrumb(requestContext, 'Passthrough', 'Serving raw source — exceeds cdn-cgi limit', {
    sourceSizeMB: sourceSizeBytes ? Math.round(sourceSizeBytes / 1024 / 1024) : 'unknown',
    originType: sourceResolution.originType,
  });

  diagnosticsInfo.containerRouting = {
    reason: 'proactive-size-check-passthrough',
    sourceSizeBytes,
    limitBytes: CDN_CGI_SIZE_LIMIT,
  };

  try {
    if (sourceResolution.originType === 'r2') {
      // Fetch directly from R2 bucket binding
      const bucketBinding = sourceResolution.source.bucketBinding || 'VIDEO_ASSETS';
      if (!env || !env[bucketBinding]) return null;

      const r2Bucket = env[bucketBinding] as R2Bucket;
      const r2Object = await r2Bucket.get(sourceResolution.resolvedPath);
      if (!r2Object) return null;

      const headers = new Headers({
        'Content-Type': r2Object.httpMetadata?.contentType || 'video/mp4',
        'Content-Length': r2Object.size.toString(),
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'public, max-age=3600',
        'X-Source-Passthrough': 'true',
        'X-Passthrough-Reason': 'exceeds-cdn-cgi-limit',
        'X-Source-Size-MB': String(Math.round(r2Object.size / 1024 / 1024)),
        'X-Origin': origin.name,
        'X-KV-Store-Handled': 'true', // Don't attempt KV storage for raw passthrough
      });

      return new Response(r2Object.body, { status: 200, headers });
    }

    // Remote / fallback — fetch the source directly
    if (sourceUrl.startsWith('http://') || sourceUrl.startsWith('https://')) {
      const sourceResponse = await fetch(sourceUrl);
      if (!sourceResponse.ok) return null;

      const headers = new Headers(sourceResponse.headers);
      headers.set('Accept-Ranges', 'bytes');
      headers.set('Cache-Control', 'public, max-age=3600');
      headers.set('X-Source-Passthrough', 'true');
      headers.set('X-Passthrough-Reason', 'exceeds-cdn-cgi-limit');
      headers.set('X-Origin', origin.name);
      headers.set('X-KV-Store-Handled', 'true');
      if (sourceSizeBytes) {
        headers.set('X-Source-Size-MB', String(Math.round(sourceSizeBytes / 1024 / 1024)));
      }

      return new Response(sourceResponse.body, { status: 200, headers });
    }

    return null;
  } catch (err) {
    execLogger.error('Failed to serve raw source passthrough', {
      error: err instanceof Error ? err.message : String(err),
      originType: sourceResolution.originType,
      path,
    });
    return null;
  }
}

/**
 * Fire a background container transform job.
 *
 * This sends a request to the container DO with a `callbackUrl` parameter.
 * The container will transcode the video and POST the result to the callback
 * URL (a worker endpoint that stores the output in KV).
 *
 * The container DO runs independently — we don't await the result and don't
 * need `waitUntil`.  The `containerInstance.fetch()` call returns a promise
 * but we intentionally don't await it.  The DO keeps running after we return.
 */
function fireBackgroundContainerJob(
  sourceResolution: SourceResolutionResult,
  origin: Origin,
  options: VideoTransformOptions,
  env: WorkerEnvironment | undefined,
  path: string,
  requestOrigin: string
): void {
  const videoConfigManager = VideoConfigurationManager.getInstance();
  const containerBinding = (env as any)?.FFMPEG_CONTAINER as ContainerNamespace | undefined;

  if (!containerBinding || !videoConfigManager.isContainerEnabled()) return;

  // Build container source URL
  let containerSourceUrl: string | null = null;
  if (
    sourceResolution.originType === 'r2' &&
    sourceResolution.source.bucketBinding &&
    sourceResolution.resolvedPath
  ) {
    containerSourceUrl = `${requestOrigin}/${sourceResolution.resolvedPath}?__r2src=${sourceResolution.source.bucketBinding}`;
  } else if (sourceResolution.sourceUrl) {
    containerSourceUrl = sourceResolution.sourceUrl;
  }

  if (!containerSourceUrl) return;

  const instanceKey = buildContainerInstanceKey(origin.name, path);

  // Build callback URL — the container will POST the transcoded output here.
  // Include transformation options so the KV cache key matches what the
  // video handler generates on the read path.
  //
  // IMPORTANT: pass the `derivative` rather than raw width/height.  The KV
  // key generator (generateKVKey) expands derivatives to their configured
  // dimensions (e.g. tablet → 1280×720).  If we pass the raw imwidth
  // (e.g. 1080) instead, the stored key won't match the lookup key.
  const callbackParams = new URLSearchParams();
  callbackParams.set('path', path);
  callbackParams.set('version', String(options.version || 1));

  // Always pass ALL key-generating fields so the container callback
  // stores under the exact same KV key that checkKVCache generates.
  // Pass both derivative AND width/height — the key generator uses
  // effective dimensions (derivative expands to width/height, but
  // explicit width/height take precedence).
  if (options.derivative) callbackParams.set('derivative', options.derivative);
  if (options.width) callbackParams.set('width', String(options.width));
  if (options.height) callbackParams.set('height', String(options.height));
  if (options.mode) callbackParams.set('mode', options.mode);
  if (options.quality) callbackParams.set('quality', options.quality);
  if (options.compression) callbackParams.set('compression', options.compression);
  if (options.format) callbackParams.set('format', options.format);
  const callbackUrl = `${requestOrigin}/internal/container-result?${callbackParams.toString()}`;

  const payload = {
    sourceUrl: containerSourceUrl,
    width: options.width ?? undefined,
    height: options.height ?? undefined,
    mode: options.mode || 'video',
    quality: options.quality || 'medium',
    fit: options.fit || 'contain',
    duration: options.duration ?? undefined,
    time: options.time || '0s',
    format: 'mp4',
    callbackUrl,
  };

  execLogger.info('Firing background container job with callback', {
    instanceKey,
    callbackUrl,
    sourceSizeApprox: 'oversized',
  });

  try {
    const containerInstance = containerBinding.getByName(instanceKey);
    const containerRequest = new Request('http://container/transform-and-callback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    // Fire and forget — the DO runs independently.
    // We catch to prevent unhandled rejection logs.
    containerInstance.fetch(containerRequest).catch((err: unknown) => {
      execLogger.debug('Background container job fire-and-forget fetch settled', {
        instanceKey,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  } catch (err) {
    execLogger.error('Failed to fire background container job', {
      error: err instanceof Error ? err.message : String(err),
      instanceKey,
    });
  }
}

/**
 * Build CDN-CGI URL parameters from video transform options.
 * Handles IMQuery/derivative dimension overrides.
 */
async function buildCdnCgiUrlParams(options: VideoTransformOptions): Promise<{
  urlParams: string[];
  width: number | null | undefined;
  height: number | null | undefined;
}> {
  const urlParams: string[] = [];

  // Check for derivative dimensions first, overriding width/height if available
  let width = options.width;
  let height = options.height;

  if (options.derivative) {
    const derivativeDimensions = getDerivativeDimensions(options.derivative);

    if (derivativeDimensions) {
      width = derivativeDimensions.width || width;
      height = derivativeDimensions.height || height;

      const cdnLogger = createCategoryLogger('CDN-CGI');
      cdnLogger.info(`Using derivative dimensions for ${options.derivative}`, {
        derivative: options.derivative,
        originalWidth: options.width,
        originalHeight: options.height,
        derivativeWidth: width,
        derivativeHeight: height,
      });
    }
  }

  // Use the possibly overridden width/height
  if (width) urlParams.push(`width=${width}`);
  if (height) urlParams.push(`height=${height}`);
  if (options.mode) urlParams.push(`mode=${options.mode}`);
  if (options.fit) urlParams.push(`fit=${options.fit}`);

  // Mode-specific parameter handling
  const mode = options.mode || 'video';

  if (mode === 'spritesheet') {
    if (options.time) urlParams.push(`time=${options.time}`);
    if (options.duration) urlParams.push(`duration=${options.duration}`);
  } else if (mode === 'frame') {
    if (options.quality) urlParams.push(`quality=${options.quality}`);
    if (options.format) urlParams.push(`format=${options.format}`);
    if (options.compression) urlParams.push(`compression=${options.compression}`);
    if (options.time) urlParams.push(`time=${options.time}`);
  } else {
    // Video mode - Include all standard parameters
    if (options.quality) urlParams.push(`quality=${options.quality}`);
    if (options.format) urlParams.push(`format=${options.format}`);
    if (options.compression) urlParams.push(`compression=${options.compression}`);

    // Video-specific parameters
    if (options.time) urlParams.push(`time=${options.time}`);
    if (options.duration) urlParams.push(`duration=${options.duration}`);
    if (options.fps !== undefined && options.fps !== null) {
      urlParams.push(`fps=${options.fps}`);
    }
    if (options.audio !== undefined) {
      urlParams.push(`audio=${options.audio ? 'true' : 'false'}`);
    }

    // Video controls - only for video mode
    if (options.loop !== undefined) {
      urlParams.push(`loop=${options.loop ? 'true' : 'false'}`);
    }
    if (options.autoplay !== undefined) {
      urlParams.push(`autoplay=${options.autoplay ? 'true' : 'false'}`);
    }
    if (options.muted !== undefined) {
      urlParams.push(`muted=${options.muted ? 'true' : 'false'}`);
    }
    if (options.preload) urlParams.push(`preload=${options.preload}`);
  }

  return { urlParams, width, height };
}

/**
 * Fetch the transformed video, handling R2 and HTTP sources differently.
 */
async function fetchTransformedVideo(
  transformRequest: Request,
  sourceResolution: SourceResolutionResult,
  sourcePath: string,
  origin: Origin,
  context: VideoTransformContext
): Promise<Response> {
  const { request, options, env } = context;

  if (sourceResolution.originType === 'r2') {
    const bucketBinding = sourceResolution.source.bucketBinding || 'VIDEO_ASSETS';
    if (!env) {
      throw new Error('Environment variables not available for R2 bucket access');
    }
    if (!env[bucketBinding]) {
      throw new Error(`R2 bucket binding '${bucketBinding}' not available in environment`);
    }

    const r2Bucket = env[bucketBinding] as R2Bucket;
    const r2Object = await r2Bucket.get(sourcePath);

    if (!r2Object) {
      // Object not found in R2 - use the retry mechanism
      execLogger.debug('R2 object not found, using retry mechanism', {
        origin: origin.name,
        failedSource: sourceResolution.source.type,
        failedPriority: sourceResolution.source.priority,
        path: sourcePath,
      });

      return await retryWithAlternativeOrigins({
        originalRequest: request,
        transformOptions: options as any,
        failedOrigin: origin,
        failedSource: sourceResolution.source,
        context: context,
        env: env as EnvVariables,
        requestContext: context.requestContext!,
        pathPatterns: context.pathPatterns,
        debugInfo: context.debugInfo,
      });
    }

    // Create a response from the R2 object to pass to CDN-CGI
    const _r2Response = new Response(r2Object.body, {
      headers: {
        'Content-Type': r2Object.httpMetadata?.contentType || 'video/mp4',
        'Content-Length': r2Object.size.toString(),
        'Last-Modified': r2Object.uploaded.toUTCString(),
        ETag: r2Object.httpEtag || `"${r2Object.size}-${r2Object.uploaded.getTime()}"`,
      },
    });

    // Fetch through CDN-CGI with the R2 response as the source
    return await fetch(transformRequest, {
      cf: { cacheTtl: 31536000 },
    });
  } else {
    // Regular HTTP source, fetch directly through CDN-CGI
    return await fetch(transformRequest, {
      cf: { cacheTtl: 31536000 },
    });
  }
}

/**
 * Build a successful response with caching and headers.
 */
async function buildSuccessResponse(
  response: Response,
  origin: Origin,
  sourceResolution: SourceResolutionResult,
  options: VideoTransformOptions,
  context: VideoTransformContext,
  requestContext: RequestContext,
  diagnosticsInfo: DiagnosticsInfo,
  url: URL
): Promise<Response> {
  addBreadcrumb(requestContext, 'Response', 'Transformation successful, building final response');

  const responseBuilder = new ResponseBuilder(response, requestContext);

  // Determine TTL based on origin configuration
  let cacheTtl = 86400; // Default 1 day

  if (origin.ttl) {
    if (origin.useTtlByStatus) {
      if (response.status >= 200 && response.status < 300 && origin.ttl.ok) {
        cacheTtl = origin.ttl.ok;
      } else if (response.status >= 300 && response.status < 400 && origin.ttl.redirects) {
        cacheTtl = origin.ttl.redirects;
      } else if (response.status >= 400 && response.status < 500 && origin.ttl.clientError) {
        cacheTtl = origin.ttl.clientError;
      } else if (response.status >= 500 && origin.ttl.serverError) {
        cacheTtl = origin.ttl.serverError;
      }
    } else if (origin.ttl.ok) {
      cacheTtl = origin.ttl.ok;
    }
  }

  const cacheConfig = {
    ttl: cacheTtl,
    staleWhileRevalidate: cacheTtl * 0.5,
    mustRevalidate: false,
    originName: origin.name,
    originTtl: cacheTtl,
  };

  responseBuilder.withCaching(
    response.status,
    cacheConfig,
    sourceResolution.originType,
    options.derivative || undefined
  );
  responseBuilder.withDebugInfo(
    context.debugInfo ?? (context.debugMode ? { isEnabled: true } : undefined)
  );

  responseBuilder.withHeaders({
    'X-Origin': origin.name,
    'X-Source-Type': sourceResolution.originType,
    'X-Handler': 'Origins',
    'X-Origin-TTL': cacheTtl.toString(),
  });

  // Check for debug view mode
  const debugView =
    url.searchParams.get('debug') === 'view' || url.searchParams.get('debug') === 'true';
  if (debugView && (context.debugInfo?.isEnabled || !!context.debugMode)) {
    addBreadcrumb(requestContext, 'Debug', 'Preparing debug view');

    return await generateDebugPage({
      diagnosticsInfo,
      isError: false,
      request: context.request,
      env: context.env,
      requestContext,
    });
  }

  return await responseBuilder.build();
}

/**
 * Execute transformation using the Origins system.
 * This is the main entry point extracted from TransformVideoCommand.executeWithOrigins().
 *
 * @returns Response with transformed video
 */
export async function executeWithOrigins(params: ExecuteWithOriginsParams): Promise<Response> {
  const { context, requestContext } = params;
  const { request, options, env } = context;

  const origin = context.origin;
  const sourceResolution = context.sourceResolution;

  if (!origin) {
    throw new Error('Origin is required for Origins-based transformation');
  }
  if (!sourceResolution) {
    throw new Error('Source resolution is required for Origins-based transformation');
  }

  const url = new URL(request.url);
  const path = url.pathname;

  // Initialize diagnostics
  const diagnosticsInfo: DiagnosticsInfo = requestContext.diagnostics || {
    errors: [],
    warnings: [],
    originalUrl: request.url,
  };

  // Add Origins information to diagnostics
  diagnosticsInfo.origin = {
    name: origin.name,
    matcher: origin.matcher,
  };

  diagnosticsInfo.sourceResolution = {
    type: sourceResolution.originType,
    resolvedPath: sourceResolution.resolvedPath,
    url: sourceResolution.sourceUrl,
  };

  execLogger.debug('Using Origins-based transformation', {
    origin: origin.name,
    sourceType: sourceResolution.originType,
  });

  addBreadcrumb(requestContext, 'Origins', 'Using Origins-based transformation', {
    origin: origin.name,
    sourceType: sourceResolution.originType,
    resolvedPath: sourceResolution.resolvedPath,
  });

  try {
    // Gather client capabilities and add to diagnostics
    addBreadcrumb(requestContext, 'Context', 'Gathering client capabilities');
    const clientInfo = getClientDiagnostics(request);
    diagnosticsInfo.browserCapabilities = clientInfo.browserCapabilities;
    diagnosticsInfo.clientHints = clientInfo.hasClientHints;
    diagnosticsInfo.deviceType = clientInfo.deviceType;
    diagnosticsInfo.networkQuality = clientInfo.networkQuality;

    // Get the request origin for CDN-CGI endpoint
    const requestUrl = new URL(request.url);
    const requestOrigin = requestUrl.origin;
    const requestQuery = requestUrl.search;
    const requestHash = requestUrl.hash;

    // Build the source URL based on source type
    const sourcePath = sourceResolution.resolvedPath;
    const sourceUrl = buildSourceUrl(
      sourceResolution,
      env,
      requestOrigin,
      requestQuery,
      requestHash,
      diagnosticsInfo
    );

    // Add source information to diagnostics
    diagnosticsInfo.source = sourceResolution.originType;
    diagnosticsInfo.sourceUrl = sourceUrl;

    // ── Proactive size check — bypass cdn-cgi for oversized sources ────
    // For R2 sources this uses the local bucket binding head() (fast, no
    // subrequest).  For remote/fallback sources a HEAD with a 2 s timeout
    // is issued.  If the source is larger than the cdn-cgi 256 MiB limit
    // and the FFmpeg container is enabled, we route directly to the
    // container — avoiding the wasted cdn-cgi round-trip and double download.
    // If the size is unknown or the container fails, we fall through to the
    // normal cdn-cgi path.  The reactive error handler in
    // transformationErrorHandler.ts remains as a safety net.
    const sourceSizeBytes = await getSourceSizeBytes(sourceResolution, env, sourceUrl);
    diagnosticsInfo.sourceSizeBytes = sourceSizeBytes;

    if (sourceSizeBytes !== null && sourceSizeBytes > CDN_CGI_SIZE_LIMIT) {
      addBreadcrumb(requestContext, 'SizeCheck', 'Source exceeds cdn-cgi limit', {
        sizeMB: Math.round(sourceSizeBytes / 1024 / 1024),
        limitMB: Math.round(CDN_CGI_SIZE_LIMIT / 1024 / 1024),
      });

      // Serve the raw source directly — the video plays immediately at
      // its original dimensions.  A background container job (if enabled)
      // will store a transformed version in KV for future requests.
      const passthroughResponse = await serveRawSourcePassthrough(
        sourceResolution,
        origin,
        env,
        requestContext,
        diagnosticsInfo,
        sourceSizeBytes,
        path,
        sourceUrl
      );

      if (passthroughResponse) {
        // Fire background container transform via the callback pattern.
        // The container will POST the result back to the worker's internal
        // endpoint which stores in KV.  This is entirely decoupled from
        // the client response.
        fireBackgroundContainerJob(sourceResolution, origin, options, env, path, requestOrigin);

        return passthroughResponse;
      }
      // Passthrough failed — fall through to cdn-cgi
      // (the reactive error handler will catch the 9402 if cdn-cgi also fails)
    }

    // Get the CDN-CGI path from configuration
    const config = getEnvironmentConfig();
    const cdnCgiPath = config.cdnCgi?.basePath || '/cdn-cgi/media';

    // Create transform URL with CDN-CGI path from configuration
    let cdnCgiUrl = `${requestOrigin}${cdnCgiPath}/`;

    // Build URL parameters
    const { urlParams, width, height } = await buildCdnCgiUrlParams(options);

    // Join parameters
    cdnCgiUrl += urlParams.join(',');

    // Add source URL
    cdnCgiUrl += `/${sourceUrl}`;

    // Add version parameter for cache busting if available
    if (options.version !== undefined) {
      const originalCdnCgiUrl = cdnCgiUrl;
      cdnCgiUrl = addVersionToUrl(cdnCgiUrl, options.version);

      if (cdnCgiUrl !== originalCdnCgiUrl) {
        execLogger.debug('Added version parameter to CDN-CGI URL for cache busting', {
          version: options.version,
          originalUrl: originalCdnCgiUrl,
          versionedUrl: cdnCgiUrl,
        });
      }
    }

    // Log CDN-CGI URL creation
    const cdnCgiLogger = createCategoryLogger('CDN-CGI');
    cdnCgiLogger.info(`Created CDN-CGI URL: ${cdnCgiUrl}`, {
      url: cdnCgiUrl,
      sourceUrl,
      params: urlParams.join(','),
      originType: sourceResolution.originType,
      urlLength: cdnCgiUrl.length,
      isIMQuery: !!options.derivative,
      derivative: options.derivative || 'none',
      imqueryDimensions: options.derivative
        ? {
            requestedWidth: options.width,
            requestedHeight: options.height,
            actualWidth: width,
            actualHeight: height,
            usingDerivativeDimensions: width !== options.width || height !== options.height,
          }
        : null,
    });

    addBreadcrumb(requestContext, 'Transformation', 'Created CDN-CGI URL', {
      sourceType: sourceResolution.originType,
      paramCount: urlParams.length,
    });

    // Add CDN-CGI URL to diagnostics
    diagnosticsInfo.cdnCgiUrl = cdnCgiUrl;

    // Create the transformation request
    const transformRequest = new Request(cdnCgiUrl, {
      method: request.method,
      headers: request.headers,
    });

    // Check for debug headers for tracking in diagnostics
    const debugHeaders = context.debugMode || context.debugInfo?.isEnabled;
    if (debugHeaders) {
      diagnosticsInfo.transformRequest = {
        url: transformRequest.url,
        method: transformRequest.method,
        headers: extractRequestHeaders(transformRequest),
      };
    }

    // Fetch response from CDN-CGI
    const response = await fetchTransformedVideo(
      transformRequest,
      sourceResolution,
      sourcePath,
      origin,
      context
    );

    // Add transform response to diagnostics if in debug mode
    if (debugHeaders) {
      diagnosticsInfo.transformResponse = {
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers.entries()),
      };
    }

    // Check if the response was successful
    if (!response.ok) {
      return await classifyAndHandleOriginError({
        response,
        request,
        options,
        origin,
        sourceResolution,
        context,
        requestContext,
        diagnosticsInfo,
        cdnCgiUrl,
        env,
      });
    }

    // --- Success Path ---
    return await buildSuccessResponse(
      response,
      origin,
      sourceResolution,
      options,
      context,
      requestContext,
      diagnosticsInfo,
      url
    );
  } catch (err) {
    const errorMessage =
      err instanceof Error ? err.message : 'Unknown execution error in Origins transformation';

    logErrorWithContext(
      'Error in Origins transformation',
      err,
      {
        origin: origin.name,
        sourceType: sourceResolution.originType,
        path,
      },
      'TransformVideoCommand.executeWithOrigins'
    );

    if (diagnosticsInfo.errors) {
      diagnosticsInfo.errors.push(`Origins Transformation Error: ${errorMessage}`);
    }

    const errorResponse = new Response(`Error transforming video with Origins: ${errorMessage}`, {
      status: 500,
      headers: {
        'Content-Type': 'text/plain',
        'Cache-Control': 'no-store',
        'X-Error': 'OriginsTransformationError',
        'X-Origin': origin.name,
        'X-Source-Type': sourceResolution.originType,
        'X-Handler': 'Origins',
      },
    });

    const responseBuilder = new ResponseBuilder(errorResponse, requestContext);
    responseBuilder.withDebugInfo(
      context.debugInfo ?? (context.debugMode ? { isEnabled: true } : undefined)
    );

    return await responseBuilder.build();
  }
}

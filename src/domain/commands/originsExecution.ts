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
import { EnvVariables } from '../../config/environmentConfig';
import { VideoTransformContext, VideoTransformOptions, R2Bucket, WorkerEnvironment } from './types';
import { classifyAndHandleOriginError } from './originsErrorHandler';
import { logErrorWithContext } from '../../utils/errorHandlingUtils';

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
      return `r2:${sourcePath}`;
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

/**
 * Build CDN-CGI URL parameters from video transform options.
 * Handles IMQuery/derivative dimension overrides.
 */
async function buildCdnCgiUrlParams(
  options: VideoTransformOptions
): Promise<{
  urlParams: string[];
  width: number | null | undefined;
  height: number | null | undefined;
}> {
  const urlParams: string[] = [];

  // Check for derivative dimensions first, overriding width/height if available
  let width = options.width;
  let height = options.height;

  if (options.derivative) {
    const { getDerivativeDimensions } = await import('../../utils/imqueryUtils');
    const derivativeDimensions = getDerivativeDimensions(options.derivative);

    if (derivativeDimensions) {
      width = derivativeDimensions.width || width;
      height = derivativeDimensions.height || height;

      const { createCategoryLogger } = await import('../../utils/logger');
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

      const { retryWithAlternativeOrigins } =
        await import('../../services/transformation/retryWithAlternativeOrigins');

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
      requestQuery,
      requestHash,
      diagnosticsInfo
    );

    // Add source information to diagnostics
    diagnosticsInfo.source = sourceResolution.originType;
    diagnosticsInfo.sourceUrl = sourceUrl;

    // Get the CDN-CGI path from configuration
    const { getEnvironmentConfig } = await import('../../config/environmentConfig');
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
    const { createCategoryLogger: createCdnLogger } = await import('../../utils/logger');
    const cdnCgiLogger = createCdnLogger('CDN-CGI');
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

/**
 * Unified video handler for processing video transformation requests
 *
 * This is the single entry point for all video transformation. It handles both
 * the legacy path-pattern flow and the Origins-based flow, branching internally
 * based on `videoConfig.shouldUseOrigins()`.
 *
 * Shared logic (context setup, KV cache, range requests, response building,
 * error handling) lives in ./videoHandlerHelpers.ts.
 */
import { determineVideoOptions } from './videoOptionsService';
import { getEnvironmentConfig, EnvVariables } from '../config/environmentConfig';
import { EnvironmentConfig } from '../config/environmentConfig';
import type { ExecutionContextExt, EnvWithExecutionContext } from '../types/cloudflare';
import {
  addBreadcrumb,
  startTimedOperation,
  endTimedOperation,
  getCurrentContext,
} from '../utils/requestContext';
import { createCategoryLogger } from '../utils/logger';

const vhLogger = createCategoryLogger('VideoHandler');
import { logErrorWithContext, withErrorHandling } from '../utils/errorHandlingUtils';
import { OriginResolver } from '../services/origins/OriginResolver';
import { Origin } from '../services/videoStorage/interfaces';
import { getVersionKV } from '../utils/flexibleBindings';
import * as Sentry from '@sentry/cloudflare';
import { getCacheKeyVersion } from '../services/cacheVersionService';
import { generateKVKey } from '../services/kvStorage/keyUtils';
import {
  getContentLength,
  exceedsTransformationLimit,
  CDN_CGI_SIZE_LIMIT,
} from '../utils/httpUtils';
import { ResponseBuilder } from '../utils/responseBuilder';
import { transformVideo } from '../services/videoTransformationService';
import { TransformVideoCommand } from '../domain/commands/TransformVideoCommand';
import type { WorkerEnvironment } from '../domain/commands/TransformVideoCommand';
import { handleTransformationError } from '../services/errorHandlerService';

import {
  setupHandlerContext,
  checkCdnCgiPassthrough,
  checkKVCache,
  buildKVCacheHitResponse,
  handleRangeRequests,
  estimateVideoInfo,
  buildFinalResponse,
  storeInKVCacheAsync,
  handleVideoError,
} from './videoHandlerHelpers';
import { BoundedLRUMap } from '../utils/BoundedLRUMap';

// In-flight transformation tracking to prevent duplicate origin fetches (Origins path)
// Bounded to 500 entries with 5-minute TTL to prevent unbounded memory growth
const inFlightTransformations = new BoundedLRUMap<string, Promise<Response>>({
  maxSize: 500,
  ttlMs: 5 * 60 * 1000,
});

/**
 * Main handler for video requests — unified for both legacy and Origins paths.
 *
 * @param request The incoming request
 * @param config Environment configuration
 * @param env Environment variables including KV bindings
 * @param ctx Execution context
 * @returns Response with the processed video
 */
export const handleVideoRequest = withErrorHandling<
  [Request, EnvironmentConfig, EnvVariables | undefined, ExecutionContext | undefined],
  Response
>(
  async function handleVideoRequestImpl(
    request: Request,
    config: EnvironmentConfig,
    env?: EnvVariables,
    ctx?: ExecutionContext
  ): Promise<Response> {
    // ── 1. Setup context ───────────────────────────────────────────────
    const hctx = setupHandlerContext(request, env, ctx);
    const { context, url, path, skipCache, videoConfig } = hctx;

    try {
      // ── 2. CDN-CGI passthrough ─────────────────────────────────────
      const cdnPassthrough = checkCdnCgiPassthrough(path, request);
      if (cdnPassthrough) return cdnPassthrough;

      // ── 3. Determine which path we're on ───────────────────────────
      const shouldUseOrigins = videoConfig.shouldUseOrigins();

      // ── 4. Prepare video options ───────────────────────────────────
      // For Origins path, resolve origin BEFORE cache check so origin-specific
      // quality/compression can be included in the cache key.
      let originMatch: any = null;
      let sourceResolution: any = null;
      const initialVideoOptions = determineVideoOptions(request, url.searchParams, path);

      if (shouldUseOrigins) {
        const originResolver = new OriginResolver(videoConfig.getConfig());
        originMatch = originResolver.matchOriginWithCaptures(path);

        if (originMatch) {
          sourceResolution = originResolver.resolvePathToSource(path);

          // Apply origin-specific options for consistent cache keys
          if (originMatch.origin.quality && !initialVideoOptions.quality) {
            initialVideoOptions.quality = originMatch.origin.quality;
          }
          if (originMatch.origin.videoCompression && !initialVideoOptions.compression) {
            initialVideoOptions.compression = originMatch.origin.videoCompression;
          }

          vhLogger.debug('Applied origin options for cache lookup', {
            origin: originMatch.origin.name,
            compression: initialVideoOptions.compression,
            quality: initialVideoOptions.quality,
          });
        }

        // Cache version management
        if (env) {
          const versionCacheKey = generateKVKey(path, initialVideoOptions);
          const currentVersion = (await getCacheKeyVersion(env, versionCacheKey)) || 1;
          initialVideoOptions.version = currentVersion;

          vhLogger.debug('Retrieved cache version for lookup', {
            versionCacheKey,
            version: currentVersion,
            path,
            derivative: initialVideoOptions.derivative,
          });
        }
      }

      // ── 5. KV cache check ─────────────────────────────────────────
      const { kvResponse, cachedFilename } = await checkKVCache(
        env,
        url,
        skipCache,
        initialVideoOptions,
        request,
        context
      );

      // ── 6. Cache hit → return early ───────────────────────────────
      if (kvResponse) {
        return buildKVCacheHitResponse(kvResponse, cachedFilename, context, shouldUseOrigins);
      }

      // ── 7. Cache miss bookkeeping ─────────────────────────────────
      if (env && !skipCache) {
        addBreadcrumb(context, 'KVCache', 'KV cache miss', { path: url.pathname });

        // Track cache miss
        Sentry.metrics.count('video_handler.cache.misses', 1, {
          attributes: { cache_type: 'kv' },
        });

        // Origins: check if version was incremented after cache miss
        if (shouldUseOrigins) {
          const versionKV = getVersionKV(env);
          if (versionKV) {
            const updatedCacheKey = generateKVKey(path, initialVideoOptions);
            const updatedVersion = (await getCacheKeyVersion(env, updatedCacheKey)) || 1;

            if (updatedVersion > (initialVideoOptions.version || 1)) {
              vhLogger.debug('Version was incremented after cache miss', {
                oldVersion: initialVideoOptions.version || 1,
                newVersion: updatedVersion,
                cacheKey: updatedCacheKey,
              });
              initialVideoOptions.version = updatedVersion;

              if (
                context.diagnostics.transformOptions &&
                typeof context.diagnostics.transformOptions === 'object'
              ) {
                (context.diagnostics.transformOptions as any).version = updatedVersion;
              }
            }
          }
        }
      }

      endTimedOperation(context, 'cache-lookup');

      // ── 8. Branch: Origins path vs Legacy path ────────────────────
      let response: Response;
      let videoOptions: any;

      if (shouldUseOrigins) {
        // ─────── Origins path ───────────────────────────────────────
        response = await handleOriginsPath(
          request,
          context,
          url,
          path,
          videoConfig,
          originMatch,
          sourceResolution,
          initialVideoOptions,
          env,
          config
        );
        videoOptions = initialVideoOptions;
      } else {
        // ─────── Legacy path ────────────────────────────────────────
        const legacyResult = await handleLegacyPath(
          request,
          context,
          url,
          path,
          videoConfig,
          config,
          env
        );
        response = legacyResult.response;
        videoOptions = legacyResult.videoOptions;
      }

      // ── 9. Post-transformation processing (shared) ────────────────
      context.diagnostics.processingTimeMs = Math.round(performance.now() - context.startTime);

      // Clone for KV caching BEFORE any range handling
      const responseForCache = response.clone();

      // Set up final response
      let finalResponse = response;

      // Handle range requests
      finalResponse = await handleRangeRequests(
        request,
        finalResponse,
        response,
        context,
        shouldUseOrigins ? 'VideoHandlerWithOrigins' : 'VideoHandler'
      );

      // Estimate video info
      estimateVideoInfo(context, videoOptions);

      // Store in KV cache (non-blocking)
      if (
        env &&
        videoOptions &&
        !skipCache &&
        responseForCache.headers.get('Cache-Control')?.includes('max-age=')
      ) {
        addBreadcrumb(context, 'Cache', 'Preparing to store in KV cache', {
          status: responseForCache.status,
          cacheControl: responseForCache.headers.get('Cache-Control'),
          contentType: responseForCache.headers.get('Content-Type'),
          contentLength: responseForCache.headers.get('Content-Length') || undefined,
        });

        startTimedOperation(context, 'cache-storage', 'Cache');

        await storeInKVCacheAsync(
          env,
          ctx,
          url,
          responseForCache,
          videoOptions,
          skipCache,
          context
        );

        endTimedOperation(context, 'cache-storage');
      } else if (skipCache && response.headers.get('Cache-Control')?.includes('max-age=')) {
        vhLogger.debug('Skipping cache storage due to debug parameter', {
          debugEnabled: context.debugEnabled,
          hasDebugParam: url.searchParams.has('debug'),
          debugParamValue: url.searchParams.get('debug'),
        });
      }

      // Build final response
      const originInfo =
        shouldUseOrigins && originMatch && sourceResolution
          ? { originName: originMatch.origin.name, sourceType: sourceResolution.originType }
          : undefined;

      const result = await buildFinalResponse(
        finalResponse,
        request,
        videoOptions,
        context,
        shouldUseOrigins,
        originInfo
      );

      // End the total request timing
      const totalDuration = endTimedOperation(context, 'total-request-processing');

      // Track response time
      if (totalDuration !== undefined) {
        Sentry.metrics.distribution('video_handler.response_time_ms', totalDuration, {
          unit: 'millisecond',
          attributes: {
            cache_status: kvResponse ? 'hit' : 'miss',
            has_origins: shouldUseOrigins ? 'yes' : 'no',
          },
        });
      }

      return result;
    } catch (err: unknown) {
      const shouldUseOrigins = videoConfig.shouldUseOrigins();
      return handleVideoError(err, request, context, env, shouldUseOrigins);
    }
  },
  {
    functionName: 'handleVideoRequest',
    component: 'VideoHandler',
    logErrors: true,
  }
);

// ════════════════════════════════════════════════════════════════════════════
// Origins path
// ════════════════════════════════════════════════════════════════════════════

async function handleOriginsPath(
  request: Request,
  context: any,
  url: URL,
  path: string,
  videoConfig: any,
  originMatch: any,
  sourceResolution: any,
  initialVideoOptions: any,
  env: EnvVariables | undefined,
  config: EnvironmentConfig
): Promise<Response> {
  // No matching origin → 404
  if (!originMatch) {
    vhLogger.debug('No matching origin for path', {
      path,
      originCount: videoConfig.getOrigins().length,
      origins: videoConfig.getOrigins().map((o: any) => o.name),
    });

    const errorResponse = new Response(`No matching origin found for path: ${path}`, {
      status: 404,
      headers: {
        'Content-Type': 'text/plain',
        'Cache-Control': 'no-store',
        'X-Handler': 'Origins',
        'X-Error': 'NoMatchingOrigin',
      },
    });

    const responseBuilder = new ResponseBuilder(errorResponse, context);
    return await responseBuilder.withDebugInfo().build();
  }

  // Found a matching origin - add to context
  context.diagnostics.origin = {
    name: originMatch.origin.name,
    matcher: originMatch.origin.matcher,
    capturedParams: originMatch.captures,
  };

  addBreadcrumb(context, 'Origins', 'Matched origin', {
    origin: originMatch.origin.name,
    matcher: originMatch.origin.matcher,
    captures: JSON.stringify(originMatch.captures),
  });

  vhLogger.debug('Matched origin for request', {
    origin: originMatch.origin.name,
    path,
    captures: originMatch.captures,
  });

  // No valid source → 500
  if (!sourceResolution) {
    vhLogger.debug('No valid source found in origin', {
      origin: originMatch.origin.name,
      sourceCount: originMatch.origin.sources.length,
      sources: originMatch.origin.sources.map((s: any) => s.type),
    });

    const errorResponse = new Response(
      `No valid source found in origin: ${originMatch.origin.name}`,
      {
        status: 500,
        headers: {
          'Content-Type': 'text/plain',
          'Cache-Control': 'no-store',
          'X-Handler': 'Origins',
          'X-Error': 'NoValidSource',
        },
      }
    );

    const responseBuilder = new ResponseBuilder(errorResponse, context);
    return await responseBuilder.withDebugInfo().build();
  }

  // Add source resolution to context
  context.diagnostics.sourceInfo = {
    type: sourceResolution.originType,
    resolvedPath: sourceResolution.resolvedPath,
    url: sourceResolution.sourceUrl,
  };

  addBreadcrumb(context, 'Origins', 'Resolved source', {
    sourceType: sourceResolution.originType,
    resolvedPath: sourceResolution.resolvedPath,
    url: sourceResolution.sourceUrl,
  });

  vhLogger.debug('Resolved path to source', {
    sourceType: sourceResolution.originType,
    resolvedPath: sourceResolution.resolvedPath,
    url: sourceResolution.sourceUrl,
  });

  // Get video options from path and query parameters
  const videoOptions = determineVideoOptions(request, url.searchParams, path);

  // Add origin-specific options
  if (originMatch.origin.quality && !videoOptions.quality) {
    videoOptions.quality = originMatch.origin.quality;
  }
  if (originMatch.origin.videoCompression && !videoOptions.compression) {
    videoOptions.compression = originMatch.origin.videoCompression;
  }

  // Use updated version from initialVideoOptions
  videoOptions.version = initialVideoOptions.version || 1;

  vhLogger.debug('Using cache version for transformation', {
    version: videoOptions.version,
    initialVersion: initialVideoOptions.version,
    path,
    hadCacheMiss: true,
  });

  const debugInfo = {
    isEnabled: context.debugEnabled,
    isVerbose: context.verboseEnabled,
    includeHeaders: true,
    includePerformance: true,
    debug: context.debugEnabled,
  };

  // ── Large video pre-check (HEAD for Content-Length) ───────────────
  let shouldBypassTransformation = false;
  let videoSizeInBytes: number | null = null;

  if (
    sourceResolution.sourceUrl &&
    (sourceResolution.sourceUrl.startsWith('http://') ||
      sourceResolution.sourceUrl.startsWith('https://'))
  ) {
    vhLogger.debug('Checking video size before transformation', {
      sourceUrl: sourceResolution.sourceUrl,
      origin: originMatch.origin.name,
    });

    addBreadcrumb(context, 'SizeCheck', 'Performing HEAD request for Content-Length', {
      url: sourceResolution.sourceUrl,
    });

    videoSizeInBytes = await getContentLength(sourceResolution.sourceUrl, {
      timeout: 5000,
      headers: request.headers,
    });

    if (videoSizeInBytes !== null) {
      const sizeInMB = Math.round(videoSizeInBytes / 1024 / 1024);
      const limitInMB = Math.round(CDN_CGI_SIZE_LIMIT / 1024 / 1024);

      vhLogger.debug('Retrieved video size', {
        sizeBytes: videoSizeInBytes,
        sizeMB: sizeInMB,
        limitMB: limitInMB,
        exceedsLimit: exceedsTransformationLimit(videoSizeInBytes),
      });

      addBreadcrumb(context, 'SizeCheck', 'Video size retrieved', {
        sizeMB: sizeInMB,
        exceedsLimit: exceedsTransformationLimit(videoSizeInBytes),
      });

      if (exceedsTransformationLimit(videoSizeInBytes)) {
        shouldBypassTransformation = true;

        vhLogger.warn('Video exceeds CDN-CGI size limit, bypassing transformation', {
          sizeMB: sizeInMB,
          limitMB: limitInMB,
          sourceUrl: sourceResolution.sourceUrl,
          origin: originMatch.origin.name,
          requestId: context.requestId,
        });

        addBreadcrumb(context, 'SizeCheck', 'Bypassing transformation - video too large', {
          sizeMB: sizeInMB,
          limitMB: limitInMB,
          reason: 'Exceeds 256 MiB transformation limit',
        });
      }
    } else {
      vhLogger.debug('Could not retrieve Content-Length, proceeding with transformation', {
        sourceUrl: sourceResolution.sourceUrl,
        reason: 'HEAD request failed or no Content-Length header',
      });

      addBreadcrumb(context, 'SizeCheck', 'Content-Length unavailable', {
        reason: 'Will attempt transformation',
      });
    }
  }

  // ── If size check indicates bypass, stream directly from source ───
  if (shouldBypassTransformation) {
    vhLogger.debug('Streaming directly from source without transformation', {
      sourceUrl: sourceResolution.sourceUrl,
      sizeMB: videoSizeInBytes ? Math.round(videoSizeInBytes / 1024 / 1024) : 'unknown',
    });

    addBreadcrumb(context, 'DirectStream', 'Fetching directly from origin', {
      sourceUrl: sourceResolution.sourceUrl,
      bypassReason: 'Video exceeds transformation size limit',
    });

    startTimedOperation(context, 'direct-fetch-large-video', 'DirectFetch');

    try {
      const directResponse = await fetch(sourceResolution.sourceUrl, {
        method: request.method,
        headers: request.headers,
        redirect: 'follow',
      });

      if (!directResponse.ok) {
        vhLogger.error('Direct fetch failed for large video', {
          status: directResponse.status,
          sourceUrl: sourceResolution.sourceUrl,
          requestId: context.requestId,
        });

        addBreadcrumb(context, 'DirectStream', 'Direct fetch failed', {
          status: directResponse.status,
        });
        // Fall through to transformation attempt as fallback
      } else {
        const headers = new Headers(directResponse.headers);
        headers.set('X-Video-Size-Bypass', 'true');
        headers.set('X-Video-Exceeds-256MiB', 'true');
        headers.set('X-Direct-Stream', 'true');
        headers.set('X-Bypass-Cache-API', 'true');
        headers.set('X-Handler', 'Origins');
        headers.set('X-Origin', originMatch.origin.name);

        if (videoSizeInBytes !== null) {
          headers.set('X-Original-Content-Length', videoSizeInBytes.toString());
        }

        const finalResponse = new Response(directResponse.body, {
          status: directResponse.status,
          statusText: directResponse.statusText,
          headers,
        });

        vhLogger.debug('Successfully streamed large video directly', {
          status: directResponse.status,
          contentType: directResponse.headers.get('Content-Type'),
          hasRangeSupport: directResponse.headers.get('Accept-Ranges') === 'bytes',
          sizeMB: videoSizeInBytes ? Math.round(videoSizeInBytes / 1024 / 1024) : 'unknown',
        });

        addBreadcrumb(context, 'DirectStream', 'Direct streaming successful', {
          status: directResponse.status,
          bypassedTransformation: true,
        });

        endTimedOperation(context, 'direct-fetch-large-video');

        context.diagnostics.processingTimeMs = Math.round(performance.now() - context.startTime);

        const responseBuilder = new ResponseBuilder(finalResponse, context);
        return await responseBuilder.withDebugInfo().build();
      }
    } catch (error) {
      vhLogger.error('Error during direct fetch for large video', {
        error: error instanceof Error ? error.message : String(error),
        sourceUrl: sourceResolution.sourceUrl,
        requestId: context.requestId,
      });

      addBreadcrumb(context, 'DirectStream', 'Direct fetch error', {
        error: error instanceof Error ? error.message : String(error),
      });
      // Fall through to transformation attempt as fallback
    } finally {
      endTimedOperation(context, 'direct-fetch-large-video');
    }
  }

  // ── Request coalescing ────────────────────────────────────────────
  const transformKey = `${originMatch.origin.name}:${sourceResolution.resolvedPath}:${JSON.stringify(
    {
      width: videoOptions.width,
      height: videoOptions.height,
      derivative: videoOptions.derivative,
      quality: videoOptions.quality,
      compression: videoOptions.compression,
      format: videoOptions.format,
      mode: videoOptions.mode,
    }
  )}`;

  const existingTransform = inFlightTransformations.get(transformKey);

  let response: Response;

  if (existingTransform) {
    vhLogger.debug('Joining existing transformation request', {
      transformKey: transformKey.substring(0, 100),
      inFlightCount: inFlightTransformations.size,
    });

    addBreadcrumb(context, 'Transform', 'Coalescing with existing transformation', {
      origin: originMatch.origin.name,
      path: sourceResolution.resolvedPath,
    });

    startTimedOperation(context, 'video-transformation-coalesced', 'Transform');

    try {
      response = await existingTransform;

      vhLogger.debug('Successfully joined existing transformation', {
        origin: originMatch.origin.name,
        status: response.status,
      });
    } finally {
      endTimedOperation(context, 'video-transformation-coalesced');
    }
  } else {
    vhLogger.debug('Initiating new transformation', {
      transformKey: transformKey.substring(0, 100),
      origin: originMatch.origin.name,
      path: sourceResolution.resolvedPath,
    });

    startTimedOperation(context, 'video-transformation', 'Transform');

    const transformPromise = transformVideoWithOrigins(
      request,
      videoOptions as any,
      originMatch.origin,
      sourceResolution,
      debugInfo,
      env
    );

    inFlightTransformations.set(transformKey, transformPromise);

    try {
      response = await transformPromise;

      vhLogger.debug('Transformation completed successfully', {
        origin: originMatch.origin.name,
        status: response.status,
        contentType: response.headers.get('Content-Type'),
      });
    } finally {
      inFlightTransformations.delete(transformKey);
      endTimedOperation(context, 'video-transformation');

      vhLogger.debug('Cleaned up in-flight transformation', {
        remainingInFlight: inFlightTransformations.size,
      });
    }
  }

  // Clone response for coalesced requests to avoid stream locking
  if (existingTransform) {
    response = response.clone();
    vhLogger.debug('Cloned response for coalesced request', {
      origin: originMatch.origin.name,
      status: response.status,
      reason: 'Avoiding stream lock on shared response',
    });
  }

  return response;
}

// ════════════════════════════════════════════════════════════════════════════
// Legacy path
// ════════════════════════════════════════════════════════════════════════════

async function handleLegacyPath(
  request: Request,
  context: any,
  url: URL,
  path: string,
  videoConfig: any,
  config: EnvironmentConfig,
  env: EnvVariables | undefined
): Promise<{ response: Response; videoOptions: any }> {
  // Initialize Origin resolver and get path patterns
  startTimedOperation(context, 'origin-resolution', 'Origin');

  // Get path patterns from config
  let pathPatterns = config.pathPatterns || videoConfig.getPathPatterns();

  // Check if Origins system is configured (it shouldn't be on this path, but handle defensively)
  const shouldUseOrigins = videoConfig.shouldUseOrigins();

  if (shouldUseOrigins) {
    // This shouldn't happen in the unified handler's legacy path, but retain for safety
    vhLogger.debug('Using Origins system for path pattern matching', {
      path,
      useLegacyFallback: !shouldUseOrigins,
    });

    const resolver = new OriginResolver(videoConfig.getConfig());
    const origins = videoConfig.getOrigins();

    vhLogger.debug('Origins configuration loaded', {
      originCount: origins.length,
      originNames: origins.map((o: any) => o.name),
    });

    addBreadcrumb(context, 'Origins', 'Using Origins for path resolution', {
      originCount: origins.length,
      originNames: origins.map((o: any) => o.name).join(', '),
    });

    if (origins.length > 0) {
      try {
        const convertOriginToPathPattern = (origin: Origin) => {
          const sortedSources = [...origin.sources].sort((a, b) => a.priority - b.priority);
          const primarySource = sortedSources[0];

          return {
            name: origin.name,
            matcher: origin.matcher,
            processPath: origin.processPath ?? true,
            baseUrl: null,
            originUrl: primarySource?.url || null,
            quality: origin.quality,
            ttl: origin.ttl,
            priority: 0,
            auth: primarySource?.auth
              ? {
                  type: primarySource.auth.type,
                  enabled: primarySource.auth.enabled,
                  accessKeyVar: primarySource.auth.accessKeyVar,
                  secretKeyVar: primarySource.auth.secretKeyVar,
                  region: primarySource.auth.region,
                  service: primarySource.auth.service,
                  expiresInSeconds: primarySource.auth.expiresInSeconds,
                  sessionTokenVar: primarySource.auth.sessionTokenVar,
                }
              : undefined,
            captureGroups: origin.captureGroups,
            transformationOverrides: origin.transformOptions || {},
          };
        };

        const originBasedPatterns = origins.map(convertOriginToPathPattern);

        vhLogger.debug('Converted Origins to PathPatterns', {
          originalCount: origins.length,
          convertedCount: originBasedPatterns.length,
        });

        pathPatterns = originBasedPatterns;
      } catch (err) {
        vhLogger.error('Error converting Origins to PathPatterns', {
          error: err instanceof Error ? err.message : String(err),
        });
        pathPatterns = config.pathPatterns || videoConfig.getPathPatterns();
      }
    }
  } else {
    vhLogger.debug('Using legacy path patterns', {
      patternCount: pathPatterns.length,
      patterns: pathPatterns.map((p: any) => ({
        name: p.name,
        matcher: p.matcher,
        processPath: p.processPath,
      })),
    });
  }

  endTimedOperation(context, 'origin-resolution');

  addBreadcrumb(context, 'Configuration', 'Path patterns for request', {
    patternCount: pathPatterns.length,
    patterns: pathPatterns.map((p: any) => p.name).join(', '),
    fromOrigins: shouldUseOrigins,
  });

  // Get video options from path and query parameters
  const videoOptions = determineVideoOptions(request, url.searchParams, path);

  const debugInfo = {
    isEnabled: context.debugEnabled,
    isVerbose: context.verboseEnabled,
    includeHeaders: true,
    includePerformance: true,
    debug: context.debugEnabled,
  };

  // Time the video transformation operation
  startTimedOperation(context, 'video-transformation', 'Transform');
  const response = await transformVideoLegacy(
    request,
    videoOptions as any,
    pathPatterns,
    debugInfo,
    env
  );
  endTimedOperation(context, 'video-transformation');

  return { response, videoOptions };
}

// ════════════════════════════════════════════════════════════════════════════
// Transformation helpers
// ════════════════════════════════════════════════════════════════════════════

/**
 * Legacy transformation via videoTransformationService
 */
async function transformVideoLegacy(
  request: Request,
  options: Record<string, unknown>,
  pathPatterns: any[],
  debugInfo: any,
  env?: EnvVariables
): Promise<Response> {
  return transformVideo(request, options, pathPatterns, debugInfo, env);
}

/**
 * Origins-based transformation via TransformVideoCommand
 */
async function transformVideoWithOrigins(
  request: Request,
  options: any,
  origin: Origin,
  sourceResolution: any,
  debugInfo: any,
  env?: EnvVariables
): Promise<Response> {
  vhLogger.debug('Transforming video with Origins', {
    origin: origin.name,
    sourceType: sourceResolution.originType,
    resolvedPath: sourceResolution.resolvedPath,
    url: sourceResolution.sourceUrl,
  });

  try {
    const command = new TransformVideoCommand({
      origin,
      sourceResolution,
      options,
      request,
      env: env as unknown as WorkerEnvironment,
      debugMode: debugInfo.isEnabled,
    });

    return await command.execute();
  } catch (err) {
    vhLogger.error('Error transforming video with Origins', {
      error: err instanceof Error ? err.message : 'Unknown error',
      origin: origin.name,
      sourceType: sourceResolution.originType,
    });

    const errorMessage = err instanceof Error ? err.message : 'Unknown transformation error';
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

    const currentCtx = getCurrentContext();
    const responseCtx = currentCtx || {
      requestId: `origins-error-${Date.now()}`,
      url: request.url,
      startTime: performance.now(),
      breadcrumbs: [],
      componentTiming: {},
      diagnostics: {
        errors: [errorMessage],
        originalUrl: request.url,
      },
      debugEnabled: false,
      verboseEnabled: false,
    };

    const responseBuilder = new ResponseBuilder(errorResponse, responseCtx);
    return await responseBuilder.build();
  }
}

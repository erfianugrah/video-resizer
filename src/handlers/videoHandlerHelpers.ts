/**
 * Shared helper functions for the unified video handler
 *
 * Extracted from the common logic between legacy videoHandler and videoHandlerWithOrigins
 * to reduce duplication and ensure consistent behavior.
 */

import { EnvVariables } from '../config/environmentConfig';
import { VideoConfigurationManager } from '../config/VideoConfigurationManager';
import { TransformOptions, getFromKVCache, storeInKVCache } from '../utils/kvCacheUtils';
import {
  createRequestContext,
  addBreadcrumb,
  startTimedOperation,
  endTimedOperation,
  setCurrentContext,
  RequestContext,
} from '../utils/requestContext';
import { initializeLegacyLogger, createCategoryLogger } from '../utils/logger';
import { logErrorWithContext } from '../utils/errorHandlingUtils';
import { ResponseBuilder } from '../utils/responseBuilder';
import { determineVideoOptions } from './videoOptionsService';
import { isCdnCgiMediaPath } from '../utils/pathUtils';
import type { EnvWithExecutionContext } from '../types/cloudflare';
import { getCacheKV } from '../utils/flexibleBindings';
import * as Sentry from '@sentry/cloudflare';
import { CacheConfigurationManager } from '../config/CacheConfigurationManager';
import { DebugConfigurationManager } from '../config/DebugConfigurationManager';
import { generateCacheTags } from '../services/videoStorageService';
import { hasBypassHeaders } from '../utils/bypassHeadersUtils';
import { handleRangeRequest } from '../utils/streamUtils';
import { handleRangeRequestForInitialAccess } from '../utils/httpUtils';

const vhLogger = createCategoryLogger('VideoHandler');
const kvLogger = createCategoryLogger('KVCacheUtils');
const rbLogger = createCategoryLogger('ResponseBuilder');

// ────────────────────────────────────────────────────────────────────────────
// Context / setup
// ────────────────────────────────────────────────────────────────────────────

export interface HandlerContext {
  context: RequestContext;
  url: URL;
  path: string;
  skipCache: boolean;
  videoConfig: VideoConfigurationManager;
}

/**
 * Create the handler context: request context, timing, legacy logger, URL parsing, breadcrumbs.
 */
export function setupHandlerContext(
  request: Request,
  env: EnvVariables | undefined,
  ctx: ExecutionContext | undefined
): HandlerContext {
  // Pass execution context to environment for waitUntil usage in caching
  if (env && ctx) {
    (env as unknown as EnvWithExecutionContext).executionCtx = ctx;
  }

  // Create request context and logger, pass execution context for waitUntil operations
  const context = createRequestContext(request, ctx);

  // Set the current request context for the global context manager
  setCurrentContext(context);

  // Log environment variables received for debugging
  if (env) {
    const cacheKV = getCacheKV(env);
    vhLogger.debug('Environment variables received', {
      CACHE_ENABLE_KV: env.CACHE_ENABLE_KV || 'not set',
      CACHE_KV_AVAILABLE: !!cacheKV,
      CACHE_KV_NAME: env.CACHE_KV_NAME || 'not set',
      ENVIRONMENT: env.ENVIRONMENT || 'not set',
    });
  }

  // Start timing the entire request processing
  startTimedOperation(context, 'total-request-processing', 'Request');

  // Initialize legacy logger for backward compatibility
  initializeLegacyLogger(request);

  // Parse URL first for the breadcrumb data
  const url = new URL(request.url);
  const path = url.pathname;

  // Add initial breadcrumb
  addBreadcrumb(context, 'Request', 'Started total-request-processing', {
    url: url.toString(),
    path: path,
    elapsedMs: 0,
  });

  // Create breadcrumb for tracking request details
  addBreadcrumb(context, 'Request', 'Request received', {
    method: request.method,
    url: url.toString(),
    path: path,
    search: url.search,
  });

  const videoConfig = VideoConfigurationManager.getInstance();
  const skipCache = url.searchParams.has('debug');

  return { context, url, path, skipCache, videoConfig };
}

/**
 * Check if this is a CDN-CGI media path and return a passthrough response if so.
 * Returns null if the path is not a CDN-CGI path and processing should continue.
 */
export function checkCdnCgiPassthrough(path: string, request: Request): Response | null {
  if (isCdnCgiMediaPath(path)) {
    vhLogger.info('Request is already a CDN-CGI media request, passing through');
    return fetch(request) as unknown as Response;
  }
  return null;
}

// ────────────────────────────────────────────────────────────────────────────
// KV cache lookup
// ────────────────────────────────────────────────────────────────────────────

export interface KVCacheCheckResult {
  kvResponse: Response | null;
  cachedFilename: string | null;
  videoOptions: any;
}

/**
 * Check KV cache for a cached response.
 *
 * @param env Environment variables
 * @param url Parsed URL
 * @param skipCache Whether to skip cache
 * @param videoOptions Video options (may be enriched with origin-specific options)
 * @param request The incoming request (for range handling)
 * @param context Request context
 */
export async function checkKVCache(
  env: EnvVariables | undefined,
  url: URL,
  skipCache: boolean,
  videoOptions: any,
  request: Request,
  context: RequestContext
): Promise<KVCacheCheckResult> {
  // Try to get the response from KV cache
  addBreadcrumb(context, 'Cache', 'Checking KV cache', {
    url: request.url,
    bypassParams: CacheConfigurationManager.getInstance()
      .getConfig()
      .bypassQueryParameters?.join(','),
  });

  // Time the cache lookup operation
  startTimedOperation(context, 'cache-lookup', 'Cache');

  let kvResponse: Response | null = null;

  // Start timing operations
  startTimedOperation(context, 'kv-cache-lookup', 'KVCache');

  const sourcePath = url.pathname;
  const cachedFilename = videoOptions.filename || null;

  // Prepare KV cache check if env is available and not skipped
  if (env && !skipCache) {
    // Get KV cache configuration
    const cacheConfig = CacheConfigurationManager.getInstance();
    const kvCacheEnabled = cacheConfig.isKVCacheEnabled();

    // Only check KV cache if it's enabled in config
    if (kvCacheEnabled) {
      addBreadcrumb(context, 'Cache', 'Checking KV cache', {
        url: request.url,
        path: sourcePath,
        options: JSON.stringify(videoOptions),
      });

      kvLogger.debug('Checking KV cache for video', {
        sourcePath: sourcePath,
        derivative: videoOptions.derivative,
        hasQuery: url.search.length > 0,
      });

      try {
        // Check KV cache with request for range handling support
        kvResponse = await getFromKVCache(
          env,
          sourcePath,
          videoOptions as unknown as TransformOptions,
          request
        );
      } catch (err) {
        kvLogger.debug('Error checking KV cache', {
          error: err instanceof Error ? err.message : String(err),
          sourcePath,
        });
      }
    } else {
      kvLogger.debug('Skipping KV cache (disabled by configuration)', {
        sourcePath: sourcePath,
        enableKVCache: false,
      });
    }
  } else if (skipCache) {
    vhLogger.debug('Skipping KV cache due to debug mode', {
      debugEnabled: context.debugEnabled,
      hasDebugParam: url.searchParams.has('debug'),
    });
  }

  endTimedOperation(context, 'kv-cache-lookup');

  return { kvResponse, cachedFilename, videoOptions };
}

// ────────────────────────────────────────────────────────────────────────────
// KV cache hit response
// ────────────────────────────────────────────────────────────────────────────

/**
 * Build a full response from a KV cache hit.
 *
 * @param kvResponse The KV cache response
 * @param cachedFilename The filename for Content-Disposition
 * @param context Request context
 * @param isOrigins Whether this is an Origins-path request
 */
export async function buildKVCacheHitResponse(
  kvResponse: Response,
  cachedFilename: string | null,
  context: RequestContext,
  isOrigins: boolean
): Promise<Response> {
  // Get cache details from headers
  const cacheAge = kvResponse.headers.get('X-KV-Cache-Age') || 'unknown';
  const cacheTtl = kvResponse.headers.get('X-KV-Cache-TTL') || 'unknown';
  const url = kvResponse.headers.get('X-KV-Cache-Key') || 'unknown';
  const contentLength = kvResponse.headers.get('Content-Length') || 'unknown';
  const contentType = kvResponse.headers.get('Content-Type') || 'unknown';

  // Log the KV cache hit
  vhLogger.info('Serving from KV cache', {
    cacheAge,
    cacheTtl,
    cacheKey: url,
    contentType,
    contentLength,
    fromKvCache: true,
  });

  addBreadcrumb(context, 'Cache', 'KV cache hit', {
    cacheAge,
    contentType,
    size: contentLength,
  });

  // Track cache hit
  Sentry.metrics.count('video_handler.cache.hits', 1, {
    attributes: { cache_type: 'kv' },
  });

  // End overall cache lookup timing
  endTimedOperation(context, 'cache-lookup');

  // Ensure debug configuration is applied to the context
  const debugConfig = DebugConfigurationManager.getInstance();

  // Override context debug flags with current configuration
  context.debugEnabled = debugConfig.isDebugEnabled() || context.debugEnabled;
  context.verboseEnabled = debugConfig.isVerboseEnabled() || context.verboseEnabled;

  rbLogger.debug('Building KV cached response with debug configuration', {
    debugEnabled: context.debugEnabled,
    verboseEnabled: context.verboseEnabled,
  });

  // Create a new response with the same body but mutable headers
  const headers = new Headers(kvResponse.headers);
  headers.set('X-Cache-Source', 'KV');
  headers.set('X-Cache-Status', 'HIT');
  if (isOrigins) {
    headers.set('X-Handler', 'Origins');
  }
  const mutableResponse = new Response(kvResponse.body, {
    status: kvResponse.status,
    statusText: kvResponse.statusText,
    headers: headers,
  });

  // Force audio content type for audio mode to avoid browsers treating it as video
  let adjustedResponse: Response = mutableResponse;
  if (cachedFilename && cachedFilename.endsWith('.m4a')) {
    const h = new Headers(mutableResponse.headers);
    h.set('Content-Type', 'audio/mp4');
    adjustedResponse = new Response(mutableResponse.body, {
      status: mutableResponse.status,
      statusText: mutableResponse.statusText,
      headers: h,
    });
  }

  const responseBuilder = new ResponseBuilder(adjustedResponse, context);
  const builtResponse = await responseBuilder.withFilename(cachedFilename).withDebugInfo().build();
  endTimedOperation(context, 'total-request-processing');
  return builtResponse;
}

// ────────────────────────────────────────────────────────────────────────────
// Range request handling
// ────────────────────────────────────────────────────────────────────────────

/**
 * Handle range requests on a final response.
 * This is the ~155 lines of nearly-identical range handling shared between both handlers.
 *
 * @param request The incoming request
 * @param finalResponse The response to process ranges on (mutated by reference via return)
 * @param response The original un-ranged response (needed for Cache API method)
 * @param context Request context
 * @param handlerTag Tag for logging (e.g. 'VideoHandler' or 'VideoHandlerWithOrigins')
 * @returns The (possibly 206) response
 */
export async function handleRangeRequests(
  request: Request,
  finalResponse: Response,
  response: Response,
  context: RequestContext,
  handlerTag: string
): Promise<Response> {
  if (
    !request.headers.has('Range') ||
    !finalResponse.headers.get('Content-Type')?.includes('video/')
  ) {
    return finalResponse;
  }

  // Check if this is a fallback response, large video, or any other bypass flag
  const bypassCacheApi =
    hasBypassHeaders(finalResponse.headers) ||
    finalResponse.headers.get('X-Video-Too-Large') === 'true' ||
    finalResponse.headers.get('X-Fallback-Applied') === 'true';

  if (bypassCacheApi) {
    // Identify the reason for bypass
    const bypassReason =
      finalResponse.headers.get('X-Video-Exceeds-256MiB') === 'true'
        ? 'VideoTooLarge'
        : finalResponse.headers.get('X-Fallback-Applied') === 'true'
          ? 'FallbackContent'
          : 'CacheAPIBypass';

    addBreadcrumb(context, 'RangeRequest', 'Using direct streaming (bypassing Cache API)', {
      contentLength: finalResponse.headers.get('Content-Length'),
      contentType: finalResponse.headers.get('Content-Type'),
      bypassReason,
      hasRangeSupport: finalResponse.headers.get('Accept-Ranges') === 'bytes',
    });

    vhLogger.debug('Direct streaming video response without Cache API', {
      contentLength: finalResponse.headers.get('Content-Length'),
      contentType: finalResponse.headers.get('Content-Type'),
      hasRangeSupport: finalResponse.headers.get('Accept-Ranges') === 'bytes',
      bypassReason,
    });

    const rangeHeader = request.headers.get('Range');
    // Only process range requests if the response is NOT already a 206 Partial Content
    if (
      rangeHeader &&
      finalResponse.headers.get('Accept-Ranges') === 'bytes' &&
      finalResponse.status !== 206
    ) {
      try {
        vhLogger.debug('Processing range request for direct stream', {
          rangeHeader,
          contentLength: finalResponse.headers.get('Content-Length'),
          bypassReason,
        });

        const rangeResponse = await handleRangeRequest(finalResponse, rangeHeader, {
          bypassCacheAPI: true,
          preserveHeaders: true,
          handlerTag: `${handlerTag}-Direct-Stream`,
          fallbackApplied: finalResponse.headers.get('X-Fallback-Applied') === 'true',
        });

        if (rangeResponse.status === 206) {
          finalResponse = rangeResponse;

          addBreadcrumb(context, 'RangeRequest', 'Range request handled for direct stream', {
            contentRange: finalResponse.headers.get('Content-Range'),
            contentLength: finalResponse.headers.get('Content-Length'),
            range: rangeHeader,
          });

          vhLogger.debug('Created 206 Partial Content response for direct stream', {
            status: 206,
            contentRange: finalResponse.headers.get('Content-Range'),
            contentLength: finalResponse.headers.get('Content-Length'),
          });
        }
      } catch (rangeError) {
        vhLogger.error('Error handling range request for direct stream', {
          error: rangeError instanceof Error ? rangeError.message : String(rangeError),
          range: rangeHeader,
        });
        // Keep the original response if range handling fails
      }
    } else if (rangeHeader && finalResponse.status === 206) {
      // The origin already handled the range request
      vhLogger.debug('Origin already returned 206 Partial Content, passing through as-is', {
        rangeHeader,
        contentRange: finalResponse.headers.get('Content-Range'),
        contentLength: finalResponse.headers.get('Content-Length'),
        bypassReason,
      });

      addBreadcrumb(context, 'RangeRequest', 'Origin handled range request directly', {
        status: 206,
        contentRange: finalResponse.headers.get('Content-Range'),
        rangeHeader,
      });
    }
  } else {
    // Regular video - use Cache API for range handling
    addBreadcrumb(context, 'RangeRequest', 'Processing range request for initial access', {
      range: request.headers.get('Range'),
      contentLength: finalResponse.headers.get('Content-Length'),
      contentType: finalResponse.headers.get('Content-Type'),
    });

    startTimedOperation(context, 'initial-range-handling', 'RangeRequest');

    try {
      finalResponse = await handleRangeRequestForInitialAccess(response, request);

      addBreadcrumb(context, 'RangeRequest', 'Range request handled for initial access', {
        originalStatus: response.status,
        newStatus: finalResponse.status,
        contentRange: finalResponse.headers.get('Content-Range'),
        contentLength: finalResponse.headers.get('Content-Length'),
      });
    } catch (err) {
      vhLogger.error('Error handling range request for initial access', {
        error: err instanceof Error ? err.message : String(err),
        range: request.headers.get('Range'),
      });
    }

    endTimedOperation(context, 'initial-range-handling');
  }

  return finalResponse;
}

// ────────────────────────────────────────────────────────────────────────────
// Estimate video info
// ────────────────────────────────────────────────────────────────────────────

/**
 * If derivative is present, make a more educated guess about video info
 * from the requested dimensions.
 */
export function estimateVideoInfo(context: RequestContext, videoOptions: any): void {
  if (context.diagnostics.derivative && videoOptions?.width && videoOptions?.height) {
    context.diagnostics.videoInfo = context.diagnostics.videoInfo || {};

    if (videoOptions.width > 640 && !context.diagnostics.videoInfo.width) {
      context.diagnostics.videoInfo.width = videoOptions.width;
    }

    if (videoOptions.height > 480 && !context.diagnostics.videoInfo.height) {
      context.diagnostics.videoInfo.height = videoOptions.height;
    }
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Build final response (debug config, cache tags, audio adjustment, ResponseBuilder)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Build the final response: apply debug config, cache tags, audio adjustment, ResponseBuilder.
 *
 * @param finalResponse The response to finalise
 * @param request The incoming request
 * @param videoOptions The video options
 * @param context Request context
 * @param isOrigins Whether we're on the Origins path
 * @param originInfo Optional origin info for Origins handler headers
 */
export async function buildFinalResponse(
  finalResponse: Response,
  request: Request,
  videoOptions: any,
  context: RequestContext,
  isOrigins: boolean,
  originInfo?: { originName: string; sourceType: string }
): Promise<Response> {
  // Use ResponseBuilder for consistent response handling
  startTimedOperation(context, 'response-building', 'Response');

  // Ensure debug configuration is applied to the context
  const debugConfig = DebugConfigurationManager.getInstance();

  context.debugEnabled = debugConfig.isDebugEnabled() || context.debugEnabled;
  context.verboseEnabled = debugConfig.isVerboseEnabled() || context.verboseEnabled;

  rbLogger.debug('Building response with debug configuration', {
    debugEnabled: context.debugEnabled,
    verboseEnabled: context.verboseEnabled,
  });

  // For the Origins path, create a single ResponseBuilder and add origin headers
  const responseBuilder = new ResponseBuilder(finalResponse, context);

  if (isOrigins && originInfo) {
    responseBuilder.withHeaders({
      'X-Handler': 'Origins',
      'X-Origin': originInfo.originName,
      'X-Source-Type': originInfo.sourceType,
    });
  }

  // Check if we should add cache tags
  if (finalResponse.ok && finalResponse.status < 300) {
    try {
      const cacheConfigMgr = CacheConfigurationManager.getInstance();
      if (cacheConfigMgr.getConfig().enableCacheTags) {
        const reqUrl = new URL(request.url);
        const tags = generateCacheTags(reqUrl.pathname, videoOptions as any, finalResponse.headers);
        if (tags.length > 0) {
          vhLogger.debug('Applying cache tags to final response', {
            tagCount: tags.length,
          });

          if (isOrigins) {
            // Origins path: add via ResponseBuilder (avoids re-creating Response and disturbing body)
            responseBuilder.withHeaders({
              'Cache-Tag': tags.join(','),
            });
          } else {
            // Legacy path: clone the response to modify headers
            const newHeaders = new Headers(finalResponse.headers);
            newHeaders.set('Cache-Tag', tags.join(','));
            finalResponse = new Response(finalResponse.body, {
              status: finalResponse.status,
              statusText: finalResponse.statusText,
              headers: newHeaders,
            });
          }

          addBreadcrumb(context, 'Cache', 'Applied Cache-Tags to final response', {
            count: tags.length,
            firstTags: tags.slice(0, 3).join(','),
          });
        }
      }
    } catch (tagError) {
      vhLogger.error('Failed to apply cache tags', {
        error: tagError instanceof Error ? tagError.message : String(tagError),
      });
    }
  }

  // Ensure audio responses present correct content type for inline playback
  if (
    videoOptions.mode === 'audio' ||
    (videoOptions.format && String(videoOptions.format).toLowerCase() === 'm4a')
  ) {
    if (!isOrigins) {
      // Legacy path: create a new Response with the adjusted Content-Type
      const h = new Headers(finalResponse.headers);
      h.set('Content-Type', 'audio/mp4');
      finalResponse = new Response(finalResponse.body, {
        status: finalResponse.status,
        statusText: finalResponse.statusText,
        headers: h,
      });
    }
    // For Origins path, the ResponseBuilder already owns the body; audio adjustment
    // is done on the headers of the ResponseBuilder's internal response below.
  }

  // Build the response through ResponseBuilder
  // For Origins path, we must use the single responseBuilder (already constructed above).
  // For Legacy path, we need a new responseBuilder on the (possibly modified) finalResponse.
  let result: Response;
  if (isOrigins) {
    result = await responseBuilder.withFilename(videoOptions.filename).withDebugInfo().build();
  } else {
    const legacyRb = new ResponseBuilder(finalResponse, context);
    result = await legacyRb.withFilename(videoOptions.filename).withDebugInfo().build();
  }

  endTimedOperation(context, 'response-building');
  return result;
}

// ────────────────────────────────────────────────────────────────────────────
// KV cache storage (async, non-blocking)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Store a response in KV cache asynchronously (uses waitUntil when available).
 */
export async function storeInKVCacheAsync(
  env: EnvVariables,
  ctx: ExecutionContext | undefined,
  url: URL,
  responseForCache: Response,
  videoOptions: any,
  skipCache: boolean,
  context: RequestContext
): Promise<void> {
  if (skipCache) return;

  const cacheConfig = CacheConfigurationManager.getInstance();
  const kvCacheEnabled = cacheConfig.isKVCacheEnabled();

  if (!kvCacheEnabled) {
    vhLogger.debug('Skipping KV cache storage (disabled by configuration)', {
      enableKVCache: false,
    });
    return;
  }

  const sourcePath = url.pathname;

  const imwidth = url.searchParams.get('imwidth');
  const imheight = url.searchParams.get('imheight');
  const hasIMRef = url.searchParams.has('imref');
  const hasIMQueryParams = !!(imwidth || imheight || hasIMRef);

  let videoOptionsForKV = videoOptions;
  if (hasIMQueryParams && videoOptions.derivative) {
    videoOptionsForKV = {
      derivative: videoOptions.derivative,
      width: videoOptions.width,
      height: videoOptions.height,
      mode: videoOptions.mode,
      version: videoOptions.version,
    };

    addBreadcrumb(context, 'Cache', 'Using optimized IMQuery cache key', {
      derivative: videoOptions.derivative,
      originalParams: Object.keys(videoOptions).length,
      optimizedParams: Object.keys(videoOptionsForKV).length,
    });
  }

  // Add origin TTL if available
  const originTtl = responseForCache.headers.get('X-Origin-TTL');
  if (originTtl) {
    videoOptionsForKV = {
      ...videoOptionsForKV,
      customData: {
        ...(videoOptionsForKV.customData || {}),
        originTtl: parseInt(originTtl, 10),
      },
    };
  }

  const storePromise = storeInKVCache(
    env,
    sourcePath,
    responseForCache,
    videoOptionsForKV as unknown as TransformOptions
  )
    .then((success) => {
      if (success) {
        vhLogger.debug('Stored in KV cache', {
          path: sourcePath,
          hasIMQuery: hasIMQueryParams,
          derivative: videoOptions.derivative,
        });
      } else {
        vhLogger.debug('Failed to store in KV cache', { path: sourcePath });
      }
    })
    .catch((err) => {
      vhLogger.error('Error storing in KV cache', {
        error: err instanceof Error ? err.message : 'Unknown error',
        path: sourcePath,
      });
    });

  // Use waitUntil if available
  const envWithCtx = env as unknown as EnvWithExecutionContext;
  if (envWithCtx.executionCtx && typeof envWithCtx.executionCtx.waitUntil === 'function') {
    envWithCtx.executionCtx.waitUntil(storePromise);
  } else if (ctx && typeof ctx.waitUntil === 'function') {
    ctx.waitUntil(storePromise);
  }
  // Otherwise fire-and-forget (promise was already started)
}

// ────────────────────────────────────────────────────────────────────────────
// Error handling
// ────────────────────────────────────────────────────────────────────────────

/**
 * Handle errors in the video handler catch block.
 */
export async function handleVideoError(
  err: unknown,
  request: Request,
  context: RequestContext,
  env: EnvVariables | undefined,
  isOrigins: boolean
): Promise<Response> {
  startTimedOperation(context, 'error-handling', 'Error');

  const component = isOrigins ? 'VideoHandlerWithOrigins' : 'VideoHandler';
  logErrorWithContext(
    `Error handling video request${isOrigins ? ' with Origins' : ''}`,
    err,
    {
      url: request.url,
      path: new URL(request.url).pathname,
      requestId: context.requestId,
    },
    component
  );

  // Add error to diagnostics
  if (!context.diagnostics.errors) {
    context.diagnostics.errors = [];
  }
  context.diagnostics.errors.push(err instanceof Error ? err.message : 'Unknown error');

  // Track handler errors
  Sentry.metrics.count('video_handler.errors.total', 1, {
    attributes: {
      error_type: err instanceof Error ? err.name : 'unknown',
    },
  });

  // Add storage diagnostics for better debugging
  try {
    const configManager = VideoConfigurationManager.getInstance();
    context.diagnostics.storageDiagnostics = configManager.getStorageDiagnostics(
      env as Record<string, unknown>
    );
    if (isOrigins) {
      context.diagnostics.originsDiagnostics = configManager.getOriginsDiagnostics();
    }
  } catch (diagError) {
    vhLogger.error('Failed to add storage diagnostics', {
      error: diagError instanceof Error ? diagError.message : 'Unknown error',
    });
  }

  // Create error response with ResponseBuilder
  const errorHeaders: Record<string, string> = {
    'Content-Type': 'text/plain',
    'Cache-Control': 'no-store',
  };
  if (isOrigins) {
    errorHeaders['X-Handler'] = 'Origins';
    errorHeaders['X-Error'] = 'InternalError';
  }

  const errorResponse = new Response(
    `Error processing video${isOrigins ? ' with Origins' : ''}: ${err instanceof Error ? err.message : 'Unknown error'}`,
    { status: 500, headers: errorHeaders }
  );

  const responseBuilder = new ResponseBuilder(errorResponse, context);
  const result = await responseBuilder.withDebugInfo().build();

  endTimedOperation(context, 'error-handling');
  endTimedOperation(context, 'total-request-processing');

  return result;
}

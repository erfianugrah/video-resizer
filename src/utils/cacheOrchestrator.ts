/**
 * Cache orchestrator for video-resizer
 *
 * This utility coordinates KV caching to optimize video serving
 *
 * Features:
 * - KV caching for videos with automatic range request support
 * - Request coalescing (single-flight) to prevent multiple origin fetches for the same resource
 * - Proper handling of range requests with full content storage for cache integrity
 */

import { EnvVariables } from '../config/environmentConfig';
import { getFromKVCache } from './kvCacheUtils';
import { getCurrentContext, addBreadcrumb } from '../utils/requestContext';
import { createCategoryLogger } from './logger';
import { buildCoalescingCacheKey } from './cache/cacheKeyBuilder';
import { executeWithCoalescing } from './cache/requestCoalescing';
import { initiateKVStorage } from './cache/kvStorageRetry';
import { processRangeResponse } from './cache/rangeRequestHandler';
import { CacheConfigurationManager } from '../config/CacheConfigurationManager';

// Create a category-specific logger for CacheOrchestrator
const logger = createCategoryLogger('CacheOrchestrator');

/**
 * Cache orchestrator that uses KV for caching with request coalescing
 *
 * Order of operations:
 * 1. Check KV storage for transformed variant
 * 2. If cache miss, check if another request for the same resource is in-flight
 *    a. If in-flight, wait for that request instead of making a new one
 *    b. If not in-flight, mark this request as in-flight and fetch from origin
 * 3. Execute the handler function to generate response for the first request only
 * 4. Store result in KV using the full response (not partial/range)
 * 5. Return appropriate response (full or partial based on Range header)
 *
 * @param request - Original request
 * @param env - Environment variables
 * @param handler - Function to execute if cache misses occur
 * @param options - Transformation options for KV cache
 * @returns Response from cache or handler
 */
export async function withCaching(
  request: Request,
  env: EnvVariables,
  handler: () => Promise<Response>,
  options?: Record<string, unknown> // Type-safe alternative to any
): Promise<Response> {
  // Generate a unique ID for this request for tracking
  const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  let cacheKey = ''; // Will be set later but defined here for scope

  const requestContext = getCurrentContext();

  // Helper for logging - use the category logger
  const logDebug = (message: string, data?: Record<string, unknown>) => {
    logger.debug(message, data);
  };

  // Skip cache for non-GET requests or based on cache configuration
  const url = new URL(request.url);

  // Get cache configuration to check bypass parameters properly
  const cacheConfig = CacheConfigurationManager.getInstance();
  if (!cacheConfig) {
    logger.warn('CacheConfigurationManager instance unavailable - bypassing cache orchestration');
    return handler();
  }

  // Use the centralized shouldBypassCache method to determine if cache should be skipped
  // This only checks for specific bypass parameters, not all query parameters
  const shouldBypass = cacheConfig.shouldBypassCache(url);
  const isNotGet = request.method !== 'GET';
  // Check KV cache flag for cache operations
  const kvCacheEnabled = cacheConfig.isKVCacheEnabled();
  const skipCache = isNotGet || shouldBypass;

  if (skipCache) {
    logDebug('Bypassing cache', {
      method: request.method,
      shouldBypass,
      url: request.url,
    });
  }

  try {
    // Step 1: Check KV cache if appropriate
    if (!skipCache) {
      // Add breadcrumb for tracing
      if (requestContext) {
        addBreadcrumb(requestContext, 'Cache', 'Starting KV cache lookup', {
          url: request.url,
        });
      }

      // Only check KV if options and env are provided and KV cache is enabled
      if (options && env && kvCacheEnabled) {
        const sourcePath = url.pathname;

        // Check if this is an IMQuery request for lookup
        const imwidth = url.searchParams.get('imwidth');
        const imheight = url.searchParams.get('imheight');

        // Create customData for lookup to match the storage format
        const customData: Record<string, unknown> = {};
        if (imwidth) customData.imwidth = imwidth;
        if (imheight) customData.imheight = imheight;

        // Add IMQuery parameters to options for cache key generation during lookup
        const lookupOptions: typeof options = {
          ...options,
          customData: Object.keys(customData).length > 0 ? customData : undefined,
        };

        // Log if using IMQuery parameters
        if (Object.keys(customData).length > 0) {
          logDebug('Looking up with IMQuery parameters', {
            imwidth,
            imheight,
            derivative: options.derivative,
            version: options.version || 1,
          });
        }

        // Pass the request through for range handling support
        try {
          const kvResponse = await getFromKVCache(env, sourcePath, lookupOptions, request);

          if (kvResponse) {
            const hasIMQuery = !!(imwidth || imheight);

            logDebug('KV cache hit', {
              sourcePath,
              hasIMQuery,
              derivative: options?.derivative,
            });

            if (requestContext) {
              addBreadcrumb(requestContext, 'Cache', 'KV cache hit', {
                url: request.url,
                hasIMQuery,
              });
            }

            return kvResponse;
          }

          // If we get here, it's a KV cache miss
          logDebug('KV cache miss', {
            sourcePath,
            derivative: options?.derivative,
          });

          if (requestContext) {
            addBreadcrumb(requestContext, 'Cache', 'KV cache miss', {
              url: request.url,
            });
          }
        } catch (err) {
          logDebug('Error checking KV cache', {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      } else if (options && env && !kvCacheEnabled) {
        // Log that KV cache is disabled by configuration
        logDebug('KV cache is disabled by configuration, skipping lookup');
      }
    } else {
      logDebug('Skipped cache checks due to request parameters');
    }

    // Step 2: Request coalescing — build key and execute with single-flight
    cacheKey = buildCoalescingCacheKey(url, options);
    const isRangeRequest = request.headers.has('Range');

    const {
      fullOriginResponse,
      isFirstRequest,
      requestId: coalescingRequestId,
    } = await executeWithCoalescing(cacheKey, request, handler, options);

    // Clone the full origin response for KV storage (only the first request stores)
    let responseForKV: Response | null = null;
    if (isFirstRequest && fullOriginResponse.ok) {
      try {
        responseForKV = fullOriginResponse.clone();
        logDebug('Created KV storage clone from full response', {
          cacheKey,
          requestId: coalescingRequestId,
          responseStatus: fullOriginResponse.status,
          contentType: fullOriginResponse.headers.get('content-type'),
          contentLength: fullOriginResponse.headers.get('content-length'),
          isRangeRequest,
        });
      } catch (cloneError) {
        logDebug('Error cloning response for KV storage', {
          cacheKey,
          requestId: coalescingRequestId,
          error: cloneError instanceof Error ? cloneError.message : String(cloneError),
          responseStatus: fullOriginResponse.status,
        });
      }
    }

    // Clone for client response (might be modified for range requests)
    let responseForClient: Response;
    try {
      responseForClient = fullOriginResponse.clone();
    } catch (clientCloneError) {
      logDebug('Error cloning response for client, using original response', {
        cacheKey,
        requestId: coalescingRequestId,
        error:
          clientCloneError instanceof Error ? clientCloneError.message : String(clientCloneError),
      });
      responseForClient = fullOriginResponse;
    }

    // Step 3: Check if this is a video response that should be proactively cached in KV
    const contentType = fullOriginResponse.headers.get('content-type') || '';
    const isError = fullOriginResponse.status >= 400;

    // Comprehensive list of video MIME types
    const videoMimeTypes = [
      'video/mp4',
      'video/webm',
      'video/ogg',
      'video/x-msvideo',
      'video/quicktime',
      'video/x-matroska',
      'video/x-flv',
      'video/3gpp',
      'video/3gpp2',
      'video/mpeg',
      'application/x-mpegURL',
      'application/dash+xml',
    ];

    const isVideoResponse = videoMimeTypes.some((mimeType) => contentType.startsWith(mimeType));

    // Store video in KV if conditions are met
    if (
      options &&
      env &&
      fullOriginResponse.ok &&
      request.method === 'GET' &&
      !skipCache &&
      isVideoResponse &&
      !isError &&
      kvCacheEnabled &&
      responseForKV
    ) {
      const sourcePath = url.pathname;

      // Build IMQuery custom data
      const imwidth = url.searchParams.get('imwidth');
      const imheight = url.searchParams.get('imheight');
      const customData: Record<string, unknown> = {};
      if (imwidth) customData.imwidth = imwidth;
      if (imheight) customData.imheight = imheight;

      if (Object.keys(customData).length > 0) {
        logDebug('Including IMQuery parameters in cache key', {
          imwidth,
          imheight,
          derivative: options.derivative,
          requestId: coalescingRequestId,
        });
      }

      try {
        if (!responseForKV || responseForKV.bodyUsed) {
          throw new Error('Invalid response for KV storage: body already consumed or null');
        }

        logDebug('Storing full video in KV for range request support (via first request)', {
          url: request.url,
          requestId: coalescingRequestId,
          contentType,
          isRangeRequest,
          isFullResponse: responseForKV.status === 200,
          responseStatus: responseForKV.status,
          contentLength: responseForKV.headers.get('content-length'),
          cacheKey,
          timestamp: Date.now(),
        });

        initiateKVStorage(env, {
          sourcePath,
          responseForKV,
          responseForClient,
          options,
          cacheKey,
          requestId: coalescingRequestId,
          customData,
        });
      } catch (err) {
        logDebug('Error preparing KV cache operation', {
          error: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack : undefined,
          cacheKey,
          requestId: coalescingRequestId,
        });
      }
    } else if (options && env && request.method === 'GET') {
      logDebug('Skipped special video handling', {
        method: request.method,
        isOk: fullOriginResponse.ok,
        hasDebug: url.searchParams.has('debug'),
        isVideoResponse,
        isError,
        statusCode: fullOriginResponse.status,
        contentType,
        kvCacheEnabled,
        responseForKVExists: !!responseForKV,
        skipCache,
        requestId: coalescingRequestId,
      });
    }

    // Step 4: Handle range requests
    if (isRangeRequest && isVideoResponse && fullOriginResponse.ok) {
      responseForClient = await processRangeResponse(
        request,
        responseForClient,
        fullOriginResponse,
        coalescingRequestId
      );
    } else {
      logDebug('Not a range request or not eligible for range processing, using full response', {
        requestId: coalescingRequestId,
        isRangeRequest,
        isVideoResponse,
        isResponseOk: fullOriginResponse.ok,
        status: fullOriginResponse.status,
      });
      responseForClient = fullOriginResponse;
    }

    // Return the appropriate response to the client
    return responseForClient;
  } catch (err) {
    // Generate a unique error ID for tracking this specific failure
    const errorId = `err_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const thisRequestId = requestId || `err_req_${Date.now()}`;
    let errorCacheKey;
    try {
      errorCacheKey = cacheKey;
    } catch {
      errorCacheKey = 'unknown-key';
    }

    logDebug('Error in cache flow', {
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
      errorId,
      requestId: thisRequestId,
      url: request.url,
      isRangeRequest: request.headers.has('Range'),
      rangeHeader: request.headers.get('Range'),
      cacheKey: errorCacheKey,
    });

    // Add breadcrumb for error tracking
    if (requestContext) {
      addBreadcrumb(requestContext, 'Error', 'Cache orchestration failed', {
        errorId,
        error: err instanceof Error ? err.message : 'Unknown error',
        severity: 'high',
      });
    }

    try {
      // Fallback to handler directly if caching fails
      logDebug('Executing fallback direct handler after cache flow error', {
        errorId,
        requestId: thisRequestId,
        url: request.url,
      });

      const fallbackResponse = await handler();

      logDebug('Fallback handler succeeded after cache flow error', {
        errorId,
        requestId: thisRequestId,
        responseStatus: fallbackResponse.status,
        contentType: fallbackResponse.headers.get('content-type'),
      });

      return fallbackResponse;
    } catch (fallbackErr) {
      logDebug('Critical: Fallback handler also failed after cache flow error', {
        originalError: err instanceof Error ? err.message : String(err),
        fallbackError: fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr),
        errorId,
        requestId: thisRequestId,
        url: request.url,
      });

      throw err;
    }
  }
}

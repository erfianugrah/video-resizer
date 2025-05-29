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
import { getFromKVCache, storeInKVCache } from './kvCacheUtils';
import { createLogger, debug as pinoDebug } from '../utils/pinoLogger';
import { getCurrentContext } from '../utils/legacyLoggerAdapter';
import { addBreadcrumb } from '../utils/requestContext';
import { BoundedLRUMap } from './BoundedLRUMap';

/**
 * Interface for in-flight request tracking with metadata
 * This provides additional context about the in-flight request for better observability
 */
interface InFlightRequest {
  promise: Promise<Response>;     // The original fetch promise
  startTime: number;              // Timestamp when request started
  url: string;                    // The original request URL
  referenceCount: number;         // Count of requests using this in-flight request
  derivative?: string;            // Derivative type if applicable
  requesterId?: string;           // ID of the request that initiated the fetch
  debug?: boolean;                // Whether this is a debug request
  isRangeRequest?: boolean;       // Whether this is a range request
}

// Static map for in-flight request tracking to reduce duplicate origin fetches
// This is a per-worker isolate map to prevent redundant fetches when multiple requests arrive simultaneously
// Enhanced with metadata for better observability and debugging
// Note: Map<cacheKey, InFlightRequest>
// Using BoundedLRUMap to prevent unbounded memory growth
const inFlightOriginFetches = new BoundedLRUMap<string, InFlightRequest>({
  maxSize: 1000, // Limit to 1000 concurrent in-flight requests
  ttlMs: 300000, // 5 minute TTL for in-flight requests
  onEvict: (key, value) => {
    // Log when entries are evicted
    console.warn(`[CacheOrchestrator] Evicting in-flight request for key: ${key}`, {
      requesterId: value.requesterId,
      startTime: value.startTime,
      age: Date.now() - value.startTime
    });
  }
});

// Track all coalescable requests by requestId for diagnostic purposes
// This helps identify which requests were coalesced together
// Also using BoundedLRUMap to prevent memory leaks
const coalescedRequestsLog = new BoundedLRUMap<string, string[]>({
  maxSize: 500, // Smaller size for diagnostic logs
  ttlMs: 600000 // 10 minute TTL for diagnostic data
});

// Generate a unique ID for tracking requests
function generateRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

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
  const logger = requestContext ? createLogger(requestContext) : undefined;

  // Helper for logging
  const logDebug = (message: string, data?: Record<string, unknown>) => {
    if (requestContext && logger) {
      pinoDebug(requestContext, logger, 'CacheOrchestrator', message, data);
    } else {
      console.debug(`CacheOrchestrator: ${message}`, data || {});
    }
  };

  // Skip cache for non-GET requests or based on cache configuration
  const url = new URL(request.url);
  
  // Get cache configuration to check bypass parameters properly
  // Import at the function level to avoid circular dependencies
  const { CacheConfigurationManager } = await import('../config/CacheConfigurationManager');
  const cacheConfig = CacheConfigurationManager.getInstance();
  
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
      url: request.url
    });
  }

  try {
    // Step 1: Check KV cache if appropriate
    if (!skipCache) {
      // Add breadcrumb for tracing
      if (requestContext) {
        addBreadcrumb(requestContext, 'Cache', 'Starting KV cache lookup', {
          url: request.url
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
          customData: Object.keys(customData).length > 0 ? customData : undefined
        };
        
        // Log if using IMQuery parameters
        if (Object.keys(customData).length > 0) {
          logDebug('Looking up with IMQuery parameters', {
            imwidth,
            imheight,
            derivative: options.derivative
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
              derivative: options?.derivative 
            });
            
            if (requestContext) {
              addBreadcrumb(requestContext, 'Cache', 'KV cache hit', {
                url: request.url,
                hasIMQuery
              });
            }
            
            return kvResponse;
          }
          
          // If we get here, it's a KV cache miss
          logDebug('KV cache miss', { 
            sourcePath,
            derivative: options?.derivative 
          });
          
          if (requestContext) {
            addBreadcrumb(requestContext, 'Cache', 'KV cache miss', {
              url: request.url
            });
          }
        } catch (err) {
          logDebug('Error checking KV cache', { 
            error: err instanceof Error ? err.message : String(err) 
          });
        }
      } else if (options && env && !kvCacheEnabled) {
        // Log that KV cache is disabled by configuration
        logDebug('KV cache is disabled by configuration, skipping lookup');
      }
    } else {
      logDebug('Skipped cache checks due to request parameters');
    }
    
    // Step 2: Check if there's already an in-flight request for this resource
    // Generate a unique cache key for request coalescing that matches KV storage key format
    const sourcePath = url.pathname;

    // Generate a canonical cache key for request coalescing (must match KV storage key)
    cacheKey = `video:${sourcePath.replace(/^\//g, '')}`;
    if (options) {
      if (options.derivative) {
        cacheKey += `:derivative=${options.derivative}`;
      }
      
      // Add width/height parameters to cache key for proper request coalescing
      // This ensures requests with different dimensions don't share the same in-flight request
      if (options.width) {
        cacheKey += `:width=${options.width}`;
      }
      if (options.height) {
        cacheKey += `:height=${options.height}`;
      }
      
      // Add IMQuery parameters if present - these should match how KV keys are generated
      const imwidth = url.searchParams.get('imwidth');
      const imheight = url.searchParams.get('imheight');

      if (imwidth || imheight) {
        const customData: Record<string, unknown> = {};
        if (imwidth) customData.imwidth = imwidth;
        if (imheight) customData.imheight = imheight;

        // Add the same IMQuery parameters that would be used in KV caching
        if (customData.imwidth) {
          cacheKey += `:imwidth=${customData.imwidth}`;
        }
        if (customData.imheight) {
          cacheKey += `:imheight=${customData.imheight}`;
        }
      }

      // Add version information to match KV key format
      cacheKey += `:v${options.version || 1}`;
    }

    // Debug info about the cache key
    logDebug('Generated canonical cache key for request coalescing', {
      cacheKey,
      url: request.url,
      path: sourcePath,
      derivative: options?.derivative,
      width: options?.width,
      height: options?.height,
      imwidth: url.searchParams.get('imwidth'),
      imheight: url.searchParams.get('imheight')
    });

    // Generate a request ID for tracking this specific request
    const requestId = generateRequestId();
    const isRangeRequest = request.headers.has('Range');
    const rangeHeaderValue = request.headers.get('Range');

    // Check if there is already an in-flight request for this exact resource
    let inFlightRequest = inFlightOriginFetches.get(cacheKey);
    let isFirstRequest = false;

    // Add debug info to trace request coalescing
    logDebug('Request coalescing check', {
      cacheKey,
      requestId,
      hasExistingRequest: !!inFlightRequest,
      url: request.url,
      timestamp: Date.now(),
      isRangeRequest,
      rangeHeaderValue: isRangeRequest ? rangeHeaderValue : undefined,
      activeInFlightCount: inFlightOriginFetches.size
    });

    // If no in-flight request, create one
    if (!inFlightRequest) {
      isFirstRequest = true;
      
      // Check concurrency limit before creating new in-flight request
      const MAX_CONCURRENT_ORIGINS = 100;
      if (inFlightOriginFetches.size >= MAX_CONCURRENT_ORIGINS) {
        logDebug('Origin fetch concurrency limit reached', {
          cacheKey,
          requestId,
          currentInFlightCount: inFlightOriginFetches.size,
          limit: MAX_CONCURRENT_ORIGINS
        });
        throw new Error(`Origin fetch concurrency limit reached (${MAX_CONCURRENT_ORIGINS})`);
      }

      // Log detailed information about the new request
      logDebug('No existing in-flight request, initiating new origin fetch', {
        cacheKey,
        requestId,
        url: request.url,
        derivative: options?.derivative,
        timestamp: Date.now(),
        isRangeRequest,
        rangeHeaderValue: isRangeRequest ? rangeHeaderValue : undefined,
        currentInFlightCount: inFlightOriginFetches.size
      });

      if (requestContext) {
        addBreadcrumb(requestContext, 'Origin', 'Initiating new origin fetch', {
          cacheKey,
          requestId,
          url: request.url
        });
      }

      // Track this request in the coalesced requests log
      coalescedRequestsLog.set(requestId, [requestId]);

      // Create a new promise with enhanced error handling
      const originFetchPromise = (async () => {
        let success = false;
        let errorMsg = '';
        let responseStatus = 0;
        const startTime = Date.now();

        try {
          // Execute handler to fetch from origin
          logDebug('First request: executing handler for origin fetch', {
            cacheKey,
            requestId,
            timestamp: startTime
          });

          const response = await handler();
          success = true;
          responseStatus = response.status;
          return response;
        } catch (error) {
          // Capture detailed error information
          errorMsg = error instanceof Error ? error.message : String(error);
          const errorStack = error instanceof Error ? error.stack : undefined;

          logDebug('Error in origin fetch', {
            cacheKey,
            requestId,
            error: errorMsg,
            stack: errorStack,
            duration: Date.now() - startTime
          });

          // Re-throw to propagate the error
          throw error;
        } finally {
          // Log completion metrics
          const duration = Date.now() - startTime;
          const coalescedRequestCount = coalescedRequestsLog.get(requestId)?.length || 1;

          logDebug(`Origin fetch ${success ? 'completed' : 'failed'}`, {
            cacheKey,
            requestId,
            success,
            duration,
            responseStatus: success ? responseStatus : undefined,
            error: !success ? errorMsg : undefined,
            coalescedCount: coalescedRequestCount,
            requestsCoalesced: coalescedRequestCount > 1 ? true : false,
            isRangeRequest
          });

          // Clean up the in-flight request when done, regardless of success/failure
          // No cleanup here - it will be done when all references are released
        }
      })();

      // Create the in-flight request object with metadata
      inFlightRequest = {
        promise: originFetchPromise,
        startTime: Date.now(),
        url: request.url,
        referenceCount: 1,
        derivative: options?.derivative?.toString(),
        requesterId: requestId,
        debug: url.searchParams.has('debug'),
        isRangeRequest
      };

      // Store the request metadata in the in-flight map for subsequent requests
      // At this point inFlightRequest is guaranteed to be defined
      inFlightOriginFetches.set(cacheKey, inFlightRequest as InFlightRequest);
    } else if (inFlightRequest) {
      // This is a subsequent request for the same resource - coalesce with the existing request
      inFlightRequest.referenceCount++;

      // Add this request to the coalesced requests log
      const initiatorId = inFlightRequest.requesterId || 'unknown';
      if (coalescedRequestsLog.has(initiatorId)) {
        coalescedRequestsLog.get(initiatorId)?.push(requestId);
      }

      // Log detailed information about joining the existing request
      logDebug('Found existing in-flight request, joining to avoid duplicate origin fetch', {
        cacheKey,
        requestId,
        joiningRequestId: inFlightRequest.requesterId,
        url: request.url,
        inFlightAge: Date.now() - inFlightRequest.startTime,
        newReferenceCount: inFlightRequest.referenceCount,
        isRangeRequest,
        initiatorIsRange: inFlightRequest.isRangeRequest
      });

      if (requestContext) {
        addBreadcrumb(requestContext, 'Origin', 'Joining existing in-flight request', {
          cacheKey,
          requestId,
          joiningRequestId: inFlightRequest.requesterId,
          url: request.url,
          coalesced: true
        });
      }
    }

    // Wait for the origin fetch to complete (first or subsequent request)
    let fullOriginResponse: Response;
    try {
      // Add a null check to satisfy TypeScript
      if (!inFlightRequest) {
        throw new Error('InFlightRequest unexpectedly became undefined');
      }

      fullOriginResponse = await inFlightRequest.promise;

      // Log successful coalescence
      if (!isFirstRequest) {
        // inFlightRequest is guaranteed to be defined at this point
        logDebug('Successfully coalesced request with existing fetch', {
          cacheKey,
          requestId,
          joiningRequestId: inFlightRequest.requesterId,
          responseStatus: fullOriginResponse.status,
          contentType: fullOriginResponse.headers.get('content-type'),
          coalesceLatency: Date.now() - inFlightRequest.startTime,
          isRangeRequest
        });
      }
    } catch (error) {
      // Handle error in coalesced request
      logDebug('Error in coalesced fetch request', {
        cacheKey,
        requestId,
        joiningRequestId: inFlightRequest?.requesterId,
        error: error instanceof Error ? error.message : String(error),
        isFirstRequest,
        isRangeRequest
      });

      // Re-throw to propagate to error handling
      throw error;
    } finally {
      // Decrement reference count and clean up if this was the last reference
      if (inFlightRequest) {
        inFlightRequest.referenceCount--;
        
        logDebug('Decremented reference count for in-flight request', {
          cacheKey,
          requestId,
          newReferenceCount: inFlightRequest.referenceCount,
          isFirstRequest
        });
        
        // If this was the last reference, clean up the in-flight request
        if (inFlightRequest.referenceCount === 0) {
          inFlightOriginFetches.delete(cacheKey);
          
          logDebug('Removed in-flight request from tracking map (last reference released)', {
            cacheKey,
            requestId,
            duration: Date.now() - inFlightRequest.startTime,
            activeFetchesRemaining: inFlightOriginFetches.size
          });
          
          // Clean up the coalesced requests log for the initiator
          if (inFlightRequest.requesterId) {
            coalescedRequestsLog.delete(inFlightRequest.requesterId);
          }
        }
      }
    }

    // **CRITICAL FIX**: Clone the full origin response immediately for KV storage
    // This clone's body must remain unread until KV storage processes it
    // Only the first request should attempt to store in KV to avoid write conflicts
    // Make sure we only clone successful responses (status 200-299)
    let responseForKV = null;
    if (isFirstRequest && fullOriginResponse.ok) {
      try {
        responseForKV = fullOriginResponse.clone();
        logDebug('Created KV storage clone from full response', {
          cacheKey,
          requestId,
          responseStatus: fullOriginResponse.status,
          contentType: fullOriginResponse.headers.get('content-type'),
          contentLength: fullOriginResponse.headers.get('content-length'),
          isRangeRequest
        });
      } catch (cloneError) {
        logDebug('Error cloning response for KV storage', {
          cacheKey,
          requestId,
          error: cloneError instanceof Error ? cloneError.message : String(cloneError),
          responseStatus: fullOriginResponse.status
        });
        // Continue without KV storage if cloning fails
      }
    }

    // Clone for client response (might be modified for range requests)
    // This needs to be in a separate try/catch since we must return something to the client
    let responseForClient;
    try {
      responseForClient = fullOriginResponse.clone();
    } catch (clientCloneError) {
      logDebug('Error cloning response for client, using original response', {
        cacheKey,
        requestId,
        error: clientCloneError instanceof Error ? clientCloneError.message : String(clientCloneError)
      });
      // Fall back to the original response if cloning fails
      responseForClient = fullOriginResponse;
    }

    // Step 3: Check if this is a video response that should be proactively cached in KV
    const contentType = fullOriginResponse.headers.get('content-type') || '';
    const isError = fullOriginResponse.status >= 400;
    // reuse isRangeRequest variable that was defined earlier

    // Comprehensive list of video MIME types
    const videoMimeTypes = [
      'video/mp4',
      'video/webm',
      'video/ogg',
      'video/x-msvideo', // AVI
      'video/quicktime', // MOV
      'video/x-matroska', // MKV
      'video/x-flv',
      'video/3gpp',
      'video/3gpp2',
      'video/mpeg',
      'application/x-mpegURL', // HLS
      'application/dash+xml'   // DASH
    ];

    const isVideoResponse = videoMimeTypes.some(mimeType => contentType.startsWith(mimeType));

    // SPECIAL HANDLING FOR VIDEO: For video content, we need to ensure we serve from cache
    // to properly support range requests (even on first access)
    if (options && env && fullOriginResponse.ok && request.method === 'GET' && !skipCache &&
        isVideoResponse && !isError && kvCacheEnabled && responseForKV) { // Only store if responseForKV exists (first request)
      const sourcePath = url.pathname;

      // Check if this is an IMQuery request
      const imwidth = url.searchParams.get('imwidth');
      const imheight = url.searchParams.get('imheight');

      // Create customData to store the IMQuery parameters for use in the cache key
      const customData: Record<string, unknown> = {};
      if (imwidth) customData.imwidth = imwidth;
      if (imheight) customData.imheight = imheight;

      // Add IMQuery detection to videoOptions custom data
      const optionsWithIMQuery: typeof options = {
        ...options,
        customData: Object.keys(customData).length > 0 ? customData : undefined
      };

      // Log the IMQuery detection for debugging
      if (Object.keys(customData).length > 0) {
        logDebug('Including IMQuery parameters in cache key', {
          imwidth,
          imheight,
          derivative: options.derivative,
          requestId
        });
      }

      try {
        // CRITICAL FIX: Validate that responseForKV is still valid before attempting storage
        // This catches cases where the response body might have been consumed or lost
        if (!responseForKV || responseForKV.bodyUsed) {
          throw new Error('Invalid response for KV storage: body already consumed or null');
        }

        // NOTE: We're using the responseForKV clone that was created before any range processing
        // This ensures we always store the full video in KV, not partial content
        logDebug('Storing full video in KV for range request support (via first request)', {
          url: request.url,
          requestId,
          contentType,
          isRangeRequest,
          isFullResponse: responseForKV.status === 200,
          responseStatus: responseForKV.status,
          contentLength: responseForKV.headers.get('content-length'),
          cacheKey,
          timestamp: Date.now()
        });

        // Get execution context if available
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ctx = (env as any).executionCtx || (env as any).ctx;

        if (ctx && typeof ctx.waitUntil === 'function') {
          // Store in KV using waitUntil to do it in the background
          // Use a retry mechanism wrapped around the storage operation
          ctx.waitUntil(
            (async () => {
              const maxRetries = 3;
              let attemptCount = 0;
              let success = false;
              let lastError: Error | null = null;
              const kvStartTime = Date.now();

              // Retry loop for storage operation
              while (attemptCount < maxRetries && !success) {
                try {
                  attemptCount++;

                  // Add diagnostic data based on attempt number
                  const attemptOptions = {
                    ...optionsWithIMQuery,
                    diagnosticsInfo: {
                      ...(optionsWithIMQuery.diagnosticsInfo || {}),
                      requestId,
                      attemptNumber: attemptCount,
                      timestamp: Date.now()
                    }
                  };

                  if (attemptCount > 1) {
                    logDebug(`Retry attempt ${attemptCount} for KV storage`, {
                      cacheKey,
                      requestId,
                      previousError: lastError?.message,
                      timeSinceFirstAttempt: Date.now() - kvStartTime
                    });
                  }

                  // Use a clone for retry attempts after the first
                  const responseToStore = attemptCount === 1 ?
                    responseForKV :
                    // Need to create a fresh clone for retries
                    responseForClient.clone();

                  // Execute storage operation
                  success = await storeInKVCache(env, sourcePath, responseToStore, attemptOptions);

                  // Success handling
                  const hasIMQuery = Object.keys(customData).length > 0;
                  if (success) {
                    logDebug(`Successfully stored video in KV cache${attemptCount > 1 ? ' after retries' : ''}`, {
                      sourcePath,
                      requestId,
                      hasIMQuery,
                      attemptCount,
                      duration: Date.now() - kvStartTime,
                      cacheKey
                    });

                    // Add breadcrumb if request context is available
                    const reqContext = getCurrentContext();
                    if (reqContext) {
                      addBreadcrumb(reqContext, 'Cache', 'Stored full video in KV cache', {
                        sourcePath,
                        hasIMQuery,
                        requestId,
                        attemptCount
                      });
                    }
                  } else {
                    // If storage reported failure but didn't throw, treat as non-retryable
                    logDebug('KV storage operation reported failure', {
                      requestId,
                      cacheKey,
                      attemptCount
                    });
                    break;
                  }
                } catch (err) {
                  lastError = err instanceof Error ? err : new Error(String(err));

                  // Check for rate limit or conflict errors that might be retryable
                  const isRateLimitError =
                    lastError.message.includes('429') ||
                    lastError.message.includes('409') ||
                    lastError.message.includes('rate limit') ||
                    lastError.message.includes('conflict');

                  logDebug('Error during KV storage attempt', {
                    cacheKey,
                    requestId,
                    error: lastError.message,
                    stack: lastError.stack,
                    attemptCount,
                    isRateLimitError,
                    willRetry: isRateLimitError && attemptCount < maxRetries
                  });

                  // Only retry rate limit errors
                  if (!isRateLimitError || attemptCount >= maxRetries) {
                    break;
                  }

                  // Exponential backoff: 100ms, 200ms, 400ms, etc.
                  const backoffMs = Math.min(100 * Math.pow(2, attemptCount - 1), 1000);
                  await new Promise(resolve => setTimeout(resolve, backoffMs));
                }
              }

              // Final logging at end of retry cycle
              if (!success) {
                logDebug('All KV storage attempts failed', {
                  cacheKey,
                  requestId,
                  attempts: attemptCount,
                  finalError: lastError?.message,
                  duration: Date.now() - kvStartTime
                });
              }
            })()
          );
        } else {
          // If no context available, store without waiting but still with retry logic
          (async () => {
            const maxRetries = 2; // Fewer retries for direct execution
            let attemptCount = 0;
            let success = false;
            let lastError: Error | null = null;
            const kvStartTime = Date.now();

            // Retry loop for storage operation
            while (attemptCount < maxRetries && !success) {
              try {
                attemptCount++;

                // Add diagnostic data based on attempt number
                const attemptOptions = {
                  ...optionsWithIMQuery,
                  diagnosticsInfo: {
                    ...(optionsWithIMQuery.diagnosticsInfo || {}),
                    requestId,
                    attemptNumber: attemptCount,
                    timestamp: Date.now()
                  }
                };

                if (attemptCount > 1) {
                  logDebug(`Direct retry attempt ${attemptCount} for KV storage`, {
                    cacheKey,
                    requestId,
                    previousError: lastError?.message,
                    timeSinceFirstAttempt: Date.now() - kvStartTime
                  });
                }

                // Use a clone for retry attempts after the first
                let responseToStore;
                try {
                  responseToStore = attemptCount === 1 ?
                    responseForKV :
                    // Need to create a fresh clone for retries
                    responseForClient.clone();
                } catch (cloneErr) {
                  logDebug('Error cloning response for retry storage', {
                    cacheKey,
                    requestId,
                    error: cloneErr instanceof Error ? cloneErr.message : String(cloneErr),
                    attemptCount
                  });
                  break; // Can't retry without a valid response
                }

                // Execute storage operation
                success = await storeInKVCache(env, sourcePath, responseToStore, attemptOptions);

                // Report success
                if (success) {
                  const hasIMQuery = Object.keys(customData).length > 0;
                  logDebug(`Successfully stored video in KV cache directly${attemptCount > 1 ? ' after retries' : ''}`, {
                    sourcePath,
                    requestId,
                    hasIMQuery,
                    attemptCount,
                    duration: Date.now() - kvStartTime,
                    cacheKey
                  });
                }
              } catch (err) {
                lastError = err instanceof Error ? err : new Error(String(err));

                // Check for rate limit or conflict errors that might be retryable
                const isRateLimitError =
                  lastError.message.includes('429') ||
                  lastError.message.includes('409') ||
                  lastError.message.includes('rate limit') ||
                  lastError.message.includes('conflict');

                logDebug('Error during direct KV storage attempt', {
                  cacheKey,
                  requestId,
                  error: lastError.message,
                  attemptCount,
                  isRateLimitError,
                  willRetry: isRateLimitError && attemptCount < maxRetries
                });

                if (!isRateLimitError || attemptCount >= maxRetries) {
                  break;
                }

                // Minimal backoff for direct execution
                const backoffMs = 100 * attemptCount;
                await new Promise(resolve => setTimeout(resolve, backoffMs));
              }
            }
          })().catch(err => {
            // Log any top-level errors in the storage flow
            logDebug('Unexpected error in direct KV storage flow', {
              cacheKey,
              requestId,
              error: err instanceof Error ? err.message : String(err)
            });
          });
        }
      } catch (err) {
        logDebug('Error preparing KV cache operation', {
          error: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack : undefined,
          cacheKey,
          requestId
        });
      }
    } else if (options && env && request.method === 'GET') {
      // Log reasons for skipping special video handling
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
        requestId
      });
    }

    // If this is a range request, we need to create a 206 Partial Content response for the client
    // while still using the full response for KV storage
    if (isRangeRequest && isVideoResponse && fullOriginResponse.ok) {
      try {
        // Import needed httpUtils functions to handle range requests
        const { parseRangeHeader } = await import('./httpUtils');

        // Get the content-length from the full response
        const contentLength = parseInt(responseForClient.headers.get('Content-Length') || '0', 10);
        const rangeHeader = request.headers.get('Range') || '';

        // Enhanced logging for range request processing
        logDebug('Processing range request with full response', {
          url: request.url,
          requestId,
          rangeHeader,
          contentLength,
          responseStatus: responseForClient.status,
          contentType: responseForClient.headers.get('Content-Type')
        });

        if (contentLength > 0) {
          // Parse the range header to get the requested byte range
          const parsedRange = parseRangeHeader(rangeHeader, contentLength);

          if (parsedRange) {
            try {
              // Use streaming range handling instead of loading entire video into memory
              logDebug('Using streaming for range processing', {
                requestId,
                parsedRange,
                contentLength
              });

              // Import the streaming utilities
              const { processRangeRequest } = await import('./streamUtils');

              // Process the range request using streaming
              responseForClient = await processRangeRequest(
                responseForClient,
                parsedRange.start,
                parsedRange.end,
                contentLength,
                {
                  preserveHeaders: true,
                  handlerTag: 'cacheOrchestrator-origin-miss',
                  bypassCacheAPI: false,
                  fallbackApplied: false
                }
              );

              logDebug('Successfully created 206 Partial Content response using streaming', {
                requestId,
                originalRangeHeader: rangeHeader,
                processedRange: `${parsedRange.start}-${parsedRange.end}/${contentLength}`
              });
            } catch (bufferErr) {
              // Specific error for buffer processing issues
              logDebug('Error processing buffer for range request, falling back to full response', {
                requestId,
                error: bufferErr instanceof Error ? bufferErr.message : String(bufferErr),
                stack: bufferErr instanceof Error ? bufferErr.stack : undefined
              });

              // Fall back to the full response if buffer processing fails
              // Create a fresh clone since the previous one might have been consumed
              try {
                responseForClient = fullOriginResponse.clone();

                // Add diagnostic header
                const headers = new Headers(responseForClient.headers);
                headers.set('X-Range-Fallback', 'buffer-processing-error');
                responseForClient = new Response(responseForClient.body, {
                  status: responseForClient.status,
                  statusText: responseForClient.statusText,
                  headers
                });
              } catch (cloneErr) {
                logDebug('Error cloning response after buffer error, using original full response', {
                  requestId,
                  error: cloneErr instanceof Error ? cloneErr.message : String(cloneErr)
                });
                responseForClient = fullOriginResponse;
              }
            }
          } else {
            // No valid parsed range - return a full response with diagnostic headers
            logDebug('Unable to parse range header, returning full response instead', {
              requestId,
              rangeHeader,
              contentLength,
              fullResponseStatus: responseForClient.status
            });

            try {
              // Create a response with diagnostic headers
              const headers = new Headers(responseForClient.headers);
              headers.set('X-Range-Fallback', 'invalid-range-header');
              responseForClient = new Response(responseForClient.body, {
                status: responseForClient.status,
                statusText: responseForClient.statusText,
                headers
              });
            } catch (headerErr) {
              logDebug('Error adding diagnostic headers, using original response', {
                requestId,
                error: headerErr instanceof Error ? headerErr.message : String(headerErr)
              });
              // Keep using the existing responseForClient
            }
          }
        } else {
          // Content length missing or zero
          logDebug('Missing or zero content length for range request, keeping full response', {
            requestId,
            contentLengthHeader: responseForClient.headers.get('Content-Length'),
            parsedContentLength: contentLength,
            fullResponseStatus: responseForClient.status
          });

          try {
            // Add diagnostic headers about the issue
            const headers = new Headers(responseForClient.headers);
            headers.set('X-Range-Fallback', 'missing-content-length');
            responseForClient = new Response(responseForClient.body, {
              status: responseForClient.status,
              statusText: responseForClient.statusText,
              headers
            });
          } catch (headerErr) {
            logDebug('Error adding diagnostic headers for missing content length', {
              requestId,
              error: headerErr instanceof Error ? headerErr.message : String(headerErr)
            });
            // Keep using the existing responseForClient
          }
        }

        // Final logging for range response creation outcome
        logDebug('Range request processing complete', {
          url: request.url,
          requestId,
          originalRangeHeader: rangeHeader,
          finalStatus: responseForClient.status,
          finalContentLength: responseForClient.headers.get('Content-Length'),
          finalContentRange: responseForClient.headers.get('Content-Range'),
          hasFallbackHeader: !!responseForClient.headers.get('X-Range-Fallback')
        });
      } catch (rangeErr) {
        // General error handler for the entire range processing
        logDebug('Error creating range response, falling back to full response', {
          requestId,
          error: rangeErr instanceof Error ? rangeErr.message : String(rangeErr),
          stack: rangeErr instanceof Error ? rangeErr.stack : undefined,
          rangeHeader: request.headers.get('Range')
        });

        // Fall back to the full response if range handling fails
        try {
          // Try to create a fresh clone with diagnostic headers
          const fallbackResponse = fullOriginResponse.clone();
          const fallbackHeaders = new Headers(fallbackResponse.headers);
          fallbackHeaders.set('X-Range-Error', 'general-processing-failure');
          responseForClient = new Response(fallbackResponse.body, {
            status: fallbackResponse.status,
            statusText: fallbackResponse.statusText,
            headers: fallbackHeaders
          });
        } catch (cloneErr) {
          // If that fails too, just use the original response directly
          logDebug('Error creating diagnostic fallback response, using original', {
            requestId,
            error: cloneErr instanceof Error ? cloneErr.message : String(cloneErr)
          });
          responseForClient = fullOriginResponse;
        }
      }
    } else {
      // For non-range requests, use the full response directly
      logDebug('Not a range request or not eligible for range processing, using full response', {
        requestId,
        isRangeRequest,
        isVideoResponse,
        isResponseOk: fullOriginResponse.ok,
        status: fullOriginResponse.status
      });
      responseForClient = fullOriginResponse;
    }

    // Return the appropriate response to the client
    return responseForClient;
  } catch (err) {
    // Generate a unique error ID for tracking this specific failure
    const errorId = `err_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    // Create a requestId variable for the error context if it doesn't exist
    const thisRequestId = requestId || `err_req_${Date.now()}`;
    // Safely use cacheKey if it's in the current scope
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
      cacheKey: errorCacheKey
    });

    // Add breadcrumb for error tracking
    if (requestContext) {
      addBreadcrumb(requestContext, 'Error', 'Cache orchestration failed', {
        errorId,
        error: err instanceof Error ? err.message : 'Unknown error',
        severity: 'high'
      });
    }

    try {
      // Fallback to handler directly if caching fails, with better error context
      logDebug('Executing fallback direct handler after cache flow error', {
        errorId,
        requestId: thisRequestId,
        url: request.url
      });

      // Execute handler for fallback
      const fallbackResponse = await handler();

      logDebug('Fallback handler succeeded after cache flow error', {
        errorId,
        requestId: thisRequestId,
        responseStatus: fallbackResponse.status,
        contentType: fallbackResponse.headers.get('content-type')
      });

      return fallbackResponse;
    } catch (fallbackErr) {
      // If even the fallback handler fails, log it but still throw the original error
      logDebug('Critical: Fallback handler also failed after cache flow error', {
        originalError: err instanceof Error ? err.message : String(err),
        fallbackError: fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr),
        errorId,
        requestId: thisRequestId,
        url: request.url
      });

      // Re-throw the original error to maintain the original error context
      throw err;
    }
  }
}
/**
 * HTTP utilities for video-resizer
 * 
 * Provides helper functions for handling HTTP operations like range requests
 */

/**
 * Parses the HTTP Range header.
 * Spec: https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Range
 *
 * @param rangeHeader The value of the Range header (e.g., "bytes=0-1023").
 * @param totalSize The total size of the resource.
 * @returns An object with start, end, and total size, or null if the header is invalid/absent or unsatisfiable.
 */
export function parseRangeHeader(
  rangeHeader: string | null,
  totalSize: number,
): { start: number; end: number; total: number } | null {
  if (!rangeHeader || !rangeHeader.startsWith('bytes=') || totalSize <= 0) {
    return null;
  }

  const range = rangeHeader.substring(6); // Remove "bytes="
  const parts = range.split('-');
  if (parts.length !== 2) {
    return null; // Invalid format
  }

  const startStr = parts[0].trim();
  const endStr = parts[1].trim();

  let start: number;
  let end: number;

  if (startStr === '' && endStr !== '') {
    // Suffix range: bytes=-N (last N bytes)
    const suffixLength = parseInt(endStr, 10);
    if (isNaN(suffixLength) || suffixLength <= 0) {
      return null;
    }
    start = Math.max(0, totalSize - suffixLength);
    end = totalSize - 1;
  } else if (startStr !== '' && endStr === '') {
    // Open range: bytes=N- (from N to end)
    start = parseInt(startStr, 10);
    if (isNaN(start) || start >= totalSize) {
      return null; // Start is out of bounds
    }
    end = totalSize - 1;
  } else if (startStr !== '' && endStr !== '') {
    // Closed range: bytes=N-M
    start = parseInt(startStr, 10);
    end = parseInt(endStr, 10);
    if (isNaN(start) || isNaN(end) || start > end || start >= totalSize) {
      // Invalid numbers, start > end, or start is out of bounds
      return null;
    }
    // Clamp end to the actual size
    end = Math.min(end, totalSize - 1);
  } else {
    // Invalid format (e.g., "bytes=-")
    return null;
  }

  // Final check: Ensure the range is valid after calculations
  if (start > end || start < 0 || end < 0 || start >= totalSize) {
    return null; // Unsatisfiable range
  }

  return { start, end, total: totalSize };
}

/**
 * Creates a Response for an unsatisfiable range request.
 * @param totalSize The total size of the resource.
 * @returns A Response object with status 416.
 */
export function createUnsatisfiableRangeResponse(totalSize: number): Response {
  const headers = new Headers({
    'Content-Range': `bytes */${totalSize}`,
    'Accept-Ranges': 'bytes', // Good practice to include even on error
  });
  return new Response('Range Not Satisfiable', { status: 416, headers });
}

/**
 * Handles range requests for initial video access using the Cache API.
 * This allows range requests to be supported even on first access to a video by:
 * 1. Storing the full response in the Cache API
 * 2. Using Cache.match() with range requests, which has built-in range support
 * 
 * @param originalResponse The full response with the video content
 * @param request The original request, potentially with a Range header
 * @returns A Response object, either the full response or a ranged response
 */
export async function handleRangeRequestForInitialAccess(
  originalResponse: Response,
  request: Request
): Promise<Response> {
  try {
    // Import the centralized bypass headers utility
    const { hasBypassHeaders } = await import('./bypassHeadersUtils');
    
    // IMPORTANT: Check if response should bypass Cache API (for large videos or fallbacks)
    if (hasBypassHeaders(originalResponse.headers) || 
        originalResponse.headers.get('X-Fallback-Applied') === 'true') {
      
      try {
        // Log bypass if context is available
        const { getCurrentContext, addBreadcrumb } = await import('./requestContext');
        const { createLogger, debug } = await import('./pinoLogger');
        
        const context = getCurrentContext();
        if (context) {
          const logger = createLogger(context);
          
          debug(context, logger, 'CacheAPI', 'Bypassing Cache API for direct streaming', {
            status: originalResponse.status,
            contentType: originalResponse.headers.get('Content-Type'),
            contentLength: originalResponse.headers.get('Content-Length'),
            reason: originalResponse.headers.get('X-Video-Exceeds-256MiB') === 'true' ? 
                   'VideoTooLarge' : 'FallbackContent',
            bypass: true
          });
          
          addBreadcrumb(context, 'CacheAPI', 'Direct streaming (bypassing Cache API)', {
            contentLength: originalResponse.headers.get('Content-Length'),
            contentType: originalResponse.headers.get('Content-Type')
          });
        }
      } catch (logError) {
        // Silent fail - logging should not break function
      }
      
      // If there's a range header, use the centralized streamUtils to handle it
      const rangeHeader = request.headers.get('Range');
      if (rangeHeader) {
        try {
          // Import centralized range handling from streamUtils
          const { handleRangeRequest } = await import('./streamUtils');
          
          // Handle the range request with streamUtils (preserving all headers and bypass flags)
          return await handleRangeRequest(originalResponse, rangeHeader, {
            bypassCacheAPI: true,
            preserveHeaders: true,
            handlerTag: 'Direct-Stream-Range-Handler',
            fallbackApplied: originalResponse.headers.get('X-Fallback-Applied') === 'true'
          });
        } catch (rangeError) {
          try {
            // Log the error
            const { getCurrentContext } = await import('./requestContext');
            const { createLogger, error } = await import('./pinoLogger');
            
            const context = getCurrentContext();
            if (context) {
              const logger = createLogger(context);
              error(context, logger, 'RangeRequest', 'Error processing range request for direct stream', {
                error: rangeError instanceof Error ? rangeError.message : String(rangeError),
                range: rangeHeader
              });
            }
          } catch (logError) {
            // Silent fail for logging errors
          }
          
          console.error('Error handling range request:', rangeError);
          
          // RECOVERY: fallback to normal response if range handling fails
          return originalResponse;
        }
      }
      
      // If there's no range request or if range handling failed, return the original response
      return originalResponse;
    }

    // Use the full URL from the original request as the cache key
    const cacheKeyForPut = request.url; // Use the full URL string
    const cache = await caches.open('VIDEO_BUFFER_CACHE');
    let responseUsedForCachePut = false;
    
    // Logging utilities
    const { getCurrentContext, addBreadcrumb } = await import('./requestContext');
    const { createLogger, debug, error: logErrorPino } = await import('./pinoLogger');
    const context = getCurrentContext();

    // In a real implementation, we would determine the TTL from config
    // But since we can't directly import those functions without creating circular dependencies
    // And the Cache API doesn't directly support TTL, we'll focus on storing the video
    // The Cache API entries will be cleared when the worker restarts or after a period of inactivity
    
    // Calculate TTL from Cache-Control header for logging purposes
    let ttl = 3600; // Default 1 hour
    const cacheControl = originalResponse.headers.get('Cache-Control');
    if (cacheControl && cacheControl.includes('max-age=')) {
      const match = cacheControl.match(/max-age=(\d+)/);
      if (match && match[1]) {
        ttl = parseInt(match[1], 10);
      }
    }
    
    // For logging consistency, we can keep track of the pathname + search if needed
    const url = new URL(request.url);
    const pathAndSearchForLogging = url.pathname + url.search;
    
    // Get the current range header before any operations
    const rangeHeader = request.headers.get('Range');
    
    // Only attempt to cache 200 OK responses that have a body
    if (originalResponse.status === 200 && originalResponse.body) {
      // First, prepare a properly TTL-enabled response
      // Calculate TTL from Cache-Control header for proper HTTP caching
      let ttl = 3600; // Default 1 hour
      const cacheControl = originalResponse.headers.get('Cache-Control');
      if (cacheControl && cacheControl.includes('max-age=')) {
        const match = cacheControl.match(/max-age=(\d+)/);
        if (match && match[1]) {
          ttl = parseInt(match[1], 10);
        }
      }
      
      // Create a response that includes current date and age headers
      // This enables proper HTTP caching with TTL countdown
      const enhancedHeaders = new Headers(originalResponse.headers);
      enhancedHeaders.set('Date', new Date().toUTCString());
      enhancedHeaders.set('Age', '0'); // Start with fresh content
      
      // Make sure Cache-Control is properly set if not already
      if (!cacheControl || !cacheControl.includes('max-age=')) {
        enhancedHeaders.set('Cache-Control', `public, max-age=${ttl}`);
      }
      
      // Create a response for cache without excessive cloning
      // Only clone once and reuse the stream efficiently
      const clonedResponse = originalResponse.clone();
      const responseToCache = new Response(clonedResponse.body, {
        status: originalResponse.status,
        statusText: originalResponse.statusText,
        headers: enhancedHeaders
      });
      
      responseUsedForCachePut = true; // Mark that we are attempting to use a stream for cache.put
      
      if (context) {
        const logger = createLogger(context);
        // Add breadcrumb for tracking
        addBreadcrumb(context, 'CacheAPI', 'Preparing to store video in Cache API for range support', {
          status: originalResponse.status,
          contentType: originalResponse.headers.get('Content-Type'),
          approximateTtl: ttl,
          cacheKey: cacheKeyForPut,
          path: pathAndSearchForLogging // Include path for context
        });
        
        debug(context, logger, 'CacheAPI', 'Storing in Cache API with TTL alignment', {
          status: originalResponse.status,
          contentType: originalResponse.headers.get('Content-Type'),
          cacheControl,
          approximateTtl: ttl,
          note: 'Cache API entries expire when worker restarts, KV provides persistent storage'
        });
      } else {
        // Fall back to console if context is not available
        console.debug('Cache API storage with TTL alignment:', {
          status: originalResponse.status,
          contentType: originalResponse.headers.get('Content-Type'),
          approximateTtl: ttl
        });
      }
      
      try {
        // Use the CLONED response for cache.put
        await cache.put(cacheKeyForPut, responseToCache);
        if (context) {
          const logger = createLogger(context);
          debug(context, logger, 'CacheAPI', 'Successfully stored response in Cache API', { 
            cacheKey: cacheKeyForPut 
          });
        }
      } catch (cachePutError) {
        responseUsedForCachePut = false; // Cache put failed, stream was not fully consumed by *this* operation on the clone
        if (context) {
          const logger = createLogger(context);
          logErrorPino(context, logger, 'CacheAPI', 'Error storing in Cache API', {
            error: cachePutError instanceof Error ? cachePutError.message : String(cachePutError),
            cacheKey: cacheKeyForPut,
          });
        } else {
          // Log warning - we should never get here if the videoHandler is properly cloning before range handling
          console.warn('Error storing in Cache API:', {
            error: cachePutError instanceof Error ? cachePutError.message : String(cachePutError),
            status: originalResponse.status,
            url: cacheKeyForPut
          });
        }
        // If cache.put fails, we will proceed to try cache.match,
        // and if that fails, we'll fall back to originalResponse.
        // Since we used a clone for the failed cache.put, originalResponse.body *should* still be intact.
      }
    } else if (context) {
      // Log warning - we should never get here if the videoHandler is properly cloning before range handling
      const logger = createLogger(context);
      debug(context, logger, 'CacheAPI', 'Skipping Cache API storage for non-200 response or no body', {
        status: originalResponse.status,
        hasBody: !!originalResponse.body,
        cacheKey: cacheKeyForPut
      });
    } else {
      console.warn('Skipping Cache API storage for non-200 response or no body:', {
        status: originalResponse.status,
        hasBody: !!originalResponse.body,
        url: cacheKeyForPut
      });
    }
    
    // ALWAYS try to serve from cache after the put attempt.
    // cache.match() returns a NEW Response with a fresh, readable stream.
    if (rangeHeader) {
      const rangeRequest = new Request(request.url, {
        headers: new Headers({ 
          'Range': rangeHeader,
          // Preserve any other important headers
          'Accept': request.headers.get('Accept') || '*/*',
          'Accept-Encoding': request.headers.get('Accept-Encoding') || ''
        }),
      });
      const rangeResponseFromCache = await cache.match(rangeRequest);
      if (rangeResponseFromCache) {
        // Update Age header for proper TTL countdown
        const ageHeader = rangeResponseFromCache.headers.get('Age');
        const dateHeader = rangeResponseFromCache.headers.get('Date');
        const newHeaders = new Headers(rangeResponseFromCache.headers);
        
        if (dateHeader) {
          // Calculate the correct Age value
          const dateValue = new Date(dateHeader).getTime();
          const currentTime = Date.now();
          const ageInSeconds = Math.floor((currentTime - dateValue) / 1000);
          
          // Start with existing Age value if present, otherwise use calculated age
          let newAge = ageInSeconds;
          if (ageHeader) {
            newAge = Math.max(parseInt(ageHeader, 10), ageInSeconds);
          }
          
          // Set updated Age header
          newHeaders.set('Age', newAge.toString());
        } else {
          // If no Date header exists, set a default Age increment
          const currentAge = ageHeader ? parseInt(ageHeader, 10) : 0;
          newHeaders.set('Age', (currentAge + 10).toString()); // Add 10 seconds as default increment
          // Also add a Date header to enable proper age calculation in future
          newHeaders.set('Date', new Date().toUTCString());
        }
        
        // Create a new response with updated headers
        // Also incorporate max-age countdown based on the Age header
        // Calculate remaining TTL by checking Cache-Control max-age against Age
        const cacheControl = newHeaders.get('Cache-Control');
        if (cacheControl && cacheControl.includes('max-age=')) {
          const match = cacheControl.match(/max-age=(\d+)/);
          if (match && match[1]) {
            const maxAge = parseInt(match[1], 10);
            const age = parseInt(newHeaders.get('Age') || '0', 10);
            
            // Calculate remaining TTL
            const remainingTtl = Math.max(0, maxAge - age);
            
            // Update Cache-Control header with the remaining TTL
            newHeaders.set('Cache-Control', `public, max-age=${remainingTtl}`);
            
            if (context) {
              const logger = createLogger(context);
              debug(context, logger, 'CacheAPI', 'Updated Cache-Control with remaining TTL for range request', {
                originalMaxAge: maxAge,
                age: age,
                remainingTtl: remainingTtl,
                range: rangeHeader
              });
            }
          }
        }
        
        const updatedResponse = new Response(rangeResponseFromCache.body, {
          status: rangeResponseFromCache.status,
          statusText: rangeResponseFromCache.statusText,
          headers: newHeaders
        });
        
        if (context) {
          addBreadcrumb(context, 'CacheAPI', 'Serving ranged response from Cache API with updated Age', {
            range: rangeHeader, 
            status: updatedResponse.status, 
            contentRange: updatedResponse.headers.get('Content-Range'),
            contentLength: updatedResponse.headers.get('Content-Length'),
            age: updatedResponse.headers.get('Age'),
            cacheKey: cacheKeyForPut,
            path: pathAndSearchForLogging
          });
        }
        return updatedResponse;
      }
      // If ranged request is not found in cache (e.g. cache.put failed or item expired quickly)
      // We'll fall through to try a full match, or eventually originalResponse.
      if (context) {
        const logger = createLogger(context);
        debug(context, logger, 'CacheAPI', 'Ranged request not found in Cache API, will try full match or fallback.', { 
          range: rangeHeader, 
          cacheKey: cacheKeyForPut 
        });
      }
    }

    // Attempt to match the full request (non-ranged or if ranged failed above)
    // Use a new Request object for cache.match to ensure no unintended header interference.
    const fullRequestForMatch = new Request(cacheKeyForPut);
    const fullResponseFromCache = await cache.match(fullRequestForMatch);
    if (fullResponseFromCache) {
      // Update Age header for proper TTL countdown, same as for ranged response
      const ageHeader = fullResponseFromCache.headers.get('Age');
      const dateHeader = fullResponseFromCache.headers.get('Date');
      const newHeaders = new Headers(fullResponseFromCache.headers);
      
      if (dateHeader) {
        // Calculate the correct Age value
        const dateValue = new Date(dateHeader).getTime();
        const currentTime = Date.now();
        const ageInSeconds = Math.floor((currentTime - dateValue) / 1000);
        
        // Start with existing Age value if present, otherwise use calculated age
        let newAge = ageInSeconds;
        if (ageHeader) {
          newAge = Math.max(parseInt(ageHeader, 10), ageInSeconds);
        }
        
        // Set updated Age header
        newHeaders.set('Age', newAge.toString());
      } else {
        // If no Date header exists, set a default Age increment
        const currentAge = ageHeader ? parseInt(ageHeader, 10) : 0;
        newHeaders.set('Age', (currentAge + 10).toString()); // Add 10 seconds as default increment
        // Also add a Date header to enable proper age calculation in future
        newHeaders.set('Date', new Date().toUTCString());
      }
      
      // Create a new response with updated headers
      // Also incorporate max-age countdown based on the Age header
      // Calculate remaining TTL by checking Cache-Control max-age against Age
      const cacheControl = newHeaders.get('Cache-Control');
      if (cacheControl && cacheControl.includes('max-age=')) {
        const match = cacheControl.match(/max-age=(\d+)/);
        if (match && match[1]) {
          const maxAge = parseInt(match[1], 10);
          const age = parseInt(newHeaders.get('Age') || '0', 10);
          
          // Calculate remaining TTL
          const remainingTtl = Math.max(0, maxAge - age);
          
          // Update Cache-Control header with the remaining TTL
          newHeaders.set('Cache-Control', `public, max-age=${remainingTtl}`);
          
          if (context) {
            const logger = createLogger(context);
            debug(context, logger, 'CacheAPI', 'Updated Cache-Control with remaining TTL', {
              originalMaxAge: maxAge,
              age: age,
              remainingTtl: remainingTtl
            });
          }
        }
      }
      
      const updatedResponse = new Response(fullResponseFromCache.body, {
        status: fullResponseFromCache.status,
        statusText: fullResponseFromCache.statusText,
        headers: newHeaders
      });
      
      if (context) {
        addBreadcrumb(context, 'CacheAPI', 'Serving full response from Cache API with updated Age', {
          status: updatedResponse.status,
          age: updatedResponse.headers.get('Age'),
          cacheKey: cacheKeyForPut
        });
      }
      return updatedResponse;
    }

    // --- Fallback to originalResponse ---
    // This section is reached if:
    // 1. The originalResponse was not cacheable (e.g., not status 200).
    // 2. Caching was attempted (for a 200 response) but then cache.match failed for both ranged and full requests.
    // Since we used a clone for cache.put(), originalResponse.body *should* still be readable.
    if (context) {
      const logger = createLogger(context);
      addBreadcrumb(context, 'CacheAPI', 'Cache API miss for all attempts, falling back to originalResponse.', {
        originalStatus: originalResponse.status,
        cacheKey: cacheKeyForPut,
        wasCachePutAttempted: responseUsedForCachePut, // Indicates if the clone's stream was given to cache.put
        hasRangeHeader: !!rangeHeader
      });
      debug(context, logger, 'CacheAPI', 'Falling back to originalResponse after Cache API miss.', {
        cacheKey: cacheKeyForPut,
        originalStatus: originalResponse.status
      });
    }
    
    // If this is a range request and we had to fall back to originalResponse,
    // we should handle the range request directly on the original response
    if (rangeHeader && originalResponse.status === 200) {
      try {
        const { handleRangeRequest } = await import('./streamUtils');
        if (context) {
          const logger = createLogger(context);
          debug(context, logger, 'CacheAPI', 'Handling range request on fallback originalResponse', {
            range: rangeHeader,
            contentType: originalResponse.headers.get('Content-Type')
          });
        }
        
        return await handleRangeRequest(originalResponse, rangeHeader, {
          bypassCacheAPI: false,
          preserveHeaders: true,
          handlerTag: 'CacheAPI-Miss-Range-Handler'
        });
      } catch (rangeError) {
        if (context) {
          const logger = createLogger(context);
          logErrorPino(context, logger, 'CacheAPI', 'Error handling range on fallback response', {
            error: rangeError instanceof Error ? rangeError.message : String(rangeError),
            stack: rangeError instanceof Error ? rangeError.stack : undefined
          });
        }
        // Still fall back to originalResponse if range handling fails
      }
    }
    
    return originalResponse;
    
  } catch (error) {
    // If anything goes wrong, fall back to the original response
    try {
      // Use proper logging utility
      const { getCurrentContext } = await import('./requestContext');
      const { createLogger, error: logError } = await import('./pinoLogger');
      
      const context = getCurrentContext();
      if (context) {
        const logger = createLogger(context);
        logError(context, logger, 'CacheAPI', 'Critical error in handleRangeRequestForInitialAccess', {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined
        });
      } else {
        console.error('Critical error in handleRangeRequestForInitialAccess (no context):', error);
      }
    } catch (logError) {
      // Fall back to console if logging utilities fail
      console.error('Critical error in handleRangeRequestForInitialAccess:', error);
    }
    
    // If we still have a range request, try the manual method as fallback
    const rangeHeader = request.headers.get('Range');
    if (rangeHeader) {
      try {
        // Use centralized streamUtils for range handling as fallback
        const { handleRangeRequest } = await import('./streamUtils');
        
        try {
          // Use proper logging utility
          const { getCurrentContext } = await import('./requestContext');
          const { createLogger, debug } = await import('./pinoLogger');
          const { addBreadcrumb } = await import('./requestContext');
          
          const context = getCurrentContext();
          if (context) {
            const logger = createLogger(context);
            debug(context, logger, 'CacheAPI', 'Attempting fallback range handling with streamUtils', {
              rangeHeader,
              status: originalResponse.status,
              contentType: originalResponse.headers.get('Content-Type')
            });
            
            addBreadcrumb(context, 'RangeRequest', 'Attempting fallback range handling', {
              range: rangeHeader
            });
          }
        } catch (logError) {
          // Silent fail for logging errors
        }
        
        // Handle the range request with appropriate options
        return await handleRangeRequest(originalResponse, rangeHeader, {
          bypassCacheAPI: false, // Regular fallback handling, not deliberately bypassing
          preserveHeaders: true,
          handlerTag: 'Stream-Range-Handler-Fallback'
        });
        
      } catch (fallbackError) {
        try {
          // Use proper logging utility
          const { getCurrentContext } = await import('./requestContext');
          const { createLogger, error: logError } = await import('./pinoLogger');
          
          const context = getCurrentContext();
          if (context) {
            const logger = createLogger(context);
            logError(context, logger, 'CacheAPI', 'Fallback range handling also failed', {
              error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
              stack: fallbackError instanceof Error ? fallbackError.stack : undefined,
              rangeHeader
            });
          } else {
            console.error('Fallback range handling also failed:', fallbackError);
          }
        } catch (logError) {
          // Fall back to console if logging utilities fail
          console.error('Fallback range handling also failed:', fallbackError);
        }
      }
    }
    
    // Final fallback: return the originalResponse.
    // Its stream state is uncertain if an error occurred mid-logic, but it's the best we have.
    return originalResponse;
  }
}
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
        const { getCurrentContext } = await import('./requestContext');
        const { createLogger, debug } = await import('./pinoLogger');
        const { addBreadcrumb } = await import('./requestContext');
        
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

    // For logging consistency, we can keep track of the pathname + search if needed
    const url = new URL(request.url);
    const pathAndSearchForLogging = url.pathname + url.search;

    // Get the cache or open a new one
    const cache = await caches.open('VIDEO_BUFFER_CACHE');
    
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
    
    // Use proper logging utility
    try {
      // Get request context if available
      const { getCurrentContext } = await import('./requestContext');
      const { createLogger, debug } = await import('./pinoLogger');
      
      const context = getCurrentContext();
      if (context) {
        const logger = createLogger(context);
        const { addBreadcrumb } = await import('./requestContext');
        
        // Add breadcrumb for tracking
        addBreadcrumb(context, 'CacheAPI', 'Storing video in Cache API for range support', {
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
      }
    } catch (logError) {
      // Fall back to console if logging utilities fail
      console.debug('Cache API storage with TTL alignment:', {
        status: originalResponse.status,
        contentType: originalResponse.headers.get('Content-Type'),
        approximateTtl: ttl
      });
    }
    
    try {
      // Store the full response in the cache using the full URL as the key
      // Only cache 200 OK responses, NEVER 206 Partial Content responses
      if (originalResponse.status === 200) {
        // Important: originalResponse is now consumed by this operation and can't be used again!
        await cache.put(cacheKeyForPut, originalResponse);
      } else {
        // Log warning - we should never get here if the videoHandler is properly cloning before range handling
        console.warn('Skipping Cache API storage for non-200 response:', {
          status: originalResponse.status,
          url: cacheKeyForPut
        });
      }
    } catch (cacheError) {
      // Log the cache error
      try {
        const { getCurrentContext } = await import('./requestContext');
        const { createLogger, error } = await import('./pinoLogger');
        
        const context = getCurrentContext();
        if (context) {
          const logger = createLogger(context);
          error(context, logger, 'CacheAPI', 'Error storing in Cache API', {
            error: cacheError instanceof Error ? cacheError.message : String(cacheError),
            status: originalResponse.status,
            contentType: originalResponse.headers.get('Content-Type'),
            contentLength: originalResponse.headers.get('Content-Length')
          });
        }
      } catch (logError) {
        // Silent fail - logging should not break function
      }
      
      // If we fail to store in cache, create a fresh response to return
      // This is needed because originalResponse is now consumed
      return new Response('Error caching response', { status: 500 });
    }
    
    // If this is a range request, use cache.match with ignoreSearch: false to respect ranges
    const rangeHeader = request.headers.get('Range');
    if (rangeHeader) {
      // Create a new request with the same URL and the Range header
      const rangeRequest = new Request(request.url, {
        headers: new Headers({
          'Range': rangeHeader,
          // Preserve any other important headers
          'Accept': request.headers.get('Accept') || '*/*',
          'Accept-Encoding': request.headers.get('Accept-Encoding') || ''
        })
      });
      
      // Match the range request against the cached response
      // The Cache API automatically handles range requests!
      const rangeResponse = await cache.match(rangeRequest);
      
      if (rangeResponse) {
        try {
          // Add breadcrumb for successful range request handling
          const { getCurrentContext } = await import('./requestContext');
          const { addBreadcrumb } = await import('./requestContext');
          
          const context = getCurrentContext();
          if (context) {
            addBreadcrumb(context, 'CacheAPI', 'Successfully handled range request', {
              range: rangeHeader,
              status: rangeResponse.status,
              contentRange: rangeResponse.headers.get('Content-Range'),
              contentLength: rangeResponse.headers.get('Content-Length'),
              cacheKey: cacheKeyForPut,
              path: pathAndSearchForLogging
            });
          }
        } catch (logError) {
          // Ignore logging errors - don't break main functionality
        }
        
        return rangeResponse;
      }
    }
    
    // If this is not a range request or if range request didn't work,
    // return the original response (cache.match will handle Range headers automatically)
    const cachedResponse = await cache.match(request);
    if (cachedResponse) {
      return cachedResponse;
    }
    
    // Fallback to original response if cache fails
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
        logError(context, logger, 'CacheAPI', 'Error handling range request with Cache API', {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined
        });
      } else {
        console.error('Error handling range request with Cache API:', error);
      }
    } catch (logError) {
      // Fall back to console if logging utilities fail
      console.error('Error handling range request with Cache API:', error);
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
    
    return originalResponse;
  }
}
/**
 * Utilities for retrieving cached responses with range request support
 */
import { CacheConfigurationManager } from '../config';
import { getCurrentContext } from './legacyLoggerAdapter';
import { addBreadcrumb } from './requestContext';
import { logErrorWithContext, withErrorHandling } from './errorHandlingUtils';
import { parseRangeHeader, createUnsatisfiableRangeResponse } from './httpUtils';
import { createLogger, debug as pinoDebug, warn as pinoWarn } from './pinoLogger';

/**
 * Log a debug message with proper context handling
 */
function logDebug(message: string, data?: Record<string, unknown>): void {
  const requestContext = getCurrentContext();
  if (requestContext) {
    const logger = createLogger(requestContext);
    pinoDebug(requestContext, logger, 'CacheRetrievalUtils', message, data);
  } else {
    // Fall back to console as a last resort
    console.debug(`CacheRetrievalUtils: ${message}`, data || {});
  }
}

/**
 * Log a warning message with proper context handling
 */
function logWarn(message: string, data?: Record<string, unknown>): void {
  const requestContext = getCurrentContext();
  if (requestContext) {
    const logger = createLogger(requestContext);
    pinoWarn(requestContext, logger, 'CacheRetrievalUtils', message, data);
  } else {
    // Fall back to console as a last resort
    console.warn(`CacheRetrievalUtils: ${message}`, data || {});
  }
}

/**
 * Retrieves a response from the Cloudflare Cache API, handling range requests.
 * Primarily uses the original request with its headers for matching,
 * letting Cloudflare handle range requests automatically.
 * Includes a fallback manual range handling mechanism for edge cases.
 * 
 * IMPORTANT: Cloudflare's Cache API has eventual consistency. This means that
 * items stored with cache.put() may not be immediately available via cache.match().
 * This function tries several cache key strategies in parallel to improve hit rates,
 * especially right after items have been stored in cache.
 * 
 * @param request - The incoming request to match in cache.
 * @returns Cached response (possibly 206 Partial Content) or null if not found.
 */
export const getCachedResponse = withErrorHandling<
  [Request],
  Promise<Response | null>
>(
  async function getCachedResponseImpl(request: Request): Promise<Response | null> {
    // Only try to cache GET requests
    if (request.method !== 'GET') {
      return null;
    }
    
    // Check if we should bypass cache based on specific cache-control headers or bypass parameters
    const url = new URL(request.url);
    
    // Get cache configuration to check bypass parameters properly
    // Only bypass for specific parameters (debug, nocache, bypass), not for IMQuery parameters
    const cacheConfig = CacheConfigurationManager.getInstance();
    const shouldBypass = cacheConfig.shouldBypassCache(url);
    
    if (shouldBypass) {
      logDebug('Bypassing cache based on specific bypass parameters', {
        url: request.url,
        hasDebugParam: url.searchParams.has('debug'),
        hasBypassParam: url.searchParams.has('bypass'),
        hasNoCacheParam: url.searchParams.has('nocache')
      });
      return null;
    }
    
    // Use the cache configuration for method determination
    const cacheMethod = cacheConfig.getConfig().method;
    
    // When using cf object caching, we don't use explicit cache.match
    // Instead, we rely on Cloudflare's built-in caching with the cf object in fetch
    if (cacheMethod === 'cf') {
      if (cacheConfig.getConfig().debug) {
        logDebug('Using cf object for caching, but still checking Cache API for better range request support', {
          url: request.url,
          method: 'cf-object'
        });
      }
      // Continue checking the Cache API even with cf method and debug mode,
      // this enables proper range request support even when debug is enabled
      // Do NOT return null here as we did before
    }
    
    // Check if this is a range request
    const isRangeRequest = request.headers.has('Range');
    const rangeHeader = request.headers.get('Range');
    
    // Cache API implementation
    const cacheMatchOperation = withErrorHandling(
      async () => {
        // Get the default cache
        const cache = caches.default;
        
        const matchStartTime = Date.now();
        
        // Log attempt with key details from the request
        logDebug('Attempting Cache API match using ORIGINAL request', {
          url: request.url,
          method: request.method,
          isRangeRequest,
          rangeHeader: rangeHeader || undefined
        });

        // Try multiple cache matching strategies in parallel for better hit rates
        // This is especially important right after cache.put operations where immediate
        // cache availability isn't guaranteed due to Cache API's eventual consistency
        
        const requestUrl = new URL(request.url);
        
        // Create all cache key variants
        // 1. Original request with all headers (handles Range requests properly)
        const originalRequest = request;
        
        // 2. Path-only request with no headers (most minimal key)
        const baseUrl = requestUrl.origin + requestUrl.pathname;
        const pathOnlyKey = new Request(baseUrl, { method: 'GET' });
        
        // 3. Path-only request with Accept header (good for content negotiation)
        const acceptHeader = request.headers.get('Accept');
        const acceptHeadersKey = new Request(baseUrl, { 
          method: 'GET',
          headers: acceptHeader ? { 'Accept': acceptHeader } : undefined
        });
        
        // 4. For transformed URLs, also try matching the original path
        let originalPathKey: Request | null = null;
        if (requestUrl.pathname.includes('/cdn-cgi/media/') || 
            requestUrl.pathname.includes('/cdn-cgi/image/')) {
          const originalPath = requestUrl.pathname.replace(/\/cdn-cgi\/(media|image)\/[^/]+\//, '/');
          
          if (originalPath !== requestUrl.pathname) {
            const originalUrl = new URL(requestUrl.toString());
            originalUrl.pathname = originalPath;
            
            originalPathKey = new Request(originalUrl.toString(), {
              method: request.method,
              headers: request.headers
            });
          }
        }
        
        // Log the cache keys we're trying
        logDebug('Attempting parallel cache matches with multiple key strategies', {
          url: request.url,
          originalRequest: true,
          pathOnlyKey: baseUrl,
          acceptHeadersKey: !!acceptHeader,
          originalPathKey: originalPathKey ? originalPathKey.url : null
        });
        
        // Try all cache match strategies simultaneously
        // Note: Order matters for Promise.all results, but we'll prioritize the
        // simpler keys first since that's what our cacheResponseUtils.ts stores with
        const matchPromises = [
          // Path-only key is the most likely to match since we store with this
          cache.match(pathOnlyKey).then(response => ({ response, method: 'path-only' })),
          // Original request with all headers is a more complex key but might work
          cache.match(originalRequest).then(response => ({ response, method: 'original-request' })),
          // Accept header key as a middle ground
          cache.match(acceptHeadersKey).then(response => ({ response, method: 'accept-headers' }))
        ];
        
        // Add originalPathKey if it exists
        if (originalPathKey) {
          matchPromises.push(
            cache.match(originalPathKey).then(response => ({ response, method: 'original-path' }))
          );
        }
        
        // Wait for all match attempts and use the first successful one
        const results = await Promise.all(matchPromises);
        
        // Find the first match that succeeded
        const matchResult = results.find(result => result.response !== null);
        
        let cachedResponse = matchResult?.response || null;
        let matchMethod = matchResult?.method || 'none';
        
        if (cachedResponse) {
          logDebug('Found cached response using parallel matching strategy', {
            url: request.url,
            matchMethod,
            status: cachedResponse.status,
            contentType: cachedResponse.headers.get('Content-Type')
          });
        } else {
          logDebug('No cache match found with any parallel strategy', {
            url: request.url,
            attemptedMethods: results.map(r => r.method).join(',')
          });
        }
        
        const matchDuration = Date.now() - matchStartTime;
        
        // Add breadcrumb for cache result
        const requestContext = getCurrentContext();
        if (requestContext) {
          if (cachedResponse) {
            addBreadcrumb(requestContext, 'Cache', 'Cache hit', {
              url: request.url,
              method: 'cache-api',
              matchMethod,
              status: cachedResponse.status,
              isRangeRequest,
              matchDurationMs: matchDuration
            });
          } else {
            addBreadcrumb(requestContext, 'Cache', 'Cache miss', {
              url: request.url,
              method: 'cache-api',
              isRangeRequest,
              matchDurationMs: matchDuration
            });
          }
        }
        
        // Handle cache hit
        if (cachedResponse) {
          logDebug('Cache API match result: HIT', {
            url: request.url,
            matchMethod,
            status: cachedResponse.status,
            contentType: cachedResponse.headers.get('Content-Type'),
            contentRange: cachedResponse.headers.get('Content-Range'),
            acceptRanges: cachedResponse.headers.get('Accept-Ranges'),
            matchDurationMs: matchDuration
          });
          
          // Check if this is a 206 Partial Content response - Cloudflare handled the range request
          if (isRangeRequest && cachedResponse.status === 206) {
            logDebug('Cloudflare Cache API automatically handled Range request', { 
              url: request.url,
              contentRange: cachedResponse.headers.get('Content-Range') 
            });
            
            if (requestContext) {
              addBreadcrumb(requestContext, 'Cache', 'Served partial content (CF Auto)', { 
                contentRange: cachedResponse.headers.get('Content-Range') 
              });
              if (!requestContext.diagnostics) requestContext.diagnostics = {};
              requestContext.diagnostics.rangeRequest = { 
                header: rangeHeader, 
                source: 'cache-api-auto', 
                status: 206 
              };
            }
            
            return cachedResponse;
          }
          
          // Manual range handling fallback (if needed)
          if (isRangeRequest && cachedResponse.status === 200 && 
              cachedResponse.headers.get('Accept-Ranges') === 'bytes') {
            logWarn('Cache hit with 200 OK when Range requested. Attempting manual range handling.', { 
              url: request.url 
            });
            
            try {
              const responseClone = cachedResponse.clone();
              const arrayBuffer = await responseClone.arrayBuffer();
              const totalSize = arrayBuffer.byteLength;
              const range = parseRangeHeader(rangeHeader, totalSize);
              
              if (range) {
                const slicedBody = arrayBuffer.slice(range.start, range.end + 1);
                const rangeHeaders = new Headers(cachedResponse.headers);
                rangeHeaders.set('Content-Range', `bytes ${range.start}-${range.end}/${range.total}`);
                rangeHeaders.set('Content-Length', slicedBody.byteLength.toString());
                rangeHeaders.set('X-Range-Handled-By', 'Manual-Fallback');
                
                logDebug('Serving MANUALLY ranged response as fallback', { 
                  url: request.url, 
                  range: rangeHeader, 
                  start: range.start, 
                  end: range.end, 
                  total: range.total 
                });
                
                if (requestContext) {
                  addBreadcrumb(requestContext, 'Cache', 'Served partial content (Manual)', { 
                    contentRange: rangeHeaders.get('Content-Range') 
                  });
                  if (!requestContext.diagnostics) requestContext.diagnostics = {};
                  requestContext.diagnostics.rangeRequest = { 
                    header: rangeHeader, 
                    start: range.start, 
                    end: range.end, 
                    total: range.total,
                    source: 'manual-range-handling',
                    status: 206 
                  };
                }
                
                return new Response(slicedBody, { 
                  status: 206, 
                  statusText: 'Partial Content', 
                  headers: rangeHeaders 
                });
              } else {
                // Unsatisfiable range
                logWarn('Unsatisfiable range for cached content', { 
                  url: request.url, 
                  range: rangeHeader, 
                  totalSize 
                });
                
                if (requestContext) {
                  addBreadcrumb(requestContext, 'Cache', 'Unsatisfiable range', { 
                    range: rangeHeader, 
                    totalSize 
                  });
                  if (!requestContext.diagnostics) requestContext.diagnostics = {};
                  requestContext.diagnostics.rangeRequest = { 
                    header: rangeHeader, 
                    error: 'unsatisfiable', 
                    total: totalSize,
                    source: 'manual-range-handling',
                    status: 416
                  };
                }
                
                return createUnsatisfiableRangeResponse(totalSize);
              }
            } catch (rangeError) {
              // Log error but fall through to return the full response
              logErrorWithContext('Error handling range request manually', 
                rangeError, { url: request.url, range: rangeHeader }, 'CacheRetrievalUtils');
            }
          }
          
          // If no range handling was needed or manual handling failed, return the response as-is
          return cachedResponse;
        }
        
        // Handle cache miss
        logDebug('Cache API match result: MISS', {
          url: request.url,
          matchDurationMs: matchDuration
        });
        
        return null;
      },
      {
        functionName: 'cacheMatchOperation',
        component: 'CacheRetrievalUtils',
        logErrors: true
      },
      {
        url: request.url,
        method: 'cache-api'
      }
    );
    
    return await cacheMatchOperation();
  },
  {
    functionName: 'getCachedResponse',
    component: 'CacheRetrievalUtils',
    logErrors: true
  },
  { component: 'Cache API' }
);
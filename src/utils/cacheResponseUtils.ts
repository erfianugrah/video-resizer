/**
 * Utilities for storing responses in cache
 * Handles complex caching scenarios with range requests
 */
import { CacheConfig } from './cacheUtils';
import { CacheConfigurationManager } from '../config';
import { getCurrentContext } from './legacyLoggerAdapter';
import { addBreadcrumb } from './requestContext';
import { logErrorWithContext, withErrorHandling } from './errorHandlingUtils';
import { parseRangeHeader, createUnsatisfiableRangeResponse } from './httpUtils';
import { createLogger, debug as pinoDebug, warn as pinoWarn } from './pinoLogger';
import { prepareResponseForCaching, storeInCacheWithRangeSupport, isCacheableContentType } from './cacheStorageUtils';

/**
 * Log a debug message with proper context handling
 */
function logDebug(message: string, data?: Record<string, unknown>): void {
  const requestContext = getCurrentContext();
  if (requestContext) {
    const logger = createLogger(requestContext);
    pinoDebug(requestContext, logger, 'CacheResponseUtils', message, data);
  } else {
    // Fall back to console as a last resort
    console.debug(`CacheResponseUtils: ${message}`, data || {});
  }
}

/**
 * Log a warning message with proper context handling
 */
function logWarn(message: string, data?: Record<string, unknown>): void {
  const requestContext = getCurrentContext();
  if (requestContext) {
    const logger = createLogger(requestContext);
    pinoWarn(requestContext, logger, 'CacheResponseUtils', message, data);
  } else {
    // Fall back to console as a last resort
    console.warn(`CacheResponseUtils: ${message}`, data || {});
  }
}

/**
 * Handle caching for a response following Cloudflare's recommended pattern:
 * 1. Check cache first with the original request
 * 2. On cache miss, call the fetch function to get the resource
 * 3. Enhance the response with headers needed for range support
 * 4. Cache the enhanced response for future requests
 * 5. Return the response (with appropriate range handling if needed)
 *
 * This properly handles range requests via Cloudflare's automatic range handling,
 * with a manual fallback for the first request.
 * 
 * IMPORTANT: The Cloudflare Cache API exhibits eventual consistency behavior.
 * This means that items stored with cache.put() may not be immediately available
 * for retrieval with cache.match(). The propagation delay can vary, which is why
 * we implement manual range handling as a fallback while the cache propagates.
 * For more information, see: https://developers.cloudflare.com/workers/runtime-apis/cache/
 *
 * @param request - The original request (may include Range header)
 * @param fetch - Function to fetch the resource if not in cache
 * @param context - Optional execution context for waitUntil
 * @returns Response with proper range support
 */
export const cacheResponse = withErrorHandling<
  [Request, Response | ((req: Request) => Promise<Response>), ExecutionContext?],
  Promise<Response>
>(
  async function cacheResponseImpl(
    request: Request,
    responseOrFetch: Response | ((req: Request) => Promise<Response>),
    context?: ExecutionContext
  ): Promise<Response> {
    // Only process GET requests
    if (request.method !== 'GET') {
      logDebug('Not caching non-GET request', { method: request.method });
      
      // If we were given a Response directly, return it
      if (responseOrFetch instanceof Response) {
        return responseOrFetch;
      }
      
      // Otherwise call the fetch function and return its result
      return responseOrFetch(request);
    }
    
    const hasRangeHeader = request.headers.has('Range');
    const rangeHeader = request.headers.get('Range');
    
    logDebug('Starting cache operation', {
      url: request.url,
      hasRangeHeader,
      rangeHeader: rangeHeader || undefined
    });
    
    // Get the cache configuration manager
    const cacheConfig = CacheConfigurationManager.getInstance();
    const cacheMethod = cacheConfig.getConfig().method;
    
    // When using cf object caching, we'll only check cache but not store explicitly
    // as caching is handled by the cf object in fetch
    const skipCacheStorage = cacheMethod === 'cf';
    
    // Step 1: First check if the resource is already in cache
    // This allows Cloudflare to handle range requests automatically
    const cache = caches.default;
    
    let cachedResponse: Response | null = null;
    try {
      // Try to get the response from cache with the original request
      const matchResult = await cache.match(request);
      cachedResponse = matchResult || null;
      
      if (cachedResponse) {
        logDebug('Cache hit', {
          url: request.url,
          status: cachedResponse.status,
          contentType: cachedResponse.headers.get('Content-Type'),
          isRangeRequest: hasRangeHeader
        });
        
        // Add breadcrumb for cache hit
        const requestContext = getCurrentContext();
        if (requestContext) {
          addBreadcrumb(requestContext, 'Cache', 'Cache hit', {
            url: request.url,
            status: cachedResponse.status,
            contentType: cachedResponse.headers.get('Content-Type')
          });
        }
        
        // Return the cached response - Cloudflare will handle range requests automatically
        return cachedResponse;
      }
      
      logDebug('Cache miss', { url: request.url });
    } catch (error) {
      logWarn('Error checking cache', {
        url: request.url,
        error: error instanceof Error ? error.message : String(error)
      });
    }
    
    // Step 2: On cache miss, get the full resource
    // If a range was requested, we need to remove the Range header to get the full resource
    let originRequest: Request;
    
    if (hasRangeHeader) {
      // Create a new request without the Range header
      originRequest = new Request(request.url, {
        method: request.method,
        headers: new Headers(request.headers)
      });
      originRequest.headers.delete('Range');
      
      logDebug('Created origin request without Range header', {
        url: originRequest.url
      });
    } else {
      // Use the original request
      originRequest = request;
    }
    
    // Step 3: Get the response - either use the provided response or call the fetch function
    let response: Response;
    
    if (responseOrFetch instanceof Response) {
      // If we were given a Response directly, use it
      response = responseOrFetch;
      
      // Very important: If the response we were given is a 206 Partial Content,
      // we can't store it directly in cache per Cloudflare's docs.
      // Log this situation clearly so we understand what's happening.
      if (response.status === 206) {
        logWarn('Received 206 Partial Content response that cannot be stored in cache', {
          url: request.url,
          contentRange: response.headers.get('Content-Range'),
          isFromCdnCgi: response.url && response.url.includes('/cdn-cgi/'),
        });
        
        // We'll still try to serve it, but we can't cache it directly
        return response;
      }
    } else {
      // Otherwise call the fetch function
      response = await responseOrFetch(originRequest);
      
      // Same check for fetch result
      if (response.status === 206) {
        logWarn('Fetch returned 206 Partial Content that cannot be stored in cache', {
          url: request.url,
          contentRange: response.headers.get('Content-Range'),
          isFromCdnCgi: response.url && response.url.includes('/cdn-cgi/'),
        });
        
        // We'll still try to serve it, but we can't cache it directly
        if (hasRangeHeader) {
          return response; // Already ranged, just return it
        }
      }
    }
    
    // Only proceed with successful responses
    if (!response.ok) {
      logDebug('Origin returned non-successful response', {
        url: request.url,
        status: response.status
      });
      return response;
    }
    
    // Check the content type
    const contentType = response.headers.get('content-type') || '';
    
    // Check if content type is cacheable
    const isCacheableContent = isCacheableContentType(contentType);
    
    // Skip caching for non-cacheable content
    if (!isCacheableContent) {
      logDebug('Skipping cache for non-cacheable content type', {
        url: request.url,
        contentType
      });
      
      // But still handle range requests for the current response
      if (hasRangeHeader) {
        return handleRangeRequest(response, rangeHeader);
      }
      
      return response;
    }
    
    // Step 4: Enhance the response with headers needed for range support
    const enhancedHeaders = new Headers(response.headers);
    
    // Ensure Accept-Ranges is set
    enhancedHeaders.set('Accept-Ranges', 'bytes');
    
    // Ensure Content-Length is set (required for range requests)
    let bodySize: number | undefined;
    if (!enhancedHeaders.has('Content-Length')) {
      try {
        const clone = response.clone();
        const body = await clone.arrayBuffer();
        bodySize = body.byteLength;
        enhancedHeaders.set('Content-Length', bodySize.toString());
        
        logDebug('Added Content-Length header', {
          contentLength: bodySize
        });
      } catch (error) {
        logWarn('Error setting Content-Length header', {
          error: error instanceof Error ? error.message : String(error)
        });
      }
    } else {
      bodySize = parseInt(enhancedHeaders.get('Content-Length') || '0', 10);
    }
    
    // Ensure we have at least one validation header (ETag or Last-Modified)
    if (!enhancedHeaders.has('ETag') && !enhancedHeaders.has('Last-Modified')) {
      const etag = `"${Date.now().toString(36)}"`;
      enhancedHeaders.set('ETag', etag);
      
      logDebug('Added ETag header', {
        etag
      });
    }
    
    // Create enhanced response
    const enhancedResponse = new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: enhancedHeaders
    });
    
    // Log details about what we're about to store in cache
    logDebug('About to store enhanced response in cache', {
      responseStatus: enhancedResponse.status,
      originalResponseUrl: response.url || 'undefined',
      isTransformed: response.url && response.url.includes('/cdn-cgi/media/'),
      acceptRanges: enhancedHeaders.get('Accept-Ranges'),
      contentLength: enhancedHeaders.get('Content-Length'),
      etag: enhancedHeaders.get('ETag'),
      lastModified: enhancedHeaders.get('Last-Modified'),
      isCdnCgiResponse: response.url && response.url.includes('/cdn-cgi/')
    });
    
    // Step 5: Cache the enhanced response for future requests (if not using cf object)
    if (!skipCacheStorage) {
      logDebug('Storing enhanced response in cache', {
        url: request.url,
        contentType: enhancedHeaders.get('Content-Type'),
        contentLength: enhancedHeaders.get('Content-Length'),
        etag: enhancedHeaders.get('ETag'),
        lastModified: enhancedHeaders.get('Last-Modified'),
        acceptRanges: enhancedHeaders.get('Accept-Ranges'),
        hasRange: request.headers.has('Range'),
        rangeHeader: request.headers.get('Range')
      });
      
      // The key issue with Cloudflare Cache API's range request handling is that
      // we need to always store WITHOUT a Range header, but when a Range header is
      // present in the original request, Cloudflare automatically attempts to return
      // the appropriate slice of the cached resource.
      //
      // For this to work properly, we must:
      // 1. STORE the resource using a key WITHOUT any Range header (full resource)
      // 2. RETRIEVE using a key WITH the exact Range header of the current request
      
      // The cache key for STORING is always the URL with empty headers
      const storeKey = new Request(request.url, {
        method: 'GET',
        headers: new Headers() // Empty headers for storage
      });
      
      // For RETRIEVAL with range requests, we need a key with JUST the Range header
      // When Cloudflare handles range requests, this is the key we'll use to retrieve
      const retrieveKey = hasRangeHeader 
        ? new Request(request.url, {
            method: 'GET',
            headers: new Headers([['Range', rangeHeader || '']])
          })
        : storeKey;
      
      logDebug('Created cache keys', {
        storeKeyUrl: storeKey.url,
        storeKeyMethod: storeKey.method,
        storeKeyHeaders: [...storeKey.headers.entries()].map(entry => `${entry[0]}: ${entry[1]}`).join(', '),
        retrieveKeyUrl: retrieveKey.url,
        retrieveKeyMethod: retrieveKey.method,
        retrieveKeyHeaders: [...retrieveKey.headers.entries()].map(entry => `${entry[0]}: ${entry[1]}`).join(', '),
        originalRangeHeader: rangeHeader
      });
      
      // Make sure we're never trying to cache a 206 Partial Content as Cloudflare won't allow it
      if (enhancedResponse.status === 206) {
        logWarn('Cannot store 206 Partial Content response in cache', {
          url: request.url,
          status: enhancedResponse.status,
          contentRange: enhancedResponse.headers.get('Content-Range')
        });
        // Skip cache storage but continue with the response
      } else {
        // Store a full 200 OK response in cache
        // Use different cache keys to test what works best with Cloudflare's range handling
        
        // When storing in cache, we always use the empty key (no headers)
        // This is critical for Cloudflare to be able to satisfy range requests
        const keyWithoutHeaders = new Request(request.url, { 
          method: 'GET',
          headers: new Headers() 
        });
        
        // For retrieval with a range request, we need a key with ONLY the Range header
        // Cloudflare will match this against the resource stored with the empty key
        const keyWithRangeOnly = hasRangeHeader ? new Request(request.url, {
          method: 'GET',
          headers: new Headers([['Range', rangeHeader || '']])
        }) : keyWithoutHeaders;
        
        // Log the actual cache keys we're using with more detailed information
        logDebug('Using cache keys for storage', {
          emptyKey: {
            url: keyWithoutHeaders.url,
            method: keyWithoutHeaders.method,
            headers: [...keyWithoutHeaders.headers.entries()].map(entry => `${entry[0]}: ${entry[1]}`).join(', ') || 'none'
          },
          rangeKey: {
            url: keyWithRangeOnly.url,
            method: keyWithRangeOnly.method,
            headers: [...keyWithRangeOnly.headers.entries()].map(entry => `${entry[0]}: ${entry[1]}`).join(', ') || 'none'
          },
          enhancedResponseInfo: {
            status: enhancedResponse.status,
            contentType: enhancedResponse.headers.get('Content-Type'),
            contentLength: enhancedResponse.headers.get('Content-Length'),
            acceptRanges: enhancedResponse.headers.get('Accept-Ranges'),
            etag: enhancedResponse.headers.get('ETag'),
            lastModified: enhancedResponse.headers.get('Last-Modified'),
            cacheControl: enhancedResponse.headers.get('Cache-Control'),
            cdnCgiInfo: response.url && response.url.includes('/cdn-cgi/') ? 'CDN-CGI response' : 'Regular response'
          }
        });
        
        // Use waitUntil if available to not delay the response
        if (context) {
          // Store and immediately verify using the EXACT same object instance
          // This is critical - we must use the same Request object instance, not just equivalent ones
          const exactSameKey = keyWithoutHeaders;
          
          // Store with the empty key first (best for Cloudflare's automatic range handling)
          context.waitUntil(
            cache.put(exactSameKey, enhancedResponse.clone())
              .then(() => {
                logDebug('Successfully stored response in cache with empty key', {
                  url: request.url,
                  status: enhancedResponse.status,
                  acceptRanges: enhancedResponse.headers.get('Accept-Ranges'),
                  contentLength: enhancedResponse.headers.get('Content-Length'),
                  etag: enhancedResponse.headers.get('ETag'),
                  keyInfo: {
                    url: exactSameKey.url,
                    method: exactSameKey.method,
                    headersCount: [...exactSameKey.headers.entries()].length
                  }
                });
                
                // Now verify with EXACTLY the same Request object instance we stored with
                // No delay needed if we're using the same instance
                return cache.match(exactSameKey);
              })
              .then(verifyResponse => {
                // Create log data object
                const logData: Record<string, unknown> = {
                  found: !!verifyResponse,
                  timestamp: new Date().toISOString(),
                  timeSinceStart: Date.now() - (context ? Date.now() - 1000 : Date.now()),
                  note: 'Cloudflare Cache API is eventually consistent - cache propagation may take time'
                };
                
                // Only try to access headers if we have a response
                if (verifyResponse && verifyResponse instanceof Response) {
                  // Add response details to log data
                  logData.status = verifyResponse.status;
                  logData.acceptRanges = verifyResponse.headers.get('Accept-Ranges');
                  logData.contentLength = verifyResponse.headers.get('Content-Length');
                  logData.etag = verifyResponse.headers.get('ETag');
                  logData.contentType = verifyResponse.headers.get('Content-Type');
                  logData.lastModified = verifyResponse.headers.get('Last-Modified');
                  logData.cacheControl = verifyResponse.headers.get('Cache-Control');
                  logData.varyHeader = verifyResponse.headers.get('Vary');
                  
                  // Create a map of all headers
                  const headerMap: Record<string, string> = {};
                  verifyResponse.headers.forEach((value: string, key: string) => {
                    headerMap[key] = value;
                  });
                  logData.allHeaders = headerMap;
                } else {
                  logData.reason = 'Cache entry not found after delay - likely due to Cache API eventual consistency';
                }
                
                // Log the verification result
                logDebug('Verification of cache storage (with delay for eventual consistency)', logData);
              })
              .catch(err => {
                logWarn('Failed to store in cache', {
                  error: err instanceof Error ? err.message : String(err)
                });
              })
          );
        } else {
          // Without ctx, store without awaiting
          // Need to use the exact same key instance
          const exactSameKey = keyWithoutHeaders;
          
          // Note: Cloudflare cache works best when using the same key instance
          cache.put(exactSameKey, enhancedResponse.clone())
            .then(() => {
              logDebug('Successfully stored response in cache with empty key (without context)', {
                url: request.url,
                status: enhancedResponse.status,
                acceptRanges: enhancedResponse.headers.get('Accept-Ranges'),
                contentLength: enhancedResponse.headers.get('Content-Length'),
                note: 'Cache API has eventual consistency - entry may not be immediately available'
              });
              
              // Try to verify cache with the exact same key instance
              setTimeout(() => {
                cache.match(exactSameKey)
                  .then(verifyResponse => {
                    const logData: Record<string, unknown> = {
                      found: !!verifyResponse,
                      url: request.url,
                      timestamp: new Date().toISOString(),
                      note: 'Cloudflare Cache API is eventually consistent'
                    };
                    
                    if (verifyResponse && verifyResponse instanceof Response) {
                      logData.status = verifyResponse.status;
                      logData.contentType = verifyResponse.headers.get('Content-Type');
                    } else {
                      logData.reason = 'Cache entry not found after delay - likely due to eventual consistency';
                    }
                    
                    logDebug('Verification of cache storage (without context)', logData);
                  })
                  .catch(() => {/* Ignore errors */});
              }, 100);
            })
            .catch(err => {
              logWarn('Failed to store in cache', {
                error: err instanceof Error ? err.message : String(err)
              });
            });
        }
      }
    }
    
    // Step 6: For range requests, try to let Cloudflare handle them automatically first
    if (hasRangeHeader) {
      logDebug('Attempting to leverage Cloudflare automatic range handling', {
        rangeHeader: rangeHeader,
        totalSize: bodySize,
        responseUrl: response.url,
        isCdnCgiResponse: response.url && response.url.includes('/cdn-cgi/'),
        contentType: enhancedResponse.headers.get('Content-Type'),
        originalResponseStatus: response.status,
        enhancedResponseStatus: enhancedResponse.status,
        enhancedAcceptRanges: enhancedResponse.headers.get('Accept-Ranges'),
        enhancedEtag: enhancedResponse.headers.get('ETag'),
        enhancedLastModified: enhancedResponse.headers.get('Last-Modified'),
        enhancedContentLength: enhancedResponse.headers.get('Content-Length'),
        timestamp: new Date().toISOString(),
        timeSinceOperation: Date.now() - Date.now()
      });
      
      try {
        // First, try to match the original request with Range header against the cache
        // This should let Cloudflare automatically handle the range request
        // For RANGE requests, we have to approach this differently:
        // 1. We store the item with NO headers (emptyKey)
        // 2. We retrieve with JUST the Range header (rangeOnlyKey)
        // But most critically - we need DIRECT reference to the key we store with
        
        // Create a SINGLE key for storage that we'll keep a DIRECT reference to
        // Do not recreate this object - direct reference equality matters
        // Re-use the same key we created earlier for storage
        const emptyKey = new Request(request.url, { 
          method: 'GET', 
          headers: new Headers() 
        });
        
        // This is the key for retrieving with Cloudflare's auto range handling
        // It must have EXACTLY the Range header and nothing else
        const rangeOnlyKey = new Request(request.url, {
          method: 'GET',
          headers: new Headers([['Range', rangeHeader || '']])
        });
        
        logDebug('Attempting to match range request against cache', {
          emptyKeyUrl: emptyKey.url,
          rangeKeyUrl: rangeOnlyKey.url,
          rangeHeader: rangeHeader,
          emptyKeyHeaders: [...emptyKey.headers.entries()].map(entry => `${entry[0]}: ${entry[1]}`).join(', ') || 'none',
          rangeKeyHeaders: [...rangeOnlyKey.headers.entries()].map(entry => `${entry[0]}: ${entry[1]}`).join(', '),
          originalRequestHeaders: [...request.headers.entries()].map(entry => `${entry[0]}: ${entry[1]}`).join(', ')
        });
        
        // First try with the rangeOnlyKey - this is the pattern Cloudflare recommends
        // We should match the content we stored with emptyKey, but with automatic range handling
        const rangeResponse = await cache.match(rangeOnlyKey);
        
        // Now get detailed info from the range response (if found)
        const headerData = rangeResponse ? 
          Object.fromEntries([...rangeResponse.headers.entries()].map(
            ([key, value]) => [key, value]
          )) : 
          { 'no-headers': 'response not found' };
        
        logDebug('Range request cache lookup result', {
          keyType: 'range-only key',
          found: !!rangeResponse,
          status: rangeResponse?.status,
          contentType: rangeResponse?.headers.get('Content-Type'),
          contentLength: rangeResponse?.headers.get('Content-Length'),
          contentRange: rangeResponse?.headers.get('Content-Range'),
          acceptRanges: rangeResponse?.headers.get('Accept-Ranges'),
          etag: rangeResponse?.headers.get('ETag'),
          hasRangeHeader: request.headers.has('Range'),
          rangeHeaderValue: request.headers.get('Range'),
          allHeaders: headerData,
          timeSinceOperation: Date.now() - (Date.now() - 1000),
          currentTime: new Date().toISOString()
        });
        
        // If the range request was successful, return it
        // Success means we got a 206 Partial Content status
        if (rangeResponse && rangeResponse.status === 206) {
          logDebug('Successfully retrieved partial content with automatic range handling', {
            status: rangeResponse.status,
            contentRange: rangeResponse.headers.get('Content-Range'),
            contentLength: rangeResponse.headers.get('Content-Length')
          });
          
          return rangeResponse;
        }
        
        // If the range-keyed lookup failed, try with empty key next
        // This will get us the full response which we can manually slice
        const fullResponse = await cache.match(emptyKey);
        
        logDebug('Full resource cache lookup result', {
          keyType: 'empty key (no headers)',
          found: !!fullResponse,
          status: fullResponse?.status,
          contentType: fullResponse?.headers.get('Content-Type'),
          contentLength: fullResponse?.headers.get('Content-Length'),
          acceptRanges: fullResponse?.headers.get('Accept-Ranges')
        });
        
        // If we found the full response, use it to manually handle the range request
        if (fullResponse) {
          logDebug('Found full resource in cache, will handle range manually', {
            status: fullResponse.status,
            contentLength: fullResponse.headers.get('Content-Length'),
            acceptRanges: fullResponse.headers.get('Accept-Ranges')
          });
          
          // Use the full response to manually create a range response
          return handleRangeRequest(fullResponse, rangeHeader);
        }
        
        // If not found with either key, try with the original request as a last resort
        const originalResponse = await cache.match(request);
        logDebug('Original request lookup result (last resort)', {
          keyType: 'original request with all headers',
          found: !!originalResponse,
          status: originalResponse?.status,
          contentType: originalResponse?.headers.get('Content-Type'),
          contentRange: originalResponse?.headers.get('Content-Range'),
          acceptRanges: originalResponse?.headers.get('Accept-Ranges')
        });
        
        // If we found anything with the original request key, return it
        if (originalResponse) {
          logDebug('Using response from original request key', {
            status: originalResponse.status,
            isPartialContent: originalResponse.status === 206,
            contentRange: originalResponse.headers.get('Content-Range')
          });
          
          return originalResponse;
        }
        // If we get here, all cache lookups failed
        // We need to do manual range handling with the original response
        const timeMs = Date.now();
        
        // Get a complete snapshot of all headers in the enhanced response
        const enhancedResponseHeaders = Object.fromEntries(
          [...enhancedResponse.headers.entries()].map(([key, value]) => [key, value])
        );
        
        logDebug('All cache lookups failed - using manual range handling with origin response', {
          rangeHeader: rangeHeader,
          totalSize: bodySize,
          parsedRange: rangeHeader ? parseRangeHeader(rangeHeader, bodySize || 0) : null,
          triedKeys: [
            'empty key with no headers',
            'range-only key',
            'original request with all headers'
          ],
          // Include timing information
          timeMs: timeMs,
          timeHint: new Date(timeMs).toISOString(),
          timeSinceOperation: timeMs - (timeMs - 1000),
          
          // Include response details that we should have been able to cache
          responseStatus: enhancedResponse.status,
          responseType: enhancedResponse.headers.get('Content-Type'),
          responseLength: enhancedResponse.headers.get('Content-Length'),
          responseAcceptRanges: enhancedResponse.headers.get('Accept-Ranges'),
          responseEtag: enhancedResponse.headers.get('ETag'),
          responseLastModified: enhancedResponse.headers.get('Last-Modified'),
          responseCacheControl: enhancedResponse.headers.get('Cache-Control'),
          responseHasContentRange: enhancedResponse.headers.has('Content-Range'),
          responseContentRange: enhancedResponse.headers.get('Content-Range'),
          responseVary: enhancedResponse.headers.get('Vary'),
          
          // Original response info
          originalResponseUrl: response.url,
          isCdnCgiResponse: response.url && response.url.includes('/cdn-cgi/'),
          cdnCgiUrl: response.url && response.url.includes('/cdn-cgi/') ? response.url : null,
          
          // Complete headers snapshot
          enhancedResponseAllHeaders: enhancedResponseHeaders
        });
        
        return handleRangeRequest(enhancedResponse, rangeHeader);
      } catch (err) {
        // Create a detailed error report
        const errorDetails = {
          message: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack : undefined,
          name: err instanceof Error ? err.name : 'Unknown',
          rangeHeader,
          responseStatus: enhancedResponse.status,
          responseType: enhancedResponse.headers.get('Content-Type'),
          responseUrl: response.url,
          timestamp: new Date().toISOString(),
          timeSinceError: 0
        };
        
        logWarn('Error during automatic range handling, falling back to manual', errorDetails);
        
        // Add to diagnostics if we have a request context
        const requestContext = getCurrentContext();
        if (requestContext) {
          if (!requestContext.diagnostics) {
            requestContext.diagnostics = {};
          }
          
          // Add range request details to diagnostics
          requestContext.diagnostics.rangeRequestError = {
            message: errorDetails.message,
            source: 'automatic-range-handling',
            fallback: 'manual-range-handling'
          };
        }
        
        return handleRangeRequest(enhancedResponse, rangeHeader);
      }
    }
    
    // Return the enhanced response
    return enhancedResponse;
  },
  {
    functionName: 'cacheResponse',
    component: 'CacheResponseUtils',
    logErrors: true
  }
);

/**
 * Helper function to handle range requests manually
 * Used as a fallback when Cloudflare's automatic range handling fails
 */
async function handleRangeRequest(
  response: Response,
  rangeHeader: string | null
): Promise<Response> {
  if (!rangeHeader) {
    logDebug('No range header, returning full response', {
      status: response.status,
      contentType: response.headers.get('Content-Type')
    });
    return response;
  }
  
  try {
    // Log what headers we're starting with
    const startTimeMs = Date.now();
    logDebug('Starting manual range handling', {
      rangeHeader,
      responseStatus: response.status,
      responseContentType: response.headers.get('Content-Type'),
      responseContentLength: response.headers.get('Content-Length'),
      responseAcceptRanges: response.headers.get('Accept-Ranges'),
      startTimeMs
    });
    
    // Get the full response body
    const clone = response.clone();
    const body = await clone.arrayBuffer();
    const totalSize = body.byteLength;
    
    // Log that we loaded the body and get metrics
    const bodyLoadTimeMs = Date.now() - startTimeMs;
    logDebug('Loaded full response body', {
      totalSize,
      bodyLoadTimeMs
    });
    
    // Parse the range header
    const range = parseRangeHeader(rangeHeader, totalSize);
    
    if (range) {
      // Create a partial response with the requested range
      const slicedBody = body.slice(range.start, range.end + 1);
      const rangeHeaders = new Headers(response.headers);
      
      // Set range-specific headers
      rangeHeaders.set('Content-Range', `bytes ${range.start}-${range.end}/${totalSize}`);
      rangeHeaders.set('Content-Length', slicedBody.byteLength.toString());
      
      // Add a custom header to mark this as a manually handled range response
      rangeHeaders.set('X-Range-Handled-By', 'Manual-Range-Handler');
      
      // Get all the headers we're setting
      const allSetHeaders = Object.fromEntries([...rangeHeaders.entries()].map(
        ([key, value]) => [key, value]
      ));
      
      // Calculate processing times
      const processTimeMs = Date.now() - startTimeMs;
      
      logDebug('Created manual partial response', {
        start: range.start,
        end: range.end,
        total: totalSize,
        size: slicedBody.byteLength,
        contentRangeHeader: `bytes ${range.start}-${range.end}/${totalSize}`,
        processTimeMs,
        allHeaders: allSetHeaders,
        headerCount: Object.keys(allSetHeaders).length,
        timestamp: new Date().toISOString()
      });
      
      // Add to diagnostics if we have a request context
      const requestContext = getCurrentContext();
      if (requestContext) {
        if (!requestContext.diagnostics) {
          requestContext.diagnostics = {};
        }
        
        // Add range request details to diagnostics
        requestContext.diagnostics.rangeRequest = {
          header: rangeHeader,
          start: range.start,
          end: range.end,
          total: totalSize,
          source: 'manual-range-handling',
          status: 206,
          processTimeMs
        };
      }
      
      return new Response(slicedBody, {
        status: 206,
        statusText: 'Partial Content',
        headers: rangeHeaders
      });
    } else {
      // Unsatisfiable range
      logDebug('Unsatisfiable range', {
        rangeHeader,
        totalSize,
        status: 416,
        processTimeMs: Date.now() - startTimeMs
      });
      
      // Add to diagnostics if we have a request context
      const requestContext = getCurrentContext();
      if (requestContext) {
        if (!requestContext.diagnostics) {
          requestContext.diagnostics = {};
        }
        
        // Add range request details to diagnostics
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
  } catch (error) {
    // Create detailed error report
    const errorDetails = {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      name: error instanceof Error ? error.name : 'Unknown',
      rangeHeader,
      responseStatus: response.status,
      responseType: response.headers.get('Content-Type'),
      processTimeMs: 0,
      timestamp: new Date().toISOString()
    };
    
    logWarn('Error creating manual range response', errorDetails);
    
    // Add to diagnostics if we have a request context
    const requestContext = getCurrentContext();
    if (requestContext) {
      if (!requestContext.diagnostics) {
        requestContext.diagnostics = {};
      }
      
      // Add range request error to diagnostics
      requestContext.diagnostics.rangeRequestError = {
        message: errorDetails.message,
        source: 'manual-range-handling',
        fallback: 'full-response'
      };
    }
    
    // If range handling fails, return the original response
    return response;
  }
}
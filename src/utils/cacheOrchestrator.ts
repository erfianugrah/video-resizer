/**
 * Cache orchestrator for video-resizer
 * 
 * This utility coordinates multiple caching layers to optimize video serving
 */

import { EnvVariables } from '../config/environmentConfig';
import { getFromKVCache, storeInKVCache } from './kvCacheUtils';
import { getCachedResponse } from '../services/cacheManagementService';
import { createLogger, debug as pinoDebug } from '../utils/pinoLogger';
import { getCurrentContext } from '../utils/legacyLoggerAdapter';
import { addBreadcrumb } from '../utils/requestContext';

/**
 * Cache orchestrator that tries multiple caching layers before processing a request
 * 
 * Order of operations:
 * 1. Check Cloudflare Cache API
 * 2. Check KV storage for transformed variant
 * 3. Execute the handler function to generate response
 * 4. Store result in KV if appropriate
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

  // Skip CF cache for non-GET requests or based on cache configuration
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
  // Use the isKVCacheEnabled method instead of directly accessing the config property
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
    // Step 1: Check both caches in parallel (if not skipping)
    if (!skipCache) {
      // Add breadcrumb for tracing
      if (requestContext) {
        addBreadcrumb(requestContext, 'Cache', 'Started parallel cache lookup', {
          url: request.url
        });
      }
      
      // Create promises for both cache checks
      const cfCachePromise = getCachedResponse(request).catch(err => {
        logDebug('Error checking CF cache', { 
          error: err instanceof Error ? err.message : String(err) 
        });
        return null;
      });
      
      let kvCachePromise: Promise<Response | null> = Promise.resolve(null);
      
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
        kvCachePromise = getFromKVCache(env, sourcePath, lookupOptions, request).catch(err => {
          logDebug('Error checking KV cache', { 
            error: err instanceof Error ? err.message : String(err) 
          });
          return null;
        });
      } else if (options && env && !kvCacheEnabled) {
        // Log that KV cache is disabled by configuration
        logDebug('KV cache is disabled by configuration, skipping lookup');
      }
      
      // Wait for both cache checks to complete
      const [cfResponse, kvResponse] = await Promise.all([cfCachePromise, kvCachePromise]);
      
      // Prefer CF cache over KV cache as it's typically faster to access
      if (cfResponse) {
        logDebug('CF Cache API hit');
        
        if (requestContext) {
          addBreadcrumb(requestContext, 'Cache', 'CF Cache API hit', {
            url: request.url
          });
        }
        
        // If we found in CF Cache but not in KV, populate KV in the background
        // to improve global distribution of cached content, but only if KV cache is enabled
        if (!kvResponse && env && options && kvCacheEnabled) {
          const sourcePath = url.pathname;
          const responseClone = cfResponse.clone();
          
          // Check if we should store in KV (using same criteria as below)
          const contentType = responseClone.headers.get('content-type') || '';
          const isError = responseClone.status >= 400;
          
          // Comprehensive list of video MIME types (same as below)
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
          
          if (responseClone.ok && !skipCache && isVideoResponse && !isError) {
            // Create customData for KV cache key
            const customData: Record<string, unknown> = {};
            const imwidth = url.searchParams.get('imwidth');
            const imheight = url.searchParams.get('imheight');
            if (imwidth) customData.imwidth = imwidth;
            if (imheight) customData.imheight = imheight;
            
            // Add IMQuery parameters to options for cache key generation
            const optionsWithIMQuery: typeof options = {
              ...options,
              customData: Object.keys(customData).length > 0 ? customData : undefined
            };
            
            // Get execution context if available
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const ctx = (env as any).executionCtx || (env as any).ctx;
            
            if (ctx && typeof ctx.waitUntil === 'function') {
              // Store in KV using waitUntil to do it in the background
              logDebug('Populating KV from CF cache using waitUntil', { 
                sourcePath, 
                contentType,
                hasIMQuery: Object.keys(customData).length > 0 
              });
              
              ctx.waitUntil(
                storeInKVCache(env, sourcePath, responseClone, optionsWithIMQuery)
                  .then((success: boolean) => {
                    logDebug(success ? 'Populated KV from CF cache' : 'Failed to populate KV from CF cache', {
                      sourcePath,
                      hasIMQuery: Object.keys(customData).length > 0
                    });
                    
                    // Add breadcrumb if request context is available
                    const reqContext = getCurrentContext();
                    if (reqContext && success) {
                      addBreadcrumb(reqContext, 'Cache', 'Populated KV from CF cache', {
                        sourcePath,
                        hasIMQuery: Object.keys(customData).length > 0
                      });
                    }
                  })
                  .catch((err) => {
                    logDebug('Error populating KV from CF cache', {
                      error: err instanceof Error ? err.message : String(err)
                    });
                  })
              );
            }
          }
        } else if (!kvResponse && env && options && !kvCacheEnabled) {
          logDebug('Skipping KV cache population (disabled by configuration)');
        }
        
        return cfResponse;
      }
      
      if (kvResponse) {
        const sourcePath = url.pathname;
        const imwidth = url.searchParams.get('imwidth');
        const imheight = url.searchParams.get('imheight');
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
      
      // Add breadcrumb for both caches missing
      if (requestContext) {
        addBreadcrumb(requestContext, 'Cache', 'Both CF and KV cache missed', {
          url: request.url
        });
      }
    } else {
      logDebug('Skipped cache checks due to request parameters');
    }
    
    // Step 3: Both caches missed, execute handler
    logDebug('All caches missed, executing handler');
    const response = await handler();
    
    // Step 4: Check if this is a video response that should be proactively cached
    const contentType = response.headers.get('content-type') || '';
    const isError = response.status >= 400;
    const isRangeRequest = request.headers.has('Range');
    
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
    if (options && env && response.ok && request.method === 'GET' && !skipCache && isVideoResponse && !isError) {
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
          derivative: options.derivative
        });
      }
      
      // First try the Cloudflare Cache API for best range request handling
      try {
        const cacheApiEnabled = cacheConfig.getConfig().method === 'cacheApi';
        
        if (cacheApiEnabled) {
          const responseClone = response.clone();
          logDebug('Storing video in Cache API for range request support', {
            url: request.url,
            isRangeRequest,
            contentType,
            size: responseClone.headers.get('Content-Length')
          });
          
          // Dynamically import cache management service to avoid circular dependencies
          const { cacheResponse, getCachedResponse } = await import('../services/cacheManagementService');
          
          // Store in Cache API synchronously
          // Get execution context if available
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const ctx = (env as any).executionCtx || (env as any).ctx;
          
          // Check if this is a transformed response from CDN-CGI
          const isCdnCgiTransformed = responseClone.url && 
              responseClone.url.includes('/cdn-cgi/media/') &&
              request.url !== responseClone.url;
              
          // Additional detailed logging about the transformed URL
          if (isCdnCgiTransformed) {
            logDebug('Detected CDN-CGI transformed response', {
              originalRequestUrl: request.url,
              transformedResponseUrl: responseClone.url,
              requestContentType: request.headers.get('Content-Type'),
              responseContentType: responseClone.headers.get('Content-Type'),
              timestamp: new Date().toISOString()
            });
          }
              
          // Log detailed information about the response
          logDebug('Processing response for cache storage', {
            requestUrl: request.url,
            responseUrl: responseClone.url || 'unknown',
            isCdnCgiTransformed,
            contentType: responseClone.headers.get('Content-Type'),
            contentLength: responseClone.headers.get('Content-Length')
          });
              
          // The updated cacheResponse function checks cache first, then puts if needed
          // It accepts either a Response or a fetch function as the second parameter
          const cachedResponse = await cacheResponse(
            request, 
            responseClone, 
            ctx
          );
          
          if (isCdnCgiTransformed) {
            logDebug('Using cached response for transformed content', {
              requestUrl: request.url,
              responseUrl: responseClone.url || 'unknown',
              contentType: responseClone.headers.get('Content-Type')
            });
          }
          
          if (cachedResponse) {
            logDebug('Successfully serving video from Cache API after storing', {
              url: request.url,
              size: cachedResponse.headers.get('Content-Length'),
              status: cachedResponse.status
            });
            
            // If we're here, we have proper range request support!
            return cachedResponse;
          }
          
          logDebug('Failed to retrieve from Cache API after storing, falling back', {
            url: request.url
          });
        }
      } catch (err) {
        logDebug('Error using Cache API for video, trying KV instead', {
          error: err instanceof Error ? err.message : String(err)
        });
      }
      
      // Fall back to KV if Cache API is disabled or failed
      if (kvCacheEnabled) {
        try {
          const responseClone = response.clone();
          
          logDebug('Storing video in KV for range request support', {
            url: request.url,
            contentType,
            isRangeRequest
          });
          
          // Store synchronously in KV
          const success = await storeInKVCache(env, sourcePath, responseClone, optionsWithIMQuery);
          
          if (success) {
            // Get from KV to ensure range request support
            const kvResponse = await getFromKVCache(env, sourcePath, optionsWithIMQuery, request);
            
            if (kvResponse) {
              logDebug('Successfully serving video from KV after storing', {
                url: request.url,
                size: kvResponse.headers.get('Content-Length'),
                status: kvResponse.status
              });
              
              // If we're here, we have proper range request support!
              return kvResponse;
            }
          }
          
          logDebug('Failed to retrieve from KV after storing, falling back to direct response', {
            url: request.url
          });
        } catch (err) {
          logDebug('Error using KV for video, falling back to direct response', {
            error: err instanceof Error ? err.message : String(err)
          });
        }
      } else if (!kvCacheEnabled) {
        // Explicitly log that we're skipping KV due to being disabled
        logDebug('Skipped KV storage for video (disabled by configuration)', {
          path: url.pathname,
          contentType
        });
      }
    } else if (options && env && request.method === 'GET') {
      // Log reasons for skipping special video handling
      logDebug('Skipped special video handling', {
        method: request.method,
        isOk: response.ok,
        hasDebug: url.searchParams.has('debug'),
        isVideoResponse,
        isError,
        statusCode: response.status,
        contentType,
        kvCacheEnabled,
        skipCache
      });
    }
    
    // For non-video responses or if all caching attempts failed, return the direct response
    return response;
  } catch (err) {
    logDebug('Error in cache flow', {
      error: err instanceof Error ? err.message : String(err)
    });
    
    // Fallback to handler directly if caching fails
    return handler();
  }
}
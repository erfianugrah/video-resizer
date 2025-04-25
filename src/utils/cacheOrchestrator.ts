/**
 * Cache orchestrator for video-resizer
 * 
 * This utility coordinates KV caching to optimize video serving
 */

import { EnvVariables } from '../config/environmentConfig';
import { getFromKVCache, storeInKVCache } from './kvCacheUtils';
import { createLogger, debug as pinoDebug } from '../utils/pinoLogger';
import { getCurrentContext } from '../utils/legacyLoggerAdapter';
import { addBreadcrumb } from '../utils/requestContext';

/**
 * Cache orchestrator that uses KV for caching
 * 
 * Order of operations:
 * 1. Check KV storage for transformed variant
 * 2. Execute the handler function to generate response
 * 3. Store result in KV if appropriate
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
    
    // Step 2: Cache miss or skip, execute handler
    logDebug('Cache miss, executing handler');
    const response = await handler();
    
    // Step 3: Check if this is a video response that should be proactively cached in KV
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
    if (options && env && response.ok && request.method === 'GET' && !skipCache && 
        isVideoResponse && !isError && kvCacheEnabled) {
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
      
      try {
        const responseClone = response.clone();
        
        logDebug('Storing video in KV for range request support', {
          url: request.url,
          contentType,
          isRangeRequest
        });
        
        // Get execution context if available 
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ctx = (env as any).executionCtx || (env as any).ctx;

        if (ctx && typeof ctx.waitUntil === 'function') {
          // Store in KV using waitUntil to do it in the background
          ctx.waitUntil(
            storeInKVCache(env, sourcePath, responseClone, optionsWithIMQuery)
              .then((success: boolean) => {
                logDebug(success ? 'Stored in KV cache' : 'Failed to store in KV cache', {
                  sourcePath,
                  hasIMQuery: Object.keys(customData).length > 0
                });
                
                // Add breadcrumb if request context is available
                const reqContext = getCurrentContext();
                if (reqContext && success) {
                  addBreadcrumb(reqContext, 'Cache', 'Stored in KV cache', {
                    sourcePath,
                    hasIMQuery: Object.keys(customData).length > 0
                  });
                }
              })
              .catch((err) => {
                logDebug('Error storing in KV cache', {
                  error: err instanceof Error ? err.message : String(err)
                });
              })
          );
        } else {
          // If no context available, store without waiting
          storeInKVCache(env, sourcePath, responseClone, optionsWithIMQuery)
            .then((success: boolean) => {
              logDebug(success ? 'Stored in KV cache (non-waitUntil)' : 'Failed to store in KV cache', {
                sourcePath,
                hasIMQuery: Object.keys(customData).length > 0 
              });
            })
            .catch((err) => {
              logDebug('Error storing in KV cache', {
                error: err instanceof Error ? err.message : String(err)
              });
            });
        }
      } catch (err) {
        logDebug('Error preparing KV cache operation', {
          error: err instanceof Error ? err.message : String(err)
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
    
    // Return the direct response (KV storage happens in the background)
    return response;
  } catch (err) {
    logDebug('Error in cache flow', {
      error: err instanceof Error ? err.message : String(err)
    });
    
    // Fallback to handler directly if caching fails
    return handler();
  }
}
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
import type { VideoTransformOptions } from '../domain/commands/TransformVideoCommand';

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
  options?: any // Use any to avoid type issues between VideoTransformOptions and TransformOptions
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
  const skipCache = isNotGet || shouldBypass;
  
  if (skipCache) {
    logDebug('Bypassing cache', { 
      method: request.method, 
      shouldBypass,
      url: request.url
    });
  }

  try {
    // Step 1: Check Cloudflare Cache API first (if not skipping)
    let cachedResponse = null;
    if (!skipCache) {
      cachedResponse = await getCachedResponse(request);
      if (cachedResponse) {
        logDebug('Cache API hit');
        
        if (requestContext) {
          addBreadcrumb(requestContext, 'Cache', 'Cache API hit', {
            url: request.url
          });
        }
        
        return cachedResponse;
      }
    } else {
      logDebug('Skipped CF cache check due to request parameters');
    }
    
    // Step 2: Check KV cache if options provided and not skipping cache
    if (options && env && !skipCache) {
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
      
      const kvResponse = await getFromKVCache(env, sourcePath, lookupOptions);
      
      if (kvResponse) {
        logDebug('KV cache hit', { 
          sourcePath,
          hasIMQuery: Object.keys(customData).length > 0,
          derivative: options.derivative 
        });
        
        if (requestContext) {
          addBreadcrumb(requestContext, 'Cache', 'KV cache hit', {
            url: request.url,
            hasIMQuery: Object.keys(customData).length > 0
          });
        }
        
        return kvResponse;
      }
    }
    
    // Step 3: Both caches missed, execute handler
    logDebug('All caches missed, executing handler');
    const response = await handler();
    
    // Step 4: Store result in KV if conditions are met
    // Check if it's a video response and not an error
    const contentType = response.headers.get('content-type') || '';
    const isError = response.status >= 400;
    
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
    
    if (options && env && response.ok && request.method === 'GET' && !skipCache && isVideoResponse && !isError) {
      const sourcePath = url.pathname;
      const responseClone = response.clone();
      
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
      
      // Get execution context if available (from Cloudflare Worker environment)
      const ctx = (env as any).executionCtx || (env as any).ctx;
      
      if (ctx && typeof ctx.waitUntil === 'function') {
        // Store in background with waitUntil
        logDebug('Storing in KV using waitUntil', { 
          sourcePath, 
          contentType,
          hasIMQuery: Object.keys(customData).length > 0 
        });
        
        ctx.waitUntil(
          storeInKVCache(env, sourcePath, responseClone, optionsWithIMQuery)
            .then((success: boolean) => {
              logDebug(success ? 'Stored in KV cache' : 'Failed to store in KV cache', {
                sourcePath,
                hasIMQuery: Object.keys(customData).length > 0
              });
            })
            .catch((err) => {
              logDebug('Error storing in KV cache', {
                error: err instanceof Error ? err.message : String(err)
              });
            })
        );
      } else {
        // No execution context, try to store directly
        logDebug('No execution context, storing directly', { 
          sourcePath,
          hasIMQuery: Object.keys(customData).length > 0
        });
        
        try {
          await storeInKVCache(env, sourcePath, responseClone, optionsWithIMQuery);
        } catch (err) {
          logDebug('Error storing in KV cache', {
            error: err instanceof Error ? err.message : String(err)
          });
        }
      }
    } else if (options && env && request.method === 'GET') {
      // Log reasons for skipping storage
      logDebug('Skipped KV storage', {
        method: request.method,
        isOk: response.ok,
        hasDebug: url.searchParams.has('debug'),
        isVideoResponse,
        isError,
        statusCode: response.status,
        contentType
      });
    }
    
    return response;
  } catch (err) {
    logDebug('Error in cache flow', {
      error: err instanceof Error ? err.message : String(err)
    });
    
    // Fallback to handler directly if caching fails
    return handler();
  }
}
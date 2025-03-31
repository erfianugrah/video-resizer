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

  // Skip CF cache for non-GET requests or debug mode, but still use KV
  const url = new URL(request.url);
  const skipCfCache = request.method !== 'GET' || url.searchParams.has('debug');
  
  if (skipCfCache) {
    logDebug('Bypassing CF edge cache', { 
      method: request.method, 
      hasDebug: url.searchParams.has('debug')
    });
  }

  try {
    // Step 1: Check Cloudflare Cache API first (if not skipping)
    let cachedResponse = null;
    if (!skipCfCache) {
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
    
    // Step 2: Check KV cache if options provided
    if (options && env) {
      const sourcePath = url.pathname;
      const kvResponse = await getFromKVCache(env, sourcePath, options);
      
      if (kvResponse) {
        logDebug('KV cache hit', { sourcePath });
        
        if (requestContext) {
          addBreadcrumb(requestContext, 'Cache', 'KV cache hit', {
            url: request.url
          });
        }
        
        return kvResponse;
      }
    }
    
    // Step 3: Both caches missed, execute handler
    logDebug('All caches missed, executing handler');
    const response = await handler();
    
    // Step 4: Store result in KV if it was successful
    if (options && env && response.ok && request.method === 'GET') {
      const sourcePath = url.pathname;
      const responseClone = response.clone();
      
      // Get execution context if available (from Cloudflare Worker environment)
      const ctx = (env as any).executionCtx || (env as any).ctx;
      
      if (ctx && typeof ctx.waitUntil === 'function') {
        // Store in background with waitUntil
        ctx.waitUntil(
          storeInKVCache(env, sourcePath, responseClone, options)
            .then((success: boolean) => {
              logDebug(success ? 'Stored in KV cache' : 'Failed to store in KV cache', {
                sourcePath
              });
            })
        );
      } else {
        // No execution context, try to store directly
        try {
          await storeInKVCache(env, sourcePath, responseClone, options);
        } catch (err) {
          logDebug('Error storing in KV cache', {
            error: err instanceof Error ? err.message : String(err)
          });
        }
      }
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
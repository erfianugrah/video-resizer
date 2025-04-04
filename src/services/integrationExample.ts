/**
 * Example integration of KV storage with the video transformation flow
 * This file demonstrates how to use the KV storage service to cache transformed video variants
 */

import { EnvVariables } from '../config/environmentConfig';
import { PathPattern } from '../utils/pathUtils';
import { DebugInfo } from '../utils/debugHeadersUtils';
import type { VideoTransformOptions } from '../domain/commands/TransformVideoCommand';
import { getFromKVCache, storeInKVCache } from '../utils/kvCacheUtils';
import { getCurrentContext } from '../utils/legacyLoggerAdapter';
import { createLogger, debug as pinoDebug } from '../utils/pinoLogger';

/**
 * Wrapper for the video transformation process that integrates with KV cache
 * 
 * @param request - The original request
 * @param options - Video transformation options
 * @param pathPatterns - Path patterns for matching URLs
 * @param debugInfo - Debug information settings
 * @param env - Environment variables and bindings
 * @returns A response containing the transformed video
 */
export async function transformVideoWithKVCache(
  request: Request,
  options: any, // Use any to avoid type issues between VideoTransformOptions and TransformOptions
  pathPatterns: PathPattern[],
  debugInfo?: DebugInfo,
  env?: EnvVariables
): Promise<Response> {
  // Get the current request context
  const requestContext = getCurrentContext();
  const logger = requestContext ? createLogger(requestContext) : undefined;
  
  // Helper for logging
  function logDebug(message: string, data?: Record<string, unknown>): void {
    if (requestContext && logger) {
      pinoDebug(requestContext, logger, 'VideoKVCache', message, data);
    } else {
      console.debug(`VideoKVCache: ${message}`, data || {});
    }
  }
  
  // Only try to use KV cache if env is provided
  if (!env) {
    logDebug('No environment provided, skipping KV cache');
    
    // Import dynamically to avoid circular dependencies
    const { transformVideo } = await import('./videoTransformationService');
    return transformVideo(request, options, pathPatterns, debugInfo, env);
  }
  
  try {
    // Try to get the video from KV cache first
    // Extract the source path from the request
    const url = new URL(request.url);
    const sourcePath = url.pathname;
    
    // If debug mode is active, bypass KV cache
    if (url.searchParams.has('debug')) {
      logDebug('Debug mode active, bypassing KV cache');
      
      // Import dynamically to avoid circular dependencies
      const { transformVideo } = await import('./videoTransformationService');
      return transformVideo(request, options, pathPatterns, debugInfo, env);
    }
    
    logDebug('Checking KV cache for transformed video', {
      sourcePath,
      derivative: options.derivative,
      width: options.width,
      height: options.height
    });
    
    // Try to get from KV cache
    const cachedResponse = await getFromKVCache(env, sourcePath, options);
    
    if (cachedResponse) {
      logDebug('KV cache hit, returning cached video', {
        sourcePath,
        derivative: options.derivative
      });
      
      return cachedResponse;
    }
    
    logDebug('KV cache miss, transforming video', {
      sourcePath,
      derivative: options.derivative
    });
    
    // If not in cache, transform the video
    // Import dynamically to avoid circular dependencies
    const { transformVideo } = await import('./videoTransformationService');
    const transformedResponse = await transformVideo(request, options, pathPatterns, debugInfo, env);
    
    // Only cache successful responses
    if (transformedResponse.ok && request.method === 'GET') {
      // Store in KV cache in the background
      const clonedResponse = transformedResponse.clone();
      
      // Get execution context if available (from Cloudflare Worker environment)
      const ctx = (env as any).ctx || undefined;
      
      if (ctx && 'waitUntil' in ctx) {
        // Use waitUntil to not block the response
        ctx.waitUntil(
          storeInKVCache(env, sourcePath, clonedResponse, options)
            .then(success => {
              logDebug(success ? 'Successfully stored in KV cache' : 'Failed to store in KV cache', {
                sourcePath,
                derivative: options.derivative
              });
            })
            .catch(err => {
              logDebug('Error storing in KV cache', {
                sourcePath,
                error: err instanceof Error ? err.message : String(err)
              });
            })
        );
      } else {
        // No execution context, store directly (might slightly delay the response)
        try {
          const success = await storeInKVCache(env, sourcePath, clonedResponse, options);
          logDebug(success ? 'Successfully stored in KV cache' : 'Failed to store in KV cache', {
            sourcePath,
            derivative: options.derivative
          });
        } catch (err) {
          logDebug('Error storing in KV cache', {
            sourcePath,
            error: err instanceof Error ? err.message : String(err)
          });
        }
      }
    } else if (!transformedResponse.ok) {
      logDebug('Not caching error response', {
        sourcePath,
        status: transformedResponse.status
      });
    }
    
    return transformedResponse;
  } catch (err) {
    logDebug('Error in KV cache flow', {
      error: err instanceof Error ? err.message : String(err)
    });
    
    // Fallback to the regular transformation process
    const { transformVideo } = await import('./videoTransformationService');
    return transformVideo(request, options, pathPatterns, debugInfo, env);
  }
}

/**
 * List all transformed variants for a video in KV storage
 * 
 * @param env - Environment variables with KV namespaces
 * @param sourcePath - Original source path
 * @returns Array of variants with their metadata
 */
export async function listVideoVariants(
  env: EnvVariables,
  sourcePath: string
): Promise<any[]> {
  // Use the preferred namespace or fall back to the alternative
  const kvNamespace = env.VIDEO_TRANSFORMATIONS_CACHE || env.VIDEO_TRANSFORMS_KV;
  if (!kvNamespace) {
    return [];
  }
  
  try {
    // Import the KV service dynamically
    const { listVariants } = await import('./kvStorageService');
    return await listVariants(kvNamespace, sourcePath);
  } catch (err) {
    const context = getCurrentContext();
    if (context) {
      const logger = createLogger(context);
      logger.error('Error listing video variants', {
        sourcePath,
        error: err instanceof Error ? err.message : String(err)
      });
    } else {
      console.error('Error listing video variants', {
        sourcePath,
        error: err instanceof Error ? err.message : String(err)
      });
    }
    return [];
  }
}

/**
 * Delete a specific transformed variant from KV storage
 * 
 * @param env - Environment variables with KV namespaces
 * @param key - The KV key to delete
 * @returns Boolean indicating if deletion was successful
 */
export async function deleteVideoVariant(
  env: EnvVariables,
  key: string
): Promise<boolean> {
  // Use the preferred namespace or fall back to the alternative
  const kvNamespace = env.VIDEO_TRANSFORMATIONS_CACHE || env.VIDEO_TRANSFORMS_KV;
  if (!kvNamespace) {
    return false;
  }
  
  try {
    await kvNamespace.delete(key);
    return true;
  } catch (err) {
    const context = getCurrentContext();
    if (context) {
      const logger = createLogger(context);
      logger.error('Error deleting video variant', {
        key,
        error: err instanceof Error ? err.message : String(err)
      });
    } else {
      console.error('Error deleting video variant', {
        key,
        error: err instanceof Error ? err.message : String(err)
      });
    }
    return false;
  }
}
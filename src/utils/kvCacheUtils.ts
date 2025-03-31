/**
 * Utility functions for using KV as a cache for transformed videos
 */

import { getCacheConfig } from '../config';
import { EnvVariables } from '../config/environmentConfig';
import { getTransformedVideo, storeTransformedVideo } from '../services/kvStorageService';
import { createLogger, debug as pinoDebug } from '../utils/pinoLogger';
import { getCurrentContext } from '../utils/legacyLoggerAdapter';
import { addBreadcrumb } from '../utils/requestContext';

/**
 * Helper for logging debug messages
 */
function logDebug(message: string, data?: Record<string, unknown>): void {
  const requestContext = getCurrentContext();
  if (requestContext) {
    const logger = createLogger(requestContext);
    pinoDebug(requestContext, logger, 'KVCacheUtils', message, data);
  } else {
    console.debug(`KVCacheUtils: ${message}`, data || {});
  }
}

/**
 * Interface for transformation options
 */
export interface TransformOptions {
  width?: number | null;
  height?: number | null;
  format?: string | null;
  quality?: string | null;
  compression?: string | null;
  derivative?: string | null;
  duration?: number | string | null;
  fps?: number | null;
  loop?: boolean | null;
  autoplay?: boolean | null;
  muted?: boolean | null;
  [key: string]: unknown;
}

/**
 * Try to get a transformed video from KV cache
 * 
 * @param env - Environment variables with KV namespaces
 * @param sourcePath - Original source path
 * @param options - Transformation options
 * @returns The cached response or null if not found
 */
export async function getFromKVCache(
  env: EnvVariables,
  sourcePath: string,
  options: TransformOptions
): Promise<Response | null> {
  // Check if KV caching is enabled - pass environment variables to ensure we get fresh config
  const config = getCacheConfig(env);
  // Check for either KV namespace binding
  const kvNamespace = env.VIDEO_TRANSFORMATIONS_CACHE || env.VIDEO_TRANSFORMS_KV;
  
  // Enhanced logging for troubleshooting
  if (!config.enableKVCache) {
    logDebug('KV cache disabled by configuration', { 
      enableKVCache: config.enableKVCache,
      cache_enable_kv_env: env.CACHE_ENABLE_KV || 'not set' 
    });
    return null;
  }
  
  if (!kvNamespace) {
    logDebug('No KV namespace binding found', { 
      VIDEO_TRANSFORMATIONS_CACHE: !!env.VIDEO_TRANSFORMATIONS_CACHE,
      VIDEO_TRANSFORMS_KV: !!env.VIDEO_TRANSFORMS_KV
    });
    return null;
  }
  
  // Check if we should bypass cache for this request
  if (shouldBypassKVCache(sourcePath)) {
    logDebug('Bypassing KV cache by configuration', { sourcePath });
    return null;
  }
  
  try {
    // Ensure namespace is defined before using
    if (!kvNamespace) {
      return null;
    }
    
    const result = await getTransformedVideo(
      kvNamespace,
      sourcePath,
      options
    );
    
    if (result) {
      // Add breadcrumb for KV cache hit
      const requestContext = getCurrentContext();
      if (requestContext) {
        addBreadcrumb(requestContext, 'KVCache', 'KV cache hit', {
          sourcePath,
          derivative: options.derivative,
          size: result.metadata.contentLength,
          cacheTime: new Date(result.metadata.createdAt).toISOString(),
          ttl: result.metadata.expiresAt ? Math.floor((result.metadata.expiresAt - Date.now()) / 1000) : 'unknown'
        });
      }
      
      logDebug('KV cache hit', {
        sourcePath,
        derivative: options.derivative,
        createdAt: new Date(result.metadata.createdAt).toISOString(),
        expiresAt: result.metadata.expiresAt ? new Date(result.metadata.expiresAt).toISOString() : 'unknown',
        contentLength: result.metadata.contentLength,
        contentType: result.metadata.contentType
      });
      
      return result.response;
    }
    
    // Add breadcrumb for KV cache miss
    const reqContext = getCurrentContext();
    if (reqContext) {
      addBreadcrumb(reqContext, 'KVCache', 'KV cache miss', {
        sourcePath,
        derivative: options.derivative,
        namespaceExists: !!kvNamespace
      });
    }
    
    logDebug('KV cache miss', {
      sourcePath,
      derivative: options.derivative,
      options: JSON.stringify(options)
    });
    
    return null;
  } catch (err) {
    logDebug('Error retrieving from KV cache', {
      sourcePath,
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined
    });
    return null;
  }
}

/**
 * Store a transformed video in KV cache
 * 
 * @param env - Environment variables with KV namespaces
 * @param sourcePath - Original source path
 * @param response - The transformed video response
 * @param options - Transformation options
 * @returns Boolean indicating if storage was successful
 */
export async function storeInKVCache(
  env: EnvVariables,
  sourcePath: string,
  response: Response,
  options: TransformOptions
): Promise<boolean> {
  // Check if KV caching is enabled - pass environment variables to ensure we get fresh config
  const config = getCacheConfig(env);
  // Check for either KV namespace binding
  const kvNamespace = env.VIDEO_TRANSFORMATIONS_CACHE || env.VIDEO_TRANSFORMS_KV;
  
  // Enhanced logging for troubleshooting
  if (!config.enableKVCache) {
    logDebug('KV cache storage disabled by configuration', { 
      enableKVCache: config.enableKVCache,
      cache_enable_kv_env: env.CACHE_ENABLE_KV || 'not set' 
    });
    return false;
  }
  
  if (!kvNamespace) {
    logDebug('No KV namespace binding found for storage', { 
      VIDEO_TRANSFORMATIONS_CACHE: !!env.VIDEO_TRANSFORMATIONS_CACHE,
      VIDEO_TRANSFORMS_KV: !!env.VIDEO_TRANSFORMS_KV
    });
    return false;
  }
  
  try {
    // Clone the response to avoid consuming it
    const responseClone = response.clone();
    
    // Determine TTL based on the content type and cache configuration
    const ttl = determineTTL(responseClone, config);
    
    // Ensure namespace is defined before using
    if (!kvNamespace) {
      return false;
    }
    
    // Enhanced logging before storage
    logDebug('Attempting to store in KV cache', {
      sourcePath,
      derivative: options.derivative,
      ttl,
      contentType: responseClone.headers.get('content-type'),
      contentLength: responseClone.headers.get('content-length'),
      namespaceBinding: env.VIDEO_TRANSFORMATIONS_CACHE ? 'VIDEO_TRANSFORMATIONS_CACHE' : 'VIDEO_TRANSFORMS_KV'
    });
    
    // Store in KV
    const success = await storeTransformedVideo(
      kvNamespace,
      sourcePath,
      responseClone,
      options,
      ttl
    );
    
    if (success) {
      const requestContext = getCurrentContext();
      if (requestContext) {
        addBreadcrumb(requestContext, 'KVCache', 'Stored in KV cache', {
          sourcePath,
          derivative: options.derivative,
          ttl,
          timestamp: new Date().toISOString()
        });
      }
      
      logDebug('Successfully stored in KV cache', {
        sourcePath,
        derivative: options.derivative,
        ttl,
        expiresAt: new Date(Date.now() + (ttl * 1000)).toISOString()
      });
    } else {
      logDebug('Failed to store in KV cache', {
        sourcePath,
        derivative: options.derivative
      });
    }
    
    return success;
  } catch (err) {
    logDebug('Error storing in KV cache', {
      sourcePath,
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined
    });
    return false;
  }
}

/**
 * Determine the TTL for a cached response
 * 
 * @param response - The response to cache
 * @param config - Cache configuration
 * @returns TTL in seconds
 */
function determineTTL(response: Response, config: any): number {
  // Default TTL based on response status
  const status = response.status;
  const statusCategory = Math.floor(status / 100);
  
  // Determine TTL based on status code
  switch (statusCategory) {
    case 2: // Success
      return config.ttl?.ok || 86400; // 24 hours
    case 3: // Redirect
      return config.ttl?.redirects || 3600; // 1 hour
    case 4: // Client error
      return config.ttl?.clientError || 60; // 1 minute
    case 5: // Server error
      return config.ttl?.serverError || 10; // 10 seconds
    default:
      return 60; // 1 minute default
  }
}

/**
 * Check if KV cache should be bypassed based on configuration settings
 * 
 * @returns Boolean indicating if cache should be bypassed
 */
function shouldBypassKVCache(sourcePath: string): boolean {
  // No URL parameters or special debug flags should bypass KV storage
  // KV caching should be controlled only by configuration
  return false;
}
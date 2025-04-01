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
  customData?: Record<string, unknown>;
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
  const shouldBypass = await shouldBypassKVCache(sourcePath);
  if (shouldBypass) {
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
    
    // Check if response is an error (4xx, 5xx)
    const statusCode = responseClone.status;
    const isError = statusCode >= 400;
    
    // Check content type to determine if response is video
    const contentType = responseClone.headers.get('content-type') || '';
    
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
    
    // Skip KV storage for errors or non-video responses
    if (isError || !isVideoResponse) {
      logDebug('Skipping KV storage for error or non-video response', {
        statusCode,
        contentType,
        isError,
        isVideoResponse
      });
      return false;
    }
    
    // Determine TTL based on the content type and cache configuration
    const ttl = determineTTL(responseClone, config);
    
    // Log TTL determination
    logDebug('Determined TTL for caching based on content type', {
      contentType,
      ttl,
      responseStatus: responseClone.status,
      statusCategory: Math.floor(responseClone.status / 100),
      configuredTTLOk: config.ttl?.ok,
      isVideo: isVideoResponse
    });
    
    // Ensure namespace is defined before using
    if (!kvNamespace) {
      return false;
    }
    
    // Check if this is a large video response
    const contentLength = parseInt(responseClone.headers.get('content-length') || '0', 10);
    const isLargeVideo = isVideoResponse && contentLength > 1000000; // >1MB
    
    // Log content length discovery
    logDebug('Determined content length for KV storage calculation', {
      contentLength,
      contentType, 
      sourcePath,
      isLargeVideo,
      sizeCategory: contentLength > 10000000 ? 'very large' : 
                   contentLength > 1000000 ? 'large' : 
                   contentLength > 100000 ? 'medium' : 'small',
      sizeMB: contentLength > 0 ? Math.round(contentLength / (1024 * 1024) * 100) / 100 : 0
    });
    
    // For videos larger than Cloudflare's KV size limit (25MiB), skip KV storage entirely
    const KV_SIZE_LIMIT = 25 * 1024 * 1024; // 25MiB in bytes
    const exceedsKVLimit = contentLength > KV_SIZE_LIMIT;
    
    // Skip KV storage for videos exceeding the 25MiB KV size limit
    if (exceedsKVLimit && isVideoResponse) {
      logDebug('Skipping KV storage for video exceeding 25MiB size limit', {
        contentType,
        contentLength,
        maxSizeBytes: KV_SIZE_LIMIT,
        sourcePath
      });
      return false;
    }
    
    // Enhanced logging before storage
    logDebug('Attempting to store in KV cache', {
      sourcePath,
      derivative: options.derivative,
      ttl,
      contentType,
      contentLength,
      isLargeVideo,
      namespaceBinding: env.VIDEO_TRANSFORMATIONS_CACHE ? 'VIDEO_TRANSFORMATIONS_CACHE' : 'VIDEO_TRANSFORMS_KV'
    });
    
    // Store in KV using a non-blocking operation to avoid worker timeouts
    // We'll schedule the storage operation using waitUntil when it's available
    let success = false;
    try {
      // Get the execution context if it exists in the request context
      const requestContext = getCurrentContext();
      const ctx = requestContext?.executionContext;
      
      // For large videos or when explicitly configured, always prefer waitUntil to avoid timeouts
      const shouldUseWaitUntil = isLargeVideo || (ctx?.waitUntil != null);
      
      if (ctx?.waitUntil && shouldUseWaitUntil) {
        // Log waitUntil decision
        logDebug('Using waitUntil for non-blocking KV storage', {
          sourcePath,
          isLargeVideo,
          contentLength,
          ttl,
          startTime: new Date().toISOString()
        });
        
        // Use waitUntil to make the KV storage non-blocking
        ctx.waitUntil(
          storeTransformedVideo(
            kvNamespace,
            sourcePath,
            responseClone,
            options,
            ttl
          ).then(result => {
            const endTime = new Date();
            // Generate a log-friendly representation of the storage key
            // Always use derivative-based key format for consistency and better caching
            const hasIMQuery = options.customData?.imwidth || options.customData?.imheight;
            const storageKeyLog = `video:${sourcePath.replace(/^\//g, '')}:${
              options.derivative ? `derivative=${options.derivative}` : 'default'
            }`;
            
            logDebug('Async KV storage operation completed', {
              sourcePath,
              derivative: options.derivative,
              hasIMQuery: !!hasIMQuery,
              imwidth: options.customData?.imwidth,
              success: !!result,
              endTime: endTime.toISOString(),
              storageKey: storageKeyLog,
              usingDerivativeKey: true
            });
            
            // Add breadcrumb for successful storage
            const reqContext = getCurrentContext();
            if (reqContext && result) {
              addBreadcrumb(reqContext, 'KVCache', 'Async KV storage completed', {
                sourcePath,
                success: !!result,
                derivative: options.derivative
              });
            }
            
            return result;
          }).catch(err => {
            // Log any errors in the waitUntil promise
            logDebug('Error in waitUntil KV storage operation', {
              sourcePath,
              error: err instanceof Error ? err.message : String(err),
              stack: err instanceof Error ? err.stack : undefined
            });
            return false;
          })
        );
        
        // Since we're using waitUntil, consider it a success even though it's running in the background
        success = true;
        logDebug('Started async KV storage operation', {
          sourcePath, 
          derivative: options.derivative,
          contentLength,
          timestamp: new Date().toISOString()
        });
      } else {
        // Fall back to blocking operation if waitUntil isn't available
        success = await storeTransformedVideo(
          kvNamespace,
          sourcePath,
          responseClone,
          options,
          ttl
        );
      }
    } catch (err) {
      logDebug('Error scheduling KV storage', {
        error: err instanceof Error ? err.message : String(err)
      });
      success = false;
    }
    
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
 * @param sourcePath - The source path being requested
 * @returns Boolean indicating if cache should be bypassed
 */
async function shouldBypassKVCache(sourcePath: string): Promise<boolean> {
  // Get current request context if available
  const requestContext = getCurrentContext();
  
  // Check for debug mode in current request
  if (requestContext?.url) {
    const url = new URL(requestContext.url);
    
    // Check for debug mode first (simple check)
    if (url.searchParams.has('debug')) {
      logDebug('Bypassing KV cache due to debug mode', { sourcePath });
      return true;
    }
    
    // Check for nocache or bypass parameters (simple check)
    if (url.searchParams.has('nocache') || url.searchParams.has('bypass')) {
      logDebug('Bypassing KV cache due to bypass parameters', { sourcePath });
      return true;
    }
  }
  
  return false;
}
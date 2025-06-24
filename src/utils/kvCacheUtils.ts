/**
 * Utility functions for using KV as a cache for transformed videos
 */

import { getCacheConfig } from '../config';
import { cacheConfig } from '../config/CacheConfigurationManager';
import { EnvVariables } from '../config/environmentConfig';
import { getTransformedVideo, storeTransformedVideo, generateKVKey } from '../services/kvStorageService';
import { getCurrentContext } from '../utils/legacyLoggerAdapter';
import { addBreadcrumb } from '../utils/requestContext';
import { normalizeUrlForCaching } from './urlVersionUtils';
import { determineTTL } from './determineTTL';
import { getCacheKV } from './flexibleBindings';
import { createCategoryLogger } from './logger';

// Create a category-specific logger for KVCacheUtils
const logger = createCategoryLogger('KVCacheUtils');
const { debug: logDebug } = logger;

/**
 * Interface for transformation options
 */
export interface TransformOptions {
  mode?: string | null;
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
  // Frame-specific options
  time?: string | null;
  // Spritesheet-specific options
  columns?: number | null;
  rows?: number | null;
  interval?: string | null;
  // Version information for cache busting
  version?: number;
  customData?: Record<string, unknown>;
  // Diagnostics information
  diagnosticsInfo?: Record<string, any>;
  [key: string]: unknown;
}

/**
 * Try to get a transformed video from KV cache
 * 
 * @param env - Environment variables with KV namespaces
 * @param sourcePath - Original source path
 * @param options - Transformation options
 * @param request - Optional request for range request support
 * @returns The cached response or null if not found
 */
export async function getFromKVCache(
  env: EnvVariables,
  sourcePath: string,
  options: TransformOptions,
  request?: Request // Add optional request parameter for range support
): Promise<Response | null> {
  // Check if KV caching is enabled from CacheConfigurationManager (which includes KV config)
  // The CacheConfigurationManager has enableKVCache default to true, and gets updated from config.json
  const cacheConfigManager = cacheConfig.getConfig();
  const enableKVCache = cacheConfigManager.enableKVCache;
  
  // Use flexible binding to get the cache KV namespace
  const kvNamespace = getCacheKV(env);
  
  // Enhanced logging for troubleshooting
  if (!enableKVCache) {
    logDebug('KV cache disabled by configuration', { 
      enableKVCache: enableKVCache,
      cache_enable_kv_env: env.CACHE_ENABLE_KV || 'not set',
      configSource: 'CacheConfigurationManager'
    });
    return null;
  }
  
  if (!kvNamespace) {
    logDebug('No KV namespace binding found', { 
      CACHE_KV_NAME: env.CACHE_KV_NAME || 'not set',
      hasFlexibleBinding: !!env.CACHE_KV_NAME
    });
    return null;
  }
  
  // Normalize the source path for caching (remove v parameter)
  const normalizedPath = normalizeUrlForCaching(sourcePath);
  
  // Check if we should bypass cache for this request
  const shouldBypass = await shouldBypassKVCache(normalizedPath);
  if (shouldBypass) {
    logDebug('Bypassing KV cache by configuration', { 
      originalPath: sourcePath,
      normalizedPath: normalizedPath !== sourcePath ? normalizedPath : undefined 
    });
    return null;
  }
  
  try {
    // Ensure namespace is defined before using
    if (!kvNamespace) {
      return null;
    }
    
    // Log if this is a range request
    if (request?.headers.has('Range')) {
      logDebug('Range request detected', {
        sourcePath,
        range: request.headers.get('Range')
      });
    }
    
    const result = await getTransformedVideo(
      kvNamespace,
      normalizedPath, // Use normalized path for consistent cache keys
      { ...options, env }, // Include env in options for version tracking
      request // Pass the request through for range handling
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
        contentType: result.metadata.contentType,
        cacheVersion: result.metadata.cacheVersion || options.version || 'unversioned'
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
      requestedVersion: options.version || 'none',
      normalizedPath: normalizedPath !== sourcePath ? normalizedPath : undefined,
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
  // Normalize the source path for caching (remove v parameter)
  const normalizedPath = normalizeUrlForCaching(sourcePath);
  // Check if KV caching is enabled from CacheConfigurationManager (which includes KV config)
  // The CacheConfigurationManager has enableKVCache default to true, and gets updated from config.json
  const cacheConfigManager = cacheConfig.getConfig();
  const enableKVCache = cacheConfigManager.enableKVCache;
  
  // Use flexible binding to get the cache KV namespace
  const kvNamespace = getCacheKV(env);
  
  // Enhanced logging for troubleshooting
  if (!enableKVCache) {
    logDebug('KV cache storage disabled by configuration', { 
      enableKVCache: enableKVCache,
      cache_enable_kv_env: env.CACHE_ENABLE_KV || 'not set',
      configSource: 'CacheConfigurationManager'
    });
    return false;
  }
  
  if (!kvNamespace) {
    logDebug('No KV namespace binding found for storage', { 
      CACHE_KV_NAME: env.CACHE_KV_NAME || 'not set',
      hasFlexibleBinding: !!env.CACHE_KV_NAME
    });
    return false;
  }
  
  try {
    // Clone the response to avoid consuming it
    const responseClone = response.clone();
    
    // CRITICAL: Check bypass headers first - do not cache if bypass is set
    const bypassHeaders = [
      'X-Bypass-Cache-API',
      'X-Video-Exceeds-256MiB',
      'X-Direct-Stream',
      'X-File-Size-Error',
      'X-Video-Too-Large'
    ];
    
    const hasBypassHeader = bypassHeaders.some(header => 
      responseClone.headers.get(header) === 'true'
    );
    
    if (hasBypassHeader) {
      logDebug('Skipping KV storage due to bypass headers', {
        sourcePath,
        bypassHeaders: bypassHeaders.filter(h => responseClone.headers.get(h) === 'true'),
        mode: options.mode || 'video'
      });
      return false;
    }
    
    // Check if response is an error (4xx, 5xx)
    const statusCode = responseClone.status;
    const isError = statusCode >= 400;
    
    // Check content type to determine if response is video
    const contentType = responseClone.headers.get('content-type') || '';
    
    // Default MIME types
    const DEFAULT_VIDEO_MIME_TYPES = [
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
    
    const DEFAULT_IMAGE_MIME_TYPES = [
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/webp',
      'image/gif',
      'image/avif'
    ];
    
    // Initialize with defaults
    let videoMimeTypes = DEFAULT_VIDEO_MIME_TYPES;
    let imageMimeTypes = DEFAULT_IMAGE_MIME_TYPES;
    
    try {
      // Get MIME types from cache configuration
      const cacheSettings = cacheConfig.getConfig();
      if (cacheSettings.mimeTypes) {
        if (cacheSettings.mimeTypes.video && cacheSettings.mimeTypes.video.length > 0) {
          videoMimeTypes = cacheSettings.mimeTypes.video;
        }
        if (cacheSettings.mimeTypes.image && cacheSettings.mimeTypes.image.length > 0) {
          imageMimeTypes = cacheSettings.mimeTypes.image;
        }
      }
    } catch (err) {
      logDebug('Error getting MIME types from configuration, using defaults', {
        error: err instanceof Error ? err.message : String(err)
      });
    }
    
    const isVideoResponse = videoMimeTypes.some(mimeType => contentType.startsWith(mimeType));
    const isImageResponse = imageMimeTypes.some(mimeType => contentType.startsWith(mimeType));
    const isCachableResponse = isVideoResponse || isImageResponse;
    
    // Skip KV storage for errors or non-cacheable responses
    if (isError || !isCachableResponse) {
      logDebug('Skipping KV storage for error or non-cacheable response', {
        statusCode,
        contentType,
        isError,
        isVideoResponse,
        isImageResponse,
        isCachableResponse,
        mode: options.mode || 'video'
      });
      return false;
    }
    
    // CRITICAL: Never cache partial/range responses
    if (statusCode === 206 || responseClone.headers.get('Content-Range')) {
      logDebug('Skipping KV storage for partial content response', {
        statusCode,
        contentRange: responseClone.headers.get('Content-Range'),
        reason: 'Partial responses should never be cached',
        mode: options.mode || 'video'
      });
      return false;
    }
    
    // Determine TTL based on the content type and cache configuration
    const ttl = determineTTL(responseClone, getCacheConfig(env));
    
    // Log TTL determination
    logDebug('Determined TTL for caching based on content type', {
      contentType,
      ttl,
      responseStatus: responseClone.status,
      statusCategory: Math.floor(responseClone.status / 100),
      configuredTTLOk: getCacheConfig(env).ttl?.ok,
      mode: options.mode || 'video',
      isVideo: isVideoResponse,
      isImage: isImageResponse
    });
    
    // Ensure namespace is defined before using
    if (!kvNamespace) {
      return false;
    }
    
    // Check content length for KV storage limits
    const contentLength = parseInt(responseClone.headers.get('content-length') || '0', 10);
    
    // Log content length discovery with enhanced data for debugging
    const contentLengthMB = contentLength > 0 ? Math.round(contentLength / (1024 * 1024) * 100) / 100 : 0;
    
    logDebug('Determined content length for KV storage calculation', {
      contentLength,
      contentType, 
      contentLengthHeader: responseClone.headers.get('content-length'),
      contentLengthMB,
      contentLengthMiB: contentLength > 0 ? Math.round(contentLength / (1024 * 1024 * 1.024) * 100) / 100 : 0, // Convert to MiB
      sourcePath,
      mode: options.mode || 'video',
      derivative: options.derivative,
      sizeCategory: contentLength > 10000000 ? 'very large' : 
                   contentLength > 1000000 ? 'large' : 
                   contentLength > 100000 ? 'medium' : 'small'
    });
    
    // Log content size details for monitoring purposes
    // Note: We've removed the pre-emptive size check to let KV naturally handle size limitations
    // This avoids potential incorrect rejections when the content size calculation is inaccurate
    
    logDebug('Content size details for KV storage', {
      contentLength,
      contentLengthMB: contentLengthMB,
      contentLengthMiB: contentLength > 0 ? Math.round(contentLength / (1024 * 1024 * 1.024) * 100) / 100 : 0,
      contentType,
      derivative: options.derivative,
      sourcePath,
      mode: options.mode || 'video'
    });
    
    // Enhanced logging before storage
    logDebug('Attempting to store in KV cache', {
      sourcePath,
      mode: options.mode || 'video',
      derivative: options.derivative,
      ttl,
      contentType,
      contentLength,
      namespaceBinding: env.CACHE_KV_NAME || 'default'
    });
    
    // Store in KV using a non-blocking operation to avoid worker timeouts
    // We'll schedule the storage operation using waitUntil when it's available
    let success = false;
    try {
      // Get the execution context if it exists in the request context
      const requestContext = getCurrentContext();
      const ctx = requestContext?.executionContext;
      
      // Always use waitUntil when available to avoid timeouts with any content type
      if (ctx?.waitUntil) {
        // Log waitUntil decision
        logDebug('Using waitUntil for non-blocking KV storage', {
          sourcePath,
          mode: options.mode || 'video',
          contentLength,
          ttl,
          startTime: new Date().toISOString(),
          version: options.version || 'not set',
          derivative: options.derivative
        });
        
        // Use waitUntil to make the KV storage non-blocking
        ctx.waitUntil(
          storeTransformedVideo(
            kvNamespace,
            normalizedPath, // Use normalized path for consistent cache keys
            responseClone,
            { ...options, env }, // Include env in options for version tracking
            ttl,
            false // Don't use streaming mode for this path
          ).then(result => {
            const endTime = new Date();
            // Generate a log-friendly representation of the storage key
            // Include mode in the key format for consistency
            const hasIMQuery = options.customData?.imwidth || options.customData?.imheight;
            const mode = options.mode || 'video';
            const storageKeyLog = `${mode}:${normalizedPath.replace(/^\//g, '')}:${
              options.derivative ? `derivative=${options.derivative}` : 'default'
            }`;
            
            logDebug('Async KV storage operation completed', {
              sourcePath,
              normalizedPath: normalizedPath !== sourcePath ? normalizedPath : undefined,
              mode,
              derivative: options.derivative,
              hasIMQuery: !!hasIMQuery,
              imwidth: options.customData?.imwidth,
              success: !!result,
              endTime: endTime.toISOString(),
              storageKey: storageKeyLog
            });
            
            // Add breadcrumb for successful storage
            const reqContext = getCurrentContext();
            if (reqContext && result) {
              addBreadcrumb(reqContext, 'KVCache', 'Async KV storage completed', {
                sourcePath,
                mode,
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
          mode: options.mode || 'video',
          derivative: options.derivative,
          contentLength,
          timestamp: new Date().toISOString()
        });
      } else {
        // Fall back to blocking operation if waitUntil isn't available
        success = await storeTransformedVideo(
          kvNamespace,
          normalizedPath, // Use normalized path for consistent cache keys
          responseClone,
          { ...options, env }, // Include env in options for version tracking
          ttl,
          false // Don't use streaming mode for this path
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
          mode: options.mode || 'video',
          derivative: options.derivative,
          ttl,
          timestamp: new Date().toISOString()
        });
      }
      
      logDebug('Successfully stored in KV cache', {
        sourcePath,
        mode: options.mode || 'video',
        derivative: options.derivative,
        ttl,
        expiresAt: new Date(Date.now() + (ttl * 1000)).toISOString()
      });
    } else {
      logDebug('Failed to store in KV cache', {
        sourcePath,
        mode: options.mode || 'video',
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

// Import determineTTL from dedicated module instead of having it inline
// This function is now defined in src/utils/determineTTL.ts

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
    
    // Get bypass parameters exclusively from configuration
    let bypassParams: string[] = [];
    
    try {
      // Get bypass parameters from the cache configuration we already imported
      const cacheSettings = cacheConfig.getConfig();
      
      // Use the bypass parameters directly from configuration
      if (cacheSettings.bypassQueryParameters && cacheSettings.bypassQueryParameters.length > 0) {
        bypassParams = [...cacheSettings.bypassQueryParameters];
        
        // Ensure 'debug' is always included for compatibility
        if (!bypassParams.includes('debug')) {
          bypassParams.push('debug');
        }
        
        logDebug('Using configured bypass parameters', {
          params: bypassParams.join(', '),
          source: 'cache-configuration'
        });
      } else {
        // Fall back to default bypass parameters if none are configured
        bypassParams = ['debug', 'nocache', 'bypass'];
        logDebug('No bypass parameters found in configuration, using defaults', {
          params: bypassParams.join(', ')
        });
      }
    } catch (err) {
      // If we can't get the configuration, use safe defaults
      bypassParams = ['debug', 'nocache', 'bypass'];
      logDebug('Error getting bypass parameters from configuration, using defaults', {
        params: bypassParams.join(', '),
        error: err instanceof Error ? err.message : String(err)
      });
    }
    
    // Check for any configured bypass parameters
    for (const param of bypassParams) {
      if (url.searchParams.has(param)) {
        logDebug(`Bypassing KV cache due to ${param} parameter`, { sourcePath });
        return true;
      }
    }
  }
  
  return false;
}
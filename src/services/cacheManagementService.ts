/**
 * Service for managing cache behavior for video responses
 * Supports both Cache API and Cloudflare cf object caching methods
 */
import { CacheConfig } from '../utils/cacheUtils';
import { CacheConfigurationManager } from '../config';
import { determineCacheControl } from '../utils/cacheControlUtils';
import { generateCacheTags, shouldBypassCache } from './videoStorageService';
import { createLogger, debug as pinoDebug, warn as pinoWarn } from '../utils/pinoLogger';
import { getCurrentContext } from '../utils/legacyLoggerAdapter';
import { addBreadcrumb } from '../utils/requestContext';

/**
 * Helper functions for consistent logging throughout this file
 * These helpers handle context availability and fallback gracefully
 */

/**
 * Log a debug message with proper context handling
 */
function logDebug(message: string, data?: Record<string, unknown>): void {
  const requestContext = getCurrentContext();
  if (requestContext) {
    const logger = createLogger(requestContext);
    pinoDebug(requestContext, logger, 'CacheManagementService', message, data);
  } else {
    // Fall back to console as a last resort
    console.debug(`CacheManagementService: ${message}`, data || {});
  }
}

/**
 * Log a warning message with proper context handling
 */
function logWarn(message: string, data?: Record<string, unknown>): void {
  const requestContext = getCurrentContext();
  if (requestContext) {
    const logger = createLogger(requestContext);
    pinoWarn(requestContext, logger, 'CacheManagementService', message, data);
  } else {
    // Fall back to console as a last resort
    console.warn(`CacheManagementService: ${message}`, data || {});
  }
}

/**
 * Apply cache headers to a response based on configuration and use Cache API if available
 * 
 * @param response - The response to modify
 * @param status - HTTP status code
 * @param cacheConfig - Cache configuration
 * @param source - Content source for tagging
 * @param derivative - Optional derivative name for tagging
 * @returns Modified response with cache headers
 */
export function applyCacheHeaders(
  response: Response,
  status: number,
  cacheConfig?: CacheConfig | null,
  source?: string,
  derivative?: string
): Response {
  // Create new headers object
  const newHeaders = new Headers(response.headers);
  
  // Create response init with headers object
  const responseInit: ResponseInit = {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders,
  };
  
  // Get request context for breadcrumbs
  const requestContext = getCurrentContext();
  
  // If no cache config, use default no-cache behavior
  if (!cacheConfig) {
    newHeaders.set('Cache-Control', 'no-store');
    
    if (requestContext) {
      addBreadcrumb(requestContext, 'Cache', 'Using no-cache behavior', {
        status,
        reason: 'No cache configuration',
        cacheControl: 'no-store'
      });
    }
    
    return new Response(response.body, responseInit);
  }
  
  // Get the appropriate cache control header
  const cacheControl = determineCacheControl(status, cacheConfig);
  
  logDebug('Applying cache headers', {
    status,
    cacheControl,
    cacheability: cacheConfig.cacheability,
    source,
    derivative
  });
  
  // Apply cache headers
  if (cacheConfig.cacheability && cacheControl) {
    newHeaders.set('Cache-Control', cacheControl);
    
    // Add breadcrumb for applied cache control
    if (requestContext) {
      // Extract the caching duration from a "max-age=X" directive
      const maxAgeMatch = cacheControl.match(/max-age=(\d+)/);
      const maxAgeTtl = maxAgeMatch ? parseInt(maxAgeMatch[1], 10) : undefined;
      
      addBreadcrumb(requestContext, 'Cache', 'Applied cacheable headers', {
        status,
        cacheControl,
        maxAgeTtl,
        statusCategory: Math.floor(status / 100) * 100,
        isCacheable: true
      });
    }
  } else {
    newHeaders.set('Cache-Control', 'no-store');
    
    // Add breadcrumb for non-cacheable response
    if (requestContext) {
      addBreadcrumb(requestContext, 'Cache', 'Applied non-cacheable headers', {
        status,
        cacheControl: 'no-store',
        reason: cacheConfig.cacheability ? 'No valid cacheControl' : 'Cacheability disabled',
        statusCategory: Math.floor(status / 100) * 100,
        isCacheable: false
      });
    }
  }
  
  // Generate cache tags if source is provided - important for purging
  if (source) {
    const options = { derivative };
    const tags = generateCacheTags(source, options, newHeaders);
    
    if (tags.length > 0) {
      newHeaders.set('Cache-Tag', tags.join(','));
      
      // Add breadcrumb for cache tags
      if (requestContext) {
        // Store cache tags in the request context for diagnostics
        if (!requestContext.diagnostics) {
          requestContext.diagnostics = {};
        }
        
        // Add cache tags to diagnostics info
        requestContext.diagnostics.cacheTags = tags;
        
        addBreadcrumb(requestContext, 'Cache', 'Generated cache tags', {
          tagCount: tags.length,
          source,
          derivative: derivative || undefined,
          firstTags: tags.slice(0, 3).join(','), // Include just the first few tags
          hasCustomTags: true
        });
      }
    } else {
      // For backward compatibility with tests 
      const fallbackTag = `video-resizer,source:${source}${derivative ? `,derivative:${derivative}` : ''}`;
      newHeaders.set('Cache-Tag', fallbackTag);
      
      // Add fallback tag to diagnostics
      if (requestContext) {
        // Store fallback cache tag in the request context for diagnostics
        if (!requestContext.diagnostics) {
          requestContext.diagnostics = {};
        }
        
        // Add fallback cache tag as an array to diagnostics
        requestContext.diagnostics.cacheTags = [fallbackTag];
        
        addBreadcrumb(requestContext, 'Cache', 'Using fallback cache tags', {
          source,
          derivative: derivative || undefined,
          tag: fallbackTag,
          reason: 'No tags generated by service'
        });
      }
    }
  }
  
  return new Response(response.body, responseInit);
}

/**
 * Store a response in the Cloudflare cache 
 * Based on configuration, uses either Cache API or cf object
 * 
 * @param request - The original request
 * @param response - The response to cache
 * @param context - Optional execution context for waitUntil
 * @returns Promise that resolves when caching is complete
 */
export async function cacheResponse(
  request: Request, 
  response: Response,
  context?: ExecutionContext
): Promise<void> {
  try {
    // Only cache successful GET requests
    if (request.method !== 'GET' || !response.ok) {
      return;
    }
    
    // Check the content type
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
    
    // Comprehensive list of image MIME types
    const imageMimeTypes = [
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
      'image/avif',
      'image/tiff',
      'image/svg+xml',
      'image/bmp'
    ];
    
    // Check if content type is cacheable
    const isVideoResponse = videoMimeTypes.some(mimeType => contentType.startsWith(mimeType));
    const isImageResponse = imageMimeTypes.some(mimeType => contentType.startsWith(mimeType));
    const isCacheableContent = isVideoResponse || isImageResponse;
    
    // Skip caching for 4xx, 5xx responses or non-video/image content
    if (isError || !isCacheableContent) {
      logDebug('Skipping cache.put for non-cacheable content', {
        url: request.url,
        status: response.status,
        contentType,
        isError,
        isCacheableContent
      });
      return;
    }
    
    // Get the cache configuration manager
    const cacheConfig = CacheConfigurationManager.getInstance();
    const cacheMethod = cacheConfig.getConfig().method;
    
    // When using cf object caching, we don't need to do anything here
    // as caching is handled by the cf object in fetch
    if (cacheMethod === 'cf') {
      if (cacheConfig.getConfig().debug) {
        logDebug('Using cf object for caching, no explicit cache.put needed', {
          url: request.url,
          status: response.status,
          contentType,
          cacheControl: response.headers.get('Cache-Control')
        });
      }
      return;
    }
    
    // Get the response Cache-Control header to check if we should cache
    const cacheControl = response.headers.get('Cache-Control');
    if (cacheControl && cacheControl.includes('no-store')) {
      logDebug('Skipping cache.put for no-store response', {
        url: request.url,
        cacheControl
      });
      return;
    }
    
    // Clone the response to avoid consuming it
    const responseClone = response.clone();
    
    // Get the default cache
    const cache = caches.default;

    // If we have an execution context, use waitUntil
    if (context) {
      context.waitUntil(
        cache.put(request, responseClone)
          .then(() => {
            logDebug('Stored response in Cloudflare Cache API (waitUntil)', {
              url: request.url,
              method: 'cache-api',
              status: responseClone.status,
              cacheControl: responseClone.headers.get('Cache-Control'),
              cacheTag: responseClone.headers.get('Cache-Tag')
            });
          })
          .catch(err => {
            // Log but don't fail if caching fails
            const errMessage = err instanceof Error ? err.message : 'Unknown error';
            
            logWarn('Failed to store in cache (waitUntil)', {
              url: request.url,
              error: errMessage
            });
          })
      );
    } else {
      // Without execution context, just put directly
      try {
        // Get the request context if available
        const requestContext = getCurrentContext();
        
        // Put the response in the cache
        await cache.put(request, responseClone);
        
        // Add breadcrumb for successful cache store
        if (requestContext) {
          addBreadcrumb(requestContext, 'Cache', 'Stored response in cache', {
            url: request.url,
            method: 'cache-api',
            status: responseClone.status,
            cacheControl: responseClone.headers.get('Cache-Control'),
            contentType: responseClone.headers.get('Content-Type'),
            contentLength: responseClone.headers.get('Content-Length')
          });
        }
        
        logDebug('Stored response in Cloudflare Cache API', {
          url: request.url,
          method: 'cache-api',
          status: responseClone.status,
          cacheControl: responseClone.headers.get('Cache-Control'),
          cacheTag: responseClone.headers.get('Cache-Tag')
        });
      } catch (err) {
        // Log but don't fail if caching fails
        const errMessage = err instanceof Error ? err.message : 'Unknown error';
        
        // Add breadcrumb for cache error
        const requestContext = getCurrentContext();
        if (requestContext) {
          addBreadcrumb(requestContext, 'Error', 'Failed to store in cache', {
            url: request.url,
            errorType: 'CacheWriteError',
            error: errMessage,
            severity: 'medium'
          });
        }
        
        logWarn('Failed to store in cache', {
          url: request.url,
          error: errMessage
        });
      }
    }
  } catch (err) {
    // Log but don't fail if caching fails
    const errMessage = err instanceof Error ? err.message : 'Unknown error';
    
    logWarn('Failed to store in cache', {
      url: request.url,
      error: errMessage
    });
  }
}

/**
 * Try to get a response from the Cloudflare cache
 * Based on configuration, uses either Cache API or returns null (when cf object caching is used)
 * 
 * @param request - The request to check in cache
 * @returns Cached response or null if not found or using cf object caching
 */
export async function getCachedResponse(request: Request): Promise<Response | null> {
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
      logDebug('Using cf object for caching, skipping explicit cache check', {
        url: request.url,
        method: 'cf-object'
      });
    }
    return null;
  }
  
  // Cache API implementation when it's the selected method
  try {
    // Get the default cache
    const cache = caches.default;
    
    // Try to find the response in the cache
    const cachedResponse = await cache.match(request);
    
    // Add breadcrumb for cache result
    const requestContext = getCurrentContext();
    if (requestContext) {
      const { addBreadcrumb } = await import('../utils/requestContext');
      if (cachedResponse) {
        addBreadcrumb(requestContext, 'Cache', 'Cache hit', {
          url: request.url,
          method: 'cache-api',
          status: cachedResponse.status
        });
      } else {
        addBreadcrumb(requestContext, 'Cache', 'Cache miss', {
          url: request.url,
          method: 'cache-api'
        });
      }
    }
    
    if (cachedResponse) {
      logDebug('Cache hit using Cache API', {
        url: request.url,
        method: 'cache-api',
        status: cachedResponse.status
      });
      return cachedResponse;
    }
    
    logDebug('Cache miss using Cache API', {
      url: request.url,
      method: 'cache-api'
    });
    return null;
  } catch (err) {
    // Add breadcrumb for cache error
    const requestContext = getCurrentContext();
    if (requestContext) {
      const { addBreadcrumb } = await import('../utils/requestContext');
      addBreadcrumb(requestContext, 'Cache', 'Cache check error', {
        url: request.url,
        error: err instanceof Error ? err.message : 'Unknown error'
      });
    }
    
    // Log but don't fail if cache check fails
    const errMessage = err instanceof Error ? err.message : 'Unknown error';
    
    logWarn('Error checking cache', {
      url: request.url,
      error: errMessage
    });
    return null;
  }
}

/**
 * Create cf object parameters for caching with Cloudflare's fetch API
 * 
 * @param status - HTTP status code
 * @param cacheConfig - Cache configuration
 * @param source - Content source for tagging
 * @param derivative - Optional derivative name for tagging
 * @param contentType - Optional content type for content-based caching decisions
 * @returns Object with cf parameters for fetch
 */
export function createCfObjectParams(
  status: number,
  cacheConfig?: CacheConfig | null,
  source?: string,
  derivative?: string,
  contentType?: string
): Record<string, unknown> {
  // Default cf object - always include baseline parameters
  const cfObject: Record<string, unknown> = {};
  
  // Handle case with no config
  if (!cacheConfig) {
    // Always set cacheEverything to false when no config
    cfObject.cacheEverything = false;
    cfObject.cacheTtl = 0; // Don't cache
    
    logDebug('Created cf object with no caching (no config)', {
      cacheEverything: false,
      cacheTtl: 0
    });
    
    return cfObject;
  }
  
  // Skip caching for error status codes
  const isError = status >= 400;
  if (isError) {
    cfObject.cacheEverything = false;
    cfObject.cacheTtl = 0;
    
    logDebug('Created cf object with no caching (error status)', {
      cacheEverything: false,
      cacheTtl: 0,
      status
    });
    
    return cfObject;
  }
  
  // Check content type restrictions if contentType is provided
  if (contentType) {
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
    
    // Comprehensive list of image MIME types
    const imageMimeTypes = [
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
      'image/avif',
      'image/tiff',
      'image/svg+xml',
      'image/bmp'
    ];
    
    // Check if content type is cacheable
    const isVideoResponse = videoMimeTypes.some(mimeType => contentType.startsWith(mimeType));
    const isImageResponse = imageMimeTypes.some(mimeType => contentType.startsWith(mimeType));
    const isCacheableContent = isVideoResponse || isImageResponse;
    
    // Skip caching for non-cacheable content
    if (!isCacheableContent) {
      cfObject.cacheEverything = false;
      cfObject.cacheTtl = 0;
      
      logDebug('Created cf object with no caching (non-cacheable content type)', {
        cacheEverything: false,
        cacheTtl: 0,
        contentType
      });
      
      return cfObject;
    }
  }
  
  // First, decide whether we should cache at all
  if (!cacheConfig.cacheability) {
    // If not cacheable, set cacheEverything to false and set cacheTtl to 0 for backward compatibility
    cfObject.cacheEverything = false;
    cfObject.cacheTtl = 0;
    return cfObject;
  }
  
  // If we got here, we've decided to cache. Always explicitly set cacheEverything to true
  cfObject.cacheEverything = true;
  
  // Choose between cacheTtl and cacheTtlByStatus based on the config setting
  const useTtlByStatus = cacheConfig.useTtlByStatus !== undefined ? cacheConfig.useTtlByStatus : true;
  
  if (useTtlByStatus) {
    // Use cacheTtlByStatus for more granular control of TTL by status code range
    cfObject.cacheTtlByStatus = {};
    
    // Determine appropriate TTLs based on status code ranges
    if (cacheConfig.ttl.ok > 0) {
      (cfObject.cacheTtlByStatus as Record<string, number>)['200-299'] = cacheConfig.ttl.ok;
    }
    
    if (cacheConfig.ttl.redirects > 0) {
      (cfObject.cacheTtlByStatus as Record<string, number>)['300-399'] = cacheConfig.ttl.redirects;
    }
    
    if (cacheConfig.ttl.clientError > 0) {
      (cfObject.cacheTtlByStatus as Record<string, number>)['400-499'] = cacheConfig.ttl.clientError;
    }
    
    if (cacheConfig.ttl.serverError > 0) {
      (cfObject.cacheTtlByStatus as Record<string, number>)['500-599'] = cacheConfig.ttl.serverError;
    }
  } else {
    // Use cacheTtl for simpler TTL management
    // Determine TTL based on status code
    let ttl = cacheConfig.ttl.ok; // Default to OK TTL
    
    // Adjust TTL based on status code
    const statusGroup = Math.floor(status / 100);
    switch (statusGroup) {
      case 2: ttl = cacheConfig.ttl.ok; break;
      case 3: ttl = cacheConfig.ttl.redirects; break;
      case 4: ttl = cacheConfig.ttl.clientError; break;
      case 5: ttl = cacheConfig.ttl.serverError; break;
    }
    
    cfObject.cacheTtl = ttl;
  }
  
  // Add cache tags if source is provided and cacheability is true
  if (source && cacheConfig.cacheability) {
    // Generate cache tags for the video
    const options = { derivative };
    const tags = generateCacheTags(source, options);
    
    if (tags.length > 0) {
      // Ensure no tag exceeds 1,024 characters (Cloudflare's limit for API purge compatibility)
      const validTags = tags.map(tag => 
        tag.length > 1024 ? tag.substring(0, 1024) : tag
      );
      
      cfObject.cacheTags = validTags;
      
      // Store cache tags in the diagnostics info
      const requestContext = getCurrentContext();
      if (requestContext) {
        // Initialize diagnostics object if it doesn't exist
        if (!requestContext.diagnostics) {
          requestContext.diagnostics = {};
        }
        
        // Add cache tags to diagnostics info
        requestContext.diagnostics.cacheTags = validTags;
      }
    }
  }
  
  logDebug('Created cf object params for caching', {
    cacheEverything: cfObject.cacheEverything,
    cacheTtlByStatus: cfObject.cacheTtlByStatus,
    cacheTtl: cfObject.cacheTtl,
    cacheTags: cfObject.cacheTags,
    cacheability: cacheConfig.cacheability
  });
  
  return cfObject;
}
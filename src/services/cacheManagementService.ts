/**
 * Service for managing cache behavior for video responses
 * Supports both Cache API and Cloudflare cf object caching methods
 */
import { CacheConfig } from '../utils/cacheUtils';
import { CacheConfigurationManager } from '../config';
import { determineCacheControl } from '../utils/cacheControlUtils';
import { generateCacheTags, shouldBypassCache } from './videoStorageService';
import { createLogger, debug as pinoDebug } from '../utils/pinoLogger';
import { getCurrentContext } from '../utils/legacyLoggerAdapter';

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
  
  // If no cache config, use default no-cache behavior
  if (!cacheConfig) {
    newHeaders.set('Cache-Control', 'no-store');
    return new Response(response.body, responseInit);
  }
  
  // Get the appropriate cache control header
  const cacheControl = determineCacheControl(status, cacheConfig);
  
  // Get the current request context if available
  const requestContext = getCurrentContext();
  
  if (requestContext) {
    const logger = createLogger(requestContext);
    pinoDebug(requestContext, logger, 'CacheManagementService', 'Applying cache headers', {
      status,
      cacheControl,
      cacheability: cacheConfig.cacheability,
      source,
      derivative
    });
  } else {
    // Fallback to legacy debugging
    console.warn('CacheManagementService: No request context available');
  }
  
  // Apply cache headers
  if (cacheConfig.cacheability && cacheControl) {
    newHeaders.set('Cache-Control', cacheControl);
  } else {
    newHeaders.set('Cache-Control', 'no-store');
  }
  
  // Generate cache tags if source is provided - important for purging
  if (source) {
    const options = { derivative };
    const tags = generateCacheTags(source, options, newHeaders);
    if (tags.length > 0) {
      newHeaders.set('Cache-Tag', tags.join(','));
    } else {
      // For backward compatibility with tests 
      newHeaders.set('Cache-Tag', `video-resizer,source:${source}${derivative ? `,derivative:${derivative}` : ''}`);
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
    
    // Get the cache configuration manager
    const cacheConfig = CacheConfigurationManager.getInstance();
    const cacheMethod = cacheConfig.getConfig().method;
    
    // When using cf object caching, we don't need to do anything here
    // as caching is handled by the cf object in fetch
    if (cacheMethod === 'cf') {
      if (cacheConfig.getConfig().debug) {
        // Get the current request context if available
        const requestContext = getCurrentContext();
        
        if (requestContext) {
          const logger = createLogger(requestContext);
          pinoDebug(requestContext, logger, 'CacheManagementService', 'Using cf object for caching, no explicit cache.put needed', {
            url: request.url,
            status: response.status,
            cacheControl: response.headers.get('Cache-Control')
          });
        } else {
          // Fallback to legacy debugging
          console.warn('CacheManagementService: No request context available for cf object caching');
        }
      }
      return;
    }
    
    // Get the response Cache-Control header to check if we should cache
    const cacheControl = response.headers.get('Cache-Control');
    if (cacheControl && cacheControl.includes('no-store')) {
      // Get the current request context if available
      const requestContext = getCurrentContext();
      
      if (requestContext) {
        const logger = createLogger(requestContext);
        pinoDebug(requestContext, logger, 'CacheManagementService', 'Skipping cache.put for no-store response', {
          url: request.url,
          cacheControl
        });
      } else {
        // Fallback to legacy debugging
        console.warn('CacheManagementService: No request context available for skipping cache.put');
      }
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
            // Get the current request context if available
            const requestContext = getCurrentContext();
            
            if (requestContext) {
              const logger = createLogger(requestContext);
              pinoDebug(requestContext, logger, 'CacheManagementService', 'Stored response in Cloudflare Cache API (waitUntil)', {
                url: request.url,
                method: 'cache-api',
                status: responseClone.status,
                cacheControl: responseClone.headers.get('Cache-Control'),
                cacheTag: responseClone.headers.get('Cache-Tag')
              });
            } else {
              // Fallback to legacy debugging
              console.warn('CacheManagementService: No request context available for cache storage (waitUntil)');
            }
          })
          .catch(err => {
            // Log but don't fail if caching fails
            const errMessage = err instanceof Error ? err.message : 'Unknown error';
            // Get the current request context if available
            const requestContext = getCurrentContext();
            
            if (requestContext) {
              const logger = createLogger(requestContext);
              pinoDebug(requestContext, logger, 'CacheManagementService', 'Failed to store in cache (waitUntil)', {
                url: request.url,
                error: errMessage
              });
            } else {
              // Fallback to legacy debugging
              console.warn(`CacheManagementService: Failed to store in cache (waitUntil): ${errMessage}`);
            }
          })
      );
    } else {
      // Without execution context, just put directly
      try {
        // Put the response in the cache
        await cache.put(request, responseClone);
        
        // Get the current request context if available
        const requestContext = getCurrentContext();
        
        if (requestContext) {
          const logger = createLogger(requestContext);
          pinoDebug(requestContext, logger, 'CacheManagementService', 'Stored response in Cloudflare Cache API', {
            url: request.url,
            method: 'cache-api',
            status: responseClone.status,
            cacheControl: responseClone.headers.get('Cache-Control'),
            cacheTag: responseClone.headers.get('Cache-Tag')
          });
        } else {
          // Fallback to legacy debugging
          console.warn('CacheManagementService: No request context available for cache storage');
        }
      } catch (err) {
        // Log but don't fail if caching fails
        const errMessage = err instanceof Error ? err.message : 'Unknown error';
        // Get the current request context if available
        const requestContext = getCurrentContext();
        
        if (requestContext) {
          const logger = createLogger(requestContext);
          pinoDebug(requestContext, logger, 'CacheManagementService', 'Failed to store in cache', {
            url: request.url,
            error: errMessage
          });
        } else {
          // Fallback to legacy debugging
          console.warn(`CacheManagementService: Failed to store in cache: ${errMessage}`);
        }
      }
    }
  } catch (err) {
    // Log but don't fail if caching fails
    const errMessage = err instanceof Error ? err.message : 'Unknown error';
    // Get the current request context if available
    const requestContext = getCurrentContext();
    
    if (requestContext) {
      const logger = createLogger(requestContext);
      pinoDebug(requestContext, logger, 'CacheManagementService', 'Failed to store in cache', {
        url: request.url,
        error: errMessage
      });
    } else {
      // Fallback to legacy debugging
      console.warn(`CacheManagementService: Failed to store in cache: ${errMessage}`);
    }
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
  
  // Check if we should bypass cache
  if (shouldBypassCache(request)) {
    // Get the current request context if available
    const requestContext = getCurrentContext();
    
    if (requestContext) {
      const logger = createLogger(requestContext);
      pinoDebug(requestContext, logger, 'CacheManagementService', 'Bypassing cache based on request', {
        url: request.url
      });
    } else {
      // Fallback to legacy debugging
      console.warn(`CacheManagementService: Bypassing cache based on request: ${request.url}`);
    }
    return null;
  }
  
  // Get the cache configuration manager
  const cacheConfig = CacheConfigurationManager.getInstance();
  const cacheMethod = cacheConfig.getConfig().method;
  
  // When using cf object caching, we don't use explicit cache.match
  // Instead, we rely on Cloudflare's built-in caching with the cf object in fetch
  if (cacheMethod === 'cf') {
    if (cacheConfig.getConfig().debug) {
      // Get the current request context if available
      const requestContext = getCurrentContext();
      
      if (requestContext) {
        const logger = createLogger(requestContext);
        pinoDebug(requestContext, logger, 'CacheManagementService', 'Using cf object for caching, skipping explicit cache check', {
          url: request.url,
          method: 'cf-object'
        });
      } else {
        // Fallback to legacy debugging
        console.warn(`CacheManagementService: Using cf object for caching, skipping explicit cache check: ${request.url}`);
      }
    }
    return null;
  }
  
  // Cache API implementation when it's the selected method
  try {
    // Get the default cache
    const cache = caches.default;
    
    // Try to find the response in the cache
    const cachedResponse = await cache.match(request);
    
    if (cachedResponse) {
      // Get the current request context if available
      const requestContext = getCurrentContext();
      
      if (requestContext) {
        const logger = createLogger(requestContext);
        pinoDebug(requestContext, logger, 'CacheManagementService', 'Cache hit using Cache API', {
          url: request.url,
          method: 'cache-api',
          status: cachedResponse.status
        });
      } else {
        // Fallback to legacy debugging
        console.warn(`CacheManagementService: Cache hit using Cache API: ${request.url}`);
      }
      return cachedResponse;
    }
    
    // Get the current request context if available
    const requestContext = getCurrentContext();
    
    if (requestContext) {
      const logger = createLogger(requestContext);
      pinoDebug(requestContext, logger, 'CacheManagementService', 'Cache miss using Cache API', {
        url: request.url,
        method: 'cache-api'
      });
    } else {
      // Fallback to legacy debugging
      console.warn(`CacheManagementService: Cache miss using Cache API: ${request.url}`);
    }
    return null;
  } catch (err) {
    // Log but don't fail if cache check fails
    const errMessage = err instanceof Error ? err.message : 'Unknown error';
    // Get the current request context if available
    const requestContext = getCurrentContext();
    
    if (requestContext) {
      const logger = createLogger(requestContext);
      pinoDebug(requestContext, logger, 'CacheManagementService', 'Error checking cache', {
        url: request.url,
        error: errMessage
      });
    } else {
      // Fallback to legacy debugging
      console.warn(`CacheManagementService: Error checking cache: ${errMessage}`);
    }
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
 * @returns Object with cf parameters for fetch
 */
export function createCfObjectParams(
  status: number,
  cacheConfig?: CacheConfig | null,
  source?: string,
  derivative?: string
): Record<string, unknown> {
  // Default cf object - always include baseline parameters
  const cfObject: Record<string, unknown> = {};
  
  // Handle case with no config
  if (!cacheConfig) {
    // Always set cacheEverything to false when no config
    cfObject.cacheEverything = false;
    cfObject.cacheTtl = 0; // Don't cache
    
    // Get the current request context if available
    const requestContext = getCurrentContext();
    
    if (requestContext) {
      const logger = createLogger(requestContext);
      pinoDebug(requestContext, logger, 'CacheManagementService', 'Created cf object with no caching (no config)', {
        cacheEverything: false,
        cacheTtl: 0
      });
    } else {
      // Fallback to legacy debugging
      console.warn('CacheManagementService: Created cf object with no caching (no config)');
    }
    
    return cfObject;
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
    }
  }
  
  // Get the current request context if available
  const requestContext = getCurrentContext();
  
  if (requestContext) {
    const logger = createLogger(requestContext);
    pinoDebug(requestContext, logger, 'CacheManagementService', 'Created cf object params for caching', {
      cacheEverything: cfObject.cacheEverything,
      cacheTtlByStatus: cfObject.cacheTtlByStatus,
      cacheTtl: cfObject.cacheTtl,
      cacheTags: cfObject.cacheTags,
      cacheability: cacheConfig.cacheability
    });
  } else {
    // Fallback to legacy debugging
    console.warn('CacheManagementService: Created cf object params for caching');
  }
  
  return cfObject;
}
/**
 * Service for managing cache behavior for video responses
 * Supports both Cache API and Cloudflare cf object caching methods
 */
import { CacheConfig } from '../utils/cacheUtils';
import { debug } from '../utils/loggerUtils';
import { CacheConfigurationManager } from '../config';
import { determineCacheControl } from '../utils/cacheControlUtils';
import { generateCacheTags, shouldBypassCache } from './videoStorageService';

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
  
  debug('CacheManagementService', 'Applying cache headers', {
    status,
    cacheControl,
    cacheability: cacheConfig.cacheability,
    source,
    derivative
  });
  
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
        debug('CacheManagementService', 'Using cf object for caching, no explicit cache.put needed', {
          url: request.url,
          status: response.status,
          cacheControl: response.headers.get('Cache-Control')
        });
      }
      return;
    }
    
    // Get the response Cache-Control header to check if we should cache
    const cacheControl = response.headers.get('Cache-Control');
    if (cacheControl && cacheControl.includes('no-store')) {
      debug('CacheManagementService', 'Skipping cache.put for no-store response', {
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
            debug('CacheManagementService', 'Stored response in Cloudflare Cache API (waitUntil)', {
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
            debug('CacheManagementService', 'Failed to store in cache (waitUntil)', {
              url: request.url,
              error: errMessage
            });
          })
      );
    } else {
      // Without execution context, just put directly
      try {
        // Put the response in the cache
        await cache.put(request, responseClone);
        
        debug('CacheManagementService', 'Stored response in Cloudflare Cache API', {
          url: request.url,
          method: 'cache-api',
          status: responseClone.status,
          cacheControl: responseClone.headers.get('Cache-Control'),
          cacheTag: responseClone.headers.get('Cache-Tag')
        });
      } catch (err) {
        // Log but don't fail if caching fails
        const errMessage = err instanceof Error ? err.message : 'Unknown error';
        debug('CacheManagementService', 'Failed to store in cache', {
          url: request.url,
          error: errMessage
        });
      }
    }
  } catch (err) {
    // Log but don't fail if caching fails
    const errMessage = err instanceof Error ? err.message : 'Unknown error';
    debug('CacheManagementService', 'Failed to store in cache', {
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
  
  // Check if we should bypass cache
  if (shouldBypassCache(request)) {
    debug('CacheManagementService', 'Bypassing cache based on request', {
      url: request.url
    });
    return null;
  }
  
  // Get the cache configuration manager
  const cacheConfig = CacheConfigurationManager.getInstance();
  const cacheMethod = cacheConfig.getConfig().method;
  
  // When using cf object caching, we don't use explicit cache.match
  // Instead, we rely on Cloudflare's built-in caching with the cf object in fetch
  if (cacheMethod === 'cf') {
    if (cacheConfig.getConfig().debug) {
      debug('CacheManagementService', 'Using cf object for caching, skipping explicit cache check', {
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
    
    if (cachedResponse) {
      debug('CacheManagementService', 'Cache hit using Cache API', {
        url: request.url,
        method: 'cache-api',
        status: cachedResponse.status
      });
      return cachedResponse;
    }
    
    debug('CacheManagementService', 'Cache miss using Cache API', {
      url: request.url,
      method: 'cache-api'
    });
    return null;
  } catch (err) {
    // Log but don't fail if cache check fails
    const errMessage = err instanceof Error ? err.message : 'Unknown error';
    debug('CacheManagementService', 'Error checking cache', {
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
    
    debug('CacheManagementService', 'Created cf object with no caching (no config)', {
      cacheEverything: false,
      cacheTtl: 0
    });
    
    return cfObject;
  }
  
  // Always add cacheEverything parameter
  cfObject.cacheEverything = cacheConfig.cacheability || false;
  
  // Determine appropriate TTL based on status code using the shared utility
  const statusGroup = Math.floor(status / 100);
  const ttlMap: Record<number, keyof CacheConfig['ttl']> = {
    2: 'ok', // 200-299 status codes
    3: 'redirects', // 300-399 status codes
    4: 'clientError', // 400-499 status codes 
    5: 'serverError', // 500-599 status codes
  };
  
  // Set TTL based on status and cacheability
  const ttlProperty = ttlMap[statusGroup];
  let ttl = 0; // Default to 0 (no caching)
  
  if (cacheConfig.cacheability && ttlProperty) {
    ttl = cacheConfig.ttl[ttlProperty];
  }
  
  // Always add cacheTtl parameter
  cfObject.cacheTtl = ttl;
  
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
  
  debug('CacheManagementService', 'Created cf object params for caching', {
    cacheEverything: cfObject.cacheEverything,
    cacheTtl: cfObject.cacheTtl,
    cacheTags: cfObject.cacheTags,
    cacheability: cacheConfig.cacheability
  });
  
  return cfObject;
}
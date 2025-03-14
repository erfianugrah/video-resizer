/**
 * Service for managing cache behavior for video responses
 * Supports both Cache API and Cloudflare cf object caching methods
 */
import { CacheConfig } from '../utils/cacheUtils';
import { debug } from '../utils/loggerUtils';
import { videoConfig } from '../config/videoConfig';
import { determineCacheControl } from '../utils/cacheControlUtils';

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
  
  // Use cache control utilities for consistency
  
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
  
  // Add cache tags if source is provided - important for purging through Cloudflare Cache API
  if (source) {
    // Use 'video-resizer' prefix for consistency with existing tests
    let cacheTag = `video-resizer,source:${source}`;
    if (derivative) {
      cacheTag += `,derivative:${derivative}`;
    }
    newHeaders.set('Cache-Tag', cacheTag);
  }
  
  return new Response(response.body, responseInit);
}

/**
 * Store a response in the Cloudflare cache 
 * Based on configuration, uses either Cache API or cf object
 * 
 * @param request - The original request
 * @param response - The response to cache
 * @returns Promise that resolves when caching is complete
 */
export async function cacheResponse(request: Request, response: Response): Promise<void> {
  try {
    // Only cache successful GET requests
    if (request.method !== 'GET' || !response.ok) {
      return;
    }
    
    // When using cf object caching, we don't need to do anything here
    // as caching is handled by the cf object in fetch
    if (videoConfig.caching.method === 'cf') {
      if (videoConfig.caching.debug) {
        debug('CacheManagementService', 'Using cf object for caching, no explicit cache.put needed', {
          url: request.url,
          status: response.status,
          cacheControl: response.headers.get('Cache-Control')
        });
      }
      return;
    }
    
    // Below is the original Cache API implementation
    // Clone the response to avoid consuming it
    const responseClone = response.clone();
    
    // Get the default cache
    const cache = caches.default;
    
    // Put the response in the cache
    // This is an optimization - the Cache-Control headers will still
    // control cache behavior, but this ensures the response is in the
    // cache immediately
    await cache.put(request, responseClone);
    
    debug('CacheManagementService', 'Stored response in Cloudflare Cache API', {
      url: request.url,
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
  
  // Check if we should bypass cache (request has cache-control: no-store, etc.)
  if (shouldBypassCache(request)) {
    debug('CacheManagementService', 'Bypassing cache based on request headers', {
      url: request.url
    });
    return null;
  }
  
  // When using cf object caching, we don't use explicit cache.match
  // Instead, we rely on Cloudflare's built-in caching with the cf object in fetch
  if (videoConfig.caching.method === 'cf') {
    if (videoConfig.caching.debug) {
      debug('CacheManagementService', 'Using cf object for caching, skipping explicit cache check', {
        url: request.url
      });
    }
    return null;
  }
  
  // Below is the original Cache API implementation
  try {
    // Get the default cache
    const cache = caches.default;
    
    // Try to find the response in the cache
    const cachedResponse = await cache.match(request);
    
    if (cachedResponse) {
      debug('CacheManagementService', 'Cache hit', {
        url: request.url,
        status: cachedResponse.status
      });
      return cachedResponse;
    }
    
    debug('CacheManagementService', 'Cache miss', {
      url: request.url
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
 * Check if a response should be cached or served fresh
 * 
 * @param request - The incoming request
 * @returns Boolean indicating if response should bypass cache
 */
export function shouldBypassCache(request: Request): boolean {
  // Check for no-cache directive in Cache-Control header
  const cacheControl = request.headers.get('Cache-Control');
  if (cacheControl && (
    cacheControl.includes('no-cache') || 
    cacheControl.includes('no-store') || 
    cacheControl.includes('max-age=0')
  )) {
    return true;
  }
  
  // Check for debug flag in URL parameters
  const url = new URL(request.url);
  if (url.searchParams.has('debug') || url.searchParams.has('nocache')) {
    return true;
  }
  
  // Default is to use cache
  return false;
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
  // Default cf object
  const cfObject: Record<string, unknown> = {};
  
  // If no cache config or should not cache, return empty cf object
  if (!cacheConfig || !cacheConfig.cacheability) {
    return cfObject;
  }
  
  // Use existing imported cache control utilities for consistency
  
  // Determine appropriate TTL based on status code using the shared utility
  const statusGroup = Math.floor(status / 100);
  const ttlMap: Record<number, keyof CacheConfig['ttl']> = {
    2: 'ok', // 200-299 status codes
    3: 'redirects', // 300-399 status codes
    4: 'clientError', // 400-499 status codes 
    5: 'serverError', // 500-599 status codes
  };
  
  const ttlProperty = ttlMap[statusGroup];
  const ttl = ttlProperty ? cacheConfig.ttl[ttlProperty] : 0;
  
  // Add caching parameters
  cfObject.cacheEverything = cacheConfig.cacheability;
  cfObject.cacheTtl = ttl;
  
  // Add cache tags if source is provided - use video-resizer prefix for consistency with tests
  if (source) {
    const tags = ['video-resizer'];
    tags.push(`source:${source}`);
    if (derivative) {
      tags.push(`derivative:${derivative}`);
    }
    cfObject.cacheTags = tags;
  }
  
  debug('CacheManagementService', 'Created cf object params for caching', {
    cacheEverything: cfObject.cacheEverything,
    cacheTtl: cfObject.cacheTtl,
    cacheTags: cfObject.cacheTags
  });
  
  return cfObject;
}
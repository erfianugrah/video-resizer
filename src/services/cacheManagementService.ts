/**
 * Service for managing cache behavior for video responses
 */
import { CacheConfig } from '../utils/cacheUtils';
import { debug } from '../utils/loggerUtils';

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
  
  // Determine appropriate TTL based on status code
  let ttl = 0;
  
  if (status >= 200 && status < 300) {
    // Success
    ttl = cacheConfig.ttl.ok;
  } else if (status >= 300 && status < 400) {
    // Redirection
    ttl = cacheConfig.ttl.redirects;
  } else if (status >= 400 && status < 500) {
    // Client error
    ttl = cacheConfig.ttl.clientError;
  } else {
    // Server error
    ttl = cacheConfig.ttl.serverError;
  }
  
  debug('CacheManagementService', 'Applying cache headers', {
    status,
    ttl,
    cacheability: cacheConfig.cacheability,
    source,
    derivative
  });
  
  // Apply cache headers
  if (cacheConfig.cacheability) {
    newHeaders.set('Cache-Control', `public, max-age=${ttl}`);
  } else {
    newHeaders.set('Cache-Control', 'no-store');
  }
  
  // Add cache tags if source is provided - important for purging through Cloudflare Cache API
  if (source) {
    let cacheTag = `video-resizer,source:${source}`;
    if (derivative) {
      cacheTag += `,derivative:${derivative}`;
    }
    newHeaders.set('Cache-Tag', cacheTag);
  }
  
  return new Response(response.body, responseInit);
}

/**
 * Store a response in the Cloudflare Cache API
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
 * Try to get a response from the Cloudflare Cache API
 * 
 * @param request - The request to check in cache
 * @returns Cached response or null if not found
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
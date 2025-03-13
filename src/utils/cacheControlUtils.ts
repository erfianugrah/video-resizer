/**
 * Utilities for managing cache control headers for videos
 */
import { CacheConfig } from './cacheUtils';

/**
 * Determine cache control header based on response status
 * @param status - HTTP status code
 * @param cache - Cache configuration
 * @returns Cache-Control header value
 */
export function determineCacheControl(status: number, cache?: CacheConfig): string {
  if (!cache || !cache.ttl) return '';

  const statusGroup = Math.floor(status / 100);

  // Map status groups to TTL properties
  const ttlMap: Record<number, keyof CacheConfig['ttl']> = {
    2: 'ok', // 200-299 status codes
    3: 'redirects', // 300-399 status codes
    4: 'clientError', // 400-499 status codes
    5: 'serverError', // 500-599 status codes
  };

  const ttlProperty = ttlMap[statusGroup];
  const ttl = ttlProperty ? cache.ttl[ttlProperty] : 0;

  return ttl ? `public, max-age=${ttl}` : '';
}

/**
 * Generate cache tag list for the video
 * @param source - Video source identifier (e.g., domain or bucket name)
 * @param derivative - Derivative type
 * @returns Array of cache tags
 */
export function generateCacheTags(source?: string, derivative?: string): string[] {
  const tags: string[] = ['video'];

  if (source) {
    tags.push(`source:${source}`);
  }

  if (derivative) {
    tags.push(`derivative:${derivative}`);
  }

  return tags;
}

/**
 * Apply cache control headers to a Response
 * @param response - The response to add cache headers to
 * @param status - The HTTP status code
 * @param cache - The cache configuration
 * @param source - Video source identifier
 * @param derivative - Derivative type
 * @returns Response with updated headers
 */
export function applyCacheHeaders(
  response: Response,
  status: number,
  cache?: CacheConfig,
  source?: string,
  derivative?: string
): Response {
  const cacheControl = determineCacheControl(status, cache);
  
  if (cacheControl) {
    response.headers.set('Cache-Control', cacheControl);
  }
  
  const cacheTags = generateCacheTags(source, derivative);
  if (cacheTags.length > 0) {
    response.headers.set('Cache-Tag', cacheTags.join(','));
  }
  
  return response;
}
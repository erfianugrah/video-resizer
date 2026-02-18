/**
 * Cache key builder for request coalescing
 *
 * Generates canonical cache keys that match the KV storage key format,
 * ensuring request coalescing works correctly with KV cache lookups.
 */

import { createCategoryLogger } from '../logger';

const logger = createCategoryLogger('CacheKeyBuilder');

/**
 * Build a canonical cache key for request coalescing.
 * This key must match the KV storage key format so that in-flight requests
 * are correctly deduplicated against cached entries.
 *
 * @param url - The parsed URL of the request
 * @param options - Transformation options (derivative, width, height, version, etc.)
 * @returns The canonical cache key string
 */
export function buildCoalescingCacheKey(url: URL, options?: Record<string, unknown>): string {
  const sourcePath = url.pathname;
  let cacheKey = `video:${sourcePath.replace(/^\//g, '')}`;

  if (options) {
    if (options.derivative) {
      cacheKey += `:derivative=${options.derivative}`;
    }

    // Add width/height parameters to cache key for proper request coalescing
    // This ensures requests with different dimensions don't share the same in-flight request
    if (options.width) {
      cacheKey += `:width=${options.width}`;
    }
    if (options.height) {
      cacheKey += `:height=${options.height}`;
    }

    // Add IMQuery parameters if present - these should match how KV keys are generated
    const imwidth = url.searchParams.get('imwidth');
    const imheight = url.searchParams.get('imheight');

    if (imwidth || imheight) {
      if (imwidth) {
        cacheKey += `:imwidth=${imwidth}`;
      }
      if (imheight) {
        cacheKey += `:imheight=${imheight}`;
      }
    }

    // Add version information to match KV key format
    cacheKey += `:v${options.version || 1}`;
  }

  // Debug info about the cache key
  logger.debug('Generated canonical cache key for request coalescing', {
    cacheKey,
    url: url.href,
    path: sourcePath,
    derivative: options?.derivative,
    width: options?.width,
    height: options?.height,
    imwidth: url.searchParams.get('imwidth'),
    imheight: url.searchParams.get('imheight'),
  });

  return cacheKey;
}

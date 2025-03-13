/**
 * Utilities for managing cache configuration for videos
 */
import { videoConfig } from '../config/videoConfig';

/**
 * Cache configuration interface
 */
export interface CacheConfig {
  cacheability: boolean;
  videoCompression: string;
  ttl: {
    ok: number;
    redirects: number;
    clientError: number;
    serverError: number;
  };
}

/**
 * Determine cache configuration based on URL
 * @param url - The full URL to check
 * @returns Cache configuration object
 */
export function determineCacheConfig(url: string): CacheConfig {
  // Default empty cache config
  const defaultCacheConfig: CacheConfig = {
    cacheability: false,
    videoCompression: 'off',
    ttl: {
      ok: 0,
      redirects: 0,
      clientError: 0,
      serverError: 0,
    },
  };

  // Prioritize specific patterns first
  // 1. Check for high traffic videos (popular)
  if (url.includes('/popular/') && url.endsWith('.mp4')) {
    return {
      cacheability: videoConfig.cache.highTraffic.cacheability,
      videoCompression: videoConfig.cache.highTraffic.videoCompression,
      ttl: videoConfig.cache.highTraffic.ttl,
    };
  }
  
  // 2. Check for short-form videos
  if (url.includes('/shorts/') && url.endsWith('.mp4')) {
    return {
      cacheability: videoConfig.cache.shortForm.cacheability,
      videoCompression: videoConfig.cache.shortForm.videoCompression,
      ttl: videoConfig.cache.shortForm.ttl,
    };
  }
  
  // 3. Check for live videos
  if (url.includes('/live/') && url.endsWith('.mp4')) {
    return {
      cacheability: videoConfig.cache.dynamic.cacheability,
      videoCompression: videoConfig.cache.dynamic.videoCompression,
      ttl: videoConfig.cache.dynamic.ttl,
    };
  }
  
  // 4. Default for any other video
  if (url.endsWith('.mp4') || url.endsWith('.mov') || url.endsWith('.webm')) {
    return {
      cacheability: videoConfig.cache.default.cacheability,
      videoCompression: videoConfig.cache.default.videoCompression,
      ttl: videoConfig.cache.default.ttl,
    };
  }

  // Return default empty config for non-video URLs
  return defaultCacheConfig;
}

/**
 * Determines if a response should be cached based on the configuration
 * @param config - The cache configuration
 * @returns boolean indicating if the response should be cached
 */
export function shouldCache(config: CacheConfig): boolean {
  return config?.cacheability === true;
}
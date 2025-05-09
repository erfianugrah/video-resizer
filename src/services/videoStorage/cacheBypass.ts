/**
 * Cache bypass utilities for the Video Storage Service
 */

import { tryOrDefault } from '../../utils/errorHandlingUtils';
import { CacheConfigurationManager } from '../../config';

/**
 * Implementation of shouldBypassCache that might throw errors
 * @param request - The incoming request
 * @returns Boolean indicating whether the cache should be bypassed
 */
function shouldBypassCacheImpl(request: Request): boolean {
  // Check for cache-control header
  const cacheControl = request.headers.get('Cache-Control');
  if (cacheControl && (cacheControl.includes('no-cache') || cacheControl.includes('no-store'))) {
    return true;
  }
  
  // Check for cache bypass in query params using centralized configuration
  const url = new URL(request.url);
  
  // Use the centralized shouldBypassCache method from CacheConfigurationManager
  // This only checks for specific bypass parameters, not all query parameters
  const cacheConfig = CacheConfigurationManager.getInstance();
  return cacheConfig.shouldBypassCache(url);
}

/**
 * Determine if a response should bypass cache based on configuration and request
 * Uses standardized error handling for consistent logging and to ensure a safe default
 * 
 * @param request - The incoming request
 * @returns Boolean indicating whether the cache should be bypassed
 */
export const shouldBypassCache = tryOrDefault<[Request], boolean>(
  shouldBypassCacheImpl,
  {
    functionName: 'shouldBypassCache',
    component: 'VideoStorageService',
    logErrors: true
  },
  false // Default to not bypassing cache if there's an error determining status
);
/**
 * Utilities for retrieving cached responses with range request support
 */
import { CacheConfigurationManager } from '../config';
import { getCurrentContext } from './legacyLoggerAdapter';
import { addBreadcrumb } from './requestContext';
import { logErrorWithContext, withErrorHandling } from './errorHandlingUtils';
import { parseRangeHeader, createUnsatisfiableRangeResponse } from './httpUtils';
import { createLogger, debug as pinoDebug, warn as pinoWarn } from './pinoLogger';

/**
 * Log a debug message with proper context handling
 */
function logDebug(message: string, data?: Record<string, unknown>): void {
  const requestContext = getCurrentContext();
  if (requestContext) {
    const logger = createLogger(requestContext);
    pinoDebug(requestContext, logger, 'CacheRetrievalUtils', message, data);
  } else {
    // Fall back to console as a last resort
    console.debug(`CacheRetrievalUtils: ${message}`, data || {});
  }
}

/**
 * Log a warning message with proper context handling
 */
function logWarn(message: string, data?: Record<string, unknown>): void {
  const requestContext = getCurrentContext();
  if (requestContext) {
    const logger = createLogger(requestContext);
    pinoWarn(requestContext, logger, 'CacheRetrievalUtils', message, data);
  } else {
    // Fall back to console as a last resort
    console.warn(`CacheRetrievalUtils: ${message}`, data || {});
  }
}

/**
 * This is a simplified version that no longer uses Cloudflare Cache API.
 * Instead, we'll exclusively use KV for caching (kvCacheUtils.ts).
 * 
 * This function is maintained for compatibility with existing code,
 * but now just returns null to indicate a cache miss, directing the flow
 * to check KV cache instead.
 * 
 * @param request - The incoming request to match in cache.
 * @returns Always returns null to direct flow to KV cache.
 */
export const getCachedResponse = withErrorHandling<
  [Request],
  Promise<Response | null>
>(
  async function getCachedResponseImpl(request: Request): Promise<Response | null> {
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
    
    // Check if this is a range request (for logging only)
    const isRangeRequest = request.headers.has('Range');
    const rangeHeader = request.headers.get('Range');
    
    // Add breadcrumb for cache result
    const requestContext = getCurrentContext();
    if (requestContext) {
      addBreadcrumb(requestContext, 'Cache', 'Cache API not used - using KV only', {
        url: request.url,
        isRangeRequest,
        rangeHeader: rangeHeader || undefined
      });
    }
    
    // Log that we're no longer using Cache API
    logDebug('Cache API no longer used - redirecting to KV cache', {
      url: request.url,
      isRangeRequest,
      rangeHeader: rangeHeader || undefined
    });
    
    // Always return null to indicate cache miss, directing flow to KV cache
    return null;
  },
  {
    functionName: 'getCachedResponse',
    component: 'CacheRetrievalUtils',
    logErrors: true
  },
  { component: 'Cache Retrieval' }
);
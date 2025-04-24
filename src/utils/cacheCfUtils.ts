/**
 * Utilities for working with Cloudflare's cf object parameters for caching
 */
import { CacheConfig } from './cacheUtils';
import { getCurrentContext } from './legacyLoggerAdapter';
import { tryOrNull } from './errorHandlingUtils';
import { createLogger, debug as pinoDebug } from './pinoLogger';
import { generateCacheTags } from '../services/videoStorageService';
import { getCacheableMimeTypes } from './cacheStorageUtils';

/**
 * Log a debug message with proper context handling
 */
function logDebug(message: string, data?: Record<string, unknown>): void {
  const requestContext = getCurrentContext();
  if (requestContext) {
    const logger = createLogger(requestContext);
    pinoDebug(requestContext, logger, 'CacheCfUtils', message, data);
  } else {
    // Fall back to console as a last resort
    console.debug(`CacheCfUtils: ${message}`, data || {});
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
export const createCfObjectParams = tryOrNull<
  [number, CacheConfig | null | undefined, string | undefined, string | undefined, string | undefined],
  Record<string, unknown>
>(
  function createCfObjectParamsImpl(
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
      const { videoMimeTypes, imageMimeTypes } = getCacheableMimeTypes();
      
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
      const tags = generateCacheTags(source, options, undefined);
      
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
      cacheability: cacheConfig?.cacheability
    });
    
    return cfObject;
  },
  {
    functionName: 'createCfObjectParams',
    component: 'CacheCfUtils',
    logErrors: true
  },
  {} // Empty default object if there's an error
);
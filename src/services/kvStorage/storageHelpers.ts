import { TransformationMetadata } from './interfaces';
import { generateCacheTags } from '../videoStorage/cacheTags';
import { getDerivativeDimensions } from '../../utils/imqueryUtils';
import { logDebug } from './logging';
import { getCurrentContext } from '../../utils/legacyLoggerAdapter';
import { addBreadcrumb } from '../../utils/requestContext';
import { logErrorWithContext } from '../../utils/errorHandlingUtils';
import { EnvVariables } from '../../config/environmentConfig';
import { storeCacheKeyVersion } from '../cacheVersionService';

/**
 * Helper function to create base metadata for KV storage
 */
export function createBaseMetadata(
  sourcePath: string,
  options: {
    mode?: string | null;
    width?: number | null;
    height?: number | null;
    format?: string | null;
    quality?: string | null;
    compression?: string | null;
    derivative?: string | null;
    duration?: number | string | null;
    fps?: number | null;
    time?: string | null;
    columns?: number | null;
    rows?: number | null;
    interval?: string | null;
    customData?: Record<string, unknown>;
  },
  contentType: string,
  contentLength: number,
  cacheVersion: number,
  ttl?: number
): TransformationMetadata {
  const metadata: TransformationMetadata = {
    sourcePath,
    mode: options.mode || 'video',
    format: options.format,
    quality: options.quality,
    compression: options.compression,
    derivative: options.derivative,
    cacheTags: generateCacheTags(sourcePath, options, new Headers({
      'Content-Type': contentType
    })),
    cacheVersion,
    contentType,
    contentLength,
    createdAt: Date.now(),
    duration: options.duration,
    fps: options.fps,
    // Add mode-specific metadata
    time: options.time,
    columns: options.columns,
    rows: options.rows,
    interval: options.interval,
    customData: {
      ...(options.customData || {})
    }
  };
  
  // When we have a derivative, use the actual derivative dimensions for width/height
  // but store the original requested dimensions in customData
  if (options.derivative) {
    // Use centralized helper to get derivative dimensions
    const derivativeDimensions = getDerivativeDimensions(options.derivative);
    
    if (derivativeDimensions) {
      metadata.width = derivativeDimensions.width;
      metadata.height = derivativeDimensions.height;
      
      // Store original requested dimensions in customData for reference
      metadata.customData = {
        ...metadata.customData,
        requestedWidth: options.width,
        requestedHeight: options.height
      };
    } else {
      // Fallback to the provided dimensions if derivative config not found
      metadata.width = options.width;
      metadata.height = options.height;
    }
  } else {
    // No derivative - use provided dimensions directly
    metadata.width = options.width;
    metadata.height = options.height;
  }
  
  // If TTL is provided, set expiresAt
  if (ttl) {
    metadata.expiresAt = Date.now() + (ttl * 1000);
  }
  
  return metadata;
}

/**
 * Helper function to store a KV value with retry logic
 */
export async function storeWithRetry(
  namespace: KVNamespace,
  key: string,
  value: ArrayBuffer | string,
  metadata: any,
  ttl?: number,
  useIndefiniteStorage = false
): Promise<boolean> {
  const maxRetries = 3;
  let attemptCount = 0;
  let success = false;
  let lastError: Error | null = null;
  
  while (attemptCount < maxRetries && !success) {
    try {
      attemptCount++;
      
      if (ttl && !useIndefiniteStorage) {
        // Normal case with TTL (when storeIndefinitely is false)
        await namespace.put(key, value, { metadata, expirationTtl: ttl });
      } else {
        // Store indefinitely without expirationTtl (or when ttl is not provided)
        await namespace.put(key, value, { metadata });
      }
      
      success = true;
      
      // Log retries if we needed more than one attempt
      if (attemptCount > 1) {
        logDebug('[STORE_VIDEO] KV put succeeded after retries', {
          key,
          attempts: attemptCount
        });
      }
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      const isRateLimitError = 
        lastError.message.includes('429') || 
        lastError.message.includes('409') || 
        lastError.message.includes('rate limit') ||
        lastError.message.includes('conflict');
      
      if (!isRateLimitError || attemptCount >= maxRetries) {
        // Either not a rate limit error or we've exhausted our retries
        logErrorWithContext(
          '[STORE_VIDEO] KV PUT failed', 
          lastError, 
          { key, attempts: attemptCount }, 
          'KVStorageService.store'
        );
        return false;
      }
      
      // Log the retry attempt
      logDebug('[STORE_VIDEO] KV rate limit hit, retrying with backoff', {
        key,
        attempt: attemptCount,
        maxRetries,
        error: lastError.message
      });
      
      // Add breadcrumb for retry operation
      const requestContext = getCurrentContext();
      if (requestContext) {
        addBreadcrumb(requestContext, 'KV', 'Retrying KV operation after rate limit', {
          key,
          attempt: attemptCount,
          maxRetries,
          error: lastError.message
        });
      }
      
      // Exponential backoff: 200ms, 400ms, 800ms, etc.
      const backoffMs = Math.min(200 * Math.pow(2, attemptCount - 1), 2000);
      await new Promise(resolve => setTimeout(resolve, backoffMs));
    }
  }
  
  return success;
}

/**
 * Helper function to handle version storage
 */
export async function handleVersionStorage(
  namespace: KVNamespace,
  key: string,
  cacheVersion: number,
  env?: EnvVariables,
  ttl?: number
): Promise<void> {
  // If env is provided but version isn't in options, ensure the version is stored in KV
  if (!env?.VIDEO_CACHE_KEY_VERSIONS) {
    return;
  }
  
  try {
    // Store the version with double the content TTL for persistence
    const versionTtl = ttl ? ttl * 2 : undefined;
    
    // Use waitUntil if available for non-blocking operation with retry
    if (env && 'executionCtx' in env && (env as any).executionCtx?.waitUntil) {
      (env as any).executionCtx.waitUntil(
        (async () => {
          const maxRetries = 3;
          let attemptCount = 0;
          let success = false;
          let lastError: Error | null = null;
          
          while (attemptCount < maxRetries && !success) {
            try {
              attemptCount++;
              await storeCacheKeyVersion(env, key, cacheVersion, versionTtl);
              success = true;
              
              // Only log if we needed retries
              if (attemptCount > 1) {
                logDebug('[STORE_VIDEO] Successfully stored cache version after retries', {
                  key,
                  cacheVersion,
                  attempts: attemptCount,
                  versionTtl: versionTtl !== undefined ? versionTtl : 'indefinite'
                });
              }
            } catch (err) {
              lastError = err instanceof Error ? err : new Error(String(err));
              const isRateLimitError = 
                lastError.message.includes('429') || 
                lastError.message.includes('409') || 
                lastError.message.includes('rate limit') ||
                lastError.message.includes('conflict');
              
              if (!isRateLimitError || attemptCount >= maxRetries) {
                logDebug('[STORE_VIDEO] Error storing cache version in KV', {
                  key,
                  cacheVersion,
                  error: lastError.message,
                  attempts: attemptCount
                });
                return; // Exit the async function within waitUntil
              }
              
              // Log the retry attempt
              logDebug('[STORE_VIDEO] KV rate limit hit during version storage, retrying with backoff', {
                key,
                attempt: attemptCount,
                maxRetries,
                error: lastError.message
              });
              
              // Exponential backoff: 200ms, 400ms, 800ms, etc.
              const backoffMs = Math.min(200 * Math.pow(2, attemptCount - 1), 2000);
              await new Promise(resolve => setTimeout(resolve, backoffMs));
            }
          }
        })()
      );
    } else if (env) { // Check that env exists before using it
      // Fallback to direct await with retry if executionCtx not available
      const maxRetries = 3;
      let attemptCount = 0;
      let success = false;
      let lastError: Error | null = null;
      
      while (attemptCount < maxRetries && !success) {
        try {
          attemptCount++;
          // options.env is guaranteed to be defined here
          await storeCacheKeyVersion(env, key, cacheVersion, versionTtl);
          success = true;
          
          // Only log if we needed retries
          if (attemptCount > 1) {
            logDebug('[STORE_VIDEO] Successfully stored cache version after retries (direct)', {
              key,
              cacheVersion,
              attempts: attemptCount,
              versionTtl: versionTtl !== undefined ? versionTtl : 'indefinite'
            });
          }
        } catch (err) {
          lastError = err instanceof Error ? err : new Error(String(err));
          const isRateLimitError = 
            lastError.message.includes('429') || 
            lastError.message.includes('409') || 
            lastError.message.includes('rate limit') ||
            lastError.message.includes('conflict');
          
          if (!isRateLimitError || attemptCount >= maxRetries) {
            // Log the error and break out
            logDebug('[STORE_VIDEO] Error storing cache version in KV (direct)', {
              key,
              cacheVersion,
              error: lastError.message,
              attempts: attemptCount
            });
            break; // Exit the loop but don't throw - version storage is not critical
          }
          
          // Log the retry attempt
          logDebug('[STORE_VIDEO] KV rate limit hit during version storage, retrying with backoff (direct)', {
            key,
            attempt: attemptCount,
            maxRetries,
            error: lastError.message
          });
          
          // Exponential backoff: 200ms, 400ms, 800ms, etc.
          const backoffMs = Math.min(200 * Math.pow(2, attemptCount - 1), 2000);
          await new Promise(resolve => setTimeout(resolve, backoffMs));
        }
      }
    }
    
    logDebug('[STORE_VIDEO] Stored cache version in KV', {
      key,
      cacheVersion,
      versionTtl: versionTtl !== undefined ? versionTtl : 'indefinite'
    });
  } catch (err) {
    // Log the error but continue - version storage is not critical for the content to be stored
    logDebug('[STORE_VIDEO] Error storing cache version in KV', {
      key,
      cacheVersion,
      error: err instanceof Error ? err.message : String(err)
    });
  }
}

/**
 * Helper function to log successful storage
 */
export function logStorageSuccess(
  key: string,
  size: number,
  ttl?: number,
  cacheVersion?: number,
  useIndefiniteStorage = false,
  isChunked = false
): void {
  // Log success
  logDebug('[STORE_VIDEO] Stored transformed video in KV', {
    key,
    size,
    ttl: useIndefiniteStorage ? 'indefinite (storeIndefinitely=true)' : (ttl || 'indefinite'),
    cacheVersion,
    isChunked
  });
  
  // Add breadcrumb for successful KV storage
  const requestContext = getCurrentContext();
  if (requestContext) {
    addBreadcrumb(requestContext, 'KV', 'Stored transformed video in KV', {
      key,
      size,
      ttl: useIndefiniteStorage ? 'indefinite (storeIndefinitely=true)' : (ttl || 'indefinite'),
      cacheVersion,
      isChunked
    });
    
    // Add version to diagnostics if available
    if (requestContext.diagnostics) {
      requestContext.diagnostics.cacheVersion = cacheVersion;
      requestContext.diagnostics.isChunked = isChunked;
    }
  }
}

/**
 * Helper function to create common response headers
 */
export function createCommonHeaders(metadata: TransformationMetadata, key: string): Headers {
  const headers = new Headers();
  
  // Always set Accept-Ranges header for video content to indicate range request support
  headers.set('Accept-Ranges', 'bytes');
  
  // Add Cache-Control header if expiresAt is set
  const now = Date.now();
  if (metadata.expiresAt) {
    const remainingTtl = Math.max(0, Math.floor((metadata.expiresAt - now) / 1000));
    headers.set('Cache-Control', `public, max-age=${remainingTtl}`);
  } else {
    // Get the cache configuration manager
    const { CacheConfigurationManager } = require('../../config');
    const cacheConfig = CacheConfigurationManager.getInstance();
    const ttl = cacheConfig.getConfig().defaultMaxAge;
    headers.set('Cache-Control', `public, max-age=${ttl}`);
  }
  
  // Add Cache-Tag header with the cache tags from metadata
  if (metadata.cacheTags && metadata.cacheTags.length > 0) {
    headers.set('Cache-Tag', metadata.cacheTags.join(','));
  }
  
  // Add detailed KV cache headers for debugging and monitoring
  const cacheAge = Math.floor((now - metadata.createdAt) / 1000);
  const cacheTtl = metadata.expiresAt ? Math.floor((metadata.expiresAt - now) / 1000) : 86400; // Default 24h
  
  headers.set('X-KV-Cache-Age', `${cacheAge}s`);
  headers.set('X-KV-Cache-TTL', `${cacheTtl}s`);
  headers.set('X-KV-Cache-Key', key);
  headers.set('X-Cache-Status', 'HIT');
  headers.set('X-Cache-Source', 'KV');
  
  // Add derivative information if available
  if (metadata.derivative) {
    headers.set('X-Video-Derivative', metadata.derivative);
  }
  
  // Set chunking information
  if (metadata.isChunked) {
    headers.set('X-Video-Chunked', 'true');
    if (metadata.actualTotalVideoSize) {
      headers.set('X-Video-Total-Size', metadata.actualTotalVideoSize.toString());
    }
  }
  
  return headers;
}
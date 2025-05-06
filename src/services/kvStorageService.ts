/**
 * KV Storage Service for video-resizer
 * 
 * This service provides functions for storing and retrieving transformed video variants in Cloudflare KV.
 * It supports storing both the video content and associated metadata, which can be used for cache invalidation.
 */

import { CacheConfigurationManager, VideoConfigurationManager } from '../config';
import { createLogger, debug as pinoDebug, error as pinoError } from '../utils/pinoLogger';
import { getCurrentContext } from '../utils/legacyLoggerAdapter';
import { addBreadcrumb } from '../utils/requestContext';
import { generateCacheTags } from './videoStorageService';
import { 
  logErrorWithContext, 
  withErrorHandling, 
  tryOrNull, 
  tryOrDefault 
} from '../utils/errorHandlingUtils';
import { getDerivativeDimensions } from '../utils/imqueryUtils';
import { 
  getCacheKeyVersion, 
  getNextCacheKeyVersion, 
  storeCacheKeyVersion 
} from './cacheVersionService';
import { 
  normalizeUrlForCaching, 
  addVersionToUrl, 
  getVersionFromUrl 
} from '../utils/urlVersionUtils';
import { checkAndRefreshTtl } from '../utils/kvTtlRefreshUtils';
import { EnvVariables } from '../config/environmentConfig';

/**
 * Helper functions for consistent logging throughout this file
 */
function logDebug(message: string, data?: Record<string, unknown>): void {
  const requestContext = getCurrentContext();
  if (requestContext) {
    const logger = createLogger(requestContext);
    pinoDebug(requestContext, logger, 'KVStorageService', message, data);
  } else {
    console.debug(`KVStorageService: ${message}`, data || {});
  }
}

/**
 * Interface for transformation metadata
 */
export interface TransformationMetadata {
  // Original source path
  sourcePath: string;
  // Transformation mode
  mode?: string;
  // Transformation parameters
  width?: number | null;
  height?: number | null;
  format?: string | null;
  quality?: string | null;
  compression?: string | null;
  derivative?: string | null;
  // Cache information
  cacheTags: string[];
  // Cache versioning
  cacheVersion?: number;
  // Content information
  contentType: string;
  contentLength: number;
  // Timestamps
  createdAt: number;
  expiresAt?: number;
  // Additional metadata
  duration?: number | string | null;  // Support both number and string for duration
  fps?: number | null;
  // Frame-specific metadata
  time?: string | null;
  // Spritesheet-specific metadata
  columns?: number | null;
  rows?: number | null;
  interval?: string | null;
  customData?: Record<string, unknown>;
}

/**
 * Internal implementation of generateKVKey that might throw exceptions
 * 
 * @param sourcePath - The original video source path
 * @param options - Transformation options
 * @returns A unique key for the KV store
 */
function generateKVKeyImpl(
  sourcePath: string,
  options: {
    mode?: string | null;
    width?: number | null;
    height?: number | null;
    format?: string | null;
    quality?: string | null;
    compression?: string | null;
    derivative?: string | null;
    time?: string | null;
    columns?: number | null;
    rows?: number | null;
    interval?: string | null;
    customData?: Record<string, unknown>;
  }
): string {
  // Remove leading slashes for consistency
  const normalizedPath = sourcePath.replace(/^\/+/, '');
  
  // Set default mode to 'video' if not specified
  const mode = options.mode || 'video';
  
  // Create a base key from the mode and path
  let key = `${mode}:${normalizedPath}`;
  
  // Always prefer derivative-based caching for better cache efficiency
  if (options.derivative) {
    // Derivative-based caching is the primary method for better cache utilization
    key += `:derivative=${options.derivative}`;
  } else {
    // Only use individual parameters if no derivative specified
    if (options.width) key += `:w=${options.width}`;
    if (options.height) key += `:h=${options.height}`;
    
    // Add mode-specific parameters
    if (mode === 'frame') {
      if (options.time) key += `:t=${options.time}`;
      if (options.format) key += `:f=${options.format}`;
    } else if (mode === 'spritesheet') {
      if (options.columns) key += `:cols=${options.columns}`;
      if (options.rows) key += `:rows=${options.rows}`;
      if (options.interval) key += `:interval=${options.interval}`;
    } else {
      // Video-specific parameters
      if (options.format) key += `:f=${options.format}`;
      if (options.quality) key += `:q=${options.quality}`;
      if (options.compression) key += `:c=${options.compression}`;
    }
  }
  
  // Store IMQuery information in metadata but not in the cache key
  // This allows requests with different imwidth values but same derivative to share cache
  
  // Only replace spaces and other truly invalid characters, preserving slashes and equals signs
  return key.replace(/[^\w:/=.*-]/g, '-');
}

/**
 * Generate a KV key for a transformed video variant
 * Handles errors by returning a fallback key
 * 
 * @param sourcePath - The original video source path
 * @param options - Transformation options
 * @returns A unique key for the KV store
 */
export const generateKVKey = tryOrDefault<
  [string, {
    mode?: string | null;
    width?: number | null;
    height?: number | null;
    format?: string | null;
    quality?: string | null;
    compression?: string | null;
    derivative?: string | null;
    time?: string | null;
    columns?: number | null;
    rows?: number | null;
    interval?: string | null;
    customData?: Record<string, unknown>;
  }],
  string
>(
  generateKVKeyImpl,
  {
    functionName: 'generateKVKey',
    component: 'KVStorageService',
    logErrors: true
  },
  'video:error:fallback-key' // Default fallback key if generation fails
);

/**
 * Implementation of storeTransformedVideo with proper error handling
 * 
 * @param namespace - The KV namespace to use
 * @param sourcePath - Original video path
 * @param response - The transformed video response
 * @param options - Transformation options used
 * @param ttl - Optional TTL in seconds
 * @returns Boolean indicating if storage was successful
 */
async function storeTransformedVideoImpl(
  namespace: KVNamespace,
  sourcePath: string,
  response: Response,
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
    version?: number; // Version from TransformationService
    env?: EnvVariables; // Add env for version operations
  },
  ttl?: number
): Promise<boolean> {
  // Clone the response to avoid consuming it
  const responseClone = response.clone();
  
  // Generate a key for this transformed variant using consistent format with = delimiter
  const key = generateKVKey(sourcePath, options);
  
  // Log key information for debugging
  logDebug('Generated KV cache key', {
    key,
    sourcePath,
    derivative: options.derivative,
    width: options.width,
    height: options.height,
    version: options.version || 1
  });
  
  // Use version from TransformationService if available, or default to 1
  let cacheVersion = options.version || 1;
  
  // Create metadata object
  const metadata: TransformationMetadata = {
    sourcePath,
    mode: options.mode || 'video',
    format: options.format,
    quality: options.quality,
    compression: options.compression,
    derivative: options.derivative,
    cacheTags: generateCacheTags(sourcePath, options, response.headers),
    cacheVersion, // Add version to metadata
    contentType: response.headers.get('Content-Type') || 'video/mp4',
    contentLength: parseInt(response.headers.get('Content-Length') || '0', 10),
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
  
  // Use ReadableStream instead of ArrayBuffer for better memory efficiency
  const responseStream = responseClone.body;
  
  if (!responseStream) {
    throw new Error('Response body is null or undefined');
  }
  
  // Create a PassThrough stream to capture the data for storage
  const { readable, writable } = new TransformStream();
  
  // Start piping the response to our transform stream
  // This doesn't block and immediately returns a promise
  const streamPromise = responseStream.pipeTo(writable);
  
  // Store the video data with metadata using retry with exponential backoff
  // This handles Cloudflare KV's rate limiting (1 write per second per key)
  const maxRetries = 3;
  let attemptCount = 0;
  let success = false;
  let lastError: Error | null = null;

  while (attemptCount < maxRetries && !success) {
    try {
      attemptCount++;
      
      if (ttl) {
        await namespace.put(key, readable, { metadata, expirationTtl: ttl });
      } else {
        await namespace.put(key, readable, { metadata });
      }
      
      // Wait for stream completion
      await streamPromise;
      
      success = true;
      
      // Log retries if we needed more than one attempt
      if (attemptCount > 1) {
        logDebug('KV put succeeded after retries', {
          key,
          attempts: attemptCount,
          size: metadata.contentLength
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
        throw lastError;
      }
      
      // Log the retry attempt
      logDebug('KV rate limit hit, retrying with backoff', {
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
  
  // If we still failed after all retries, throw the last error
  if (!success && lastError) {
    throw lastError;
  }
  
  // If env is provided but version isn't in options, ensure the version is stored in KV
  // This helps keep the version service and KV storage in sync
  if (options.env?.VIDEO_CACHE_KEY_VERSIONS && !options.version) {
    try {
      // Store the version with double the content TTL for persistence
      const versionTtl = ttl ? ttl * 2 : undefined;
      
      // Use waitUntil if available for non-blocking operation with retry
      if (options.env && 'executionCtx' in options.env && (options.env as any).executionCtx?.waitUntil) {
        (options.env as any).executionCtx.waitUntil(
          (async () => {
            const maxRetries = 3;
            let attemptCount = 0;
            let success = false;
            let lastError: Error | null = null;
            
            while (attemptCount < maxRetries && !success) {
              try {
                attemptCount++;
                await storeCacheKeyVersion(options.env, key, cacheVersion, versionTtl);
                success = true;
                
                // Only log if we needed retries
                if (attemptCount > 1) {
                  logDebug('Successfully stored cache version after retries', {
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
                  logDebug('Error storing cache version in KV', {
                    key,
                    cacheVersion,
                    error: lastError.message,
                    attempts: attemptCount
                  });
                  return; // Exit the async function within waitUntil
                }
                
                // Log the retry attempt
                logDebug('KV rate limit hit during version storage, retrying with backoff', {
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
      } else if (options.env) { // Check that env exists before using it
        // Fallback to direct await with retry if executionCtx not available
        const maxRetries = 3;
        let attemptCount = 0;
        let success = false;
        let lastError: Error | null = null;
        
        while (attemptCount < maxRetries && !success) {
          try {
            attemptCount++;
            // options.env is guaranteed to be defined here
            await storeCacheKeyVersion(options.env, key, cacheVersion, versionTtl);
            success = true;
            
            // Only log if we needed retries
            if (attemptCount > 1) {
              logDebug('Successfully stored cache version after retries (direct)', {
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
              logDebug('Error storing cache version in KV (direct)', {
                key,
                cacheVersion,
                error: lastError.message,
                attempts: attemptCount
              });
              break; // Exit the loop but don't throw - version storage is not critical
            }
            
            // Log the retry attempt
            logDebug('KV rate limit hit during version storage, retrying with backoff (direct)', {
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
      
      logDebug('Stored cache version in KV', {
        key,
        cacheVersion,
        versionTtl: versionTtl !== undefined ? versionTtl : 'indefinite'
      });
    } catch (err) {
      // Log the error but continue - version storage is not critical for the content to be stored
      logDebug('Error storing cache version in KV', {
        key,
        cacheVersion,
        error: err instanceof Error ? err.message : String(err)
      });
    }
  }
  
  // Log success
  logDebug('Stored transformed video in KV', {
    key,
    size: metadata.contentLength,
    ttl: ttl || 'indefinite',
    cacheVersion
  });
  
  // Add breadcrumb for successful KV storage
  const requestContext = getCurrentContext();
  if (requestContext) {
    addBreadcrumb(requestContext, 'KV', 'Stored transformed video in KV', {
      key,
      contentType: metadata.contentType,
      contentLength: metadata.contentLength,
      ttl: ttl || 'indefinite',
      cacheVersion
    });
    
    // Add version to diagnostics if available
    if (requestContext.diagnostics) {
      requestContext.diagnostics.cacheVersion = cacheVersion;
    }
  }
  
  return true;
}

/**
 * Store a transformed video in KV storage
 * This function is wrapped with error handling to ensure consistent error logging
 * and fail gracefully when KV operations encounter issues
 * 
 * @param namespace - The KV namespace to use
 * @param sourcePath - Original video path
 * @param response - The transformed video response
 * @param options - Transformation options used
 * @param ttl - Optional TTL in seconds
 * @returns Boolean indicating if storage was successful
 */
export const storeTransformedVideo = withErrorHandling<
  [
    KVNamespace,
    string,
    Response,
    {
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
      version?: number; // Version from TransformationService
      env?: EnvVariables; // Environment variables for versioning
    },
    number | undefined
  ],
  Promise<boolean>
>(
  async function storeTransformedVideoWrapper(
    namespace,
    sourcePath,
    response,
    options,
    ttl?
  ): Promise<boolean> {
    try {
      return await storeTransformedVideoImpl(namespace, sourcePath, response, options, ttl);
    } catch (err) {
      // Add breadcrumb for KV storage error
      const requestContext = getCurrentContext();
      if (requestContext) {
        addBreadcrumb(requestContext, 'Error', 'Failed to store in KV', {
          sourcePath,
          error: err instanceof Error ? err.message : 'Unknown error',
          severity: 'medium'
        });
      }
      return false;
    }
  },
  {
    functionName: 'storeTransformedVideo',
    component: 'KVStorageService',
    logErrors: true
  },
  { operationType: 'write' }
);

/**
 * Implementation for retrieving a transformed video from KV storage
 * 
 * @param namespace - The KV namespace to use
 * @param sourcePath - Original video path
 * @param options - Transformation options
 * @param request - Optional request object for range request support
 * @returns The stored video response or null if not found
 */
async function getTransformedVideoImpl(
  namespace: KVNamespace,
  sourcePath: string,
  options: {
    mode?: string | null;
    width?: number | null;
    height?: number | null;
    format?: string | null;
    quality?: string | null;
    compression?: string | null;
    derivative?: string | null;
    time?: string | null;
    columns?: number | null;
    rows?: number | null;
    interval?: string | null;
    version?: number; // Version from TransformationService
    env?: EnvVariables; // Environment variables for versioning
  },
  request?: Request // Add request parameter for range support
): Promise<{ response: Response; metadata: TransformationMetadata } | null> {
  // Generate a key for this transformed variant using consistent format with = delimiter
  const key = generateKVKey(sourcePath, options);
  
  // Log lookup key for debugging
  logDebug('Looking up KV cache with key', {
    key,
    sourcePath,
    derivative: options.derivative,
    width: options.width,
    height: options.height,
    version: options.version,
    hasRangeRequest: request?.headers.has('Range')
  });
  
  // Check if the key exists in KV
  // For video content, request as a stream to improve memory efficiency
  const { value, metadata } = await namespace.getWithMetadata<TransformationMetadata>(key, 'stream');
  
  if (!value || !metadata) {
    logDebug('Transformed video not found in KV', { key });
    
    // Increment version on cache miss if env is provided
    if (options.env?.VIDEO_CACHE_KEY_VERSIONS) {
      try {
        // Force increment on cache miss
        const nextVersion = await getNextCacheKeyVersion(options.env, key, true);
        
        // Calculate a reasonable TTL (will be overwritten when content is stored)
        const cacheConfig = CacheConfigurationManager.getInstance();
        const versionTtl = (cacheConfig.getConfig().defaultMaxAge || 300) * 2;
        
        // Store updated version in background if possible, with retry logic
        if (options.env && 'executionCtx' in options.env && (options.env as any).executionCtx?.waitUntil) {
          (options.env as any).executionCtx.waitUntil(
            (async () => {
              const maxRetries = 3;
              let attemptCount = 0;
              let success = false;
              let lastError: Error | null = null;
              
              while (attemptCount < maxRetries && !success) {
                try {
                  attemptCount++;
                  await storeCacheKeyVersion(options.env, key, nextVersion, versionTtl);
                  success = true;
                  
                  // Only log if we needed retries
                  if (attemptCount > 1) {
                    logDebug('Successfully incremented version on cache miss after retries', {
                      key,
                      previousVersion: nextVersion - 1,
                      nextVersion,
                      attempts: attemptCount,
                      ttl: versionTtl
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
                    logDebug('Error incrementing version on cache miss', {
                      key,
                      error: lastError.message,
                      attempts: attemptCount
                    });
                    return; // Exit the async function within waitUntil
                  }
                  
                  // Log the retry attempt
                  logDebug('KV rate limit hit during version increment, retrying with backoff', {
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
        } else if (options.env) { // Check that env exists before using it
          // Fall back to direct storage with retry logic
          const maxRetries = 3;
          let attemptCount = 0;
          let success = false;
          let lastError: Error | null = null;
          
          while (attemptCount < maxRetries && !success) {
            try {
              attemptCount++;
              // options.env is guaranteed to be defined here
              await storeCacheKeyVersion(options.env, key, nextVersion, versionTtl);
              success = true;
              
              // Only log if we needed retries
              if (attemptCount > 1) {
                logDebug('Successfully incremented version on cache miss after retries (direct)', {
                  key,
                  previousVersion: nextVersion - 1,
                  nextVersion,
                  attempts: attemptCount,
                  ttl: versionTtl
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
                logDebug('Error incrementing version on cache miss (direct)', {
                  key,
                  error: lastError.message,
                  attempts: attemptCount
                });
                break; // Exit the loop but don't throw - version storage is not critical
              }
              
              // Log the retry attempt
              logDebug('KV rate limit hit during version increment, retrying with backoff (direct)', {
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
        
        logDebug('Incremented version on cache miss', {
          key,
          previousVersion: nextVersion - 1,
          nextVersion,
          ttl: versionTtl
        });
      } catch (err) {
        // Log error but continue - version incrementation is not critical for get operations
        logDebug('Error incrementing version on cache miss', {
          key,
          error: err instanceof Error ? err.message : String(err)
        });
      }
    }
    
    return null;
  }
  
  // Create headers for the response
  const headers = new Headers();
  headers.set('Content-Type', metadata.contentType);
  
  // Always set Accept-Ranges header for video content to indicate range request support
  headers.set('Accept-Ranges', 'bytes');
  
  // Add Cache-Control header if expiresAt is set
  const now = Date.now();
  if (metadata.expiresAt) {
    const remainingTtl = Math.max(0, Math.floor((metadata.expiresAt - now) / 1000));
    headers.set('Cache-Control', `public, max-age=${remainingTtl}`);
  } else {
    // Get the cache configuration manager
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
  
  // Add version information to headers if available
  // Get version from metadata, options, or default to 1
  let cacheVersion = metadata.cacheVersion || options.version || 1;
  
  // If we have a cache version, add it to headers
  if (cacheVersion) {
    headers.set('X-Cache-Version', cacheVersion.toString());
  }
  
  // Add derivative and other option information for analytics
  if (options.derivative) {
    headers.set('X-Video-Derivative', options.derivative);
  }
  if (options.quality) {
    headers.set('X-Video-Quality', options.quality);
  }
  
  let response: Response;
  
  // Check for range request and handle it if present
  if (request && request.headers.has('Range')) {
    try {
      // Dynamically import httpUtils to avoid potential circular dependencies
      const { parseRangeHeader, createUnsatisfiableRangeResponse } = await import('../utils/httpUtils');
      
      const rangeHeader = request.headers.get('Range');
      // For streams, we need to use the metadata.contentLength since we don't have value.byteLength
      const totalSize = metadata.contentLength;
      
      // Log detailed information about the range request
      logDebug('Processing range request from KV cache', { 
        key,
        range: rangeHeader,
        totalSize,
        contentType: metadata.contentType,
        url: request.url,
        cacheVersion
      });
      
      const range = parseRangeHeader(rangeHeader, totalSize);
      
      if (range) {
        // Valid range request - create a 206 Partial Content response with streams
        const rangeHeaders = new Headers(headers);
        rangeHeaders.set('Content-Range', `bytes ${range.start}-${range.end}/${range.total}`);
        rangeHeaders.set('Content-Length', (range.end - range.start + 1).toString());
        
        // Add debug headers to verify range handling
        rangeHeaders.set('X-Range-Handled-By', 'KV-Cache-Stream');
        rangeHeaders.set('X-Range-Request', rangeHeader || '');
        rangeHeaders.set('X-Range-Bytes', `${range.start}-${range.end}/${range.total}`);
        
        // Create a TransformStream that will extract the requested range
        const { readable, writable } = new TransformStream();
        
        // Stream processing in background
        const processStream = async () => {
          try {
            // Create a stream reader and writer
            const reader = value.getReader();
            const writer = writable.getWriter();
            
            let bytesRead = 0;
            let bytesWritten = 0;
            
            // Process the stream
            while (true) {
              const { done, value: chunk } = await reader.read();
              
              if (done) break;
              
              // Find overlapping bytes with our range
              if (chunk) {
                const chunkSize = chunk.byteLength;
                const chunkStart = bytesRead;
                const chunkEnd = bytesRead + chunkSize - 1;
                
                // Check if this chunk overlaps with our range
                if (chunkEnd >= range.start && chunkStart <= range.end) {
                  // Calculate the portion of this chunk to include
                  const startOffset = Math.max(0, range.start - chunkStart);
                  const endOffset = Math.min(chunkSize, range.end - chunkStart + 1);
                  
                  // Extract the relevant portion
                  const relevantPortion = chunk.slice(startOffset, endOffset);
                  
                  // Write to output stream
                  await writer.write(relevantPortion);
                  bytesWritten += relevantPortion.byteLength;
                }
                
                // Track total bytes processed
                bytesRead += chunkSize;
                
                // If we've gone past our range, we can stop
                if (bytesRead > range.end) break;
              }
            }
            
            // Close the writer
            await writer.close();
            
            logDebug('Completed streaming range request', {
              bytesRead,
              bytesWritten,
              expectedBytes: range.end - range.start + 1
            });
            
          } catch (error) {
            logDebug('Error processing stream for range request', {
              error: error instanceof Error ? error.message : String(error)
            });
            // Attempt to close the stream on error
            writable.abort(error);
          }
        };
        
        // Start processing in background
        void processStream();
        
        logDebug('Serving ranged response from KV cache with streaming', { 
          key,
          range: rangeHeader,
          start: range.start,
          end: range.end,
          total: range.total,
          bytesSent: range.end - range.start + 1,
          cacheVersion
        });
        
        // Add breadcrumb for range response
        const requestContext = getCurrentContext();
        if (requestContext) {
          addBreadcrumb(requestContext, 'KV', 'Serving partial content from KV cache with streams', {
            key,
            contentRange: `bytes ${range.start}-${range.end}/${range.total}`,
            contentLength: range.end - range.start + 1,
            age: cacheAge + 's',
            rangeRequest: rangeHeader || '',
            cacheVersion
          });
          
          // Add diagnostic information to request context
          if (!requestContext.diagnostics) {
            requestContext.diagnostics = {};
          }
          
          requestContext.diagnostics.rangeRequest = {
            header: rangeHeader,
            start: range.start,
            end: range.end,
            total: range.total,
            bytes: range.end - range.start + 1,
            source: 'kv-cache-stream'
          };
          
          // Add version to diagnostics
          requestContext.diagnostics.cacheVersion = cacheVersion;
        }
        
        response = new Response(readable, { 
          status: 206, 
          statusText: 'Partial Content',
          headers: rangeHeaders 
        });
      } else {
        // Invalid or unsatisfiable range - return 416
        logDebug('Unsatisfiable range requested for KV cached item', {
          key,
          range: rangeHeader,
          totalSize,
          contentType: metadata.contentType,
          cacheVersion
        });
        
        // Add breadcrumb for unsatisfiable range
        const requestContext = getCurrentContext();
        if (requestContext) {
          addBreadcrumb(requestContext, 'KV', 'Unsatisfiable range requested', {
            key,
            contentType: metadata.contentType,
            totalSize,
            range: rangeHeader,
            cacheVersion
          });
          
          // Add diagnostic information to request context
          if (!requestContext.diagnostics) {
            requestContext.diagnostics = {};
          }
          
          requestContext.diagnostics.rangeRequest = {
            header: rangeHeader,
            error: 'unsatisfiable',
            total: totalSize,
            source: 'kv-cache-stream'
          };
          
          // Add version to diagnostics
          requestContext.diagnostics.cacheVersion = cacheVersion;
        }
        
        response = createUnsatisfiableRangeResponse(totalSize);
      }
    } catch (err) {
      logDebug('Error processing range request, falling back to full response', {
        key,
        error: err instanceof Error ? err.message : String(err),
        range: request.headers.get('Range'),
        cacheVersion
      });
      
      // Add error to diagnostics
      const requestContext = getCurrentContext();
      if (requestContext) {
        addBreadcrumb(requestContext, 'Error', 'Range processing error in KV cache', {
          key,
          error: err instanceof Error ? err.message : 'Unknown error',
          range: request.headers.get('Range'),
          cacheVersion
        });
        
        // Add diagnostic information to request context
        if (!requestContext.diagnostics) {
          requestContext.diagnostics = {};
        }
        
        requestContext.diagnostics.rangeRequest = {
          header: request.headers.get('Range'),
          error: err instanceof Error ? err.message : 'Unknown error',
          source: 'kv-cache'
        };
        
        // Add version to diagnostics
        requestContext.diagnostics.cacheVersion = cacheVersion;
      }
      
      // Fall back to sending full response
      headers.set('Content-Length', metadata.contentLength.toString());
      response = new Response(value, { headers });
    }
  } else {
    // Not a range request - create a standard response with the stream
    headers.set('Content-Length', metadata.contentLength.toString());
    response = new Response(value, { headers });
  }
  
  // Log success
  logDebug('Retrieved transformed video from KV', {
    key,
    size: metadata.contentLength,
    age: Math.floor((Date.now() - metadata.createdAt) / 1000) + 's',
    status: response.status,
    isRanged: response.status === 206,
    cacheVersion
  });
  
  // Add breadcrumb for successful KV retrieval
  const requestContext = getCurrentContext();
  if (requestContext) {
    addBreadcrumb(requestContext, 'KV', 'Retrieved transformed video from KV', {
      key,
      contentType: metadata.contentType,
      contentLength: metadata.contentLength,
      age: Math.floor((Date.now() - metadata.createdAt) / 1000) + 's',
      status: response.status,
      cacheVersion
    });
    
    // Add version to diagnostics
    if (requestContext.diagnostics) {
      requestContext.diagnostics.cacheVersion = cacheVersion;
    }
    
    // Refresh TTL on cache hit using optimized TTL refresh utilities
    // This extends the expiration time for frequently accessed content
    if (requestContext.executionContext) {
      // Use the new optimized TTL refresh mechanism which avoids re-storing the entire value
      checkAndRefreshTtl(
        namespace,
        key,
        metadata,
        options.env,
        requestContext.executionContext
      ).catch(err => {
        // Log any errors but don't fail the response
        logDebug('Error during TTL refresh', {
          key,
          error: err instanceof Error ? err.message : String(err)
        });
      });
    }
  }
  
  return { response, metadata };
}

/**
 * Retrieve a transformed video from KV storage
 * Uses standardized error handling for robust error handling and logging
 * 
 * @param namespace - The KV namespace to use
 * @param sourcePath - Original video path
 * @param options - Transformation options
 * @param request - Optional request object for range request support
 * @returns The stored video response or null if not found
 */
export const getTransformedVideo = withErrorHandling<
  [
    KVNamespace,
    string,
    {
      mode?: string | null;
      width?: number | null;
      height?: number | null;
      format?: string | null;
      quality?: string | null;
      compression?: string | null;
      derivative?: string | null;
      time?: string | null;
      columns?: number | null;
      rows?: number | null;
      interval?: string | null;
      version?: number; // Version from TransformationService
      env?: EnvVariables; // Environment variables for versioning
    },
    Request | undefined // Add optional request parameter
  ],
  Promise<{ response: Response; metadata: TransformationMetadata } | null>
>(
  async function getTransformedVideoWrapper(
    namespace,
    sourcePath,
    options,
    request // Add request parameter
  ): Promise<{ response: Response; metadata: TransformationMetadata } | null> {
    try {
      // Pass request to the implementation
      return await getTransformedVideoImpl(namespace, sourcePath, options, request);
    } catch (err) {
      // Add breadcrumb for KV retrieval error
      const requestContext = getCurrentContext();
      if (requestContext) {
        addBreadcrumb(requestContext, 'Error', 'Failed to retrieve from KV', {
          sourcePath,
          error: err instanceof Error ? err.message : 'Unknown error',
          severity: 'medium'
        });
      }
      
      // Increment version on error if env is provided
      // This ensures cache busting occurs on errors
      if (options.env?.VIDEO_CACHE_KEY_VERSIONS) {
        try {
          const key = generateKVKey(sourcePath, options);
          
          // Force increment on error
          const nextVersion = await getNextCacheKeyVersion(options.env, key, true);
          
          // Calculate TTL - use double the default for persistence
          const cacheConfig = CacheConfigurationManager.getInstance();
          const versionTtl = (cacheConfig.getConfig().defaultMaxAge || 300) * 2;
          
          // Store updated version in background if possible, with retry logic
          if (options.env && 'executionCtx' in options.env && (options.env as any).executionCtx?.waitUntil) {
            (options.env as any).executionCtx.waitUntil(
              (async () => {
                const maxRetries = 3;
                let attemptCount = 0;
                let success = false;
                let lastError: Error | null = null;
                
                while (attemptCount < maxRetries && !success) {
                  try {
                    attemptCount++;
                    await storeCacheKeyVersion(options.env, key, nextVersion, versionTtl);
                    success = true;
                    
                    // Only log if we needed retries
                    if (attemptCount > 1) {
                      logDebug('Successfully incremented version on KV retrieval error after retries (background)', {
                        key,
                        previousVersion: nextVersion - 1,
                        nextVersion,
                        attempts: attemptCount,
                        ttl: versionTtl
                      });
                    } else {
                      logDebug('Incremented version on KV retrieval error (background)', {
                        key,
                        previousVersion: nextVersion - 1,
                        nextVersion,
                        ttl: versionTtl
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
                      logDebug('Error incrementing version on KV retrieval error (background)', {
                        key,
                        error: lastError.message,
                        attempts: attemptCount
                      });
                      return; // Exit the async function within waitUntil
                    }
                    
                    // Log the retry attempt
                    logDebug('KV rate limit hit during error version increment, retrying with backoff (background)', {
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
          } else if (options.env) { // Check that env exists before using it
            // Fall back to direct storage with retry logic
            const maxRetries = 3;
            let attemptCount = 0;
            let success = false;
            let lastError: Error | null = null;
            
            while (attemptCount < maxRetries && !success) {
              try {
                attemptCount++;
                // options.env is guaranteed to be defined here
                await storeCacheKeyVersion(options.env, key, nextVersion, versionTtl);
                success = true;
                
                // Only log if we needed retries
                if (attemptCount > 1) {
                  logDebug('Successfully incremented version on KV retrieval error after retries (direct)', {
                    key,
                    previousVersion: nextVersion - 1,
                    nextVersion,
                    attempts: attemptCount,
                    ttl: versionTtl
                  });
                } else {
                  logDebug('Incremented version on KV retrieval error (direct)', {
                    key,
                    previousVersion: nextVersion - 1,
                    nextVersion,
                    ttl: versionTtl
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
                  logDebug('Error incrementing version on KV retrieval error (direct)', {
                    key,
                    error: lastError.message,
                    attempts: attemptCount
                  });
                  break; // Exit the loop but don't throw - version storage is not critical
                }
                
                // Log the retry attempt
                logDebug('KV rate limit hit during error version increment, retrying with backoff (direct)', {
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
        } catch (versionErr) {
          // Log error but continue - version incrementation is not critical
          logDebug('Error incrementing version on KV retrieval error', {
            sourcePath,
            error: versionErr instanceof Error ? versionErr.message : String(versionErr)
          });
        }
      }
      
      // Log via standardized error handling but return null to allow fallback to origin
      logErrorWithContext(
        'Failed to retrieve transformed video from KV',
        err,
        {
          sourcePath,
          options,
          hasRangeRequest: request?.headers.has('Range'),
          key: generateKVKey(sourcePath, options),
          version: options.version
        },
        'KVStorageService'
      );
      
      return null;
    }
  },
  {
    functionName: 'getTransformedVideo',
    component: 'KVStorageService',
    logErrors: true
  },
  { operationType: 'read' }
);

/**
 * Implementation for listing all transformed variants of a source video
 * 
 * @param namespace - The KV namespace to use
 * @param sourcePath - Original video path
 * @param env - Optional environment variables for version lookup
 * @returns Array of keys and their metadata
 */
async function listVariantsImpl(
  namespace: KVNamespace,
  sourcePath: string,
  env?: EnvVariables
): Promise<{ key: string; metadata: TransformationMetadata }[]> {
  // Normalize the path
  const normalizedPath = sourcePath.replace(/^\/+/, '');
  
  // When listing by path in our pattern format, we need a better matching strategy
  // We need to find keys matching our pattern where path is part of key
  // First, get all keys that might match by listing all keys
  // We don't use a specific prefix to ensure we get all keys with our path
  const keys = await namespace.list();
  
  // Get metadata for each key
  const variants: { key: string; metadata: TransformationMetadata }[] = [];
  
  for (const key of keys.keys) {
    // Process any key that contains this normalized path
    // This will include all transformation modes (video, frame, spritesheet)
    // The key format will be [mode]:[path]:[params]
    if (key.name.includes(`:${normalizedPath}:`)) {
      const { metadata } = await namespace.getWithMetadata<TransformationMetadata>(key.name);
      
      if (metadata) {
        // If env is provided and the KV version binding exists,
        // try to get the latest version for this key
        if (env?.VIDEO_CACHE_KEY_VERSIONS && !metadata.cacheVersion) {
          try {
            // Get the current version - don't increment
            const currentVersion = await getCacheKeyVersion(env, key.name);
            
            // Add version to metadata if found
            if (currentVersion !== null) {
              metadata.cacheVersion = currentVersion;
              
              logDebug('Added version info to variant metadata', {
                key: key.name,
                version: currentVersion
              });
            }
          } catch (err) {
            // Log error but continue
            logDebug('Error retrieving version for variant', {
              key: key.name,
              error: err instanceof Error ? err.message : String(err)
            });
          }
        }
        
        variants.push({ key: key.name, metadata });
      }
    }
  }
  
  // Log success
  logDebug('Listed video variants', {
    sourcePath,
    variantCount: variants.length,
    hasVersions: variants.some(v => v.metadata.cacheVersion !== undefined)
  });
  
  return variants;
}

/**
 * List all transformed variants of a source video
 * Uses standardized error handling to ensure consistent logging and fallback behavior
 * 
 * @param namespace - The KV namespace to use
 * @param sourcePath - Original video path
 * @param env - Optional environment variables for version lookup
 * @returns Array of keys and their metadata, or empty array on error
 */
export const listVariants = withErrorHandling<
  [KVNamespace, string, EnvVariables?],
  Promise<{ key: string; metadata: TransformationMetadata }[]>
>(
  async function listVariantsWrapper(
    namespace,
    sourcePath,
    env
  ): Promise<{ key: string; metadata: TransformationMetadata }[]> {
    try {
      return await listVariantsImpl(namespace, sourcePath, env);
    } catch (err) {
      // Log via standardized error handling but return empty array
      logErrorWithContext(
        'Failed to list video variants',
        err,
        { 
          sourcePath,
          hasVersionKv: !!env?.VIDEO_CACHE_KEY_VERSIONS
        },
        'KVStorageService'
      );
      
      // Return empty array as fallback
      return [];
    }
  },
  {
    functionName: 'listVariants',
    component: 'KVStorageService',
    logErrors: true
  },
  { operationType: 'list' }
);
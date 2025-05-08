/**
 * KV Storage Service for video-resizer
 * 
 * This service provides functions for storing and retrieving transformed video variants in Cloudflare KV.
 * It supports storing both the video content and associated metadata, which can be used for cache invalidation.
 * 
 * Features:
 * - Standard KV storage for videos under size limit
 * - Chunked storage for larger videos with data integrity verification
 * - Range request support for streaming video content
 * - TTL refresh for frequently accessed content
 * - Cache versioning for cache invalidation
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
 * Constants for chunking configuration
 */
// Maximum size for a single KV entry (20 MiB is conservative for 25MiB KV value limit)
const MAX_VIDEO_SIZE_FOR_SINGLE_KV_ENTRY = 20 * 1024 * 1024; 
// Standard chunk size for large videos (5 MiB ensures chunks are well below KV limits)
const STANDARD_CHUNK_SIZE = 5 * 1024 * 1024; 
// KV read cache TTL (1 hour edge cache for KV reads)
const DEFAULT_KV_READ_CACHE_TTL = 60 * 60;

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
 * Helper function for logging chunk-specific operations
 */
function logChunkDebug(operation: 'store' | 'retrieve', message: string, data?: Record<string, unknown>): void {
  const prefix = operation === 'store' ? '[STORE_VIDEO CHUNK]' : '[GET_VIDEO CHUNK]';
  logDebug(`${prefix} ${message}`, data);
}

/**
 * Helper function to log data integrity verification events
 */
function logIntegrityCheck(operation: 'store' | 'retrieve', key: string, expected: number, actual: number, success: boolean): void {
  const prefix = operation === 'store' ? '[STORE_VIDEO INTEGRITY]' : '[GET_VIDEO INTEGRITY]';
  const status = success ? 'PASSED' : 'FAILED';
  
  logDebug(`${prefix} ${status} for ${key}`, {
    expected,
    actual,
    operation,
    mismatch: !success,
    difference: actual - expected
  });
  
  // Log critical error if integrity check failed
  if (!success) {
    const errorMsg = `Size mismatch for ${key}. Expected: ${expected}, Actual: ${actual}`;
    logErrorWithContext(
      `${prefix} ${errorMsg}`, 
      new Error('Data integrity violation'),
      { key, expected, actual },
      'KVStorageService'
    );
  }
}

/**
 * Helper function to determine if chunking should be used based on content size
 */
function shouldUseChunking(contentSize: number): boolean {
  // Use chunking if the content size exceeds the maximum size for a single KV entry
  return contentSize > MAX_VIDEO_SIZE_FOR_SINGLE_KV_ENTRY;
}

/**
 * Helper function to calculate the estimated number of chunks needed
 */
function calculateChunkCount(totalSize: number): number {
  if (totalSize <= MAX_VIDEO_SIZE_FOR_SINGLE_KV_ENTRY) {
    return 1; // Single entry, no chunking needed
  }
  
  // Calculate the number of chunks needed (rounding up)
  return Math.ceil(totalSize / STANDARD_CHUNK_SIZE);
}

/**
 * Interface for chunking manifest data
 * This structure defines how large videos are split into chunks
 * and contains the necessary information to reconstruct the original video
 */
export interface ChunkManifest {
  // Total size of the video in bytes (sum of all actualChunkSizes)
  totalSize: number;
  // Number of chunks the video is split into
  chunkCount: number;
  // Array of exact byte lengths for each chunk as measured during storage
  actualChunkSizes: number[];
  // The target size for most chunks (STANDARD_CHUNK_SIZE)
  standardChunkSize: number;
  // Original content type of the video
  originalContentType: string;
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
  
  // Chunking-specific fields
  // Flag indicating if the video is stored as chunks
  isChunked?: boolean;
  // Actual total size of the video content (for both chunked and non-chunked)
  actualTotalVideoSize?: number;
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
 * Generate a chunk key for a specific chunk index
 * 
 * @param baseKey - The base KV key for the video
 * @param chunkIndex - The index of the chunk 
 * @returns A unique key for this specific chunk
 */
function generateChunkKey(baseKey: string, chunkIndex: number): string {
  return `${baseKey}_chunk_${chunkIndex}`;
}

/**
 * Extract the base key from a chunk key
 * 
 * @param chunkKey - The full chunk key
 * @returns The base key portion, or null if not a valid chunk key
 */
function extractBaseKeyFromChunkKey(chunkKey: string): string | null {
  const chunkKeyPattern = /^(.+)_chunk_\d+$/;
  const match = chunkKey.match(chunkKeyPattern);
  
  if (match && match[1]) {
    return match[1];
  }
  
  return null;
}

/**
 * Extract the chunk index from a chunk key
 * 
 * @param chunkKey - The full chunk key
 * @returns The chunk index, or -1 if not a valid chunk key
 */
function extractChunkIndex(chunkKey: string): number {
  const chunkKeyPattern = /^.+_chunk_(\d+)$/;
  const match = chunkKey.match(chunkKeyPattern);
  
  if (match && match[1]) {
    return parseInt(match[1], 10);
  }
  
  return -1;
}

/**
 * Implementation of storeTransformedVideo with support for both single entry
 * and chunked video storage with byte-perfect data integrity verification
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
  const originalVideoContentType = responseClone.headers.get('Content-Type') || 'video/mp4';
  
  // Log key information for debugging
  logDebug('[STORE_VIDEO] Initiating storage for key', {
    key,
    sourcePath,
    derivative: options.derivative,
    width: options.width,
    height: options.height,
    version: options.version || 1,
    contentType: originalVideoContentType
  });
  
  // Use version from TransformationService if available, or default to 1
  const cacheVersion = options.version || 1;
  
  // Check if indefinite storage is enabled
  const cacheConfig = CacheConfigurationManager.getInstance().getConfig();
  const useIndefiniteStorage = cacheConfig.storeIndefinitely === true;

  // Verify response body exists
  if (!responseClone.body) {
    logErrorWithContext(
      '[STORE_VIDEO] Response body is null for key', 
      new Error('Empty response body'), 
      { key }, 
      'KVStorageService.store'
    );
    return false;
  }
  
  // Buffer the entire video for exact size measurement and chunking decision
  let videoArrayBuffer: ArrayBuffer;
  try {
    videoArrayBuffer = await responseClone.arrayBuffer();
  } catch (error) {
    logErrorWithContext(
      '[STORE_VIDEO] Failed to read response body into ArrayBuffer', 
      error, 
      { key }, 
      'KVStorageService.store'
    );
    return false;
  }
  
  const totalActualVideoBytes = videoArrayBuffer.byteLength;
  logDebug('[STORE_VIDEO] Video successfully buffered', {
    key,
    totalActualVideoBytes,
    contentType: originalVideoContentType
  });
  
  if (totalActualVideoBytes === 0) {
    logDebug('[STORE_VIDEO] Video size is 0 bytes, skipping KV storage', { key });
    return false;
  }
  
  // Determine whether to use single entry or chunked storage based on size
  if (totalActualVideoBytes <= MAX_VIDEO_SIZE_FOR_SINGLE_KV_ENTRY) {
    //
    // Case 1: Video is small enough for a single KV entry
    //
    logDebug('[STORE_VIDEO] Storing as single KV entry', {
      key,
      size: totalActualVideoBytes,
      usingSingleEntry: true
    });
    
    // Create single entry metadata
    const singleEntryMetadata = createBaseMetadata(
      sourcePath, 
      options, 
      originalVideoContentType, 
      totalActualVideoBytes, 
      cacheVersion, 
      ttl
    );
    
    // Mark as non-chunked and store actual video size for integrity checks
    singleEntryMetadata.isChunked = false;
    singleEntryMetadata.actualTotalVideoSize = totalActualVideoBytes;
    
    // Log before KV put
    logDebug('[STORE_VIDEO] Preparing to PUT single entry', {
      key,
      size: videoArrayBuffer.byteLength,
      metadata: singleEntryMetadata
    });
    
    // Store with retry
    const success = await storeWithRetry(
      namespace,
      key,
      videoArrayBuffer,
      singleEntryMetadata,
      ttl,
      useIndefiniteStorage
    );
    
    if (!success) {
      return false;
    }
    
    // Handle version storage if needed
    await handleVersionStorage(namespace, key, cacheVersion, options.env, ttl);
    
    // Log success and add breadcrumb
    logStorageSuccess(key, totalActualVideoBytes, ttl, cacheVersion, useIndefiniteStorage, false);
    
    return true;
  } else {
    //
    // Case 2: Video is large and needs to be chunked
    //
    logDebug('[STORE_VIDEO] Video too large for single entry, storing as chunks', {
      key,
      size: totalActualVideoBytes,
      maxSingleEntrySize: MAX_VIDEO_SIZE_FOR_SINGLE_KV_ENTRY,
      standardChunkSize: STANDARD_CHUNK_SIZE
    });
    
    const actualChunkSizes: number[] = [];
    const chunkKeys: string[] = [];
    const chunkPutPromises: Promise<boolean>[] = [];
    
    let chunkIndex = 0;
    
    // Split video into chunks and store each one
    for (let offset = 0; offset < totalActualVideoBytes; offset += STANDARD_CHUNK_SIZE) {
      const chunkStart = offset;
      const chunkEnd = Math.min(offset + STANDARD_CHUNK_SIZE, totalActualVideoBytes);
      const chunkBuffer = videoArrayBuffer.slice(chunkStart, chunkEnd);
      
      // Skip potential empty trailing chunk if size is exact multiple of chunk size
      if (chunkBuffer.byteLength === 0 && chunkEnd === totalActualVideoBytes) {
        logDebug('[STORE_VIDEO] Final chunk is 0 bytes (total size is multiple of chunk size), skipping', { 
          key, 
          chunkIndex 
        });
        continue;
      }
      
      // Ensure we don't have empty chunks in the middle (which would indicate a logic error)
      if (chunkBuffer.byteLength === 0 && chunkEnd < totalActualVideoBytes) {
        logErrorWithContext(
          '[STORE_VIDEO] Created an empty chunk before end of video', 
          new Error('Empty chunk created mid-stream'), 
          { key, chunkStart, chunkEnd, totalActualVideoBytes, chunkIndex }, 
          'KVStorageService.store'
        );
        return false;
      }
      
      const chunkKey = `${key}_chunk_${chunkIndex}`;
      chunkKeys.push(chunkKey);
      actualChunkSizes.push(chunkBuffer.byteLength);
      
      // Minimal metadata for individual chunks
      const chunkMetadata = {
        parentKey: key,
        chunkIndex: chunkIndex,
        size: chunkBuffer.byteLength,
        contentType: 'application/octet-stream',
        createdAt: Date.now(),
      };
      
      logDebug('[STORE_VIDEO] Preparing to PUT chunk', { 
        key: chunkKey, 
        chunkIndex, 
        size: chunkBuffer.byteLength, 
        start: chunkStart, 
        end: chunkEnd 
      });
      
      // Store each chunk with retry
      chunkPutPromises.push(
        storeWithRetry(
          namespace,
          chunkKey,
          chunkBuffer,
          chunkMetadata,
          ttl,
          useIndefiniteStorage
        ).then(success => {
          if (success) {
            logDebug('[STORE_VIDEO] Successfully PUT chunk', { 
              key: chunkKey, 
              chunkIndex 
            });
          } else {
            logErrorWithContext(
              '[STORE_VIDEO] Failed to store chunk', 
              new Error('Chunk storage failed'), 
              { key: chunkKey, chunkIndex }, 
              'KVStorageService.store'
            );
            throw new Error(`Failed to store chunk ${chunkIndex}`);
          }
          return success;
        })
      );
      
      chunkIndex++;
    }
    
    try {
      // Wait for all chunks to be stored
      await Promise.all(chunkPutPromises);
      logDebug('[STORE_VIDEO] All chunks stored successfully', { 
        key, 
        chunkCount: chunkKeys.length 
      });
    } catch (error) {
      logErrorWithContext(
        '[STORE_VIDEO] At least one chunk storage operation failed', 
        error, 
        { key, chunkCount: chunkKeys.length }, 
        'KVStorageService.store'
      );
      // TODO: Consider cleanup of successfully uploaded chunks
      return false;
    }
    
    // Verify sum of chunk sizes matches the original total size
    const sumOfChunkBytes = actualChunkSizes.reduce((sum, size) => sum + size, 0);
    if (sumOfChunkBytes !== totalActualVideoBytes) {
      logErrorWithContext(
        '[STORE_VIDEO] CRITICAL DATA INTEGRITY ISSUE: Sum of chunk sizes does not match total video bytes', 
        new Error('Chunk sum mismatch'), 
        { 
          key, 
          totalActualVideoBytes, 
          sumOfChunkBytes, 
          actualChunkSizes 
        }, 
        'KVStorageService.store'
      );
      // TODO: Consider cleanup of already written chunks
      return false;
    }
    
    logDebug('[STORE_VIDEO] Chunk size integrity verified', { 
      key, 
      sumOfChunkBytes, 
      totalActualVideoBytes,
      chunkCount: actualChunkSizes.length
    });
    
    // Create the manifest data that describes how the video is chunked
    const manifestData: ChunkManifest = {
      totalSize: sumOfChunkBytes, // Authoritative total size
      chunkCount: chunkKeys.length,
      actualChunkSizes: actualChunkSizes, // Array of exact byte lengths
      standardChunkSize: STANDARD_CHUNK_SIZE,
      originalContentType: originalVideoContentType,
    };
    
    // Create metadata for the manifest entry
    const manifestEntryMetadata = createBaseMetadata(
      sourcePath, 
      options, 
      'application/json', // The manifest entry itself stores JSON
      JSON.stringify(manifestData).length, // Length of manifest JSON string
      cacheVersion, 
      ttl
    );
    
    // Mark as chunked and store actual video size for integrity checks
    manifestEntryMetadata.isChunked = true;
    manifestEntryMetadata.actualTotalVideoSize = sumOfChunkBytes;
    
    logDebug('[STORE_VIDEO] Preparing to PUT manifest', { 
      key, 
      manifestSize: JSON.stringify(manifestData).length,
      chunkCount: chunkKeys.length,
      totalSize: sumOfChunkBytes
    });
    
    // Store the manifest as the value of the base key
    const manifestSuccess = await storeWithRetry(
      namespace,
      key,
      JSON.stringify(manifestData),
      manifestEntryMetadata,
      ttl,
      useIndefiniteStorage
    );
    
    if (!manifestSuccess) {
      logErrorWithContext(
        '[STORE_VIDEO] Failed to store manifest', 
        new Error('Manifest storage failed'), 
        { key }, 
        'KVStorageService.store'
      );
      // TODO: Consider cleanup of stored chunks
      return false;
    }
    
    // Handle version storage if needed
    await handleVersionStorage(namespace, key, cacheVersion, options.env, ttl);
    
    // Log success and add breadcrumb
    logStorageSuccess(key, sumOfChunkBytes, ttl, cacheVersion, useIndefiniteStorage, true);
    
    return true;
  }
}

/**
 * Helper function to create base metadata for KV storage
 */
function createBaseMetadata(
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
async function storeWithRetry(
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
async function handleVersionStorage(
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
function logStorageSuccess(
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
 * with support for chunked videos and full data integrity verification
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
  // Generate a key for this transformed variant
  const key = generateKVKey(sourcePath, options);
  const isRangeRequest = request?.headers.has('Range') || false;
  const rangeHeaderValue = request?.headers.get('Range');
  const kvReadOptions = { cacheTtl: DEFAULT_KV_READ_CACHE_TTL }; // Use edge cache for KV reads
  
  // Log lookup information
  logDebug('[GET_VIDEO] Attempting to retrieve video', {
    key,
    sourcePath,
    derivative: options.derivative,
    width: options.width,
    height: options.height,
    version: options.version,
    isRangeRequest,
    rangeHeaderValue
  });
  
  // Fetch the base entry to determine if it's a single entry or chunked
  // Use type 'text' for initial fetch to allow parsing manifest if chunked
  const { value: baseValueText, metadata: baseMetadata } = await namespace.getWithMetadata<TransformationMetadata>(key, { type: 'text', ...kvReadOptions });
  
  // Handle cache miss
  if (!baseMetadata) {
    logDebug('[GET_VIDEO] Base key not found', { key });
    
    // Increment version on cache miss if env is provided
    if (options.env?.VIDEO_CACHE_KEY_VERSIONS) {
      try {
        // Force increment on cache miss
        const nextVersion = await getNextCacheKeyVersion(options.env, key, true);
        
        // Calculate a reasonable TTL (will be overwritten when content is stored)
        const cacheConfig = CacheConfigurationManager.getInstance();
        const versionTtl = (cacheConfig.getConfig().defaultMaxAge || 300) * 2;
        
        // Store updated version in background if possible
        await handleVersionIncrement(options.env, key, nextVersion, versionTtl);
        
        logDebug('[GET_VIDEO] Incremented version on cache miss', {
          key,
          previousVersion: nextVersion - 1,
          nextVersion,
          ttl: versionTtl
        });
      } catch (err) {
        // Log error but continue - version incrementation is not critical
        logDebug('[GET_VIDEO] Error incrementing version on cache miss', {
          key,
          error: err instanceof Error ? err.message : String(err)
        });
      }
    }
    
    return null;
  }
  
  logDebug('[GET_VIDEO] Retrieved base metadata', { 
    key, 
    metadata: baseMetadata,
    contentType: baseMetadata.contentType,
    isChunked: baseMetadata.isChunked
  });
  
  // Create common headers for response
  const responseHeaders = createCommonHeaders(baseMetadata, key);
  
  // Get version from metadata or options
  const cacheVersion = baseMetadata.cacheVersion || options.version || 1;
  
  // Add version information to headers
  if (cacheVersion) {
    responseHeaders.set('X-Cache-Version', cacheVersion.toString());
  }
  
  // Add chunking information for diagnostics
  if (baseMetadata.isChunked) {
    responseHeaders.set('X-Video-Storage', 'chunked');
  } else {
    responseHeaders.set('X-Video-Storage', 'single');
  }
  
  //
  // Handle chunked video retrieval
  //
  if (baseMetadata.isChunked === true) {
    logDebug('[GET_VIDEO] Video is stored as chunks', { key });
    
    // Parse the manifest
    if (!baseValueText) {
      logErrorWithContext(
        '[GET_VIDEO] Manifest value missing for chunked video', 
        new Error('Missing manifest value'), 
        { key }, 
        'KVStorageService.get'
      );
      return null;
    }
    
    let manifest: ChunkManifest;
    try {
      manifest = JSON.parse(baseValueText);
    } catch (e) {
      logErrorWithContext(
        '[GET_VIDEO] Failed to parse manifest JSON', 
        e, 
        { key, manifestText: baseValueText }, 
        'KVStorageService.get'
      );
      return null;
    }
    
    // Validate manifest content
    if (!manifest || typeof manifest.totalSize !== 'number' || !Array.isArray(manifest.actualChunkSizes) || manifest.chunkCount !== manifest.actualChunkSizes.length) {
      logErrorWithContext(
        '[GET_VIDEO] Invalid manifest structure', 
        new Error('Invalid manifest structure'), 
        { key, manifest }, 
        'KVStorageService.get'
      );
      return null;
    }
    
    logDebug('[GET_VIDEO] Parsed manifest for chunked video', { 
      key, 
      totalSize: manifest.totalSize, 
      chunkCount: manifest.chunkCount,
      contentType: manifest.originalContentType 
    });
    
    // Set content type from manifest
    responseHeaders.set('Content-Type', manifest.originalContentType);
    
    // Handle range request for chunked video
    if (isRangeRequest) {
      try {
        const { parseRangeHeader, createUnsatisfiableRangeResponse } = await import('../utils/httpUtils');
        const rangeValue = rangeHeaderValue || '';
        const clientRange = parseRangeHeader(rangeValue, manifest.totalSize);
        
        if (!clientRange) {
          logDebug('[GET_VIDEO] Unsatisfiable range request for chunked video', {
            key,
            range: rangeHeaderValue,
            totalSize: manifest.totalSize
          });
          
          addRangeDiagnostics(key, rangeValue, 'unsatisfiable', manifest.totalSize, 'chunked-kv');
          
          return { 
            response: createUnsatisfiableRangeResponse(manifest.totalSize), 
            metadata: baseMetadata 
          };
        }
        
        // Set range response headers
        responseHeaders.set('Content-Range', `bytes ${clientRange.start}-${clientRange.end}/${manifest.totalSize}`);
        responseHeaders.set('Content-Length', (clientRange.end - clientRange.start + 1).toString());
        
        logDebug('[GET_VIDEO] Processing range request for chunked video', { 
          key, 
          range: clientRange,
          totalSize: manifest.totalSize 
        });
        
        // Create streaming response with transform stream
        const { readable, writable } = new TransformStream();
        
        // Process the chunks for range request
        const streamChunksPromise = streamChunkedRangeResponse(
          namespace,
          key,
          manifest,
          clientRange,
          writable.getWriter(),
          kvReadOptions
        );
        
        // Process in background
        const context = getCurrentContext();
        if (context?.executionContext?.waitUntil) {
          context.executionContext.waitUntil(
            streamChunksPromise.catch(err => {
              logDebug('[GET_VIDEO] Error in background chunk processing', {
                key,
                error: err instanceof Error ? err.message : String(err),
                range: rangeHeaderValue
              });
            })
          );
        }
        
        // Add diagnostics
        addRangeDiagnostics(
          key, 
          rangeValue, 
          'success', 
          manifest.totalSize, 
          'chunked-kv', 
          clientRange.start, 
          clientRange.end
        );
        
        // Return 206 Partial Content response
        logDebug('[GET_VIDEO] Returning 206 Partial Content for chunked video', { key });
        
        // Refresh TTL on cache hit
        refreshCacheTtl(namespace, key, baseMetadata, options.env);
        
        return { 
          response: new Response(readable, { 
            status: 206, 
            statusText: 'Partial Content',
            headers: responseHeaders 
          }), 
          metadata: baseMetadata 
        };
      } catch (err) {
        logErrorWithContext(
          '[GET_VIDEO] Error processing range request for chunked video', 
          err, 
          { key, range: rangeHeaderValue }, 
          'KVStorageService.get'
        );
        
        // Fall back to full content if range request fails
        logDebug('[GET_VIDEO] Falling back to full content response after range error', { key });
      }
    }
    
    // Full content response for chunked video
    responseHeaders.set('Content-Length', manifest.totalSize.toString());
    
    logDebug('[GET_VIDEO] Processing full content request for chunked video', { 
      key, 
      totalSize: manifest.totalSize,
      chunkCount: manifest.chunkCount 
    });
    
    // Create streaming response with transform stream
    const { readable, writable } = new TransformStream();
    
    // Process all chunks
    const streamChunksPromise = streamFullChunkedResponse(
      namespace,
      key,
      manifest,
      writable.getWriter(),
      kvReadOptions
    );
    
    // Process in background
    const context = getCurrentContext();
    if (context?.executionContext?.waitUntil) {
      context.executionContext.waitUntil(
        streamChunksPromise.catch(err => {
          logErrorWithContext(
            '[GET_VIDEO] Error in background full content chunk processing', 
            err, 
            { key }, 
            'KVStorageService.get'
          );
        })
      );
    }
    
    // Refresh TTL on cache hit
    refreshCacheTtl(namespace, key, baseMetadata, options.env);
    
    logDebug('[GET_VIDEO] Returning 200 OK for full chunked video', { key });
    
    return { 
      response: new Response(readable, { 
        status: 200, 
        headers: responseHeaders 
      }), 
      metadata: baseMetadata 
    };
  }
  //
  // Handle single entry video retrieval
  //
  else if (baseMetadata.isChunked === false && typeof baseMetadata.actualTotalVideoSize === 'number') {
    logDebug('[GET_VIDEO] Video is stored as single entry', { 
      key, 
      expectedSize: baseMetadata.actualTotalVideoSize 
    });
    
    // baseValueText from text fetch not needed, get binary data instead
    const videoArrayBuffer = await namespace.get(key, { type: 'arrayBuffer', ...kvReadOptions });
    
    if (!videoArrayBuffer) {
      logErrorWithContext(
        '[GET_VIDEO] Video data missing for single entry', 
        new Error('Missing data'), 
        { key }, 
        'KVStorageService.get'
      );
      return null;
    }
    
    // Verify retrieved size against metadata for data integrity
    logDebug('[GET_VIDEO] Retrieved single entry video', { 
      key, 
      expectedSize: baseMetadata.actualTotalVideoSize, 
      actualSize: videoArrayBuffer.byteLength 
    });
    
    if (videoArrayBuffer.byteLength !== baseMetadata.actualTotalVideoSize) {
      const errorMsg = `CRITICAL SIZE MISMATCH for key ${key}. Expected: ${baseMetadata.actualTotalVideoSize}, Actual: ${videoArrayBuffer.byteLength}`;
      logErrorWithContext(
        '[GET_VIDEO] ' + errorMsg, 
        new Error('Size mismatch'), 
        { key }, 
        'KVStorageService.get'
      );
      
      // Decision: Return null for strict integrity validation
      return null;
    }
    
    // Set content type from metadata
    responseHeaders.set('Content-Type', baseMetadata.contentType);
    
    // Handle range request for single entry
    if (isRangeRequest) {
      try {
        const { parseRangeHeader, createUnsatisfiableRangeResponse } = await import('../utils/httpUtils');
        const rangeValue = rangeHeaderValue || '';
        const clientRange = parseRangeHeader(rangeValue, videoArrayBuffer.byteLength);
        
        if (!clientRange) {
          logDebug('[GET_VIDEO] Unsatisfiable range request for single entry', {
            key,
            range: rangeHeaderValue,
            size: videoArrayBuffer.byteLength
          });
          
          addRangeDiagnostics(key, rangeValue, 'unsatisfiable', videoArrayBuffer.byteLength, 'single-kv');
          
          return { 
            response: createUnsatisfiableRangeResponse(videoArrayBuffer.byteLength), 
            metadata: baseMetadata 
          };
        }
        
        logDebug('[GET_VIDEO] Processing range request for single entry', { 
          key, 
          range: clientRange 
        });
        
        // Create partial response from the array buffer
        const partialData = videoArrayBuffer.slice(clientRange.start, clientRange.end + 1);
        
        // Set range response headers
        responseHeaders.set('Content-Range', `bytes ${clientRange.start}-${clientRange.end}/${videoArrayBuffer.byteLength}`);
        responseHeaders.set('Content-Length', partialData.byteLength.toString());
        
        // Add diagnostics
        addRangeDiagnostics(
          key, 
          rangeValue, 
          'success', 
          videoArrayBuffer.byteLength, 
          'single-kv', 
          clientRange.start, 
          clientRange.end
        );
        
        // Refresh TTL on cache hit
        refreshCacheTtl(namespace, key, baseMetadata, options.env);
        
        logDebug('[GET_VIDEO] Returning 206 Partial Content for single entry', { key });
        
        return { 
          response: new Response(partialData, { 
            status: 206, 
            statusText: 'Partial Content',
            headers: responseHeaders 
          }), 
          metadata: baseMetadata 
        };
      } catch (err) {
        logErrorWithContext(
          '[GET_VIDEO] Error processing range request for single entry', 
          err, 
          { key, range: rangeHeaderValue }, 
          'KVStorageService.get'
        );
        
        // Fall back to full content
        logDebug('[GET_VIDEO] Falling back to full content response after range error', { key });
      }
    }
    
    // Full content response for single entry
    responseHeaders.set('Content-Length', videoArrayBuffer.byteLength.toString());
    
    // Refresh TTL on cache hit
    refreshCacheTtl(namespace, key, baseMetadata, options.env);
    
    logDebug('[GET_VIDEO] Returning 200 OK for full single entry', { key });
    
    return { 
      response: new Response(videoArrayBuffer, { 
        status: 200, 
        headers: responseHeaders 
      }), 
      metadata: baseMetadata 
    };
  }
  //
  // Handle metadata inconsistency
  //
  else {
    logErrorWithContext(
      '[GET_VIDEO] Inconsistent metadata state', 
      new Error('Invalid metadata state'), 
      { 
        key, 
        isChunked: baseMetadata.isChunked, 
        actualTotalVideoSize: baseMetadata.actualTotalVideoSize 
      }, 
      'KVStorageService.get'
    );
    return null;
  }
}

/**
 * Helper function to create common response headers
 */
function createCommonHeaders(metadata: TransformationMetadata, key: string): Headers {
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

/**
 * Helper function to stream a range of a chunked video
 */
async function streamChunkedRangeResponse(
  namespace: KVNamespace,
  baseKey: string,
  manifest: ChunkManifest,
  clientRange: { start: number; end: number; total: number },
  writer: WritableStreamDefaultWriter<Uint8Array>,
  kvReadOptions: { cacheTtl?: number } = {}
): Promise<void> {
  try {
    let bytesSentForRange = 0;
    let currentVideoPos = 0;
    
    // Process each chunk that overlaps with the requested range
    for (let i = 0; i < manifest.chunkCount; i++) {
      const chunkKey = `${baseKey}_chunk_${i}`;
      const expectedChunkSize = manifest.actualChunkSizes[i];
      const chunkStartInVideo = currentVideoPos;
      const chunkEndInVideo = currentVideoPos + expectedChunkSize - 1;
      
      // Skip chunks that don't overlap with the requested range
      if (clientRange.start > chunkEndInVideo || clientRange.end < chunkStartInVideo) {
        currentVideoPos += expectedChunkSize;
        continue;
      }
      
      // This chunk overlaps with the requested range - fetch it
      logDebug('[GET_VIDEO] Fetching chunk for range', { 
        chunkKey, 
        chunkIndex: i, 
        expectedSize: expectedChunkSize,
        chunkStartPos: chunkStartInVideo,
        chunkEndPos: chunkEndInVideo
      });
      
      const chunkArrayBuffer = await namespace.get(chunkKey, { type: 'arrayBuffer', ...kvReadOptions });
      
      if (!chunkArrayBuffer) {
        const errorMsg = `[GET_VIDEO] Chunk data not found: ${chunkKey}`;
        logErrorWithContext(
          errorMsg, 
          new Error('Missing chunk data'), 
          { chunkKey, chunkIndex: i }, 
          'KVStorageService.get'
        );
        throw new Error(errorMsg);
      }
      
      // CRITICAL: Verify chunk size for data integrity
      logDebug('[GET_VIDEO] Retrieved chunk', { 
        chunkKey, 
        chunkIndex: i, 
        expectedSize: expectedChunkSize, 
        actualSize: chunkArrayBuffer.byteLength 
      });
      
      if (chunkArrayBuffer.byteLength !== expectedChunkSize) {
        const errorMsg = `[GET_VIDEO] CRITICAL CHUNK SIZE MISMATCH for key ${chunkKey}. Expected: ${expectedChunkSize}, Actual: ${chunkArrayBuffer.byteLength}`;
        logErrorWithContext(
          errorMsg, 
          new Error('Chunk size mismatch'), 
          { chunkKey, chunkIndex: i, expectedSize: expectedChunkSize, actualSize: chunkArrayBuffer.byteLength }, 
          'KVStorageService.get'
        );
        throw new Error(errorMsg);
      }
      
      // Calculate portion of this chunk needed for the range
      const sliceStartInChunk = Math.max(0, clientRange.start - chunkStartInVideo);
      const sliceEndInChunk = Math.min(expectedChunkSize, (clientRange.end - chunkStartInVideo) + 1);
      
      if (sliceStartInChunk < sliceEndInChunk) {
        const chunkSliceToSend = chunkArrayBuffer.slice(sliceStartInChunk, sliceEndInChunk);
        await writer.write(new Uint8Array(chunkSliceToSend));
        bytesSentForRange += chunkSliceToSend.byteLength;
        
        // Log progress for large ranges
        if (bytesSentForRange % 1000000 === 0) { // Log every ~1MB
          logDebug('[GET_VIDEO] Range request streaming progress', {
            bytesSentForRange,
            percentComplete: Math.round((bytesSentForRange / (clientRange.end - clientRange.start + 1)) * 100)
          });
        }
      }
      
      currentVideoPos += expectedChunkSize;
      
      // Optimization: stop if we've gone past the end of the requested range
      if (currentVideoPos > clientRange.end && bytesSentForRange > 0) {
        break;
      }
    }
    
    // Verify we sent the expected number of bytes
    const expectedBytesSent = clientRange.end - clientRange.start + 1;
    if (bytesSentForRange !== expectedBytesSent) {
      logDebug('[GET_VIDEO] Warning: Bytes sent for range doesn\'t match expected count', {
        bytesSentForRange,
        expectedBytesSent,
        clientRange
      });
    }
    
    logDebug('[GET_VIDEO] Completed streaming range request', {
      bytesSentForRange,
      expectedBytesSent,
      successful: bytesSentForRange > 0
    });
    
    // Close the writer
    await writer.close();
  } catch (error) {
    logErrorWithContext(
      '[GET_VIDEO] Error streaming chunked range response', 
      error, 
      { baseKey, clientRange }, 
      'KVStorageService.get'
    );
    
    // Attempt to abort the stream
    try {
      writer.abort(error);
    } catch (abortError) {
      // Ignore errors from aborting
    }
    
    throw error;
  }
}

/**
 * Helper function to stream a full chunked video
 */
async function streamFullChunkedResponse(
  namespace: KVNamespace,
  baseKey: string,
  manifest: ChunkManifest,
  writer: WritableStreamDefaultWriter<Uint8Array>,
  kvReadOptions: { cacheTtl?: number } = {}
): Promise<void> {
  try {
    let totalBytesSent = 0;
    
    // Stream all chunks in order
    for (let i = 0; i < manifest.chunkCount; i++) {
      const chunkKey = `${baseKey}_chunk_${i}`;
      const expectedChunkSize = manifest.actualChunkSizes[i];
      
      logDebug('[GET_VIDEO] Fetching chunk for full response', { 
        chunkKey, 
        chunkIndex: i, 
        expectedSize: expectedChunkSize 
      });
      
      const chunkArrayBuffer = await namespace.get(chunkKey, { type: 'arrayBuffer', ...kvReadOptions });
      
      if (!chunkArrayBuffer) {
        const errorMsg = `[GET_VIDEO] Chunk data not found: ${chunkKey}`;
        logErrorWithContext(
          errorMsg, 
          new Error('Missing chunk data'), 
          { chunkKey, chunkIndex: i }, 
          'KVStorageService.get'
        );
        throw new Error(errorMsg);
      }
      
      // CRITICAL: Verify chunk size for data integrity
      logDebug('[GET_VIDEO] Retrieved chunk', { 
        chunkKey, 
        chunkIndex: i, 
        expectedSize: expectedChunkSize, 
        actualSize: chunkArrayBuffer.byteLength 
      });
      
      if (chunkArrayBuffer.byteLength !== expectedChunkSize) {
        const errorMsg = `[GET_VIDEO] CRITICAL CHUNK SIZE MISMATCH for key ${chunkKey}. Expected: ${expectedChunkSize}, Actual: ${chunkArrayBuffer.byteLength}`;
        logErrorWithContext(
          errorMsg, 
          new Error('Chunk size mismatch'), 
          { chunkKey, chunkIndex: i, expectedSize: expectedChunkSize, actualSize: chunkArrayBuffer.byteLength }, 
          'KVStorageService.get'
        );
        throw new Error(errorMsg);
      }
      
      // Write this chunk to the output stream
      await writer.write(new Uint8Array(chunkArrayBuffer));
      totalBytesSent += chunkArrayBuffer.byteLength;
      
      // Log progress for large videos
      if (totalBytesSent % 5000000 === 0) { // Log every ~5MB
        logDebug('[GET_VIDEO] Full content streaming progress', {
          totalBytesSent,
          percentComplete: Math.round((totalBytesSent / manifest.totalSize) * 100),
          chunkIndex: i,
          totalChunks: manifest.chunkCount
        });
      }
    }
    
    // Verify we sent the expected total bytes
    if (totalBytesSent !== manifest.totalSize) {
      logDebug('[GET_VIDEO] Warning: Total bytes sent doesn\'t match manifest size', {
        totalBytesSent,
        manifestTotalSize: manifest.totalSize
      });
    }
    
    logDebug('[GET_VIDEO] Completed streaming full chunked response', {
      totalBytesSent,
      expectedTotalSize: manifest.totalSize
    });
    
    // Close the writer
    await writer.close();
  } catch (error) {
    logErrorWithContext(
      '[GET_VIDEO] Error streaming full chunked response', 
      error, 
      { baseKey }, 
      'KVStorageService.get'
    );
    
    // Attempt to abort the stream
    try {
      writer.abort(error);
    } catch (abortError) {
      // Ignore errors from aborting
    }
    
    throw error;
  }
}

/**
 * Helper function to add range request diagnostics
 */
function addRangeDiagnostics(
  key: string,
  rangeHeader: string | null,
  status: 'success' | 'unsatisfiable' | 'error',
  totalSize: number,
  source: string,
  start?: number,
  end?: number
): void {
  const requestContext = getCurrentContext();
  if (!requestContext) return;
  
  addBreadcrumb(requestContext, 'KV', `Range request ${status}`, {
    key,
    rangeHeader: rangeHeader || '',
    totalSize,
    status,
    start,
    end,
    source
  });
  
  // Add to diagnostics object
  if (!requestContext.diagnostics) {
    requestContext.diagnostics = {};
  }
  
  requestContext.diagnostics.rangeRequest = {
    header: rangeHeader,
    status,
    total: totalSize,
    source,
    start,
    end
  };
}

/**
 * Helper function to refresh cache TTL on access
 */
function refreshCacheTtl(
  namespace: KVNamespace,
  key: string,
  metadata: TransformationMetadata,
  env?: EnvVariables
): void {
  const requestContext = getCurrentContext();
  if (!requestContext?.executionContext) return;
  
  // Use the optimized TTL refresh mechanism which avoids re-storing the entire value
  checkAndRefreshTtl(
    namespace,
    key,
    metadata,
    env,
    requestContext.executionContext
  ).catch(err => {
    // Log any errors but don't fail the response
    logDebug('[GET_VIDEO] Error during TTL refresh', {
      key,
      error: err instanceof Error ? err.message : String(err)
    });
  });
}

/**
 * Helper function to handle version increment with retries
 */
async function handleVersionIncrement(
  env: EnvVariables,
  key: string,
  version: number,
  ttl?: number
): Promise<void> {
  // Use waitUntil if available for non-blocking operation with retry
  if ('executionCtx' in env && (env as any).executionCtx?.waitUntil) {
    (env as any).executionCtx.waitUntil(
      (async () => {
        const maxRetries = 3;
        let attemptCount = 0;
        let success = false;
        let lastError: Error | null = null;
        
        while (attemptCount < maxRetries && !success) {
          try {
            attemptCount++;
            await storeCacheKeyVersion(env, key, version, ttl);
            success = true;
            
            // Only log if we needed retries
            if (attemptCount > 1) {
              logDebug('[GET_VIDEO] Successfully incremented version after retries', {
                key,
                version,
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
              logDebug('[GET_VIDEO] Error incrementing version', {
                key,
                error: lastError.message,
                attempts: attemptCount
              });
              return;
            }
            
            // Exponential backoff
            const backoffMs = Math.min(200 * Math.pow(2, attemptCount - 1), 2000);
            await new Promise(resolve => setTimeout(resolve, backoffMs));
          }
        }
      })()
    );
  } else {
    // Direct incrementation with retry
    const maxRetries = 3;
    let attemptCount = 0;
    let success = false;
    let lastError: Error | null = null;
    
    while (attemptCount < maxRetries && !success) {
      try {
        attemptCount++;
        await storeCacheKeyVersion(env, key, version, ttl);
        success = true;
        
        // Only log if we needed retries
        if (attemptCount > 1) {
          logDebug('[GET_VIDEO] Successfully incremented version after retries (direct)', {
            key,
            version,
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
          logDebug('[GET_VIDEO] Error incrementing version (direct)', {
            key,
            error: lastError.message,
            attempts: attemptCount
          });
          break;
        }
        
        // Exponential backoff
        const backoffMs = Math.min(200 * Math.pow(2, attemptCount - 1), 2000);
        await new Promise(resolve => setTimeout(resolve, backoffMs));
      }
    }
  }
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
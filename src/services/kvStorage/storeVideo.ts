import { withErrorHandling } from '../../utils/errorHandlingUtils';
import { EnvVariables } from '../../config/environmentConfig';
import { getCurrentContext, addBreadcrumb } from '../../utils/requestContext';
import { logDebug } from './logging';
import { CacheConfigurationManager } from '../../config';
import { generateKVKey } from './keyUtils';
import {
  createBaseMetadata,
  handleVersionStorage,
  logStorageSuccess,
  storeWithRetry,
} from './storageHelpers';
import { ChunkManifest, TransformationMetadata } from './interfaces';
import { MAX_VIDEO_SIZE_FOR_SINGLE_KV_ENTRY, STANDARD_CHUNK_SIZE } from './constants';
import { generateCacheTags } from '../videoStorage/cacheTags';

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
    contentType: originalVideoContentType,
    receivedVersion: options.version,
    willUseVersion: options.version || 1,
  });

  // Use version from TransformationService if available, or default to 1
  const cacheVersion = options.version || 1;

  // Check if indefinite storage is enabled
  const cacheConfig = CacheConfigurationManager.getInstance().getConfig();
  const useIndefiniteStorage = cacheConfig.storeIndefinitely === true;

  // Verify response body exists
  if (!responseClone.body) {
    logDebug('[STORE_VIDEO] Response body is null for key', { key });
    return false;
  }

  // Buffer the entire video for exact size measurement and chunking decision
  let videoArrayBuffer: ArrayBuffer;
  try {
    videoArrayBuffer = await responseClone.arrayBuffer();
  } catch (error) {
    logDebug('[STORE_VIDEO] Failed to read response body into ArrayBuffer', {
      key,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }

  const totalActualVideoBytes = videoArrayBuffer.byteLength;
  logDebug('[STORE_VIDEO] Video successfully buffered', {
    key,
    totalActualVideoBytes,
    contentType: originalVideoContentType,
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
      usingSingleEntry: true,
    });

    // Create single entry metadata
    // Check if there's an explicit ttl in customData.originTtl from the origin config
    const originTtl = options.customData?.originTtl as number | undefined;

    const singleEntryMetadata = createBaseMetadata(
      sourcePath,
      options,
      originalVideoContentType,
      totalActualVideoBytes,
      cacheVersion,
      ttl
    );

    // Store the origin TTL in the metadata for retrieval
    if (originTtl) {
      singleEntryMetadata.customData = {
        ...singleEntryMetadata.customData,
        originTtl: originTtl,
      };

      // If we're using an origin TTL, make sure expiresAt is set based on it for countdown
      // This ensures Cache-Control headers count down correctly from the origin-defined TTL
      singleEntryMetadata.expiresAt = Date.now() + originTtl * 1000;
    }

    // Mark if we're using indefinite storage
    singleEntryMetadata.storeIndefinitely = useIndefiniteStorage;

    // Mark as non-chunked and store actual video size for integrity checks
    singleEntryMetadata.isChunked = false;
    singleEntryMetadata.actualTotalVideoSize = totalActualVideoBytes;

    // Log before KV put
    logDebug('[STORE_VIDEO] Preparing to PUT single entry', {
      key,
      size: videoArrayBuffer.byteLength,
      metadata: singleEntryMetadata,
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
      standardChunkSize: STANDARD_CHUNK_SIZE,
    });

    const actualChunkSizes: number[] = [];
    const chunkKeys: string[] = [];
    const chunkPutPromises: Promise<boolean>[] = [];

    let chunkIndex = 0;

    // Generate cache tags for all chunks before storing them
    // We need to do this here since these tags will be applied to all chunks
    const cacheTags = generateCacheTags(
      sourcePath,
      options,
      new Headers({
        'Content-Type': originalVideoContentType,
      })
    );

    logDebug('[STORE_VIDEO] Generated cache tags for chunked video', {
      key,
      tagCount: cacheTags.length,
    });

    // Split video into chunks and store each one
    for (let offset = 0; offset < totalActualVideoBytes; offset += STANDARD_CHUNK_SIZE) {
      const chunkStart = offset;
      const chunkEnd = Math.min(offset + STANDARD_CHUNK_SIZE, totalActualVideoBytes);
      const chunkBuffer = videoArrayBuffer.slice(chunkStart, chunkEnd);

      // Skip potential empty trailing chunk if size is exact multiple of chunk size
      if (chunkBuffer.byteLength === 0 && chunkEnd === totalActualVideoBytes) {
        logDebug(
          '[STORE_VIDEO] Final chunk is 0 bytes (total size is multiple of chunk size), skipping',
          {
            key,
            chunkIndex,
          }
        );
        continue;
      }

      // Ensure we don't have empty chunks in the middle (which would indicate a logic error)
      if (chunkBuffer.byteLength === 0 && chunkEnd < totalActualVideoBytes) {
        logDebug('[STORE_VIDEO] Created an empty chunk before end of video', {
          key,
          chunkStart,
          chunkEnd,
          totalActualVideoBytes,
          chunkIndex,
        });
        return false;
      }

      const chunkKey = `${key}_chunk_${chunkIndex}`;
      chunkKeys.push(chunkKey);
      actualChunkSizes.push(chunkBuffer.byteLength);

      // Enhanced metadata for individual chunks with the same cache tags as the parent entry
      // This allows purging both the parent and all chunks with a single tag-based operation
      const chunkMetadata = {
        chunkIndex: chunkIndex,
        size: chunkBuffer.byteLength,
        contentType: 'application/octet-stream', // Use octet-stream for chunks
        createdAt: Date.now(),
        cacheTags: generateCacheTags(
          sourcePath,
          options,
          new Headers({
            'Content-Type': originalVideoContentType, // Generate tags based on the original video type
          })
        ),
      };

      logDebug('[STORE_VIDEO] Preparing to PUT chunk', {
        key: chunkKey,
        chunkIndex,
        size: chunkBuffer.byteLength,
        start: chunkStart,
        end: chunkEnd,
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
        ).then((success) => {
          if (success) {
            logDebug('[STORE_VIDEO] Successfully PUT chunk', {
              key: chunkKey,
              chunkIndex,
            });
          } else {
            logDebug('[STORE_VIDEO] Failed to store chunk', {
              key: chunkKey,
              chunkIndex,
            });
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
        chunkCount: chunkKeys.length,
      });
    } catch (error) {
      logDebug('[STORE_VIDEO] At least one chunk storage operation failed', {
        key,
        chunkCount: chunkKeys.length,
        error: error instanceof Error ? error.message : String(error),
      });
      // TODO: Consider cleanup of successfully uploaded chunks
      return false;
    }

    // Verify sum of chunk sizes matches the original total size
    const sumOfChunkBytes = actualChunkSizes.reduce((sum, size) => sum + size, 0);
    if (sumOfChunkBytes !== totalActualVideoBytes) {
      logDebug(
        '[STORE_VIDEO] CRITICAL DATA INTEGRITY ISSUE: Sum of chunk sizes does not match total video bytes',
        {
          key,
          totalActualVideoBytes,
          sumOfChunkBytes,
          actualChunkSizes,
        }
      );
      // TODO: Consider cleanup of already written chunks
      return false;
    }

    logDebug('[STORE_VIDEO] Chunk size integrity verified', {
      key,
      sumOfChunkBytes,
      totalActualVideoBytes,
      chunkCount: actualChunkSizes.length,
    });

    // Create the manifest data that describes how the video is chunked
    const manifestData: ChunkManifest = {
      totalSize: sumOfChunkBytes, // Authoritative total size
      chunkCount: chunkKeys.length,
      actualChunkSizes: actualChunkSizes, // Array of exact byte lengths
      standardChunkSize: STANDARD_CHUNK_SIZE,
      originalContentType: originalVideoContentType,
    };

    // Check if there's an explicit ttl in customData.originTtl from the origin config
    const originTtl = options.customData?.originTtl as number | undefined;

    // Create metadata for the manifest entry with video content type for cache tags
    // but application/json as the actual content type for the manifest itself
    const manifestEntryMetadata = createBaseMetadata(
      sourcePath,
      options,
      'application/json', // The manifest entry itself stores JSON
      JSON.stringify(manifestData).length, // Length of manifest JSON string
      cacheVersion,
      ttl
    );

    // Store the origin TTL in the metadata for retrieval
    if (originTtl) {
      manifestEntryMetadata.customData = {
        ...manifestEntryMetadata.customData,
        originTtl: originTtl,
      };

      // If we're using an origin TTL, make sure expiresAt is set based on it for countdown
      // This ensures Cache-Control headers count down correctly from the origin-defined TTL
      manifestEntryMetadata.expiresAt = Date.now() + originTtl * 1000;
    }

    // Mark if we're using indefinite storage
    manifestEntryMetadata.storeIndefinitely = useIndefiniteStorage;

    // Mark as chunked and store actual video size for integrity checks
    manifestEntryMetadata.isChunked = true;
    manifestEntryMetadata.actualTotalVideoSize = sumOfChunkBytes;

    // Override the cache tags to ensure they have the original video content type
    // This ensures all chunked video-related entries have tags that include the
    // correct video/mp4 content type, not application/json
    manifestEntryMetadata.cacheTags = generateCacheTags(
      sourcePath,
      options,
      new Headers({
        'Content-Type': originalVideoContentType, // Generate tags based on the original video type
      })
    );

    logDebug('[STORE_VIDEO] Preparing to PUT manifest', {
      key,
      manifestSize: JSON.stringify(manifestData).length,
      chunkCount: chunkKeys.length,
      totalSize: sumOfChunkBytes,
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
      logDebug('[STORE_VIDEO] Failed to store manifest', { key });
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
 * Store a transformed video in KV storage
 * This function is wrapped with error handling to ensure consistent error logging
 * and fail gracefully when KV operations encounter issues
 *
 * @param namespace - The KV namespace to use
 * @param sourcePath - Original video path
 * @param response - The transformed video response
 * @param options - Transformation options used
 * @param ttl - Optional TTL in seconds
 * @param useStreaming - Whether to use streaming mode for large files (default false)
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
    number | undefined,
    boolean | undefined,
  ],
  Promise<boolean>
>(
  async function storeTransformedVideoWrapper(
    namespace,
    sourcePath,
    response,
    options,
    ttl?,
    useStreaming?
  ): Promise<boolean> {
    try {
      // CRITICAL: Never cache partial/range responses
      if (response.status === 206 || response.headers.get('Content-Range')) {
        const { logDebug } = await import('./logging');
        logDebug('Refusing to cache partial content response', {
          path: sourcePath,
          component: 'KVStorageService',
          status: response.status,
          contentRange: response.headers.get('Content-Range'),
          reason: 'Partial responses should never be cached',
        });
        return false;
      }

      // Check content length
      const contentLengthHeader = response.headers.get('Content-Length');
      const contentLength = contentLengthHeader ? parseInt(contentLengthHeader, 10) : 0;

      // Safety check: Skip storing files larger than 128MB to avoid memory issues
      if (contentLength > 128 * 1024 * 1024) {
        // Log the skipped storage
        const { logDebug } = await import('./logging');
        logDebug('Skipping KV storage for large file', {
          path: sourcePath,
          component: 'KVStorageService',
          size: Math.round(contentLength / 1024 / 1024) + 'MB',
          reason: 'Exceeds 128MB safety limit',
        });
        return false;
      }

      // Check if we should use streaming mode (either explicitly requested or very large file)
      const shouldUseStreaming =
        useStreaming === true || contentLength > MAX_VIDEO_SIZE_FOR_SINGLE_KV_ENTRY * 2;

      if (shouldUseStreaming) {
        logDebug('Using streaming mode for large file', {
          sourcePath,
          contentLength,
          explicitStreaming: useStreaming === true,
        });

        // Dynamically import the streaming implementation to avoid circular dependencies
        const { storeTransformedVideoWithStreaming } = await import('./streamStorage');
        return await storeTransformedVideoWithStreaming(
          namespace,
          sourcePath,
          response,
          options,
          ttl
        );
      } else {
        // Use the standard implementation for normal files
        return await storeTransformedVideoImpl(namespace, sourcePath, response, options, ttl);
      }
    } catch (err) {
      // Add breadcrumb for KV storage error
      const requestContext = getCurrentContext();
      if (requestContext) {
        addBreadcrumb(requestContext, 'Error', 'Failed to store in KV', {
          sourcePath,
          error: err instanceof Error ? err.message : 'Unknown error',
          severity: 'medium',
        });
      }
      return false;
    }
  },
  {
    functionName: 'storeTransformedVideo',
    component: 'KVStorageService',
    logErrors: true,
  },
  { operationType: 'write' }
);

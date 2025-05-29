/**
 * Streaming storage functions for KV
 * These utilities support processing ReadableStreams in chunks without
 * buffering the entire content in memory
 */
import { ChunkManifest, TransformationMetadata } from './interfaces';
import { logDebug } from './logging';
import { logErrorWithContext } from '../../utils/errorHandlingUtils';
import { STANDARD_CHUNK_SIZE, MAX_VIDEO_SIZE_FOR_SINGLE_KV_ENTRY } from './constants';
import { generateCacheTags } from '../videoStorage/cacheTags';
import { createBaseMetadata, storeWithRetry } from './storageHelpers';
import { generateKVKey } from './keyUtils';
import { CacheConfigurationManager } from '../../config';
import { handleVersionStorage, logStorageSuccess } from './storageHelpers';
import { EnvVariables } from '../../config/environmentConfig';
import { ConcurrencyQueue } from '../../utils/concurrencyQueue';
import { chunkLockManager } from './chunkLockManager';

/**
 * Processes a ReadableStream in chunks and stores them in KV storage
 * This avoids loading the entire file into memory, making it suitable
 * for very large files that would otherwise exceed memory limits
 * 
 * @param namespace KV namespace to store data
 * @param sourcePath Original file path
 * @param response The response whose body will be streamed
 * @param options Transformation options
 * @param ttl TTL for the stored chunks in seconds
 * @returns Promise resolving to whether the operation was successful
 */
export async function storeTransformedVideoWithStreaming(
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
    version?: number;
    env?: EnvVariables;
  },
  ttl?: number
): Promise<boolean> {
  // Clone the response to ensure we don't affect the consumer
  const responseClone = response.clone();
  
  // Verify response body exists
  if (!responseClone.body) {
    logDebug('Response body is null', { sourcePath });
    return false;
  }
  
  // Generate a key for this transformed variant
  const key = generateKVKey(sourcePath, options);
  const contentType = responseClone.headers.get('Content-Type') || 'video/mp4';
  
  // Log key information for debugging
  logDebug('[STREAM_STORE] Initiating streaming storage for key', {
    key,
    sourcePath,
    derivative: options.derivative,
    width: options.width,
    height: options.height,
    version: options.version || 1,
    contentType
  });
  
  // Use version from TransformationService if available, or default to 1
  const cacheVersion = options.version || 1;
  
  // Check if indefinite storage is enabled
  const cacheConfig = CacheConfigurationManager.getInstance().getConfig();
  const useIndefiniteStorage = cacheConfig.storeIndefinitely === true;
  
  // Get content length for optimization decisions
  const contentLengthHeader = responseClone.headers.get('Content-Length');
  const contentLength = contentLengthHeader ? parseInt(contentLengthHeader, 10) : 0;
  
  // Use a larger chunk size for extremely large files
  const useExtremeLargeMode = contentLength > 200 * 1024 * 1024; // 200MB threshold
  const chunkSize = useExtremeLargeMode ? STANDARD_CHUNK_SIZE * 2 : STANDARD_CHUNK_SIZE;
  
  if (useExtremeLargeMode) {
    logDebug('[STREAM_STORE] Using extra-large chunk mode for very large file', {
      key,
      contentLengthMB: Math.round(contentLength / 1024 / 1024),
      chunkSizeMB: Math.round(chunkSize / 1024 / 1024)
    });
  }
  
  // Process the stream in chunks and get the result
  const result = await processStreamInChunks(
    namespace,
    key,
    responseClone.body,
    {
      sourcePath, 
      contentType,
      transformOptions: options,
      cacheVersion,
      chunkSize
    },
    ttl,
    useIndefiniteStorage
  );
  
  if (!result.success) {
    logDebug('[STREAM_STORE] Failed to store video using streaming', {
      key,
      chunksStored: result.chunkKeys.length,
      totalProcessedBytes: result.totalSize
    });
    return false;
  }
  
  // If small enough to store as a single entry, store directly
  if (result.totalSize <= MAX_VIDEO_SIZE_FOR_SINGLE_KV_ENTRY && result.chunkKeys.length === 0) {
    // The processStreamInChunks function already stored this as a single entry
    logDebug('[STREAM_STORE] Video stored as single entry', {
      key,
      size: result.totalSize
    });
    
    // Handle version storage if needed
    await handleVersionStorage(namespace, key, cacheVersion, options.env, ttl);
    
    // Log success
    logStorageSuccess(key, result.totalSize, ttl, cacheVersion, useIndefiniteStorage, false);
    
    return true;
  }
  
  // For chunked storage, version storage was already handled in processStreamInChunks
  
  // Log success (manifest and chunks were already stored in processStreamInChunks)
  logStorageSuccess(key, result.totalSize, ttl, cacheVersion, useIndefiniteStorage, true);
  
  return true;
}

/**
 * Processes a ReadableStream in chunks and stores them in KV storage
 * This avoids loading the entire file into memory, making it suitable
 * for very large files that would otherwise exceed memory limits
 * 
 * @param namespace KV namespace to store data
 * @param key Base key for the chunked data
 * @param stream ReadableStream to process
 * @param options Options containing metadata and configuration
 * @param ttl TTL for the stored chunks
 * @param useIndefiniteStorage Whether to use indefinite storage
 * @returns Promise resolving to whether the operation was successful
 */
async function processStreamInChunks(
  namespace: KVNamespace,
  key: string,
  stream: ReadableStream<Uint8Array>,
  options: {
    sourcePath: string;
    contentType: string;
    transformOptions: Record<string, any>;
    cacheVersion: number;
    chunkSize?: number; // Allow custom chunk size
  },
  ttl?: number,
  useIndefiniteStorage?: boolean
): Promise<{
  success: boolean;
  totalSize: number;
  chunkKeys: string[];
  actualChunkSizes: number[];
}> {
  // Arrays to store chunk information
  const chunkKeys: string[] = [];
  const actualChunkSizes: number[] = [];
  let totalProcessedBytes = 0;
  
  // Always use streaming for all files to avoid memory spikes
  // This ensures consistent memory usage under high concurrency
  logDebug('[STREAM_STORE] Using streaming for all files to prevent memory spikes', {
    key,
    contentLength: options.transformOptions.contentLength || 'unknown'
  });
  
  try {
    // Import the streaming chunk processor
    const { createStreamingChunkProcessor } = await import('./streamChunkProcessor');
    
    // Create concurrency queue for chunk uploads
    const uploadQueue = new ConcurrencyQueue(5); // Limit to 5 concurrent uploads
    const chunkUploadPromises: Promise<boolean>[] = [];
    
    // Generate cache tags once for all chunks
    const cacheTags = generateCacheTags(options.sourcePath, options.transformOptions, new Headers({
      'Content-Type': options.contentType
    }));

    logDebug('[STREAM_STORE] Processing ReadableStream for KV storage', {
      key,
      contentType: options.contentType,
      concurrencyLimit: 5
    });
    
    // Define a helper function to store a chunk
    async function storeChunk(chunkData: Uint8Array, currentChunkIndex: number): Promise<void> {
      const chunkKey = `${key}_chunk_${currentChunkIndex}`;
      const chunkSize = chunkData.byteLength;
      
      chunkKeys.push(chunkKey);
      actualChunkSizes.push(chunkSize);
      totalProcessedBytes += chunkSize;
      
      // Enhanced metadata for individual chunks
      const chunkMetadata = {
        parentKey: key,
        chunkIndex: currentChunkIndex,
        size: chunkSize,
        contentType: 'application/octet-stream', // Use octet-stream for chunks
        createdAt: Date.now(),
        cacheTags: cacheTags,
      };
      
      logDebug('[STREAM_STORE] Queueing chunk for storage', { 
        key: chunkKey, 
        chunkIndex: currentChunkIndex, 
        size: chunkSize,
        totalProcessed: totalProcessedBytes
      });
      
      // Queue the chunk upload to prevent overwhelming KV namespace
      const uploadPromise = uploadQueue.add(async () => {
        // Acquire lock for this chunk to prevent concurrent writes
        const releaseLock = await chunkLockManager.acquireLock(chunkKey);
        
        try {
          logDebug('[STREAM_STORE] Starting queued chunk upload', { 
            key: chunkKey, 
            chunkIndex: currentChunkIndex,
            queueSize: uploadQueue.pending,
            running: uploadQueue.runningCount
          });
          
          // Create a copy of the data to ensure it's not modified during async operations
          const dataToStore = chunkData.slice().buffer;
          
          // Verify the size matches before storing
          if (dataToStore.byteLength !== chunkSize) {
            throw new Error(`Chunk buffer size mismatch during copy: expected ${chunkSize}, got ${dataToStore.byteLength}`);
          }
          
          // Update metadata with the actual size to ensure consistency
          const finalChunkMetadata = {
            ...chunkMetadata,
            size: dataToStore.byteLength
          };
          
          const success = await storeWithRetry(
            namespace,
            chunkKey,
            dataToStore,
            finalChunkMetadata,
            ttl,
            useIndefiniteStorage
          );
          
          if (success) {
            logDebug('[STREAM_STORE] Successfully stored chunk', { 
              key: chunkKey, 
              chunkIndex: currentChunkIndex,
              size: chunkSize
            });
          } else {
            logDebug('[STREAM_STORE] Failed to store chunk', { 
              key: chunkKey, 
              chunkIndex: currentChunkIndex,
              size: chunkSize
            });
          }
          
          return success;
        } finally {
          // Always release the lock
          releaseLock();
        }
      });
      
      // Add to promises array to track all uploads
      chunkUploadPromises.push(uploadPromise);
    }

    // Use custom chunk size if provided, otherwise use standard
    const targetChunkSize = options.chunkSize || STANDARD_CHUNK_SIZE;
    
    // Create the streaming chunk processor
    const chunkProcessor = createStreamingChunkProcessor(
      targetChunkSize,
      async (chunk: Uint8Array, index: number) => {
        // Store each chunk as it's ready
        await storeChunk(chunk, index);
      },
      async () => {
        // Completion handler - nothing special needed here
        logDebug('[STREAM_STORE] Stream processing completed', {
          key,
          totalChunks: chunkKeys.length,
          totalBytes: totalProcessedBytes
        });
      }
    );
    
    // Process the stream through our chunk processor
    await stream.pipeThrough(chunkProcessor).pipeTo(new WritableStream({
      write() {
        // We don't need to do anything here - chunks are handled by the processor
      },
      close() {
        logDebug('[STREAM_STORE] Stream closed successfully', { key });
      },
      abort(err) {
        logDebug('[STREAM_STORE] Stream aborted', { 
          key, 
          error: err instanceof Error ? err.message : String(err) 
        });
      }
    }));
    
    logDebug('[STREAM_STORE] All chunks queued for upload', {
      key,
      chunkCount: chunkKeys.length,
      totalSize: totalProcessedBytes,
      pendingUploads: chunkUploadPromises.length
    });
    
    // Wait for all chunk uploads to complete
    const uploadResults = await Promise.all(chunkUploadPromises);
    const failedUploads = uploadResults.filter(success => !success).length;
    
    if (failedUploads > 0) {
      logDebug('[STREAM_STORE] Some chunk uploads failed', {
        key,
        failedCount: failedUploads,
        totalChunks: chunkKeys.length
      });
      throw new Error(`Failed to upload ${failedUploads} chunks`);
    }
    
    logDebug('[STREAM_STORE] All chunk uploads completed successfully', {
      key,
      chunkCount: chunkKeys.length,
      totalSize: totalProcessedBytes
    });
    
    // Now create and store the manifest
    if (chunkKeys.length > 0) {
      // Create the manifest data that describes how the content is chunked
      const manifestData: ChunkManifest = {
        totalSize: totalProcessedBytes,
        chunkCount: chunkKeys.length,
        actualChunkSizes: actualChunkSizes,
        standardChunkSize: options.chunkSize || STANDARD_CHUNK_SIZE,
        originalContentType: options.contentType,
      };
      
      // Create metadata for the manifest entry
      const manifestEntryMetadata = createBaseMetadata(
        options.sourcePath,
        options.transformOptions,
        'application/json', // The manifest entry itself stores JSON
        JSON.stringify(manifestData).length, // Length of manifest JSON string
        options.cacheVersion,
        ttl
      );

      // Mark as chunked and store actual content size for integrity checks
      manifestEntryMetadata.isChunked = true;
      manifestEntryMetadata.actualTotalVideoSize = totalProcessedBytes;

      // Override the cache tags to ensure they match the original content type
      manifestEntryMetadata.cacheTags = cacheTags;
      
      logDebug('[STREAM_STORE] Storing manifest', { 
        key, 
        manifestSize: JSON.stringify(manifestData).length,
        chunkCount: chunkKeys.length,
        totalSize: totalProcessedBytes
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
        logDebug(
          '[STREAM_STORE] Failed to store manifest', 
          { key }
        );
        return {
          success: false,
          totalSize: totalProcessedBytes,
          chunkKeys,
          actualChunkSizes
        };
      }
      
      // Handle version storage if needed
      if (options.transformOptions.env) {
        await handleVersionStorage(
          namespace, 
          key, 
          options.cacheVersion, 
          options.transformOptions.env, 
          ttl
        );
      }
      
      logDebug('[STREAM_STORE] Successfully stored manifest and all chunks', {
        key,
        chunkCount: chunkKeys.length,
        totalSize: totalProcessedBytes
      });
    }
    
    return {
      success: true,
      totalSize: totalProcessedBytes,
      chunkKeys,
      actualChunkSizes
    };
  } catch (error) {
    logDebug(
      '[STREAM_STORE] Error processing stream chunks',
      {
        key,
        error: error instanceof Error ? error.message : String(error),
        processedBytes: totalProcessedBytes,
        chunkCount: chunkKeys.length
      }
    );
    
    return {
      success: false,
      totalSize: totalProcessedBytes,
      chunkKeys,
      actualChunkSizes
    };
  }
}
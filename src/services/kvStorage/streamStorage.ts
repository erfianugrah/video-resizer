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
  let chunkIndex = 0;
  
  // Small file optimization: if we know from Content-Length it's small, 
  // buffer directly and store as single entry
  const contentLengthHeader = options.transformOptions.contentLength as string | undefined;
  if (contentLengthHeader && parseInt(contentLengthHeader, 10) <= MAX_VIDEO_SIZE_FOR_SINGLE_KV_ENTRY) {
    try {
      logDebug('[STREAM_STORE] Using small file optimization', {
        key,
        contentLength: contentLengthHeader
      });
      
      // Buffer small file directly
      const reader = stream.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        size += value.byteLength;
      }
      
      // Concatenate chunks
      const buffer = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        buffer.set(chunk, offset);
        offset += chunk.byteLength;
      }
      
      // Create single entry metadata
      const singleEntryMetadata = createBaseMetadata(
        options.sourcePath, 
        options.transformOptions, 
        options.contentType, 
        size, 
        options.cacheVersion, 
        ttl
      );
      
      // Mark as non-chunked and store actual size for integrity checks
      singleEntryMetadata.isChunked = false;
      singleEntryMetadata.actualTotalVideoSize = size;
      
      // Store with retry
      const success = await storeWithRetry(
        namespace,
        key,
        buffer.buffer,
        singleEntryMetadata,
        ttl,
        useIndefiniteStorage
      );
      
      if (!success) {
        logDebug('[STREAM_STORE] Failed to store small file directly', { key, size });
        return { success: false, totalSize: size, chunkKeys: [], actualChunkSizes: [] };
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
      
      logDebug('[STREAM_STORE] Successfully stored small file directly', { key, size });
      return { success: true, totalSize: size, chunkKeys: [], actualChunkSizes: [] };
    } catch (smallFileError) {
      // If small file optimization fails, fall back to normal chunking
      logDebug('[STREAM_STORE] Small file optimization failed, falling back to chunking', {
        key,
        error: smallFileError instanceof Error ? smallFileError.message : String(smallFileError)
      });
      
      // Need to clone the stream since we've consumed it
      if (options.transformOptions.response && (options.transformOptions.response as Response).body) {
        stream = (options.transformOptions.response as Response).clone().body!;
      } else {
        return { success: false, totalSize: 0, chunkKeys: [], actualChunkSizes: [] };
      }
    }
  }
  
  try {
    // Set up the reader
    const reader = stream.getReader();
    
    // Create a buffer for accumulating data
    let currentChunkData: Uint8Array[] = [];
    let currentAccumulatedSize = 0;
    
    // Generate cache tags once for all chunks
    const cacheTags = generateCacheTags(options.sourcePath, options.transformOptions, new Headers({
      'Content-Type': options.contentType
    }));

    logDebug('[STREAM_STORE] Processing ReadableStream for KV storage', {
      key,
      contentType: options.contentType
    });
    
    // Define a helper function to store current chunk data
    async function storeCurrentChunk(): Promise<boolean> {
      if (currentChunkData.length === 0) return true;
      
      // Concatenate all the Uint8Arrays in the buffer
      const totalLength = currentChunkData.reduce((sum: number, arr: Uint8Array) => sum + arr.byteLength, 0);
      const combinedChunk = new Uint8Array(totalLength);
      
      let offset = 0;
      for (const chunk of currentChunkData) {
        combinedChunk.set(chunk, offset);
        offset += chunk.byteLength;
      }
      
      const chunkKey = `${key}_chunk_${chunkIndex}`;
      chunkKeys.push(chunkKey);
      actualChunkSizes.push(totalLength);
      totalProcessedBytes += totalLength;
      
      // Enhanced metadata for individual chunks
      const chunkMetadata = {
        parentKey: key,
        chunkIndex: chunkIndex,
        size: totalLength,
        contentType: 'application/octet-stream', // Use octet-stream for chunks
        createdAt: Date.now(),
        cacheTags: cacheTags,
      };
      
      logDebug('[STREAM_STORE] Storing chunk', { 
        key: chunkKey, 
        chunkIndex, 
        size: totalLength,
        totalProcessed: totalProcessedBytes
      });
      
      // Store the chunk with retry
      const success = await storeWithRetry(
        namespace,
        chunkKey,
        combinedChunk.buffer,
        chunkMetadata,
        ttl,
        useIndefiniteStorage
      );
      
      if (success) {
        logDebug('[STREAM_STORE] Successfully stored chunk', { 
          key: chunkKey, 
          chunkIndex,
          size: totalLength
        });
      } else {
        logDebug('[STREAM_STORE] Failed to store chunk', { 
          key: chunkKey, 
          chunkIndex,
          size: totalLength
        });
      }
      
      return success;
    }

    // Process the stream chunk by chunk
    while (true) {
      const { done, value } = await reader.read();
      
      // Break when stream is done
      if (done) {
        // Store any remaining data in the buffer
        if (currentAccumulatedSize > 0) {
          const success = await storeCurrentChunk();
          if (!success) throw new Error(`Failed to store final chunk ${chunkIndex}`);
        }
        break;
      }
      
      // Add the new chunk to our buffer
      currentChunkData.push(value);
      currentAccumulatedSize += value.byteLength;
      
      // If we've accumulated enough data, store it as a chunk
      // Use custom chunk size if provided, otherwise use standard
      const targetChunkSize = options.chunkSize || STANDARD_CHUNK_SIZE;
      if (currentAccumulatedSize >= targetChunkSize) {
        const success = await storeCurrentChunk();
        if (!success) throw new Error(`Failed to store chunk ${chunkIndex}`);
        
        // Reset the buffer
        currentChunkData = [];
        currentAccumulatedSize = 0;
        chunkIndex++;
      }
    }
    
    logDebug('[STREAM_STORE] All chunks processed successfully', {
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
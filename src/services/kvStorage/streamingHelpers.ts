import { ChunkManifest, TransformationMetadata } from './interfaces';
import { logDebug } from './logging';
import { logErrorWithContext } from '../../utils/errorHandlingUtils';
import { getCurrentContext } from '../../utils/legacyLoggerAdapter';
import { STANDARD_CHUNK_SIZE, MAX_VIDEO_SIZE_FOR_SINGLE_KV_ENTRY } from './constants';
import { generateCacheTags } from '../videoStorage/cacheTags';
import { storeWithRetry } from './storageHelpers';
import { createBaseMetadata } from './storageHelpers';

/**
 * Helper function to stream a range of a chunked video with improved robustness
 */
export async function streamChunkedRangeResponse(
  namespace: KVNamespace,
  baseKey: string,
  manifest: ChunkManifest,
  clientRange: { start: number; end: number; total: number },
  writer: WritableStreamDefaultWriter<Uint8Array>,
  kvReadOptions: { cacheTtl?: number } = {}
): Promise<void> {
  // Track state for error handling and cleanup
  let isStreamClosed = false;
  let isStreamAborted = false;
  
  try {
    let bytesSentForRange = 0;
    let currentVideoPos = 0;
    
    // Pre-calculate which chunks we'll need to fetch for this range
    // This allows skipping unnecessary chunks more efficiently
    const chunksToFetch: { 
      index: number; 
      key: string; 
      size: number; 
      sliceStart: number; 
      sliceEnd: number; 
      startPos: number;
    }[] = [];
    
    // First pass: determine needed chunks and slices
    for (let i = 0; i < manifest.chunkCount; i++) {
      const chunkSize = manifest.actualChunkSizes[i];
      const chunkStartInVideo = currentVideoPos;
      const chunkEndInVideo = currentVideoPos + chunkSize - 1;
      
      // Skip chunks that don't overlap with the requested range
      if (clientRange.start > chunkEndInVideo || clientRange.end < chunkStartInVideo) {
        currentVideoPos += chunkSize;
        continue;
      }
      
      // Calculate portion of this chunk needed for the range
      const sliceStartInChunk = Math.max(0, clientRange.start - chunkStartInVideo);
      const sliceEndInChunk = Math.min(chunkSize, (clientRange.end - chunkStartInVideo) + 1);
      
      if (sliceStartInChunk < sliceEndInChunk) {
        chunksToFetch.push({
          index: i,
          key: `${baseKey}_chunk_${i}`,
          size: chunkSize,
          sliceStart: sliceStartInChunk,
          sliceEnd: sliceEndInChunk,
          startPos: chunkStartInVideo
        });
      }
      
      currentVideoPos += chunkSize;
    }
    
    logDebug('[GET_VIDEO] Range request requires fetching chunks', { 
      rangeStart: clientRange.start,
      rangeEnd: clientRange.end,
      chunkCount: chunksToFetch.length,
      totalChunks: manifest.chunkCount
    });
    
    // Second pass: fetch and process chunks
    for (const chunkInfo of chunksToFetch) {
      // Check if stream was aborted during processing
      if (isStreamAborted) {
        logDebug('[GET_VIDEO] Stream was aborted, stopping chunk processing', {
          chunkKey: chunkInfo.key
        });
        break;
      }
      
      logDebug('[GET_VIDEO] Fetching chunk for range', { 
        chunkKey: chunkInfo.key, 
        chunkIndex: chunkInfo.index, 
        expectedSize: chunkInfo.size,
        sliceStart: chunkInfo.sliceStart,
        sliceEnd: chunkInfo.sliceEnd
      });
      
      // Fetch chunk with timeout handling
      let chunkArrayBuffer: ArrayBuffer | null = null;
      try {
        // Use Promise.race for timeout to prevent hanging on problematic chunks
        // Calculate dynamic timeout based on chunk size - larger chunks need more time
        // Base timeout is 5 seconds + 1 second per MB, capped at 30 seconds
        const chunkSizeMB = chunkInfo.size / (1024 * 1024);
        const timeoutMs = Math.min(5000 + Math.ceil(chunkSizeMB) * 1000, 30000);

        const fetchPromise = namespace.get(chunkInfo.key, { type: 'arrayBuffer', ...kvReadOptions });
        const timeoutPromise = new Promise<null>((resolve) => {
          setTimeout(() => {
            logDebug('[GET_VIDEO] Chunk fetch timeout', {
              chunkKey: chunkInfo.key,
              chunkSizeMB: chunkSizeMB.toFixed(2),
              timeoutMs
            });
            resolve(null);
          }, timeoutMs);
        });

        chunkArrayBuffer = await Promise.race([fetchPromise, timeoutPromise]);
      } catch (fetchError) {
        logErrorWithContext(
          '[GET_VIDEO] Error fetching chunk', 
          fetchError, 
          { chunkKey: chunkInfo.key }, 
          'KVStorageService.get'
        );
        
        if (bytesSentForRange === 0) {
          // If we haven't sent any bytes yet, fail the entire operation
          throw new Error(`Failed to fetch initial chunk: ${fetchError instanceof Error ? fetchError.message : String(fetchError)}`);
        }
        
        // For mid-stream errors, log but try to continue with next chunk
        logDebug('[GET_VIDEO] Skipping chunk due to fetch error and continuing', {
          chunkKey: chunkInfo.key,
          bytesSentSoFar: bytesSentForRange
        });
        continue;
      }
      
      if (!chunkArrayBuffer) {
        const errorMsg = `[GET_VIDEO] Chunk data not found or timed out: ${chunkInfo.key}`;
        logErrorWithContext(
          errorMsg, 
          new Error('Missing chunk data'), 
          { chunkKey: chunkInfo.key, chunkIndex: chunkInfo.index }, 
          'KVStorageService.get'
        );
        
        if (bytesSentForRange === 0) {
          // If we haven't sent any bytes yet, fail the entire operation
          throw new Error(errorMsg);
        }
        
        // For mid-stream errors, log but try to continue with next chunk
        logDebug('[GET_VIDEO] Skipping chunk due to missing data and continuing', {
          chunkKey: chunkInfo.key,
          bytesSentSoFar: bytesSentForRange
        });
        continue;
      }
      
      // CRITICAL: Verify chunk size for data integrity
      logDebug('[GET_VIDEO] Retrieved chunk', { 
        chunkKey: chunkInfo.key, 
        chunkIndex: chunkInfo.index, 
        expectedSize: chunkInfo.size, 
        actualSize: chunkArrayBuffer.byteLength 
      });
      
      if (chunkArrayBuffer.byteLength !== chunkInfo.size) {
        const errorMsg = `[GET_VIDEO] CRITICAL CHUNK SIZE MISMATCH for key ${chunkInfo.key}. Expected: ${chunkInfo.size}, Actual: ${chunkArrayBuffer.byteLength}`;
        logErrorWithContext(
          errorMsg, 
          new Error('Chunk size mismatch'), 
          { chunkKey: chunkInfo.key, chunkIndex: chunkInfo.index, expectedSize: chunkInfo.size, actualSize: chunkArrayBuffer.byteLength }, 
          'KVStorageService.get'
        );
        
        if (bytesSentForRange === 0) {
          // If we haven't sent any bytes yet, fail the entire operation
          throw new Error(errorMsg);
        }
        
        // For mid-stream errors, log but try to continue with next chunk
        logDebug('[GET_VIDEO] Skipping chunk due to size mismatch and continuing', {
          chunkKey: chunkInfo.key,
          bytesSentSoFar: bytesSentForRange
        });
        continue;
      }
      
      // Prepare the data slice to send
      const chunkSliceToSend = chunkArrayBuffer.slice(chunkInfo.sliceStart, chunkInfo.sliceEnd);
      
      // Attempt to write to the stream, handling potential errors
      try {
        logDebug('[GET_VIDEO] Writing chunk slice to stream', {
          chunkKey: chunkInfo.key,
          sliceSize: chunkSliceToSend.byteLength,
          bytesSentSoFar: bytesSentForRange
        });

        // Check if stream was aborted during processing
        if (isStreamAborted || isStreamClosed) {
          logDebug('[GET_VIDEO] Stream was closed/aborted before writing chunk slice', {
            chunkKey: chunkInfo.key
          });
          break;
        }

        // Set a timeout for the write operation to detect stalled clients
        const writePromise = writer.write(new Uint8Array(chunkSliceToSend));
        const writeTimeoutMs = Math.max(5000, chunkSliceToSend.byteLength / 5000); // ~5MB/s minimum rate expected

        // Create a timeout promise that resolves to an error after writeTimeoutMs
        const writeTimeoutPromise = new Promise<void>((_, reject) => {
          setTimeout(() => {
            reject(new Error('Write operation timed out, client may be stalled'));
          }, writeTimeoutMs);
        });

        // Race the write operation against the timeout
        await Promise.race([writePromise, writeTimeoutPromise]);

        bytesSentForRange += chunkSliceToSend.byteLength;

        // Log progress for large ranges
        if (bytesSentForRange % 1000000 === 0) { // Log every ~1MB
          logDebug('[GET_VIDEO] Range request streaming progress', {
            bytesSentForRange,
            percentComplete: Math.round((bytesSentForRange / (clientRange.end - clientRange.start + 1)) * 100)
          });
        }
      } catch (writeError) {
        // If write fails, the client likely disconnected
        const errorMessage = writeError instanceof Error ? writeError.message : String(writeError);
        const isTimeoutError = errorMessage.includes('timed out');

        logDebug('[GET_VIDEO] Stream write failed, client may have disconnected', {
          error: errorMessage,
          reason: isTimeoutError ? 'write timeout' : 'stream error',
          chunkKey: chunkInfo.key,
          bytesSentSoFar: bytesSentForRange
        });

        isStreamAborted = true;

        // Try to abort the stream to clean up
        try {
          writer.abort(writeError);
        } catch (abortError) {
          // Ignore errors from aborting
        }

        // Exit the loop as we can't write to this stream anymore
        break;
      }
    }
    
    // Only close the writer if we haven't aborted and it's not already closed
    if (!isStreamAborted && !isStreamClosed) {
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
      try {
        logDebug('[GET_VIDEO] Closing stream writer after successful range response', {
          bytesSent: bytesSentForRange
        });
        
        isStreamClosed = true;
        await writer.close();
      } catch (closeError) {
        logDebug('[GET_VIDEO] Error closing stream writer', {
          error: closeError instanceof Error ? closeError.message : String(closeError)
        });
      }
    }
  } catch (error) {
    logErrorWithContext(
      '[GET_VIDEO] Error streaming chunked range response', 
      error, 
      { baseKey, clientRange }, 
      'KVStorageService.get'
    );
    
    // Attempt to abort the stream if not already aborted/closed
    if (!isStreamAborted && !isStreamClosed) {
      try {
        isStreamAborted = true;
        logDebug('[GET_VIDEO] Aborting stream due to error', {
          error: error instanceof Error ? error.message : String(error)
        });
        writer.abort(error);
      } catch (abortError) {
        // Ignore errors from aborting
      }
    }
    
    throw error;
  }
}

/**
 * Helper function to stream a full chunked video with improved robustness
 */
export async function streamFullChunkedResponse(
  namespace: KVNamespace,
  baseKey: string,
  manifest: ChunkManifest,
  writer: WritableStreamDefaultWriter<Uint8Array>,
  kvReadOptions: { cacheTtl?: number } = {}
): Promise<void> {
  // Track state for error handling and cleanup
  let isStreamClosed = false;
  let isStreamAborted = false;
  
  try {
    let totalBytesSent = 0;
    
    // Log how many chunks we'll need to fetch
    logDebug('[GET_VIDEO] Full content response requires fetching all chunks', { 
      chunkCount: manifest.chunkCount,
      totalSize: manifest.totalSize
    });
    
    // Stream all chunks in order
    for (let i = 0; i < manifest.chunkCount; i++) {
      // Check if stream was aborted during processing
      if (isStreamAborted) {
        logDebug('[GET_VIDEO] Stream was aborted, stopping chunk processing', {
          chunkIndex: i
        });
        break;
      }
      
      const chunkKey = `${baseKey}_chunk_${i}`;
      const expectedChunkSize = manifest.actualChunkSizes[i];
      
      logDebug('[GET_VIDEO] Fetching chunk for full response', { 
        chunkKey, 
        chunkIndex: i, 
        expectedSize: expectedChunkSize 
      });
      
      // Fetch chunk with timeout handling
      let chunkArrayBuffer: ArrayBuffer | null = null;
      try {
        // Use Promise.race for timeout to prevent hanging on problematic chunks
        // Calculate dynamic timeout based on chunk size - larger chunks need more time
        // Base timeout is 5 seconds + 1 second per MB, capped at 30 seconds
        const chunkSizeMB = expectedChunkSize / (1024 * 1024);
        const timeoutMs = Math.min(5000 + Math.ceil(chunkSizeMB) * 1000, 30000);

        const fetchPromise = namespace.get(chunkKey, { type: 'arrayBuffer', ...kvReadOptions });
        const timeoutPromise = new Promise<null>((resolve) => {
          setTimeout(() => {
            logDebug('[GET_VIDEO] Chunk fetch timeout', {
              chunkKey,
              chunkSizeMB: chunkSizeMB.toFixed(2),
              timeoutMs
            });
            resolve(null);
          }, timeoutMs);
        });

        chunkArrayBuffer = await Promise.race([fetchPromise, timeoutPromise]);
      } catch (fetchError) {
        logErrorWithContext(
          '[GET_VIDEO] Error fetching chunk', 
          fetchError, 
          { chunkKey }, 
          'KVStorageService.get'
        );
        
        if (totalBytesSent === 0) {
          // If we haven't sent any bytes yet, fail the entire operation
          throw new Error(`Failed to fetch initial chunk: ${fetchError instanceof Error ? fetchError.message : String(fetchError)}`);
        }
        
        // For mid-stream errors, log but try to continue with next chunk if possible
        logDebug('[GET_VIDEO] Skipping chunk due to fetch error and continuing', {
          chunkKey,
          bytesSentSoFar: totalBytesSent
        });
        continue;
      }
      
      if (!chunkArrayBuffer) {
        const errorMsg = `[GET_VIDEO] Chunk data not found or timed out: ${chunkKey}`;
        logErrorWithContext(
          errorMsg, 
          new Error('Missing chunk data'), 
          { chunkKey, chunkIndex: i }, 
          'KVStorageService.get'
        );
        
        if (totalBytesSent === 0) {
          // If we haven't sent any bytes yet, fail the entire operation
          throw new Error(errorMsg);
        }
        
        // For mid-stream errors, log but try to continue with next chunk
        logDebug('[GET_VIDEO] Skipping chunk due to missing data and continuing', {
          chunkKey,
          bytesSentSoFar: totalBytesSent
        });
        continue;
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
        
        if (totalBytesSent === 0) {
          // If we haven't sent any bytes yet, fail the entire operation
          throw new Error(errorMsg);
        }
        
        // For mid-stream errors, log but try to continue with next chunk
        logDebug('[GET_VIDEO] Skipping chunk due to size mismatch and continuing', {
          chunkKey,
          bytesSentSoFar: totalBytesSent
        });
        continue;
      }
      
      // Attempt to write to the stream, handling potential errors
      try {
        logDebug('[GET_VIDEO] Writing chunk to stream', {
          chunkKey,
          chunkSize: chunkArrayBuffer.byteLength,
          bytesSentSoFar: totalBytesSent
        });

        // Check if stream was aborted or closed during processing
        if (isStreamAborted || isStreamClosed) {
          logDebug('[GET_VIDEO] Stream was closed/aborted before writing chunk', {
            chunkKey
          });
          break;
        }

        // Set a timeout for the write operation to detect stalled clients
        const writePromise = writer.write(new Uint8Array(chunkArrayBuffer));
        const writeTimeoutMs = Math.max(5000, chunkArrayBuffer.byteLength / 5000); // ~5MB/s minimum rate expected

        // Create a timeout promise that resolves to an error after writeTimeoutMs
        const writeTimeoutPromise = new Promise<void>((_, reject) => {
          setTimeout(() => {
            reject(new Error('Write operation timed out, client may be stalled'));
          }, writeTimeoutMs);
        });

        // Race the write operation against the timeout
        await Promise.race([writePromise, writeTimeoutPromise]);

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
      } catch (writeError) {
        // If write fails, the client likely disconnected
        const errorMessage = writeError instanceof Error ? writeError.message : String(writeError);
        const isTimeoutError = errorMessage.includes('timed out');

        logDebug('[GET_VIDEO] Stream write failed, client may have disconnected', {
          error: errorMessage,
          reason: isTimeoutError ? 'write timeout' : 'stream error',
          chunkKey,
          bytesSentSoFar: totalBytesSent
        });

        isStreamAborted = true;

        // Try to abort the stream to clean up
        try {
          writer.abort(writeError);
        } catch (abortError) {
          // Ignore errors from aborting
        }

        // Exit the loop as we can't write to this stream anymore
        break;
      }
    }
    
    // Only close the writer if we haven't aborted and it's not already closed
    if (!isStreamAborted && !isStreamClosed) {
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
      try {
        logDebug('[GET_VIDEO] Closing stream writer after successful full response', {
          bytesSent: totalBytesSent
        });
        
        isStreamClosed = true;
        await writer.close();
      } catch (closeError) {
        logDebug('[GET_VIDEO] Error closing stream writer', {
          error: closeError instanceof Error ? closeError.message : String(closeError)
        });
      }
    }
  } catch (error) {
    logErrorWithContext(
      '[GET_VIDEO] Error streaming full chunked response', 
      error, 
      { baseKey }, 
      'KVStorageService.get'
    );
    
    // Attempt to abort the stream if not already aborted/closed
    if (!isStreamAborted && !isStreamClosed) {
      try {
        isStreamAborted = true;
        logDebug('[GET_VIDEO] Aborting stream due to error', {
          error: error instanceof Error ? error.message : String(error)
        });
        writer.abort(error);
      } catch (abortError) {
        // Ignore errors from aborting
      }
    }
    
    throw error;
  }
}
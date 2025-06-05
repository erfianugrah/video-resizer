import { ChunkManifest, TransformationMetadata } from './interfaces';
import { logDebug } from './logging';
import { logErrorWithContext } from '../../utils/errorHandlingUtils';
import { getCurrentContext } from '../../utils/legacyLoggerAdapter';
import { STANDARD_CHUNK_SIZE, MAX_VIDEO_SIZE_FOR_SINGLE_KV_ENTRY } from './constants';
import { generateCacheTags } from '../videoStorage/cacheTags';
import { storeWithRetry } from './storageHelpers';
import { createBaseMetadata } from './storageHelpers';
import { withTimeout } from '../../utils/streamUtils';

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
    // Use a more memory-efficient approach to track needed chunks
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
    
    // Second pass: fetch and process chunks with prefetching
    let nextChunkPromise: Promise<ArrayBuffer | null> | null = null;
    
    for (let i = 0; i < chunksToFetch.length; i++) {
      const chunkInfo = chunksToFetch[i];
      
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
        sliceEnd: chunkInfo.sliceEnd,
        isPrefetched: !!nextChunkPromise
      });
      
      // Helper function to fetch a chunk
      const fetchChunkWithTimeout = async (info: typeof chunkInfo) => {
        const chunkSizeMB = info.size / (1024 * 1024);
        const timeoutMs = Math.min(5000 + Math.ceil(chunkSizeMB) * 1000, 30000);

        const fetchPromise = namespace.get(info.key, { type: 'arrayBuffer', ...kvReadOptions });
        const timeoutPromise = new Promise<null>((resolve) => {
          setTimeout(() => {
            logDebug('[GET_VIDEO] Chunk fetch timeout', {
              chunkKey: info.key,
              chunkSizeMB: chunkSizeMB.toFixed(2),
              timeoutMs
            });
            resolve(null);
          }, timeoutMs);
        });

        return Promise.race([fetchPromise, timeoutPromise]);
      };
      
      // Use prefetched chunk or fetch current one
      let chunkArrayBuffer: ArrayBuffer | null = null;
      try {
        if (nextChunkPromise) {
          chunkArrayBuffer = await nextChunkPromise;
          nextChunkPromise = null;
        } else {
          chunkArrayBuffer = await fetchChunkWithTimeout(chunkInfo);
        }
        
        // Start prefetching next chunk while processing current one
        if (i + 1 < chunksToFetch.length && !isStreamAborted) {
          const nextChunkInfo = chunksToFetch[i + 1];
          logDebug('[GET_VIDEO] Starting prefetch for next chunk', {
            currentChunk: chunkInfo.index,
            nextChunk: nextChunkInfo.index
          });
          nextChunkPromise = fetchChunkWithTimeout(nextChunkInfo).catch(err => {
            logDebug('[GET_VIDEO] Prefetch error (will retry when needed)', {
              chunkKey: nextChunkInfo.key,
              error: err instanceof Error ? err.message : String(err)
            });
            return null;
          });
        }
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
        const sizeDiff = chunkArrayBuffer.byteLength - chunkInfo.size;
        const percentDiff = (Math.abs(sizeDiff) / chunkInfo.size) * 100;
        
        // Allow small size differences (< 0.1% or < 2KB) to handle edge cases
        // This accounts for potential padding or alignment during concurrent operations
        const isAcceptableDifference = percentDiff < 0.1 || Math.abs(sizeDiff) < 2048;
        
        if (isAcceptableDifference) {
          logDebug('[GET_VIDEO] Minor chunk size difference detected, continuing with actual size', {
            chunkKey: chunkInfo.key,
            expectedSize: chunkInfo.size,
            actualSize: chunkArrayBuffer.byteLength,
            sizeDifference: sizeDiff,
            percentDifference: percentDiff.toFixed(3) + '%'
          });
          
          // Update the chunk info with the actual size for correct slicing
          chunkInfo.size = chunkArrayBuffer.byteLength;
          
          // Recalculate slice boundaries if needed
          const chunkStartInVideo = chunkInfo.startPos;
          const chunkEndInVideo = chunkStartInVideo + chunkArrayBuffer.byteLength - 1;
          
          // Ensure we don't exceed the requested range
          if (clientRange.start <= chunkEndInVideo && clientRange.end >= chunkStartInVideo) {
            chunkInfo.sliceStart = Math.max(0, clientRange.start - chunkStartInVideo);
            chunkInfo.sliceEnd = Math.min(chunkArrayBuffer.byteLength, (clientRange.end - chunkStartInVideo) + 1);
          }
        } else {
          const errorMsg = `[GET_VIDEO] CRITICAL CHUNK SIZE MISMATCH for key ${chunkInfo.key}. Expected: ${chunkInfo.size}, Actual: ${chunkArrayBuffer.byteLength}, Difference: ${sizeDiff}`;
          logErrorWithContext(
            errorMsg, 
            new Error('Chunk size mismatch'), 
            { 
              chunkKey: chunkInfo.key, 
              chunkIndex: chunkInfo.index, 
              expectedSize: chunkInfo.size, 
              actualSize: chunkArrayBuffer.byteLength,
              sizeDifference: sizeDiff,
              isLargerThanExpected: chunkArrayBuffer.byteLength > chunkInfo.size,
              percentDifference: percentDiff.toFixed(2) + '%'
            }, 
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
      }
      
      // Prepare the data slice to send - use Uint8Array.subarray instead of slice to avoid copy
      const chunkData = new Uint8Array(chunkArrayBuffer);
      const chunkSliceToSend = chunkData.subarray(chunkInfo.sliceStart, chunkInfo.sliceEnd);
      
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

        // CRITICAL OPTIMIZATION: Process in smaller segments to avoid memory pressure
        // We'll process in 512KB segments for range requests to prevent memory issues
        const SEGMENT_SIZE = 512 * 1024; // 512KB segments
        const totalSegments = Math.ceil(chunkSliceToSend.byteLength / SEGMENT_SIZE);
        let segmentsSent = 0;
        
        for (let i = 0; i < totalSegments; i++) {
          // Check for abort conditions between segments
          if (isStreamAborted || isStreamClosed) {
            logDebug('[GET_VIDEO] Stream was closed/aborted during segmented range write', {
              chunkKey: chunkInfo.key,
              segment: i,
              totalSegments
            });
            break;
          }
          
          // Calculate segment boundaries
          const start = i * SEGMENT_SIZE;
          const end = Math.min((i + 1) * SEGMENT_SIZE, chunkSliceToSend.byteLength);
          const segmentSize = end - start;
          
          // Create a view of just this segment (no copying)
          const segment = chunkSliceToSend.subarray(start, end);
          
          // Set an adaptive timeout for the segment write operation
          // Scale timeout based on segment size to handle network latency
          // Increased base timeout and reduced minimum throughput requirement for better reliability
          const writeTimeoutMs = Math.max(5000, Math.ceil(segmentSize / 64)); // ~64KB/sec minimum rate
          
          try {
            // Check writer status before attempting to write
            if (writer.desiredSize === null || writer.desiredSize < 0) {
              // Writer is already closed or being closed
              logDebug('[GET_VIDEO] Writer is already closed or being closed', {
                chunkKey: chunkInfo.key,
                segment: i,
                totalSegments,
                desiredSize: writer.desiredSize
              });
              isStreamAborted = true;
              break;
            }
            
            // Double-check the stream is still writable before write attempt
            try {
              // Use the centralized withTimeout utility to avoid hitting timeout limits
              await withTimeout(
                writer.write(segment), 
                writeTimeoutMs,
                'Segment write operation timed out'
              );
            } catch (writeError) {
              // Check if this is a "readable side" error
              const errorMessage = writeError instanceof Error ? writeError.message : String(writeError);
              if (errorMessage.includes('readable side') || errorMessage.includes('TransformStream')) {
                logDebug('[GET_VIDEO] Stream was closed by client during write', {
                  chunkKey: chunkInfo.key,
                  segment: i,
                  totalSegments,
                  error: errorMessage
                });
                isStreamAborted = true;
                break;
              }
              // Re-throw other errors
              throw writeError;
            }
            
            // Check writer status after write (in case it was closed during the write)
            if (writer.desiredSize === null || writer.desiredSize < 0) {
              logDebug('[GET_VIDEO] Writer was closed during write operation', {
                chunkKey: chunkInfo.key,
                segment: i,
                totalSegments,
                desiredSize: writer.desiredSize
              });
              isStreamAborted = true;
              break;
            }
            
            segmentsSent++;
          } catch (segmentError) {
            logDebug('[GET_VIDEO] Range segment write failed', {
              chunkKey: chunkInfo.key,
              segment: i,
              totalSegments,
              error: segmentError instanceof Error ? segmentError.message : String(segmentError)
            });
            
            // Stop processing this chunk on first segment error
            isStreamAborted = true;
            try {
              // Only attempt to abort if the stream hasn't been closed
              if (!isStreamClosed) {
                writer.abort(segmentError);
              }
            } catch (abortError) {
              // Ignore abort errors
            }
            break;
          }
        }
        
        // Only count bytes if all segments were sent successfully
        if (segmentsSent === totalSegments) {
          bytesSentForRange += chunkSliceToSend.byteLength;
        }

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
          error: error instanceof Error ? error.message : String(error),
          isTransformStreamError: error instanceof Error && (
            error.message.includes('TransformStream') || 
            error.message.includes('readable side')
          )
        });
        
        // Check writer state before attempting to abort
        if (writer.desiredSize !== null) {
          writer.abort(error);
        } else {
          logDebug('[GET_VIDEO] Skipping writer abort because writer is already closed', {
            error: error instanceof Error ? error.message : String(error)
          });
        }
      } catch (abortError) {
        // Ignore errors from aborting
        logDebug('[GET_VIDEO] Error occurred during writer abort', {
          error: abortError instanceof Error ? abortError.message : String(abortError)
        });
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

        // CRITICAL OPTIMIZATION: Process chunk in smaller segments to avoid memory pressure
        // We'll process chunks in 1MB segments to prevent memory buildup
        const SEGMENT_SIZE = 1024 * 1024; // 1MB segments
        const totalSegments = Math.ceil(chunkArrayBuffer.byteLength / SEGMENT_SIZE);
        let segmentsSent = 0;
        
        for (let i = 0; i < totalSegments; i++) {
          // Check for abort conditions between segments
          if (isStreamAborted || isStreamClosed) {
            logDebug('[GET_VIDEO] Stream was closed/aborted during segmented write', {
              chunkKey,
              segment: i,
              totalSegments
            });
            break;
          }
          
          // Calculate segment boundaries
          const start = i * SEGMENT_SIZE;
          const end = Math.min((i + 1) * SEGMENT_SIZE, chunkArrayBuffer.byteLength);
          const segmentSize = end - start;
          
          // Create a view (not a copy) of just this segment
          // Use a more efficient approach that avoids copying data
          const chunkData = new Uint8Array(chunkArrayBuffer);
          const segment = chunkData.subarray(start, end);
          
          // Set an adaptive timeout for the segment write operation
          // Scale timeout more generously for full content streaming
          const writeTimeoutMs = Math.max(3000, segmentSize / 64); // ~64KB/sec minimum rate
          
          // Create a timeout promise that resolves to an error after writeTimeoutMs
          const writeTimeoutPromise = new Promise<void>((_, reject) => {
            setTimeout(() => {
              reject(new Error('Segment write operation timed out'));
            }, writeTimeoutMs);
          });
          
          try {
            // Check writer status before attempting to write
            if (writer.desiredSize === null || writer.desiredSize < 0) {
              // Writer is already closed or being closed
              logDebug('[GET_VIDEO] Writer is already closed or being closed', {
                chunkKey,
                segment: i,
                totalSegments,
                desiredSize: writer.desiredSize
              });
              isStreamAborted = true;
              break;
            }
            
            try {
              // Race the write operation against the timeout
              await Promise.race([writer.write(segment), writeTimeoutPromise]);
            } catch (writeError) {
              // Check if this is a "readable side" error
              const errorMessage = writeError instanceof Error ? writeError.message : String(writeError);
              if (errorMessage.includes('readable side') || errorMessage.includes('TransformStream')) {
                logDebug('[GET_VIDEO] Stream was closed by client during write', {
                  chunkKey,
                  segment: i,
                  totalSegments,
                  error: errorMessage
                });
                isStreamAborted = true;
                break;
              }
              // Re-throw other errors
              throw writeError;
            }
            
            // Check writer status after write (in case it was closed during the write)
            if (writer.desiredSize === null || writer.desiredSize < 0) {
              logDebug('[GET_VIDEO] Writer was closed during write operation', {
                chunkKey,
                segment: i,
                totalSegments,
                desiredSize: writer.desiredSize
              });
              isStreamAborted = true;
              break;
            }
            
            segmentsSent++;
          } catch (segmentError) {
            logDebug('[GET_VIDEO] Segment write failed', {
              chunkKey,
              segment: i,
              totalSegments,
              error: segmentError instanceof Error ? segmentError.message : String(segmentError)
            });
            
            // Stop processing this chunk on first segment error
            isStreamAborted = true;
            try {
              // Only attempt to abort if the stream hasn't been closed
              if (!isStreamClosed) {
                writer.abort(segmentError);
              }
            } catch (abortError) {
              // Ignore abort errors
            }
            break;
          }
        }
        
        // Only count bytes if all segments were sent successfully
        if (segmentsSent === totalSegments) {
          totalBytesSent += chunkArrayBuffer.byteLength;
        }

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
          error: error instanceof Error ? error.message : String(error),
          isTransformStreamError: error instanceof Error && (
            error.message.includes('TransformStream') || 
            error.message.includes('readable side')
          )
        });
        
        // Check writer state before attempting to abort
        if (writer.desiredSize !== null) {
          writer.abort(error);
        } else {
          logDebug('[GET_VIDEO] Skipping writer abort because writer is already closed', {
            error: error instanceof Error ? error.message : String(error)
          });
        }
      } catch (abortError) {
        // Ignore errors from aborting
        logDebug('[GET_VIDEO] Error occurred during writer abort', {
          error: abortError instanceof Error ? abortError.message : String(abortError)
        });
      }
    }
    
    throw error;
  }
}
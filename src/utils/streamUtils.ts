/**
 * Centralized streaming utilities for video handling
 * Used across the system for both KV and direct streaming needs
 */
import { logDebug } from '../services/kvStorage/logging';
import { logErrorWithContext } from './errorHandlingUtils';
import { getCurrentContext } from './legacyLoggerAdapter';
import { createLogger, debug, error } from './pinoLogger';
import { addBreadcrumb } from './requestContext';

/**
 * Processes a range request by efficiently streaming only the requested byte range
 * Used for both direct fallback streaming and KV streaming
 * 
 * @param response The full response containing the video data
 * @param start The start byte position
 * @param end The end byte position
 * @param totalSize The total size of the video in bytes
 * @param options Additional options for processing
 * @returns A new 206 Partial Content response
 */
export async function processRangeRequest(
  response: Response,
  start: number,
  end: number,
  totalSize: number,
  options: {
    bypassCacheAPI?: boolean;
    preserveHeaders?: boolean;
    handlerTag?: string;
    fallbackApplied?: boolean;
  } = {}
): Promise<Response> {
  try {
    // Get the current context for logging
    const requestContext = getCurrentContext();
    const logger = requestContext ? createLogger(requestContext) : null;
    
    if (requestContext) {
      addBreadcrumb(requestContext, 'RangeRequest', `Processing range request: bytes=${start}-${end}/${totalSize}`, {
        bypassCacheAPI: options.bypassCacheAPI || false,
        handlerTag: options.handlerTag || 'Stream-Range-Handler',
        fallbackApplied: options.fallbackApplied || false
      });
    }
    
    if (logger && requestContext) {
      debug(requestContext, logger, 'StreamUtils', 'Processing range request', {
        range: `bytes=${start}-${end}`,
        totalSize: totalSize,
        requestedBytes: end - start + 1,
        contentType: response.headers.get('Content-Type'),
        bypassCacheAPI: options.bypassCacheAPI || false,
        handlerTag: options.handlerTag || 'Stream-Range-Handler'
      });
    }
    
    // Use IdentityTransformStream for optimal binary streaming with BYOB support
    // This is more efficient than TransformStream for binary data
    const { readable, writable } = new IdentityTransformStream();
    const writer = writable.getWriter();
    
    // Clone the response only once to avoid consuming it
    const clonedResponse = response.clone();
    const reader = clonedResponse.body?.getReader();
    
    if (!reader) {
      throw new Error('Response body reader could not be obtained');
    }
    
    // Process the stream in the background
    const streamProcessing = async () => {
      let bytesRead = 0;
      let bytesWritten = 0;
      
      try {
        while (true) {
          const { done, value: chunk } = await reader.read();
          
          if (done) break;
          
          if (chunk) {
            const chunkSize = chunk.byteLength;
            const chunkStart = bytesRead;
            const chunkEnd = bytesRead + chunkSize - 1;
            
            // Check if this chunk overlaps our range
            if (chunkEnd >= start && chunkStart <= end) {
              // Calculate the portion of this chunk to include
              const startOffset = Math.max(0, start - chunkStart);
              const endOffset = Math.min(chunkSize, end - chunkStart + 1);
              
              // Use subarray() which creates a view of the original data without copying
              // This avoids memory overhead of creating new arrays while preventing detached ArrayBuffer issues
              const relevantPortion = chunk.subarray(startOffset, endOffset);
              
              // CRITICAL OPTIMIZATION: Process in smaller segments to avoid memory pressure
              // For video streams, always write in small chunks to prevent memory issues with concurrent requests
              const SEGMENT_SIZE = 256 * 1024; // 256KB segments for stream processing
              const totalSegments = Math.ceil(relevantPortion.byteLength / SEGMENT_SIZE);
              
              // Track bytes actually written for this portion
              let portionBytesWritten = 0;
              
              for (let i = 0; i < totalSegments; i++) {
                // Calculate segment boundaries
                const start = i * SEGMENT_SIZE;
                const end = Math.min((i + 1) * SEGMENT_SIZE, relevantPortion.byteLength);
                const segmentSize = end - start;
                
                // Create a view of just this segment (no copying)
                const segment = relevantPortion.subarray(start, end);
                
                try {
                  // Check writer status before attempting to write
                  if (writer.desiredSize === null) {
                    // Writer is already closed or being closed
                    if (logger && requestContext) {
                      debug(requestContext, logger, 'StreamUtils', 'Writer is already closed or being closed', {
                        segment: i,
                        totalSegments,
                        start,
                        end
                      });
                    }
                    throw new Error('Writer is already closed or being closed');
                  }
                  
                  // Write segment with adaptive timeout based on segment size
                  // Larger segments need more time to write, especially with network latency
                  const timeoutMs = Math.max(2000, segment.byteLength / 128); // ~128KB/sec minimum
                  
                  await Promise.race([
                    writer.write(segment),
                    new Promise<void>((_, reject) => 
                      setTimeout(() => reject(new Error('Segment write timed out')), timeoutMs)
                    )
                  ]);
                  
                  // Check writer status after write (in case it was closed during the write)
                  if (writer.desiredSize === null) {
                    if (logger && requestContext) {
                      debug(requestContext, logger, 'StreamUtils', 'Writer was closed during write operation', {
                        segment: i,
                        totalSegments,
                        start,
                        end
                      });
                    }
                    throw new Error('Writer was closed during write operation');
                  }
                  
                  portionBytesWritten += segmentSize;
                } catch (err) {
                  // If writing fails, we'll exit the loop and the function will handle cleanup
                  if (logger && requestContext) {
                    error(requestContext, logger, 'StreamUtils', 'Error writing stream segment', {
                      error: err instanceof Error ? err.message : String(err),
                      segment: i,
                      totalSegments
                    });
                  } else {
                    console.error('Error writing stream segment:', err);
                  }
                  throw err; // Let the outer try/catch handle this
                }
              }
              
              // Track total bytes successfully written
              bytesWritten += portionBytesWritten;
            }
            
            // Track total bytes processed
            bytesRead += chunkSize;
            
            // If we've gone past our range, we can stop
            if (bytesRead > end) break;
          }
        }
        
        // Close the writer when done
        await writer.close();
        
        if (logger && requestContext) {
          debug(requestContext, logger, 'StreamUtils', 'Range request streaming completed', {
            bytesRead,
            bytesWritten,
            expectedBytes: end - start + 1,
            range: `bytes=${start}-${end}`
          });
        }
      } catch (streamError) {
        if (logger && requestContext) {
          error(requestContext, logger, 'StreamUtils', 'Error processing stream for range request', {
            error: streamError instanceof Error ? streamError.message : String(streamError)
          });
        } else {
          console.error('Error processing stream for range request:', streamError);
        }
        
        try {
          writer.abort(streamError);
        } catch (abortError) {
          // Ignore abort errors
        }
      }
    };
    
    // Start processing in the background
    if (requestContext?.executionContext?.waitUntil) {
      requestContext.executionContext.waitUntil(
        streamProcessing().catch(err => {
          if (logger) {
            error(requestContext, logger, 'StreamUtils', 'Background stream processing error', {
              error: err instanceof Error ? err.message : String(err),
              stack: err instanceof Error ? err.stack : undefined,
              isTransformStreamError: err instanceof Error && err.message.includes('TransformStream'),
              range: `bytes=${start}-${end}`
            });
          } else {
            console.error('Background stream processing error:', err);
          }
          
          // Attempt to abort the writer if there's a TransformStream error
          if (err instanceof Error && 
              (err.message.includes('TransformStream') || 
               err.message.includes('readable side') || 
               err.message.includes('Writer is already closed'))) {
            try {
              if (writer.desiredSize !== null) {
                writer.abort(err);
              }
            } catch (abortError) {
              // Ignore abort errors
              if (logger && requestContext) {
                debug(requestContext, logger, 'StreamUtils', 'Failed to abort writer after error', {
                  abortError: abortError instanceof Error ? abortError.message : String(abortError)
                });
              }
            }
          }
        })
      );
    } else {
      void streamProcessing();
    }
    
    // Create headers for the range response
    const headers = options.preserveHeaders ? new Headers(response.headers) : new Headers();
    
    // Essential headers
    headers.set('Content-Range', `bytes ${start}-${end}/${totalSize}`);
    headers.set('Content-Length', String(end - start + 1));
    headers.set('Accept-Ranges', 'bytes');
    headers.set('Content-Type', response.headers.get('Content-Type') || '');
    
    // Handler tag for diagnostics
    headers.set('X-Range-Handled-By', options.handlerTag || 'Stream-Range-Handler');
    
    // Use the centralized bypass headers utility
    const { setBypassHeaders } = await import('./bypassHeadersUtils');
    
    // Handle bypass flags if needed
    if (options.bypassCacheAPI) {
      setBypassHeaders(headers, { isFallback: options.fallbackApplied });
    } else if (options.fallbackApplied) {
      // If it's a fallback but not explicitly bypassing Cache API
      headers.set('X-Fallback-Applied', 'true');
    }
    
    // Create and return a 206 Partial Content response
    return new Response(readable, {
      status: 206,
      statusText: 'Partial Content',
      headers: headers
    });
  } catch (error) {
    logErrorWithContext(
      'Error processing range request',
      error,
      { start, end, totalSize },
      'StreamUtils'
    );
    
    // Return the original response if range handling fails
    return response;
  }
}

/**
 * Parse the HTTP Range header and process the range request
 * 
 * @param response The original full response
 * @param rangeHeader The Range header value (e.g. "bytes=0-1023")
 * @param options Additional options for processing
 * @returns A 206 Partial Content response or the original response if range is invalid
 */
export async function handleRangeRequest(
  response: Response,
  rangeHeader: string | null,
  options: {
    bypassCacheAPI?: boolean;
    preserveHeaders?: boolean;
    handlerTag?: string;
    fallbackApplied?: boolean;
  } = {}
): Promise<Response> {
  try {
    // Get context for logging
    const requestContext = getCurrentContext();
    const logger = requestContext ? createLogger(requestContext) : null;
    
    // Check if range header exists and is valid
    if (!rangeHeader || !rangeHeader.startsWith('bytes=')) {
      if (logger && requestContext) {
        debug(requestContext, logger, 'StreamUtils', 'No valid range header found', {
          rangeHeader: rangeHeader || 'null'
        });
      }
      return response;
    }
    
    // Get content length
    const contentLengthHeader = response.headers.get('Content-Length');
    const contentLength = contentLengthHeader ? parseInt(contentLengthHeader, 10) : 0;
    
    if (!contentLength || contentLength <= 0) {
      if (logger && requestContext) {
        debug(requestContext, logger, 'StreamUtils', 'No valid content length for range processing', {
          contentLength: contentLengthHeader || 'missing'
        });
      }
      return response;
    }
    
    // Import parse function
    const { parseRangeHeader } = await import('./httpUtils');
    const parsedRange = parseRangeHeader(rangeHeader, contentLength);
    
    if (!parsedRange) {
      // If range is unsatisfiable, return 416 with proper headers
      if (logger && requestContext) {
        debug(requestContext, logger, 'StreamUtils', 'Unsatisfiable range request', {
          range: rangeHeader,
          contentLength: contentLength
        });
      }
      
      // Create unsatisfiable range response
      const headers = new Headers(response.headers);
      headers.set('Content-Range', `bytes */${contentLength}`);
      headers.set('Accept-Ranges', 'bytes');
      
      return new Response('Range Not Satisfiable', {
        status: 416,
        headers: headers
      });
    }
    
    // Log the range request details
    if (logger && requestContext) {
      debug(requestContext, logger, 'StreamUtils', 'Valid range request found', {
        rangeHeader,
        start: parsedRange.start,
        end: parsedRange.end,
        contentLength
      });
    }
    
    // Process the range request
    return processRangeRequest(
      response,
      parsedRange.start,
      parsedRange.end,
      contentLength,
      options
    );
  } catch (error) {
    logErrorWithContext(
      'Error handling range request',
      error,
      { rangeHeader },
      'StreamUtils'
    );
    
    // Return the original response if range handling fails
    return response;
  }
}
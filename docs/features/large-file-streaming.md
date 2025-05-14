# Large File Streaming Implementation

## Overview

This document describes the implementation of efficient large file streaming in our video resizer service. This solution addresses memory issues that previously occurred when processing large video files (>100MB) in Cloudflare Workers.

## Problem Statement

When processing large video files (particularly those exceeding 100MB), the video resizer service would encounter memory errors:

```
ReadableStream.tee() buffer limit exceeded
```

This error occurs in Cloudflare Workers when cloning a response with a large body. The issue was particularly prevalent in background caching operations using `waitUntil()`, where the response body was being cloned multiple times.

Additionally, the original implementation would buffer the entire video content into memory before storing it to KV, which could cause another memory error with very large files:

```typescript
// Buffer the entire video for exact size measurement and chunking decision
let videoArrayBuffer: ArrayBuffer;
try {
  videoArrayBuffer = await responseClone.arrayBuffer();
} catch (error) {
  // Error handling
}
```

## Solution: Comprehensive Streaming Architecture

Rather than imposing artificial file size limits, we implemented a comprehensive streaming architecture using the Streams API to handle files of any size:

1. **Single Response Clone**: Response bodies are cloned only once before being passed to background processes
2. **Streaming Read Processing**: Large files are processed as streams without buffering the entire content
3. **Streaming Write Implementation**: Chunks are written to KV as they are read from the stream
4. **Smart Size Detection**: Automatically detects file size and selects optimal storage strategy
5. **Chunked Storage**: Larger files are split into manageable chunks for storage with proper manifest
6. **Memory Management**: Maintains low memory footprint even for files of several hundred megabytes

## Implementation Details

The solution consists of three major components:

### 1. Streaming-Aware Storage in KV Storage Service

We enhanced `storeTransformedVideo` to support a streaming mode:

```typescript
export const storeTransformedVideo = withErrorHandling<
  [/* parameters */],
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
      // Check if we should use streaming mode (either explicitly requested or very large file)
      const contentLengthHeader = response.headers.get('Content-Length');
      const contentLength = contentLengthHeader ? parseInt(contentLengthHeader, 10) : 0;
      const shouldUseStreaming = useStreaming === true || 
                               (contentLength > MAX_VIDEO_SIZE_FOR_SINGLE_KV_ENTRY * 2);
      
      if (shouldUseStreaming) {
        logDebug('KVStorageService', 'Using streaming mode for large file', { 
          sourcePath, 
          contentLength,
          explicitStreaming: useStreaming === true
        });
        
        // Dynamically import the streaming implementation to avoid circular dependencies
        const { storeTransformedVideoWithStreaming } = await import('./streamStorage');
        return await storeTransformedVideoWithStreaming(namespace, sourcePath, response, options, ttl);
      } else {
        // Use the standard implementation for normal files
        return await storeTransformedVideoImpl(namespace, sourcePath, response, options, ttl);
      }
    } catch (err) {
      // Error handling
    }
  },
  /* error handling configs */
);
```

### 2. New Stream-Specific Storage Implementation

We implemented a dedicated streaming storage implementation that processes files chunk-by-chunk:

```typescript
export async function storeTransformedVideoWithStreaming(
  namespace: KVNamespace,
  sourcePath: string,
  response: Response,
  options: { /* options */ },
  ttl?: number
): Promise<boolean> {
  // Verify response body exists
  if (!responseClone.body) {
    return false;
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
      cacheVersion
    },
    ttl,
    useIndefiniteStorage
  );
  
  // Rest of function implementation
}

async function processStreamInChunks(
  namespace: KVNamespace,
  key: string,
  stream: ReadableStream<Uint8Array>,
  options: { /* options */ },
  ttl?: number,
  useIndefiniteStorage?: boolean
): Promise<{
  success: boolean;
  totalSize: number;
  chunkKeys: string[];
  actualChunkSizes: number[];
}> {
  try {
    // Set up the reader
    const reader = stream.getReader();
    
    // Create a buffer for accumulating data
    let currentChunkData: Uint8Array[] = [];
    let currentAccumulatedSize = 0;
    
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
      if (currentAccumulatedSize >= STANDARD_CHUNK_SIZE) {
        const success = await storeCurrentChunk();
        if (!success) throw new Error(`Failed to store chunk ${chunkIndex}`);
        
        // Reset the buffer
        currentChunkData = [];
        currentAccumulatedSize = 0;
        chunkIndex++;
      }
    }
    
    // Process results, create manifest
    // Rest of implementation
  } catch (error) {
    // Error handling
  }
  
  /**
   * Helper function to store the current accumulated data as a chunk
   */
  async function storeCurrentChunk(): Promise<boolean> {
    // Implementation
  }
}
```

### 3. Integration With Fallback Storage

Updated `streamFallbackToKV` to use the streaming-aware storage for background caching:

```typescript
export async function streamFallbackToKV(
  env: EnvVariables,
  sourcePath: string,
  fallbackResponse: Response,
  config: VideoResizerConfig
): Promise<void> {
  try {
    // Check if this is a large file that would benefit from streaming
    const useStreaming = contentLength > 40 * 1024 * 1024; // 40MB threshold for streaming
    
    if (useStreaming) {
      logDebug('VideoStorageService', 'Using streaming mode for large fallback content', {
        path: transformedPath,
        sizeMB: Math.round(contentLength / 1024 / 1024),
        contentType
      });
    }

    // Store in KV with chunking support using streaming for large files
    await storeTransformedVideo(
      env.VIDEO_TRANSFORMATIONS_CACHE,
      transformedPath,
      storageResponse,
      {
        // options
      },
      config?.cache?.ttl?.ok ?? 3600,
      useStreaming // Pass the streaming flag
    );
  } catch (err) {
    // Error handling
  }
}
```

## How It Works

1. **Size Detection**: The system automatically detects large files that would benefit from streaming
2. **Progressive Storage**: Large files are read in manageable chunks (typically 5MB) and stored incrementally
3. **Manifest Creation**: A manifest records information about chunks for later retrieval
4. **Memory Efficiency**: By processing data in chunks, memory usage remains low regardless of total file size
5. **Transparent Implementation**: The streaming functionality is automatically invoked for large files with no user configuration required

## Key Benefits

1. **True Streaming Architecture**: Files of any size can be efficiently processed without buffering the entire content
2. **Automatic Optimization**: Intelligently selects between direct storage (for small files) and streaming (for large files)
3. **Memory-Safe Processing**: Maintains low memory footprint even for very large files (300MB+)
4. **Stable Worker Execution**: Prevents memory-related crashes or timeouts
5. **High-Performance Storage**: Maintains fast processing for small files while supporting large files
6. **Intelligent Chunking**: Splits content into optimally-sized chunks for KV storage

## Testing

The solution has been verified with:

1. Comprehensive unit tests that simulate large file processing
2. Controlled streaming response tests for both small and large files
3. Error handling tests to ensure system resilience 
4. Performance testing for various file sizes

## Future Considerations

1. **Progressive Streaming Support**: Add support for storing partial cache results for interrupted operations
2. **Adaptive Chunk Sizing**: Dynamically adjust chunk sizes based on file characteristics
3. **Bandwidth-Aware Streaming**: Adjust streaming behavior based on origin bandwidth characteristics
4. **Metrics Collection**: Add detailed metrics for streaming operations to monitor performance

## Conclusion

This implementation provides a comprehensive solution for handling files of any size in Cloudflare Workers, eliminating previous memory limitations while maintaining high performance. The architecture ensures that all content, regardless of size, can be properly processed and cached for optimal delivery.
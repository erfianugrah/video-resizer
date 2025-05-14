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

## Solution: Smart Size Detection with 128MB Limit

After extensive testing, we've implemented a pragmatic approach to handling large files based on file size:

1. **Hard 128MB Limit**: Files larger than 128MB are not stored in KV at all
2. **Optimized Streaming**: Files between 40-128MB use streaming techniques to minimize memory usage
3. **Efficient Standard Processing**: Files under 40MB use the regular approach for better performance

This approach provides the following benefits:
- Prevents "ReadableStream.tee() buffer limit exceeded" errors completely
- Avoids memory pressure in Cloudflare Workers (which have a 128MB limit)
- Focuses KV resources on files that can be reliably stored and retrieved
- Maintains compatibility with Cloudflare's architecture limitations
- Improves overall system stability and resource utilization

## Implementation Details

The solution consists of three major components:

### 1. Size-Based Storage Decision in KV Storage Service

We enhanced `storeTransformedVideo` to make intelligent decisions based on file size:

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
      // Check content length
      const contentLengthHeader = response.headers.get('Content-Length');
      const contentLength = contentLengthHeader ? parseInt(contentLengthHeader, 10) : 0;
      
      // Safety check: Skip storing files larger than 128MB to avoid memory issues
      if (contentLength > 128 * 1024 * 1024) {
        // Log the skipped storage
        logDebug('Skipping KV storage for large file', {
          path: sourcePath,
          component: 'KVStorageService',
          size: Math.round(contentLength / 1024 / 1024) + 'MB',
          reason: 'Exceeds 128MB safety limit'
        });
        return false;
      }
      
      // Check if we should use streaming mode (either explicitly requested or large file)
      const shouldUseStreaming = useStreaming === true || 
                              (contentLength > MAX_VIDEO_SIZE_FOR_SINGLE_KV_ENTRY * 2);
      
      if (shouldUseStreaming) {
        logDebug('Using streaming mode for large file', { 
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

### 2. Fallback Storage with Size Limits

Updated `fetchFromFallback` to skip KV storage for extremely large files:

```typescript
// In fetchFromFallbackImpl
// Check if we should store this in KV (in the background)
if (response.ok && env.executionCtx?.waitUntil && env.VIDEO_TRANSFORMATIONS_CACHE) {
  // Get content length to check file size
  const contentLengthHeader = response.headers.get('Content-Length');
  const contentLength = contentLengthHeader ? parseInt(contentLengthHeader, 10) : 0;
  
  // Skip KV storage completely for files larger than 128MB
  if (contentLength > 128 * 1024 * 1024) { // 128MB threshold
    logDebug('VideoStorageService', `Skipping KV storage for large fallback content (${Math.round(contentLength/1024/1024)}MB) - exceeds 128MB limit`, {
      path: transformedPath,
      size: contentLength
    });
  } else {
    // For smaller files, proceed with KV storage
    
    // We need to clone the response before passing it to waitUntil and returning it
    const responseClone = response.clone();
    
    // Use waitUntil to process in the background without blocking the response
    env.executionCtx.waitUntil(
      streamFallbackToKV(env, transformedPath, responseClone, config)
    );
    
    logDebug('VideoStorageService', 'Initiating background storage of fallback content', {
      path: transformedPath,
      size: contentLength || 'unknown'
    });
  }
}
```

### 3. Streaming Implementation For Medium-Sized Files

For files that fall within our storage limits but are still large (40-128MB), we use an optimized streaming approach:

```typescript
export async function streamFallbackToKV(
  env: EnvVariables,
  sourcePath: string,
  fallbackResponse: Response,
  config: VideoResizerConfig
): Promise<void> {
  // Use the correct KV namespace from env
  if (!env.VIDEO_TRANSFORMATIONS_CACHE || !fallbackResponse.body || !fallbackResponse.ok) {
    return;
  }

  try {
    const transformedPath = applyPathTransformation(sourcePath, config, 'fallback');
    const contentType = fallbackResponse.headers.get('Content-Type') || 'video/mp4';
    const contentLength = parseInt(fallbackResponse.headers.get('Content-Length') || '0', 10);
    
    // Safety check: Skip storing files larger than 128MB to avoid memory issues
    if (contentLength > 128 * 1024 * 1024) {
      logDebug('VideoStorageService', 'Skipping KV storage for large file in streamFallbackToKV', {
        path: transformedPath,
        size: Math.round(contentLength / 1024 / 1024) + 'MB',
        reason: 'Exceeds 128MB safety limit'
      });
      return;
    }
    
    logDebug('VideoStorageService', 'Starting background streaming of fallback to KV', { 
      path: transformedPath,
      contentType,
      contentLength 
    });

    // For files close to our limit, use optimized streaming approach
    if (contentLength > 40 * 1024 * 1024) {
      logDebug('KVCache', 'Using optimized streaming for large file', {
        path: transformedPath,
        sizeMB: Math.round(contentLength / 1024 / 1024)
      });
      
      // Use the streaming implementation for these medium-sized files
      // Rest of optimized implementation...
    }
    
    // For smaller files, use standard approach...
  } catch (err) {
    // Error handling
  }
}
```

## How It Works

1. **Size Detection**: The system automatically detects file size and makes processing decisions accordingly:
   - Files > 128MB: Skip KV storage completely (streamed directly from origin)
   - Files 40-128MB: Use optimized streaming techniques for KV storage
   - Files < 40MB: Use standard approach for maximum efficiency

2. **Tiered Processing**:
   - **Direct Streaming**: Extremely large files (>128MB) are streamed directly from origin to client
   - **Optimized Streaming**: Large files (40-128MB) use chunk-based streaming with 5MB chunks
   - **Standard Processing**: Small files use the most efficient direct approach

3. **Safety Measures**:
   - Hard enforced 128MB limit prevents memory issues
   - Skip KV storage completely for any file that could cause memory pressure
   - Multiple checkpoints ensure consistent size validation

4. **Transparent Implementation**: These optimizations are automatically applied without requiring configuration

## Key Benefits

1. **Absolute Reliability**: Completely eliminates "ReadableStream.tee() buffer limit exceeded" errors
2. **Resource Optimization**: Focuses KV storage on files that can be reliably stored
3. **Automatic Detection**: Intelligently selects the appropriate strategy based on file size
4. **Stable Worker Execution**: Prevents memory-related crashes or timeouts
5. **Efficient Resource Usage**: Optimizes both memory usage and KV storage
6. **Simplified Architecture**: Clear, understandable size thresholds for different behaviors

## Testing

The solution has been verified with:

1. Comprehensive unit tests that simulate large file processing
2. Controlled streaming response tests for both small and large files
3. Error handling tests to ensure system resilience 
4. Performance testing for various file sizes

## Future Considerations

1. **Direct Origin Streaming Optimization**: For files >128MB, explore direct-to-R2 streaming solutions
2. **Adaptive Limit Adjustment**: Consider adjusting the 128MB threshold based on real-world metrics 
3. **Origin Acceleration**: For large files that bypass KV, consider alternative edge caching strategies
4. **Metrics Collection**: Add detailed metrics to monitor performance across size tiers

## Conclusion

This implementation provides a pragmatic solution to handling files of various sizes in Cloudflare Workers. Instead of trying to force all files through KV storage (which can cause memory issues), we've implemented a tiered approach that respects the platform's limits while still optimizing performance:

1. Files under 40MB use the most efficient approach for speed
2. Files between 40-128MB use optimized streaming techniques for memory efficiency
3. Files larger than 128MB bypass KV storage completely to prevent memory errors

This approach prioritizes reliability and stability over theoretical capabilities, ensuring that the system operates efficiently within Cloudflare Workers' real-world constraints.
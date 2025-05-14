# Large File Streaming Implementation

## Overview

This document describes the implementation of efficient large file streaming in our video resizer service. This solution addresses memory issues that previously occurred when processing large video files (>100MB) in Cloudflare Workers.

## Problem Statement

When processing large video files (particularly those exceeding 100MB), the video resizer service would encounter memory errors:

```
ReadableStream.tee() buffer limit exceeded
```

This error occurs in Cloudflare Workers when cloning a response with a large body. The issue was particularly prevalent in background caching operations using `waitUntil()`, where the response body was being cloned multiple times.

## Solution: Efficient Streaming with Streams API

Rather than imposing artificial file size limits, we implemented a more efficient approach using the Streams API to handle files of any size:

1. **Single Response Clone**: We ensure that response bodies are cloned only once before being passed to background processes
2. **Direct Stream Consumption**: The response body is consumed directly as a stream, without loading the entire content into memory
3. **Proper Headers Propagation**: Content-Type and Content-Length headers are preserved when streaming
4. **Memory-Efficient Processing**: Chunked storage mechanism processes data in small pieces to avoid memory limits

## Implementation Details

The key components of the implementation are:

### 1. fetchFromFallbackImpl Function

```typescript
// Check if we should store this in KV (in the background)
if (response.ok && env.executionCtx?.waitUntil && env.VIDEO_TRANSFORMATIONS_CACHE) {
  // Get content length to check file size
  const contentLengthHeader = response.headers.get('Content-Length');
  const contentLength = contentLengthHeader ? parseInt(contentLengthHeader, 10) : 0;
  
  // For extremely large files, we'll still process them but log the size
  if (contentLength > 100 * 1024 * 1024) { // 100MB threshold
    logDebug('VideoStorageService', `Processing large fallback content (${Math.round(contentLength/1024/1024)}MB) with streams API`, {
      path: transformedPath,
      size: contentLength
    });
  }
  
  // We need to clone the response before passing it to waitUntil and returning it
  const responseClone = response.clone();
  
  // Use waitUntil to process in the background without blocking the response
  env.executionCtx.waitUntil(
    streamFallbackToKV(env, transformedPath, responseClone, config)
  );
}
```

### 2. streamFallbackToKV Function

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
    
    logDebug('VideoStorageService', 'Starting background streaming of fallback to KV', { 
      path: transformedPath,
      contentType,
      contentLength 
    });

    // Import the storeTransformedVideo function from the correct relative path
    const { storeTransformedVideo } = await import('../../services/kvStorage/storeVideo');
    
    // Create a new response with the body for KV storage
    // Since fallbackResponse was already cloned before being passed to this function,
    // we can just use it directly without another clone
    const storageResponse = new Response(fallbackResponse.body, {
      headers: new Headers({
        'Content-Type': contentType,
        'Content-Length': contentLength ? contentLength.toString() : ''
      })
    });

    // Store in KV with chunking support using existing implementation
    await storeTransformedVideo(
      env.VIDEO_TRANSFORMATIONS_CACHE,
      transformedPath,
      storageResponse,
      {
        width: (config as any).width || null,
        height: (config as any).height || null,
        format: (config as any).format || null,
        env: env
      },
      config?.cache?.ttl?.ok ?? 3600
    );
    
    logDebug('VideoStorageService', 'Successfully stored fallback content in KV', {
      path: transformedPath,
      kvNamespace: 'VIDEO_TRANSFORMATIONS_CACHE'
    });
  } catch (err) {
    logErrorWithContext(
      'Error streaming fallback content to KV',
      err,
      { sourcePath, kvNamespace: 'VIDEO_TRANSFORMATIONS_CACHE' },
      'VideoStorageService'
    );
  }
}
```

### 3. initiateBackgroundCaching in transformationErrorHandler.ts

```typescript
// For extremely large files, we'll still process them using the streams API
if (contentLength > 100 * 1024 * 1024) { // 100MB threshold
  logDebug('handleTransformationError', `Processing large ${contextType} (${Math.round(contentLength/1024/1024)}MB) with streams API`, {
    path,
    pattern: tagInfo?.pattern,
    contentLength,
    status: fallbackResponse.status,
    isLargeVideo: tagInfo?.isLargeVideo
  });
  
  addBreadcrumb(requestContext, 'KVCache', `Using streaming for large ${contextType}`, {
    path,
    pattern: tagInfo?.pattern,
    contentLength,
    isLargeVideo: tagInfo?.isLargeVideo,
    sizeMB: Math.round(contentLength/1024/1024)
  });
}

// Get a fresh clone for KV storage
const fallbackClone = fallbackResponse.clone();

// Use waitUntil to store in the background
env.executionCtx.waitUntil(
  streamFallbackToKV(env, path, fallbackClone, videoConfig)
    .catch(storeError => {
      // Log any errors that occur during background storage
      logErrorWithContext(`Error during background KV storage for ${contextType}`, storeError, {
        path,
        pattern: tagInfo?.pattern,
        requestId: requestContext.requestId,
        isLargeVideo: tagInfo?.isLargeVideo
      }, 'handleTransformationError');
    })
);
```

## Key Improvements

The improved implementation provides:

1. **Size Agnostic Processing**: Efficiently handles files of any size, from small videos to multi-hundred MB files
2. **Memory Efficiency**: Avoids exceeding Worker memory limits by streaming content directly
3. **Reduced Error Rates**: Eliminates "ReadableStream.tee() buffer limit exceeded" errors by managing response cloning properly
4. **Transparent User Experience**: Users receive videos regardless of size, with background caching handled efficiently
5. **Improved Diagnostics**: Added detailed logging for large file processing to assist with monitoring and debugging
6. **Graceful Error Handling**: Prevents user-visible errors when background caching operations fail

## Testing

The solution has been verified with:

1. Comprehensive unit tests that simulate large file processing
2. Integration tests that verify proper behavior with the KV chunking system
3. Error handling tests to ensure system resilience
4. Log verification for proper diagnostics

## Future Considerations

1. **Configurable Size Thresholds**: Size thresholds could be made configurable via the video-resizer config
2. **Enhanced Monitoring**: Consider adding metrics for large file processing success rates
3. **Adaptive Streaming**: Implement adaptive chunk sizes based on file sizes for optimal performance

By efficiently handling large files through streaming, the video resizer service can now reliably process videos of any size within the constraints of the Cloudflare Workers platform.
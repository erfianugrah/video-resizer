# Large File Streaming Implementation

*Last Updated: December 9, 2025*

## Overview

Large video responses are handled with a mix of single-entry KV storage, chunked storage, and streamed fallback storage to avoid memory pressure in Workers.

## Size thresholds

- **≤20 MiB**: stored as a single KV entry.
- **>20 MiB**: chunked at **5 MiB** per chunk with a manifest.
- **>128 MiB (fallback fetches only)**: skipped for KV storage entirely to avoid memory pressure.

## Storage paths

### Main transform path (`storeVideo.ts`)
- The response body is buffered once to determine size and to build chunk manifests when needed.
- Chunk writes are locked per chunk key and tagged for purging.
- Background storage is triggered from `cacheOrchestrator` using `waitUntil` with retries.

```typescript
// storeVideo.ts (size decision)
const totalBytes = videoArrayBuffer.byteLength;
if (totalBytes <= MAX_VIDEO_SIZE_FOR_SINGLE_KV_ENTRY) {
  await namespace.put(key, videoArrayBuffer, { metadata });
} else {
  await writeChunks(namespace, key, videoArrayBuffer, metadata); // 5 MiB chunks
}
```

### Fallback storage (`fallbackStorage.ts`)
- Streams responses into 10 MB chunks directly to KV when a fallback source succeeds.
- Skips KV storage when the content length exceeds 128 MB.
- Uses streaming to avoid cloning large bodies multiple times.

```typescript
// fallbackStorage.ts (skip >128 MB)
const contentLength = parseInt(response.headers.get('Content-Length') || '0', 10);
if (contentLength > 128 * 1024 * 1024) return response;
env.executionCtx.waitUntil(streamFallbackToKV(env, transformedPath, response.clone(), config));
```

## Range-friendly retrieval

- `getVideo.ts` and `streamingHelpers.ts` read only the required chunks for a Range request.
- Segmenting (512 KB–1 MB slices) keeps per-request memory small even when chunks are large.
- If a Range is unsatisfiable, the full response is returned instead of 416 to keep playback stable.

## Operational notes

- Prefer supplying `Content-Length` headers from origins; it enables early decisions on chunking/skipping.
- Monitor debug breadcrumbs for `chunkCount`, `chunkSizeMismatch`, and fallback skip decisions.
- KV storage for fallbacks is best-effort; skipping >128 MB content is expected behaviour, not an error.

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

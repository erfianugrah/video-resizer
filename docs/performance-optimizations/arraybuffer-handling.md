# ArrayBuffer Handling and Stream Management

*Last Updated: January 2025*

## Overview

This document describes the ArrayBuffer handling improvements implemented to prevent "Cannot perform Construct on a detached ArrayBuffer" errors when storing videos in KV cache.

## The Problem

When storing videos in KV cache, the previous implementation used `waitUntil()` to store videos asynchronously while simultaneously serving the response to the client. This caused ArrayBuffer detachment errors because:

1. The response body was being consumed by the client stream
2. The same response was being read for KV storage
3. ArrayBuffers can only be consumed once

## The Solution

The implementation was changed to use a "store-first-then-retrieve" pattern:

### Before (Problematic)
```typescript
// This caused ArrayBuffer detachment
const response = await transform();
ctx.waitUntil(storeInKVCache(response.clone()));
return response; // Stream to client while storing
```

### After (Fixed)
```typescript
// Store first, then retrieve
const response = await transform();
const stored = await storeInKVCache(response);
if (stored) {
  const kvResponse = await getFromKVCache();
  return kvResponse; // Serve from KV
}
return response; // Fallback to original
```

## Implementation Details

### 1. Synchronous Storage

The KV storage operation is now performed synchronously before serving the response:

```typescript
// Store in KV synchronously to ensure it completes before serving
storedInKV = await storeInKVCache(env, sourcePath, response, videoOptionsForKV);

if (storedInKV) {
  // Retrieve from KV to serve
  const kvResponse = await getFromKVCache(env, sourcePath, videoOptionsForKV, request);
  
  if (kvResponse) {
    // Ensure Accept-Ranges header is set for video responses
    if (kvResponse.headers.get('Content-Type')?.includes('video/')) {
      const headers = new Headers(kvResponse.headers);
      if (!headers.has('Accept-Ranges')) {
        headers.set('Accept-Ranges', 'bytes');
      }
      finalResponse = new Response(kvResponse.body, {
        status: kvResponse.status,
        statusText: kvResponse.statusText,
        headers: headers
      });
    }
  }
}
```

### 2. Range Request Support

The implementation ensures proper range request support by:
- Adding `Accept-Ranges: bytes` header to video responses
- Passing the request object through to KV retrieval for range handling

### 3. Affected Files

The following files were updated with this pattern:
- `/src/handlers/videoHandlerWithOrigins.ts`
- `/src/handlers/videoHandler.ts` (uses waitUntil but with proper cloning)
- `/src/utils/cacheOrchestrator.ts` (uses waitUntil with careful stream management)

## Benefits

1. **Eliminates ArrayBuffer Errors**: No more detachment errors during concurrent operations
2. **Reliable Video Playback**: Videos play correctly after being stored in KV
3. **Proper Range Support**: Range requests work correctly for cached videos
4. **Consistent Behavior**: Same pattern across all handlers

## Performance Considerations

While the synchronous approach adds slight latency to the first request, it ensures:
- Reliable storage without errors
- Immediate availability for subsequent requests
- No failed playback due to corrupted storage

## Best Practices

1. **Always store before serving** when dealing with stream bodies
2. **Clone responses carefully** - each clone can only be consumed once
3. **Test with actual video playback** to ensure streams work correctly
4. **Monitor for ArrayBuffer errors** in production logs

## Related Documentation

- [KV Chunking](../features/kv-chunking.md) - How large videos are stored
- [Large File Streaming](../features/large-file-streaming.md) - Stream handling for large videos
- [Cache Management](../caching/cache-api.md) - Overall caching strategy
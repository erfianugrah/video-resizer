# Range Request Support for Video Streaming

This document details the implementation and benefits of range request support in the video-resizer service, enabling efficient video seeking, streaming, and partial content delivery.

## Overview

Range requests allow clients to request only a specific portion of a resource by using the HTTP `Range` header. For video content, this enables:

- Seeking to specific timestamps without downloading the entire video
- Fast-forward and rewind operations in video players
- Resumable downloads if connections are interrupted
- Efficient bandwidth usage, especially for large videos

The video-resizer service provides robust support for range requests, even for first-time video access, ensuring a smooth playback experience in all scenarios.

## Implementation Architecture

The range request handling system uses a multi-layered approach:

### 1. Cache API Integration (First Access)

When a video is first requested with a range header:

1. The full video response is stored in the temporary Cache API
2. The Cache API's built-in range request handling is used to serve the requested range
3. This happens in parallel with KV storage (using waitUntil)
4. Cache entries respect similar expiration periods as the KV storage TTL configuration
5. The client receives only the requested byte range as a 206 Partial Content response

```
┌─────────────┐    Range Request    ┌─────────────┐
│             │─────────────────────▶             │
│   Client    │                     │ video-      │
│   Browser   │                     │ resizer     │
│             │◀────────────────────│ Worker      │
└─────────────┘ 206 Partial Content └──────┬──────┘
                                           │
                        ┌──────────────────┼──────────────────┐
                        │                  │                  │
                        ▼                  ▼                  ▼
                  ┌──────────┐      ┌──────────┐       ┌────────────┐
                  │ Transform│      │Store Full│       │Store in KV │
                  │   Video  │      │Response in│      │(waitUntil) │
                  │          │      │Cache API  │      │            │
                  └──────────┘      └──────────┘       └────────────┘
```

### 2. KV Cache Layer (Subsequent Access)

For subsequent requests to the same video:

1. Requests are first checked against KV cache
2. Range requests are handled by slicing the stored complete video
3. Custom range handling implementation provides efficient byte range responses
4. The system avoids redundant transformations for the same video

### 3. Manual Fallback Mechanism

If the Cache API is unavailable or fails:

1. The system falls back to manual range extraction
2. The full response is converted to an ArrayBuffer
3. The requested byte range is extracted using slice() operations
4. A properly formatted 206 Partial Content response is returned

## Technical Implementation Details

### Range Request Detection

Range requests are detected by:
1. Checking for the presence of the HTTP `Range` header
2. Validating that the header follows the format `bytes=start-end`
3. Ensuring the range is satisfiable given the resource size

```typescript
// Example Range header
// Range: bytes=0-1023
```

### Cache API Integration

The Cache API provides built-in range request support:

```typescript
// Store full response in cache
await cache.put(cacheKey, originalResponse.clone());

// Create a request with Range header
const rangeRequest = new Request(url, {
  headers: new Headers({
    'Range': 'bytes=0-1023'
  })
});

// Cache.match automatically handles the range request
const rangeResponse = await cache.match(rangeRequest);
```

### Expiration and TTL Handling

The system ensures consistent expiration handling across all storage layers:

```typescript
// For KV storage: Set expirationTtl parameter explicitly
await namespace.put(key, videoData, { 
  metadata, 
  expirationTtl: ttl // Seconds until this key expires
});

// For KV metadata: Track expiration for Cache-Control headers
metadata.expiresAt = Date.now() + (ttl * 1000); // Timestamp when this item expires

// For Cache API: Extract TTL from Cache-Control when available
const cacheControl = response.headers.get('Cache-Control');
if (cacheControl && cacheControl.includes('max-age=')) {
  const match = cacheControl.match(/max-age=(\d+)/);
  if (match && match[1]) {
    ttl = parseInt(match[1], 10); // Use same TTL as origin or transform response
  }
}
```

The TTL values are determined from configuration profiles based on:
- Response status code category (2xx, 3xx, 4xx, 5xx)
- Content type (video vs other)
- Path-based caching profiles
- Custom TTL settings from configuration

#### Automatic TTL Renewal

The system includes smart TTL renewal for frequently-accessed videos:

```typescript
// On cache hit, refresh TTL if video has been accessed for a while
if (requestContext.executionContext?.waitUntil) {
  // Only refresh if reasonably old (>25% of TTL elapsed)
  const elapsed = Math.floor((Date.now() - metadata.createdAt) / 1000);
  const remaining = Math.floor((metadata.expiresAt - Date.now()) / 1000);
  
  if (elapsed > originalTtl * 0.25 && remaining > 60) {
    // Use waitUntil to avoid blocking response
    requestContext.executionContext.waitUntil(
      namespace.put(key, value, { 
        metadata: clonedMetadata, 
        expirationTtl: originalTtl // Use same TTL as original storage
      })
    );
  }
}
```

This ensures that:
- Frequently accessed videos stay in cache longer
- Cache refreshes occur in the background without affecting response time
- Original TTL values are respected and consistently applied

### Fallback Mechanism

The manual fallback uses ArrayBuffer manipulation:

```typescript
// Extract the range
const { start, end } = parsedRange;
const fullContent = await response.arrayBuffer();
const rangeContent = fullContent.slice(start, end + 1);

// Create proper 206 response
return new Response(rangeContent, {
  status: 206,
  headers: new Headers({
    'Content-Range': `bytes ${start}-${end}/${totalSize}`,
    'Content-Length': String(rangeContent.byteLength),
    'Accept-Ranges': 'bytes'
  })
});
```

## Response Headers

For range requests, the following headers are crucial:

| Header | Description | Example |
|--------|-------------|---------|
| `Accept-Ranges` | Indicates range request support | `Accept-Ranges: bytes` |
| `Content-Range` | Specifies the byte range returned | `Content-Range: bytes 0-1023/10240` |
| `Content-Length` | Size of the returned range | `Content-Length: 1024` |

## Performance Benefits

1. **Faster Initial Seeking:** Users can immediately seek through videos without waiting for full download
2. **Reduced Bandwidth:** Only requested segments are transferred, saving bandwidth
3. **Improved UX:** Video players provide immediate response to seeking operations
4. **Resilient Design:** Multiple fallback mechanisms ensure range requests work in all environments

## Testing

The range request handling is covered by comprehensive tests:
- Unit tests for range header parsing
- Integration tests for Cache API interaction
- Edge case handling for unsatisfiable ranges
- Fallback mechanism verification

## Best Practices for Clients

For optimal range request performance:

1. **HTML5 Video Tag:** Modern browsers automatically use range requests with the video tag
2. **Player Configuration:** Ensure video players are configured to use native seeking
3. **Progressive Enhancement:** Provide fallback behavior for older browsers without range support

```html
<video src="https://cdn.example.com/videos/sample.mp4" controls>
  Your browser does not support HTML5 video.
</video>
```

## Related Features

- [Video Mode](./video-mode.md) - Core video transformation capabilities
- [KV Caching System](../kv-caching/README.md) - Details on the persistent storage layer

## Future Enhancements

Planned improvements to range request handling:

1. Adaptive bitrate streaming support (HLS/DASH)
2. Enhanced analytics for range request patterns
3. Further optimization for large video files
4. Smart prefetching of likely-to-be-requested ranges

## Last Updated

*April 29, 2025* (TTL Handling added)
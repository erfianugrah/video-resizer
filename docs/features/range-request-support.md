# Range Request Support

*Last Updated: May 10, 2025*

## Table of Contents

- [Overview](#overview)
- [How Range Requests Work](#how-range-requests-work)
- [Implementation Details](#implementation-details)
- [Cache Synchronization](#cache-synchronization)
- [Automatic TTL Renewal](#automatic-ttl-renewal)
- [Supporting Headers](#supporting-headers)
- [Edge Cases and Handling](#edge-cases-and-handling)
- [Performance Optimizations](#performance-optimizations)
- [Configuration Options](#configuration-options)
- [Debugging Range Requests](#debugging-range-requests)
- [Integration with Player Technologies](#integration-with-player-technologies)
- [Best Practices](#best-practices)
- [Common Issues](#common-issues)

## Overview

Range request support in the Video Resizer enables efficient video streaming, seeking, and partial content delivery. This feature allows video players to request specific portions (or "ranges") of a video file rather than downloading the entire content, which is essential for:

- Fast video seeking and scrubbing
- Efficient video streaming
- Reduced bandwidth consumption
- Improved playback experience
- Resumable downloads

The implementation fully complies with HTTP/1.1 Range Requests (RFC 7233) and integrates seamlessly with the caching system for optimal performance.

## How Range Requests Work

Range requests use the `Range` HTTP header to specify which portion of a resource to return:

```
Range: bytes=1024-2047
```

This requests bytes 1024 through 2047 (inclusive) of the resource.

The server responds with a `206 Partial Content` status and the `Content-Range` header:

```
HTTP/1.1 206 Partial Content
Content-Range: bytes 1024-2047/146515
Content-Length: 1024
```

This indicates that the response contains bytes 1024-2047 of a 146,515-byte resource.

### Common Range Formats

| Range Format | Description | Example | Meaning |
|--------------|-------------|---------|---------|
| `bytes=X-Y` | Specific range | `bytes=1024-2047` | Bytes 1024 to 2047 |
| `bytes=X-` | Range to end | `bytes=1024-` | Bytes 1024 to end |
| `bytes=-Y` | Last Y bytes | `bytes=-1024` | Last 1024 bytes |
| `bytes=0-0,-1` | Multiple ranges | `bytes=0-0,-1` | First and last byte |

## Implementation Details

The Video Resizer implements range request support at multiple levels:

### 1. Direct Range Handling

For uncached videos, range requests are:
1. Detected by checking for the `Range` header
2. Validated against the requested resource
3. Forwarded to the origin with the same range
4. Processed and returned with proper `206 Partial Content` status

### 2. Cache API Integration

For cached videos, the system leverages Cloudflare's Cache API which has built-in range request handling:

```typescript
// Store a full response in cache with Accept-Ranges header
const fullResponse = await videoTransform(request);
const headersWithRange = new Headers(fullResponse.headers);
headersWithRange.set('Accept-Ranges', 'bytes');
headersWithRange.set('Content-Length', body.byteLength.toString());

const cacheableResponse = new Response(body, {
  status: fullResponse.status,
  headers: headersWithRange
});

// Store in cache with a simplified key (no Range header)
const cacheKey = new Request(url, { method: 'GET' });
await cache.put(cacheKey, cacheableResponse);

// Later, a range request can be served from this cached resource
// The Cache API automatically handles the range extraction
```

### 3. KV Range Support

For KV-cached videos, the system:
1. Retrieves the entire resource from KV
2. Extracts the requested range
3. Constructs a proper `206 Partial Content` response

```typescript
// Handle ranges for KV cache
if (rangeHeader && kvCachedResponse) {
  const contentLength = parseInt(kvCachedResponse.headers.get('Content-Length') || '0');
  
  // Parse the range header
  const range = parseRangeHeader(rangeHeader, contentLength);
  
  if (range) {
    // Get the full body
    const fullBody = await kvCachedResponse.arrayBuffer();
    
    // Extract the requested range
    const rangeBody = fullBody.slice(range.start, range.end + 1);
    
    // Create a new response with the partial content
    const partialResponse = new Response(rangeBody, {
      status: 206,
      headers: new Headers(kvCachedResponse.headers)
    });
    
    // Set appropriate headers
    partialResponse.headers.set('Content-Range', `bytes ${range.start}-${range.end}/${contentLength}`);
    partialResponse.headers.set('Content-Length', rangeBody.byteLength.toString());
    
    return partialResponse;
  }
}
```

## Cache Synchronization

Range requests introduce special caching considerations that the Video Resizer addresses:

### 1. Cache Key Normalization

Range requests use the same cache key as full requests:

```typescript
// Creating a normalized cache key without Range headers
const normalizedRequest = new Request(request.url, {
  method: request.method,
  headers: stripRangeHeaders(request.headers)
});
```

This ensures that a single cached resource can serve both full and range requests.

### 2. Synchronous Caching

The implementation uses synchronous caching to ensure cache consistency:

```typescript
// Execute the cache operation synchronously
await cachePutOperation();

// Now we can safely return a response from the cache
const cachedResponse = await cache.match(request);
if (cachedResponse) {
  return cachedResponse;
}
```

This approach avoids race conditions and ensures that the Range request mechanism works correctly.

### 3. Content Validation

Each range response includes validation headers:

```typescript
// Add validation headers to range responses
rangeResponse.headers.set('ETag', `"${hashCode}-${Date.now().toString(36)}"`);
rangeResponse.headers.set('Last-Modified', new Date().toUTCString());
```

These headers allow clients to validate cached ranges and make conditional requests for improved efficiency.

## Automatic TTL Renewal

The range request system implements "automatic TTL renewal" for frequently accessed videos:

### How It Works

1. When a range request is received for a cached video:
   - The system checks if the video is nearing its cache expiration
   - If it's within a configurable threshold (e.g., 20% of TTL remaining)
   - The TTL is automatically extended

2. This ensures that frequently watched videos remain cached:
   - Videos that are actively being watched don't expire mid-playback
   - Popular videos stay in cache longer
   - Edge cache resources are used efficiently

```typescript
// Automatic TTL renewal for range requests
if (isRangeRequest && cacheResponse) {
  const originalTtl = parseInt(cacheResponse.headers.get('X-Original-TTL') || '0');
  const cacheTime = parseInt(cacheResponse.headers.get('X-Cache-Time') || '0');
  const currentTime = Date.now();
  const elapsedTime = (currentTime - cacheTime) / 1000;
  const remainingTime = originalTtl - elapsedTime;
  const renewalThreshold = originalTtl * 0.2; // 20% of original TTL
  
  // If we're within 20% of expiration, renew the TTL
  if (remainingTime > 0 && remainingTime < renewalThreshold) {
    // Extend the TTL by storing again with a fresh TTL
    const clonedResponse = new Response(await cacheResponse.clone().arrayBuffer(), {
      status: cacheResponse.status,
      headers: new Headers(cacheResponse.headers)
    });
    
    // Update cache metadata
    clonedResponse.headers.set('X-Cache-Time', currentTime.toString());
    
    // Store with a new TTL
    ctx.waitUntil(cache.put(request, clonedResponse, {
      expirationTtl: originalTtl
    }));
    
    // Log the renewal
    logInfo('Renewed TTL for range request', {
      url: request.url,
      originalTtl,
      remainingTime,
      renewalThreshold
    });
  }
}
```

## Supporting Headers

Several HTTP headers are critical for range request support:

| Header | Purpose | Example |
|--------|---------|---------|
| `Accept-Ranges` | Indicates range request support | `Accept-Ranges: bytes` |
| `Content-Length` | Total size of the resource | `Content-Length: 146515` |
| `Content-Range` | Range returned in the response | `Content-Range: bytes 1024-2047/146515` |
| `ETag` | Resource version identifier | `ETag: "3f80f-1b6-3e1cb03b"` |
| `Last-Modified` | Resource modification date | `Last-Modified: Tue, 15 Nov 2023 12:45:26 GMT` |

The Video Resizer ensures all these headers are correctly set on responses to support seamless range requests.

## Edge Cases and Handling

### 1. Malformed Range Requests

The system validates and sanitizes range headers:

```typescript
function parseRangeHeader(rangeHeader: string, contentLength: number): Range | null {
  // Range format: "bytes=start-end"
  const match = rangeHeader.match(/bytes=(\d*)-(\d*)/);
  if (!match) return null;
  
  let start = match[1] ? parseInt(match[1], 10) : 0;
  let end = match[2] ? parseInt(match[2], 10) : contentLength - 1;
  
  // Validate and adjust range
  if (isNaN(start) || isNaN(end) || start < 0 || end >= contentLength || start > end) {
    return null; // Invalid range
  }
  
  return { start, end };
}
```

If a range is invalid, the system returns a `416 Range Not Satisfiable` response.

### 2. Multi-Part Ranges

While the HTTP standard supports multiple ranges in a single request, the Video Resizer currently handles only single ranges:

```
Range: bytes=0-499, 500-999, 1000-1499
```

When multiple ranges are requested, the system returns the entire content with a `200 OK` status instead of a `206 Partial Content` status with multiple parts.

### 3. If-Range Conditional Requests

The system supports `If-Range` conditional requests:

```
If-Range: "3f80f-1b6-3e1cb03b"
Range: bytes=1024-2047
```

If the resource has changed (ETag doesn't match), the entire resource is returned instead of the requested range.

## Performance Optimizations

The range request implementation includes several optimizations:

### 1. Range Prediction

For video streaming, the system can predict future ranges:

```typescript
if (isVideoStreaming(request) && rangeHeader) {
  // Parse current range
  const currentRange = parseRangeHeader(rangeHeader, contentLength);
  
  // Predict next range based on typical video chunk size
  const predictedStart = currentRange.end + 1;
  const chunkSize = currentRange.end - currentRange.start + 1;
  const predictedEnd = Math.min(predictedStart + chunkSize - 1, contentLength - 1);
  
  // Prefetch the next chunk in the background
  ctx.waitUntil(prefetchRange(request, predictedStart, predictedEnd));
}
```

This technique improves streaming performance by preparing future chunks before they're requested.

### 2. Byte Range Caching

Edge locations cache byte ranges separately:

```typescript
// Add caching directives for range requests
rangeResponse.headers.set('Cache-Control', 'public, max-age=86400');
rangeResponse.headers.set('X-Range-Cache', 'true');
```

This allows edge locations to efficiently serve popular video segments without fetching the entire video.

### 3. Parallel Range Processing

For KV-cached videos, multiple ranges can be processed in parallel:

```typescript
// Process multiple ranges in parallel
if (multiRangeRequest) {
  const rangePromises = ranges.map(range => 
    processRange(fullBody, range.start, range.end, contentLength)
  );
  const rangeResponses = await Promise.all(rangePromises);
  // Combine range responses
}
```

This optimization improves performance for complex range requests.

## Configuration Options

Range request behavior can be configured:

```json
{
  "rangeRequests": {
    "enabled": true,
    "enableTtlRenewal": true,
    "ttlRenewalThreshold": 0.2,
    "maxRange": 10485760,
    "enablePrediction": true,
    "predictedChunkSize": 1048576,
    "kvImplementation": "arrayBuffer",
    "multiRangeSupport": false,
    "addValidationHeaders": true
  }
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | boolean | true | Enable range request support |
| `enableTtlRenewal` | boolean | true | Enable automatic TTL renewal |
| `ttlRenewalThreshold` | number | 0.2 | Percentage of TTL remaining to trigger renewal |
| `maxRange` | number | 10485760 | Maximum range size in bytes (10MB) |
| `enablePrediction` | boolean | true | Enable range prediction for streaming |
| `predictedChunkSize` | number | 1048576 | Size of predicted chunks in bytes (1MB) |
| `kvImplementation` | string | "arrayBuffer" | KV range extraction method |
| `multiRangeSupport` | boolean | false | Enable multi-part range support |
| `addValidationHeaders` | boolean | true | Add ETag and Last-Modified headers |

## Debugging Range Requests

Range request behavior can be debugged using the debug mode:

```
https://cdn.example.com/videos/sample.mp4?debug=view
```

The debug UI includes a "Range Requests" section with:
- Requested range information
- Processing method used
- Cache integration details
- TTL renewal status
- Headers applied to the response

For range-specific debugging, use:

```
https://cdn.example.com/videos/sample.mp4?debug=headers&debug-focus=range
```

This focuses on range request headers in a more lightweight format.

## Integration with Player Technologies

The range request implementation works seamlessly with various video player technologies:

### HTML5 Video

The native HTML5 video element automatically uses range requests for seeking:

```html
<video src="https://cdn.example.com/videos/sample.mp4" controls></video>
```

No special configuration is needed; the browser handles range requests automatically.

### HLS and DASH

For adaptive streaming formats:

```html
<video id="video" controls></video>
<script src="https://cdn.jsdelivr.net/npm/hls.js@latest"></script>
<script>
  const video = document.getElementById('video');
  const videoSrc = 'https://cdn.example.com/videos/sample.m3u8';
  
  if (Hls.isSupported()) {
    const hls = new Hls();
    hls.loadSource(videoSrc);
    hls.attachMedia(video);
  } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = videoSrc;
  }
</script>
```

The Video Resizer handles range requests for both segment requests and full video fallbacks.

### Media Source Extensions (MSE)

For custom players using MSE:

```javascript
const mediaSource = new MediaSource();
video.src = URL.createObjectURL(mediaSource);

mediaSource.addEventListener('sourceopen', async () => {
  const sourceBuffer = mediaSource.addSourceBuffer('video/mp4; codecs="avc1.42E01E, mp4a.40.2"');
  
  // Fetch video chunks with range requests
  const response = await fetch('https://cdn.example.com/videos/sample.mp4', {
    headers: { Range: 'bytes=0-1048575' }
  });
  
  const chunk = await response.arrayBuffer();
  sourceBuffer.appendBuffer(chunk);
});
```

## Best Practices

1. **Ensure Content-Length is Accurate**:
   - Accurate `Content-Length` headers are critical for range requests
   - This allows clients to make precise range calculations
   - The Video Resizer automatically ensures this header is set correctly

2. **Use Appropriate Chunk Sizes**:
   - Most players request 1-2MB chunks
   - Configure your player's buffer size to match your audience's typical connection speed
   - For mobile-optimized sites, smaller chunks (512KB-1MB) may be appropriate

3. **Enable Validation Headers**:
   - `ETag` and `Last-Modified` headers enable conditional requests
   - These reduce bandwidth for unchanged content
   - They're automatically added by the Video Resizer

4. **Leverage Cache Control**:
   - Set appropriate `Cache-Control` headers for your content
   - Consider longer TTLs for static video content
   - Balance TTL with content update frequency

5. **Monitor Range Request Patterns**:
   - Different players have different range request patterns
   - Understanding these patterns can help optimize caching
   - The debug UI provides insights into these patterns

## Common Issues

### 1. Missing Range Support Headers

**Issue**: Range requests fail because the `Accept-Ranges` header is missing.
**Solution**: The Video Resizer automatically adds this header to all video responses.

### 2. Inconsistent Content-Length

**Issue**: Range calculations fail due to incorrect `Content-Length` headers.
**Solution**: The system recalculates and corrects the `Content-Length` header before caching.

```typescript
// Ensure Content-Length is accurate
const body = await response.arrayBuffer();
headers.set('Content-Length', body.byteLength.toString());
```

### 3. Cache Key Conflicts

**Issue**: Range requests and full requests use different cache keys, causing redundant storage.
**Solution**: The system normalizes cache keys by stripping range headers:

```typescript
// Create a normalized cache key without Range headers
const normalizedRequest = new Request(request.url, {
  method: request.method,
  headers: stripRangeHeaders(request.headers)
});
```

### 4. Range Validation Errors

**Issue**: Improper validation causes range errors when content changes.
**Solution**: The system adds strong ETag validation and handles `If-Range` conditions properly.

```typescript
// Add strong validation with versioned ETag
const hash = calculateHash(body);
const version = Date.now().toString(36);
headers.set('ETag', `"${hash}-${version}"`);
```
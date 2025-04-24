# Cloudflare Cache API and Range Requests: Implementation Insights

## Overview

This document captures our learnings from implementing synchronous caching with Cloudflare's Cache API, with special focus on Range request handling for video content. It provides guidance for developers working with the Cache API for media content delivery.

## Key Insights

### 1. Basic Cache API Concepts

Cloudflare's Cache API provides two primary methods:
- `cache.put(request, response)` - Stores a response in cache
- `cache.match(request)` - Retrieves a response from cache

While these methods seem straightforward, there are important nuances:

1. **Cache Key Generation**: The `request` object is used as the cache key
2. **Headers Affect Matching**: Request headers influence whether a cached item can be found
3. **Asynchronous Propagation**: Even after `await cache.put()` completes, the cached item may not be immediately available for retrieval
4. **Response Headers Matter**: Headers on the stored Response significantly impact caching behavior

### 2. Range Request Handling

For video content, Range requests are critical for efficient streaming. Cloudflare's Cache API has built-in support:

1. **Automatic 206 Responses**: When storing a full (200 OK) response, Cloudflare can automatically generate 206 Partial Content responses for Range requests
2. **Required Headers**: For this to work, the cached response must have:
   - `Accept-Ranges: bytes`
   - `Content-Length: [exact byte length]`

3. **Cache Key Best Practices**:
   - **For storage**: Use a minimal Request with no Range header
   - **For retrieval**: Use the original Request (which may have a Range header)

### 3. Implementation Pattern

Our recommended pattern for video caching:

```typescript
// 1. Create a simple cache key for storage
const simpleCacheKey = new Request(url, { 
  method: 'GET',
  headers: { 'Accept': '*/*' }
});

// 2. Ensure response has required headers
const headers = new Headers(response.headers);
headers.set('Accept-Ranges', 'bytes');
headers.set('Content-Length', body.byteLength.toString());

// 3. Remove headers that prevent caching
headers.delete('set-cookie');
if (headers.get('vary') === '*') headers.delete('vary');

// 4. Create a cacheable response
const cachableResponse = new Response(body, {
  status: response.status,
  headers: headers
});

// 5. Store in cache
await cache.put(simpleCacheKey, cachableResponse);

// 6. Retrieve using original request (with Range header if present)
const matchedResponse = await cache.match(originalRequest);

// 7. Fall back to original if cache match fails
return matchedResponse || enhancedResponse;
```

### 4. Headers that Block Caching

Some headers prevent caching or affect cache behavior:

1. **`Set-Cookie`**: Responses with this header are never cached
2. **`Vary: *`**: Completely prevents caching
3. **Complex `Vary` Headers**: Makes caching unreliable - simplify where possible
4. **`Transfer-Encoding: chunked`**: Can cause issues with proper range request handling

#### The Vary Header and Cache Matching

The `Vary` header is particularly problematic for reliable caching:

1. **How Vary Affects Cache Matching**:
   - Cache matching becomes **strictly conditional on all headers** listed in the Vary field
   - For example, with `Vary: User-Agent, Accept-Encoding`:
     - The cache entry will only match if both `User-Agent` AND `Accept-Encoding` header values exactly match the original request
     - Even slight differences in the `User-Agent` string will cause cache misses

2. **CDN-CGI Transformed Responses**:
   - Cloudflare's CDN-CGI transformed responses (for video/image) include complex Vary headers
   - These headers will cause subsequent cache lookups to fail consistently if not sanitized

3. **Best Practice for Video Content**:
   - Option 1: Remove Vary completely (`headers.delete('vary')`) - Most reliable for cache hits
   - Option 2: Simplify to `Vary: accept-encoding` - Balance between compression and cache hits

### 5. Cache Propagation Timing

A fundamental characteristic of Cloudflare's distributed cache:

1. **Async Propagation**: Even after `await cache.put()` completes successfully, the item may not be immediately available
2. **Graceful Fallback**: Always be prepared to fall back to the original response if cache.match fails
3. **Future Requests**: The cache will work properly for subsequent requests even if immediate retrieval fails

### 6. Debugging

For effective debugging:

1. Add an `X-Cache-Source` header to identify where the response came from
2. Add detailed `SYNC_CACHE:` prefixed logs to trace caching operations
3. Include timing information in logs to monitor propagation patterns
4. Check headers in both cached and generated responses

## Recommendations

1. **Keep It Simple**: Use minimal cache keys for storage
2. **Always Add Critical Headers**: Ensure `Accept-Ranges` and `Content-Length` are set
3. **Sanitize Response Headers**: 
   - Always remove `Set-Cookie` headers
   - Remove or simplify the `Vary` header (especially for CDN-CGI transformed responses)
   - Consider removing `Transfer-Encoding: chunked`
4. **Handle Different Response Types**:
   - Pay special attention to transformed responses (CDN-CGI) which need header sanitization
   - Regular responses may need less modification
5. **Implement Graceful Fallback**: Be prepared for cache.match to fail immediately after cache.put
6. **Use Validation Headers**: Add `ETag` and `Last-Modified` where possible
7. **Verify Response Structure**: Ensure you're returning a properly structured video response
8. **Add Diagnostic Headers**: Add custom headers to track which code path prepared a response
9. **Log Header Details**: When debugging, log full request and response headers to identify issues

## Conclusion

Cloudflare's Cache API provides robust support for video content with Range requests, but requires careful implementation. By following the pattern outlined in this document, you can build reliable video delivery with efficient caching and proper range support for streaming.
# Synchronous Cache API Implementation

## Overview

This document describes the implementation of synchronous caching with Cloudflare's Cache API in the video-resizer project. The enhancement changes caching operations from asynchronous (using `waitUntil`) to synchronous (using `await`), and adds immediate cache retrieval to serve responses directly from the cache.

## The Problem

Previously, video responses were cached asynchronously using `waitUntil`. This approach had several limitations:

1. The original response was returned to the client before caching was complete
2. Range request support was inconsistent because the original response was served instead of the cached version
3. Cache operations might fail silently without affecting the response
4. Cached responses weren't used immediately after storing

## The Solution: Synchronous Caching

The implementation makes caching operations synchronous and serves responses directly from the cache:

### Core Changes

1. **Synchronous Cache Operations**: Changed from `ctx.waitUntil(cache.put())` to `await cache.put()`
2. **Immediate Cache Retrieval**: Added `cache.match()` right after successful `cache.put()`
3. **Consistent Cache Keys**: Using simplified cache keys for storage and original request for retrieval
4. **Enhanced Error Handling**: Added fallback to original response if cache operations fail
5. **Detailed Logging**: Added "SYNC_CACHE:" prefix for easy troubleshooting

### Helper Function for Consistent Caching

A new helper function `storeInCacheWithRangeSupport` ensures proper headers and consistent cache keys:

```typescript
async function storeInCacheWithRangeSupport(
  cache: Cache,
  url: string,
  response: Response,
  options?: {
    isTransformed?: boolean;
    logPrefix?: string;
  }
): Promise<void> {
  // Create a simple cache key without any headers for consistency
  // According to Cloudflare docs, this works best for Range requests
  const simpleCacheKey = new Request(url, { 
    method: 'GET'
    // No headers - keep it minimal for consistent cache operations
  });
  
  // Ensure our response has the headers needed for proper Range request handling
  const headers = new Headers(response.headers);
  
  // Critical for Range request support
  headers.set('Accept-Ranges', 'bytes');
  
  // Remove headers that prevent caching according to Cloudflare docs
  headers.delete('set-cookie');
  if (headers.get('vary') === '*') {
    headers.delete('vary');
  }
  
  // Create a clean response for caching with full body content
  const body = await response.clone().arrayBuffer();
  
  // Make sure Content-Length is set - this is required for proper Range request handling
  headers.set('Content-Length', body.byteLength.toString());
  
  // Add strong validation headers if missing
  if (!headers.has('ETag')) {
    const hashCode = Math.abs(body.byteLength).toString(16);
    headers.set('ETag', `"${hashCode}-${Date.now().toString(36)}"`);
  }
  
  if (!headers.has('Last-Modified')) {
    headers.set('Last-Modified', new Date().toUTCString());
  }
  
  // Create a clean, cacheable response
  const cachableResponse = new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: headers
  });
  
  // Store with the simple cache key
  await cache.put(simpleCacheKey, cachableResponse);
}
```

### Implementation in cacheManagementService.ts

```typescript
// Execute the cache operation synchronously
await cachePutOperation();

// Now, immediately try to retrieve the response from cache to serve it
try {
  // Get the default cache instance
  const cache = caches.default;
  
  // IMPORTANT: According to Cloudflare documentation:
  // - Store cache entries using a Request without Range headers
  // - Retrieve using the original Request (with Range headers)
  // - Cloudflare will automatically generate proper 206 responses
  
  // Just use the original request for cache.match
  // This lets Cloudflare handle Range requests automatically
  const hasRangeHeader = request.headers.has('Range');
  const matchRequest = request;
  
  logDebug('SYNC_CACHE: Using original request for cache match', {
    url: request.url,
    hasRangeHeader: hasRangeHeader,
    range: hasRangeHeader ? request.headers.get('Range') : 'none'
  });
  
  // No artificial delay needed - await cache.put() ensures the operation has completed
  
  // Perform the cache match with the appropriate request
  const matchedResponse = await cache.match(matchRequest);

  if (matchedResponse) {
    logDebug('SYNC_CACHE: Successfully matched response from Cache API immediately after put', {
      url: request.url,
      status: matchedResponse.status,
      contentType: matchedResponse.headers.get('Content-Type'),
      contentLength: matchedResponse.headers.get('Content-Length'),
      acceptRanges: matchedResponse.headers.get('Accept-Ranges'),
      timestamp: new Date().toISOString()
    });
    
    // Return the response retrieved directly from the cache
    return matchedResponse;
  } else {
    // This case is unlikely immediately after a successful put, but handle defensively
    logWarn('SYNC_CACHE: Cache match failed immediately after successful put. Falling back to original response.');
    // Fallback to returning the response object we originally intended to put
    return enhancedResponse;
  }
} catch (matchError) {
  // Handle potential errors during the cache.match operation
  logErrorWithContext(
    'SYNC_CACHE: Error during cache.match immediately after cache.put',
    matchError,
    { 
      url: request.url,
      timestamp: new Date().toISOString()
    },
    'CacheManagementService'
  );
  // Fallback to returning the response object we originally intended to put
  return enhancedResponse;
}
```

### Updates in videoHandler.ts

The handler now awaits the enhanced response from cacheResponse and uses it:

```typescript
// Store in Cloudflare Cache API (edge cache)
try {
  const enhancedResponse = await cacheResponse(request, response.clone(), context.executionContext);
  
  if (enhancedResponse && enhancedResponse instanceof Response) {
    // Use the enhanced response from cache as our response to return
    finalResponse = enhancedResponse;
    
    debug(context, logger, 'VideoHandler', 'Using enhanced response from cache', {
      acceptRanges: enhancedResponse.headers.get('Accept-Ranges'),
      etag: enhancedResponse.headers.get('ETag'),
      lastModified: enhancedResponse.headers.get('Last-Modified'),
      cache: 'sync',
      url: request.url
    });
  } else {
    debug(context, logger, 'VideoHandler', 'No enhanced response from cache, using original response');
  }
} catch (err) {
  error(context, logger, 'VideoHandler', 'Error in synchronous caching, using original response', {
    error: err instanceof Error ? err.message : 'Unknown error',
  });
}
```

## Understanding Cloudflare Cache API Range Request Behavior

According to Cloudflare's documentation and our testing:

1. When storing a response in the cache, use a request **without** Range headers
2. When retrieving, use the original request **with** Range headers
3. Cloudflare automatically generates proper 206 Partial Content responses

For this to work correctly, the cached response **must have** certain headers:
- `Content-Length`: The exact byte length of the full content
- `Accept-Ranges: bytes`: Indicates that range requests are supported

Additionally, certain headers will prevent caching and must be removed:
- `Set-Cookie`: Responses with this header are never cached
- `Vary: *`: A wildcard vary header prevents caching

This insight simplified our implementation significantly by relying on Cloudflare's built-in Range handling:

```typescript
// Store with a minimal request (no headers)
const simpleCacheKey = new Request(url, { method: 'GET' });

// Ensure response has required headers
const headers = new Headers(response.headers);
headers.set('Accept-Ranges', 'bytes');
headers.set('Content-Length', body.byteLength.toString());
headers.delete('set-cookie');

// Store in cache with the clean key
await cache.put(simpleCacheKey, new Response(body, { 
  status: response.status,
  headers: headers 
}));

// Retrieve with the original request (with Range headers)
const matchedResponse = await cache.match(request);
```

## Special Handling for Transformed Responses

The implementation includes special handling for CDN-CGI transformed responses:

1. Ensures the original URL is used as the cache key
2. Adds strong validation headers (ETag, Last-Modified)
3. Sets Accept-Ranges to 'bytes' for proper range request support
4. Specifies accurate Content-Length
5. Adds a verification step to confirm successful caching

## Benefits

1. **Improved Range Request Support**:
   - Responses come directly from the cache with proper range support
   - Headers like Accept-Ranges, ETag, and Content-Length are correctly set
   - Cloudflare automatically handles byte-range responses (206 status)

2. **Enhanced Reliability**:
   - Cache operations complete before response is returned
   - Failures are caught and handled gracefully
   - Verification ensures successful caching

3. **Better Diagnostics**:
   - Detailed logging with "SYNC_CACHE:" prefix
   - Explicit tracking of cache operations
   - Error handling with context data

4. **Consistent Response Headers**:
   - ETag for validation
   - Last-Modified for freshness checks
   - Content-Length for accurate size information
   - Accept-Ranges for range request support

## Implementation Details

### Cache API Propagation Characteristics

While `await cache.put()` ensures the operation completes from the API perspective, we've discovered that Cloudflare's distributed cache systems still need propagation time before the cached item is fully available for matching. 

This is a fundamental characteristic of large distributed systems - even though the API call completes successfully, the item may not be immediately available across Cloudflare's entire network.

Our implementation handles this by:

1. Storing the response in cache with proper headers
2. Attempting to retrieve it immediately
3. Falling back to the original response if the cache match fails

```typescript
// Store in cache with proper headers for range support
await cache.put(simpleCacheKey, cachableResponse);

// Attempt to match from cache immediately
const matchedResponse = await cache.match(request);

// Fall back to original response if match fails
return matchedResponse || enhancedResponse;
```

This approach ensures the client always gets a valid response while still benefiting from cache storage for subsequent requests. Each initial request effectively "seeds" the cache for future requests to the same resource.

### Headers that Prevent Caching

We explicitly remove headers that prevent caching according to Cloudflare documentation:

```typescript
// Remove headers that prevent caching
headers.delete('set-cookie');
if (headers.get('vary') === '*') {
  headers.delete('vary');
}
```

### Error Handling

Comprehensive error handling ensures the system degrades gracefully:

```typescript
try {
  const matchedResponse = await cache.match(request);
  // Use the matched response if found
} catch (matchError) {
  // Log the error with context
  logErrorWithContext(
    'SYNC_CACHE: Error during cache.match',
    matchError,
    { url: request.url, timestamp: new Date().toISOString() },
    'CacheManagementService'
  );
  
  // Fall back to the original response
  return enhancedResponse;
}
```

## Performance Considerations

1. The synchronous approach adds minimal latency to the initial response
2. The improved caching behavior ensures better performance for subsequent requests
3. Range requests are handled automatically by Cloudflare without manual processing
4. Headers are optimized for maximum cacheability
5. Overall user experience is improved, especially for video content with range requests
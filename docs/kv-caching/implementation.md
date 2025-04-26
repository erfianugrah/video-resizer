# KV Caching Implementation Details

## Key Components

1. **kvStorageService.ts**
   - Core service for KV operations
   - Handles key generation, storage, and retrieval
   - Manages metadata association with stored content
   - Integrates with cache versioning system

2. **kvCacheUtils.ts**
   - Helper utilities for the KV caching system
   - Handles TTL determination
   - Provides cache bypass functions
   - Manages cache headers
   - Implements bypass for debug mode and non-video responses

3. **cacheOrchestrator.ts**
   - Coordinates the caching workflow
   - Determines which cache layer to check
   - Handles background storage with waitUntil
   - Manages error handling and fallbacks
   - Skips caching for error responses (4xx, 5xx)

4. **videoHandlerWithCache.ts**
   - Integration point with the video processing handler
   - Extracts transformation options from requests
   - Wraps the transformation service with caching

5. **cacheVersionService.ts**
   - Manages version numbers for cached content
   - Stores versions in dedicated KV namespace
   - Provides version incrementation on cache misses
   - Enables automatic cache busting via URL parameters

## Metadata Structure

Each KV entry includes detailed metadata:

```typescript
interface TransformationMetadata {
  // Original source path
  sourcePath: string;
  
  // Transformation parameters
  width?: number | null;
  height?: number | null;
  format?: string | null;
  quality?: string | null;
  compression?: string | null;
  derivative?: string | null;
  
  // Cache information
  cacheTags: string[];
  cacheVersion?: number;
  
  // Content information
  contentType: string;
  contentLength: number;
  
  // Timestamps
  createdAt: number;
  expiresAt?: number;
  
  // Additional metadata
  duration?: number | null;
  fps?: number | null;
  customData?: Record<string, unknown>;
}
```

This metadata is used for:
- Retrieving the correct transformation options
- Setting appropriate response headers
- Managing cache lifetime
- Organizing content with cache tags

## Key Generation

Keys in the KV storage are generated based on the source path and transformation options:

```
video:<source_path>[:option=value][:option=value]...
```

For example:
- `video:videos/sample.mp4` (original video)
- `video:videos/sample.mp4:derivative=mobile` (mobile derivative)
- `video:videos/sample.mp4:w=640:h=360:f=mp4:q=high` (specific transformation)

This schema allows for efficient storage and retrieval of specific video variants.

### Version Keys

For cache versioning, a separate key structure is used in the dedicated VIDEO_CACHE_KEY_VERSIONS namespace:

```
version-<cache_key>
```

Where `<cache_key>` is the sanitized version of the main content cache key. This separate versioning system enables cache busting even when cached content is deleted, since version information persists independently.

For more details on versioning, see the [Cache Versioning System](./cache-versioning.md) documentation.

## TTL Management

Different TTLs are applied based on response status:

| Status Category | Default TTL | Description |
|-----------------|-------------|-------------|
| 2xx (Success)   | 86400s (24h)| Successful responses are cached longer |
| 3xx (Redirect)  | 3600s (1h)  | Redirects are cached for a medium duration |
| 4xx (Client Error) | 60s (1m) | Client errors are cached briefly |
| 5xx (Server Error) | 10s (10s) | Server errors are cached very briefly |

These TTLs can be configured in the environment configuration.

## Cache Tags

Cache tags are stored with each video variant, allowing for coordinated purging:

- Source-based tags: `video-<source_identifier>`
- Derivative-based tags: `video-derivative-<derivative_name>`
- Format-based tags: `video-format-<format>`

Example usage: 
- Purge all "mobile" derivatives: purge tag `video-derivative-mobile`
- Purge all WebM videos: purge tag `video-format-webm`

## Cache Bypass Rules

Several conditions trigger cache bypass to ensure optimal behavior:

### 1. Debug Mode

Requests with the `debug` query parameter bypass KV caching:

```typescript
// In shouldBypassKVCache function
if (requestContext?.url) {
  const url = new URL(requestContext.url);
  if (url.searchParams.has('debug')) {
    logDebug('Bypassing KV cache due to debug mode', { sourcePath });
    return true;
  }
}
```

This allows users to see the latest version of the video during debugging without cache interference.

### 2. Error Responses

Error responses (4xx, 5xx) are not stored in KV:

```typescript
// Check if response is an error (4xx, 5xx)
const statusCode = responseClone.status;
const isError = statusCode >= 400;

// Skip KV storage for errors
if (isError) {
  logDebug('Skipping KV storage for error response', { statusCode });
  return false;
}
```

This prevents caching error responses that might be temporary or request-specific.

### 3. Non-Video Content

Only responses with standard video MIME types are stored in KV cache:

```typescript
// Comprehensive list of video MIME types
const videoMimeTypes = [
  'video/mp4',
  'video/webm',
  'video/ogg',
  'video/x-msvideo', // AVI
  'video/quicktime', // MOV
  'video/x-matroska', // MKV
  'video/x-flv',
  'video/3gpp',
  'video/3gpp2',
  'video/mpeg',
  'application/x-mpegURL', // HLS
  'application/dash+xml'   // DASH
];

const isVideoResponse = videoMimeTypes.some(mimeType => contentType.startsWith(mimeType));

// Skip KV storage for non-video responses
if (!isVideoResponse) {
  logDebug('Skipping KV storage for non-video response', { contentType });
  return false;
}
```

This ensures the cache is used only for its intended purpose - storing transformed videos - and prevents accidental caching of HTML error pages or JSON responses that might have the word "video" in their content type.

## Basic Usage

The KV caching system is automatically used when handling video requests through the `videoHandlerWithCache.ts` handler:

```typescript
// Example route handler
router.get('/videos/:path', (request, env, ctx) => {
  return handleRequestWithCaching(request, env, ctx);
});
```\n## Troubleshooting\n
\n### enableKVCache Configuration Issues\n
# enableKVCache Flag Fix

## Issue

There was a bug in the KV caching system where the `enableKVCache` flag was not being fully respected throughout the codebase. Specifically, the direct KV cache operations in `videoHandler.ts` were not checking the `enableKVCache` flag before performing KV operations, resulting in KV cache still being used even when explicitly disabled via configuration.

## Root Cause

The issue existed in two places:

1. In `videoHandler.ts`, there was a direct call to `getFromKVCache()` without checking the `enableKVCache` flag first:
```typescript
// Start KV lookup with request for range handling support
kvPromise = getFromKVCache(env, sourcePath, videoOptions as unknown as TransformOptions, request);
```

2. Similarly, when storing to KV cache, videoHandler.ts was not checking the flag:
```typescript
// Use waitUntil if available to store in KV without blocking response
const envWithCtx = env as unknown as EnvWithExecutionContext;
if (envWithCtx.executionCtx && typeof envWithCtx.executionCtx.waitUntil === 'function') {
  envWithCtx.executionCtx.waitUntil(
    storeInKVCache(env, sourcePath, responseClone, videoOptionsWithIMQuery as unknown as TransformOptions)
    // ...
  );
}
```

While the `getFromKVCache()` and `storeInKVCache()` functions themselves did check the flag internally, the direct calls in `videoHandler.ts` were not being conditioned on the flag, leading to unnecessary KV operations and logging.

## Fix

The fix involved adding explicit checks for the `enableKVCache` flag in `videoHandler.ts` before making any calls to KV cache operations:

1. Before reading from KV cache:
```typescript
// Get KV cache configuration
const { CacheConfigurationManager } = await import('../config/CacheConfigurationManager');
const cacheConfig = CacheConfigurationManager.getInstance();
const kvCacheEnabled = cacheConfig.isKVCacheEnabled();

// Only check KV cache if it's enabled in config
if (kvCacheEnabled) {
  // KV lookup code...
  kvPromise = getFromKVCache(env, sourcePath, videoOptions as unknown as TransformOptions, request);
} else {
  debug(context, logger, 'KVCacheUtils', 'Skipping KV cache (disabled by configuration)', {
    sourcePath: sourcePath,
    enableKVCache: false
  });
}
```

2. Before writing to KV cache:
```typescript
// Get KV cache configuration
const { CacheConfigurationManager } = await import('../config/CacheConfigurationManager');
const cacheConfig = CacheConfigurationManager.getInstance();
const kvCacheEnabled = cacheConfig.isKVCacheEnabled();

// Only proceed with KV cache if it's enabled in config
if (kvCacheEnabled) {
  // KV storage code...
} else {
  // KV cache is disabled in config
  debug(context, logger, 'VideoHandler', 'Skipping KV cache storage (disabled by configuration)', {
    enableKVCache: false
  });
  endTimedOperation(context, 'cache-storage');
}
```

## Verification

After applying these changes, the KV cache is now properly bypassed when:
1. The `enableKVCache` flag is set to `false` in the configuration loaded from KV
2. The `CACHE_ENABLE_KV` environment variable is set to `false`

The worker will log messages indicating that KV cache operations were skipped due to configuration settings, and no KV operations will be attempted.

## Related Configuration

The `enableKVCache` setting can be configured in two ways:

1. Via KV configuration:
```json
{
  "cache": {
    "enableKVCache": false
  }
}
```

2. Via environment variable in wrangler.jsonc:
```json
{
  "vars": {
    "CACHE_ENABLE_KV": "false"
  }
}
```\n### Vary Header Issues\n
# Fixing Cache Consistency with Vary Header Sanitization

## Issue Summary

We encountered a persistent issue where video responses were successfully stored in Cloudflare's Cache API but not found by subsequent requests. This document explains the root cause and our solution.

## Problem Details

The issue occurred specifically with CDN-CGI transformed responses:

1. A video response would be successfully stored in cache using `cache.put()`
2. The immediate `cache.match()` after storing would often succeed
3. However, subsequent requests from different clients would consistently fail to match the cached item

This resulted in poor cache hit rates and increased origin traffic, particularly impacting video streaming performance where range requests are common.

## Root Cause

After thorough investigation, we traced the issue to **complex `Vary` headers** in the CDN-CGI transformed responses:

1. When Cloudflare's CDN-CGI service processes media, it adds complex `Vary` headers like:
   ```
   Vary: Accept-Encoding, User-Agent, ...
   ```

2. These headers were being copied to our cached responses without sanitization in the transformed response path

3. The `Vary` header instructs caches that the response varies based on the request headers listed:
   - For a response with `Vary: User-Agent`, cache lookups will only match if the *exact* `User-Agent` string matches
   - This makes cache matching extremely brittle since `User-Agent` strings vary significantly between clients

4. The code path for transformed responses lacked the `Vary` header sanitization that existed in other paths

## Solution Implemented

We implemented a fix consisting of several key changes:

1. **Aggressive Header Sanitization**: For transformed responses, we now:
   ```typescript
   // Only keep essential headers for caching and proper content delivery
   const essentialHeaders = [
     'content-type',
     'content-length',
     'cache-control',
     'etag',
     'last-modified'
   ];
   
   // Clear all headers and only copy essential ones
   for (const key of headerKeys) {
     if (!essentialHeaders.includes(key.toLowerCase())) {
       headers.delete(key);
     }
   }
   
   // Completely remove Vary header for maximum cache reliability
   headers.delete('vary');
   ```

2. **Simplified Cache Keys**: We now use the most minimal cache key possible:
   ```typescript
   // Strip query parameters from the URL
   const urlObj = new URL(url);
   const baseUrl = urlObj.origin + urlObj.pathname;
   
   // Create minimal cache key with no headers
   const simpleCacheKey = new Request(baseUrl, { 
     method: 'GET'
   });
   ```

3. **Multi-Strategy Cache Lookup**: We try multiple approaches for cache matching:
   ```typescript
   // First, try with the super-simplified request
   let matchedResponse = await cache.match(simpleKey);
   let matchSuccessType = matchedResponse ? 'simple-key' : 'none';
   
   // If that fails, try with the original request
   if (!matchedResponse) {
     matchedResponse = await cache.match(request);
     matchSuccessType = matchedResponse ? 'original-request' : 'none';
   }
   ```

4. **Comprehensive Logging**: Added detailed diagnostic logging:
   ```typescript
   logDebug('SYNC_CACHE: Cache match attempt result', {
     url: request.url,
     matchSuccessType,
     foundInCache: !!matchedResponse,
     responseStatus: matchedResponse ? matchedResponse.status : 'n/a',
     responseType: matchedResponse ? matchedResponse.headers.get('content-type') : 'n/a',
     varyHeaderInResponse: matchedResponse ? matchedResponse.headers.get('vary') : 'n/a',
     strategy: 'tried-both-simple-and-original'
   });
   ```

## Expected Impact

This fix should significantly improve cache hit rates for video content by:

1. Making cache keys more consistent and resilient to client differences by removing all non-essential headers
2. Completely removing the `Vary` header which was causing the most significant issues
3. Using multiple cache lookup strategies to maximize the chance of a cache hit

## Implementation Location

The fix was applied in `cacheManagementService.ts`, focusing on:

1. The `storeInCacheWithRangeSupport` function for consistent range request support
2. The transformed response handling path in the `cacheResponse` function
3. Cache key generation and matching strategies

## Verification

You can verify this fix by:

1. Looking for the `X-Cache-Sanitized: true` header in responses
2. Checking logs for entries with `SYNC_CACHE: Removed Vary header completely for maximum cache reliability` 
3. Confirming that subsequent requests from different clients now successfully match cached items

## Broader Implications

This experience highlights the critical importance of response header management when working with caching systems:

1. Headers affect not just browser behavior but also cache matching logic
2. CDN-transformed responses may introduce headers that require sanitization
3. Different response types may need different header handling strategies
4. Simplified cache keys and aggressive header sanitization can dramatically improve cache hit rates

We've updated our [Cloudflare Cache API Insights](./cloudflare-cache-api-insights.md) documentation with these learnings to help prevent similar issues in the future.\n## Implementation Insights\n
\n### Cloudflare Cache API Insights\n
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

Cloudflare's Cache API provides robust support for video content with Range requests, but requires careful implementation. By following the pattern outlined in this document, you can build reliable video delivery with efficient caching and proper range support for streaming.\n### Cache API Cleanup\n
# Cache API Implementation Cleanup

This document outlines the key issues and fixes made to improve the Cache API implementation in the video-resizer project.

## Issue: Code Structure and Duplication

The `cacheManagementService.ts` file had accumulated significant code duplication over time, leading to:

1. Duplicate declarations of variables like `requestUrl`, `baseUrl`, `matchedResponse`, etc.
2. Duplicated code for cache lookup strategies with both `simpleKey` and `simpleMatchRequest` variables
3. Multiple sections of code that accomplish the same thing in slightly different ways
4. TypeScript errors due to undefined variables (`hasRangeHeader`)

## Fix: Code Restructuring and Variable Definition

### 1. Fixed the TypeScript errors related to undefined `hasRangeHeader` variable

The variable `hasRangeHeader` was being referenced in the range request handling code, but wasn't defined in the local scope, causing TypeScript errors:

```typescript
// Error:
if (hasRangeHeader && matchedResponse.headers.get('Accept-Ranges') === 'bytes') {
  // Range request handling code...
}
```

The fix added proper initialization of the variable directly before its use:

```typescript
// Fix:
// Check if the original request had a Range header
const hasRangeHeader = request.headers.has('Range');

if (hasRangeHeader && matchedResponse.headers.get('Accept-Ranges') === 'bytes') {
  // Range request handling code...
}
```

This change ensures that the TypeScript type system properly knows about this variable.

### 2. Additional cleanup work (in progress)

The following areas still need further cleanup:

- Code between lines 908-953 that overlaps with lines 865-907
- Duplicate code blocks between lines 1456-1501
- Consistent naming conventions for cache key variables
- Simplification of error handling paths

## Previous Optimizations Made to the Caching Implementation

### 1. Vary Header Handling for CDN-CGI Transformed Responses

Implemented aggressive header handling for transformed responses:
- Simplified to bare minimum essential headers
- Completely removed the `Vary` header for maximum cache reliability
- Added detailed logging of headers before sanitization

### 2. Cache Key Enhancement

- Implemented simplified cache keys by stripping query parameters
- Used minimal headers for maximum consistency
- Added multi-strategy cache lookup (tries both simplified key and original request)

## Results

The cleanup and fixes have resulted in:

1. Fixed TypeScript errors
2. More maintainable code structure
3. Reliable caching behavior for transformed responses
4. Consistent handling of range requests from cache

All TypeScript errors have been fixed and the code now passes type checking. This makes the codebase more maintainable and reduces the risk of runtime errors related to cache operations.\n### Cache API Synchronization\n
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
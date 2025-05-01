# Cache API Implementation

*Last Updated: May 1, 2025*

## Table of Contents

- [Overview](#overview)
- [Cache API Architecture](#cache-api-architecture)
- [Synchronous Caching Implementation](#synchronous-caching-implementation)
- [Range Request Support](#range-request-support)
- [Header Management](#header-management)
- [Cache Key Construction](#cache-key-construction)
- [Cache-Control Headers](#cache-control-headers)
- [Vary Header Handling](#vary-header-handling)
- [Error Handling](#error-handling)
- [Cache Efficiency Optimizations](#cache-efficiency-optimizations)
- [Integration with KV Cache](#integration-with-kv-cache)
- [Debugging and Diagnostics](#debugging-and-diagnostics)
- [Best Practices](#best-practices)
- [Implementation Examples](#implementation-examples)

## Overview

The Cache API implementation in the Video Resizer provides a regional edge caching layer using Cloudflare's Cache API. This caching layer complements the global KV cache by providing low-latency, region-specific caching with built-in support for HTTP standards like range requests, conditional requests, and cache validation.

The Cache API is particularly valuable for:
- Video streaming with range requests
- Region-specific content delivery
- Standards-compliant HTTP caching
- Content with frequent partial access

This document explains the technical implementation details of the Cache API caching system.

## Cache API Architecture

The Cache API caching system consists of several key components:

### 1. cacheManagementService.ts

Core service responsible for Cache API operations:
- Manages interaction with Cloudflare Cache API
- Handles response storage and retrieval
- Implements synchronous caching
- Manages header sanitization
- Provides range request support

```typescript
export class CacheManagementService {
  private readonly cache: Cache;
  
  constructor() {
    this.cache = caches.default;
  }
  
  public async getCachedResponse(request: Request): Promise<Response | null> {
    // Cache retrieval implementation
  }
  
  public async cacheResponse(
    request: Request,
    response: Response,
    ctx: ExecutionContext
  ): Promise<Response> {
    // Cache storage implementation
  }
  
  // Additional methods
}
```

### 2. cacheUtils.ts

Helper utilities for Cache API operations:
- Provides header manipulation functions
- Implements cache key generation
- Handles cache bypass checks
- Manages Cache-Control header generation
- Provides content type filtering

```typescript
// Header sanitization
export function sanitizeHeadersForCaching(headers: Headers): Headers {
  const sanitizedHeaders = new Headers(headers);
  
  // Remove headers that prevent caching
  sanitizedHeaders.delete('set-cookie');
  
  // Simplify Vary header if present
  if (sanitizedHeaders.has('vary')) {
    const varyValue = sanitizedHeaders.get('vary');
    if (varyValue === '*') {
      sanitizedHeaders.delete('vary');
    } else if (varyValue?.includes('user-agent')) {
      sanitizedHeaders.set('vary', 'accept-encoding');
    }
  }
  
  return sanitizedHeaders;
}

// Cache-Control generation
export function generateCacheControl(
  ttl: number,
  options?: { public?: boolean; immutable?: boolean }
): string {
  const directives: string[] = [];
  
  // Add public/private directive
  directives.push(options?.public !== false ? 'public' : 'private');
  
  // Add max-age directive
  directives.push(`max-age=${ttl}`);
  
  // Add immutable directive if specified
  if (options?.immutable) {
    directives.push('immutable');
  }
  
  return directives.join(', ');
}
```

### 3. cacheResponseUtils.ts

Utilities for response handling:
- Manages response duplication
- Implements header normalization
- Handles body extraction
- Provides response reconstruction
- Adds validation headers

```typescript
// Create cacheable response
export async function createCacheableResponse(
  response: Response,
  options?: { stripHeaders?: boolean }
): Promise<Response> {
  // Clone the response
  const responseClone = response.clone();
  
  // Extract the body
  const body = await responseClone.arrayBuffer();
  
  // Get and sanitize headers
  const headers = options?.stripHeaders
    ? new Headers()
    : sanitizeHeadersForCaching(responseClone.headers);
  
  // Set critical headers for caching
  headers.set('Accept-Ranges', 'bytes');
  headers.set('Content-Length', body.byteLength.toString());
  
  // Add validation headers if missing
  if (!headers.has('ETag')) {
    const hashCode = Math.abs(body.byteLength).toString(16);
    headers.set('ETag', `"${hashCode}-${Date.now().toString(36)}"`);
  }
  
  if (!headers.has('Last-Modified')) {
    headers.set('Last-Modified', new Date().toUTCString());
  }
  
  // Create new response
  return new Response(body, {
    status: responseClone.status,
    statusText: responseClone.statusText,
    headers
  });
}
```

## Synchronous Caching Implementation

The Cache API implementation uses a synchronous caching approach for consistency and reliability:

### Traditional Approach (with waitUntil)

In the traditional approach, caching happens asynchronously:

```typescript
// Asynchronous caching (traditional approach)
ctx.waitUntil(cache.put(cacheKey, response.clone()));

// Return the original response immediately
return response;
```

This approach has issues:
- The response is returned before caching completes
- Range requests may not work correctly
- Cache operations fail silently
- Manual range handling is required

### Synchronous Approach

The Video Resizer uses a synchronous caching approach:

```typescript
// Synchronous caching implementation
async function cacheResponse(
  request: Request,
  response: Response
): Promise<Response> {
  // Create a simple cache key without Range headers
  const url = new URL(request.url);
  const simpleCacheKey = new Request(url.toString(), { 
    method: 'GET'
    // No headers - keep it minimal for consistent cache operations
  });
  
  // Prepare response for caching
  const cacheable = await createCacheableResponse(response);
  
  // Execute the cache operation synchronously
  await cache.put(simpleCacheKey, cacheable);
  
  // Now, immediately try to retrieve the response from cache to serve it
  try {
    // Perform the cache match with the original request
    // This lets Cloudflare handle Range requests automatically
    const matchedResponse = await cache.match(request);
    
    if (matchedResponse) {
      // Return the response retrieved directly from the cache
      return matchedResponse;
    } else {
      // Fallback to returning the enhanced response
      return cacheable;
    }
  } catch (matchError) {
    // Fallback to returning the enhanced response
    return cacheable;
  }
}
```

Benefits of this approach:
- Ensures cache consistency
- Leverages Cloudflare's built-in range request handling
- Provides immediate feedback on cache operations
- Simplifies code by using standard Cache API features

## Range Request Support

The Cache API provides built-in support for HTTP range requests:

### Setting Up Range Support

```typescript
// Prepare response for range request handling
function prepareRangeSupport(response: Response): Response {
  // Clone the response
  const clone = response.clone();
  const headers = new Headers(clone.headers);
  
  // Ensure response has required headers for range support
  headers.set('Accept-Ranges', 'bytes');
  
  // Ensure Content-Length is set properly
  if (!headers.has('Content-Length')) {
    // Extract content length from response if possible
    const contentLength = parseInt(headers.get('Content-Length') || '0');
    if (contentLength > 0) {
      headers.set('Content-Length', contentLength.toString());
    } else {
      // Will be set correctly when the body is extracted
    }
  }
  
  // Return updated response
  return new Response(clone.body, {
    status: clone.status,
    statusText: clone.statusText,
    headers
  });
}
```

### Storing for Range Support

According to Cloudflare's documentation and our testing:

1. Store a full (200 OK) response with these critical headers:
   - `Accept-Ranges: bytes`
   - `Content-Length: [exact byte length]`

2. Store using a simple Request with no Range header:
   ```typescript
   const simpleCacheKey = new Request(url.toString(), { method: 'GET' });
   await cache.put(simpleCacheKey, cacheable);
   ```

3. Retrieve using the original Request (with Range header):
   ```typescript
   const matchedResponse = await cache.match(request);
   ```

4. Cloudflare automatically generates proper 206 Partial Content responses:
   ```
   HTTP/1.1 206 Partial Content
   Content-Range: bytes 1024-2047/146515
   Content-Length: 1024
   ```

This implementation leverages Cloudflare's built-in range request handling without requiring manual range extraction.

## Header Management

Header management is critical for effective caching:

### Header Sanitization

```typescript
// Sanitize headers for caching
function sanitizeHeadersForCaching(headers: Headers): Headers {
  const sanitized = new Headers(headers);
  
  // Headers that prevent caching
  sanitized.delete('set-cookie');
  sanitized.delete('authorization');
  sanitized.delete('cf-ray');
  sanitized.delete('cf-connecting-ip');
  
  // Manage Vary header - simplify or remove
  if (sanitized.has('vary')) {
    const varyValue = sanitized.get('vary');
    if (varyValue === '*') {
      // Vary: * prevents caching completely - remove it
      sanitized.delete('vary');
    } else if (varyValue?.includes('user-agent')) {
      // User-Agent varies too much - simplify to accept-encoding only
      sanitized.set('vary', 'accept-encoding');
    }
  }
  
  // Remove headers with undefined values
  for (const [key, value] of Array.from(sanitized.entries())) {
    if (value === undefined || value === null || value === 'undefined' || value === 'null') {
      sanitized.delete(key);
    }
  }
  
  return sanitized;
}
```

### Essential Headers

The implementation ensures these essential headers are present:

```typescript
// Ensure critical headers for caching and range support
headers.set('Accept-Ranges', 'bytes');
headers.set('Content-Length', body.byteLength.toString());
headers.set('Content-Type', contentType || 'video/mp4');
headers.set('Cache-Control', generateCacheControl(ttl, { public: true }));
headers.set('ETag', `"${hashCode}-${Date.now().toString(36)}"`);
headers.set('Last-Modified', new Date().toUTCString());
```

### Validation Headers

Adding validation headers improves caching efficiency:

```typescript
// Add validation headers if not present
if (!headers.has('ETag')) {
  // Create a strong ETag based on content hash and timestamp
  const hashCode = Math.abs(body.byteLength).toString(16);
  const timestamp = Date.now().toString(36);
  headers.set('ETag', `"${hashCode}-${timestamp}"`);
}

if (!headers.has('Last-Modified')) {
  // Set Last-Modified to current time if not present
  headers.set('Last-Modified', new Date().toUTCString());
}
```

## Cache Key Construction

Cache key construction is crucial for consistent caching:

### Simplified Cache Keys

The system uses simplified cache keys for storage:

```typescript
// Create a simplified cache key for maximum compatibility
function createSimpleCacheKey(url: string): Request {
  // Parse the URL and remove query parameters for more consistent caching
  const urlObj = new URL(url);
  const baseUrl = urlObj.origin + urlObj.pathname;
  
  // Create a minimal request with no headers
  return new Request(baseUrl, { 
    method: 'GET'
    // No headers - keep it minimal for consistent cache operations
  });
}
```

This approach:
- Removes query parameters that don't affect content
- Eliminates headers that could prevent cache hits
- Creates a stable key for multiple similar requests

### Original Request for Retrieval

For retrieval, the original request is used:

```typescript
// Use the original request for retrieval
const matchedResponse = await cache.match(request);
```

This leverages Cloudflare's built-in capabilities:
- Automatic range request handling
- Conditional request processing
- Accept-Encoding handling

## Cache-Control Headers

The system generates appropriate Cache-Control headers:

```typescript
// Generate Cache-Control header
function generateCacheControl(
  ttl: number,
  options?: { 
    public?: boolean; 
    immutable?: boolean;
    staleWhileRevalidate?: number;
    staleIfError?: number;
  }
): string {
  const directives: string[] = [];
  
  // Public or private directive
  directives.push(options?.public !== false ? 'public' : 'private');
  
  // Max-age directive
  directives.push(`max-age=${ttl}`);
  
  // Add immutable if specified (prevents revalidation)
  if (options?.immutable) {
    directives.push('immutable');
  }
  
  // Add stale-while-revalidate if specified
  if (options?.staleWhileRevalidate) {
    directives.push(`stale-while-revalidate=${options.staleWhileRevalidate}`);
  }
  
  // Add stale-if-error if specified
  if (options?.staleIfError) {
    directives.push(`stale-if-error=${options.staleIfError}`);
  }
  
  return directives.join(', ');
}
```

Example generated header:
```
Cache-Control: public, max-age=86400, stale-while-revalidate=3600, stale-if-error=86400
```

## Vary Header Handling

The `Vary` header significantly impacts cache effectiveness:

### The Problem with Vary

The `Vary` header instructs caches to vary responses based on request headers:
- `Vary: User-Agent` - Requires exact User-Agent match
- `Vary: Accept-Encoding, User-Agent` - Requires both headers to match
- `Vary: *` - Prevents caching entirely

This can dramatically reduce cache hit rates, especially with `User-Agent` which varies widely.

### Solution: Vary Header Sanitization

The implementation sanitizes Vary headers for maximum cache efficiency:

```typescript
// Handle Vary header
if (headers.has('vary')) {
  const varyValue = headers.get('vary');
  
  if (varyValue === '*') {
    // Vary: * prevents caching completely - remove it
    logDebug('SYNC_CACHE: Removed Vary: * header to enable caching');
    headers.delete('vary');
  } else if (varyValue?.includes('user-agent')) {
    // User-Agent varies too much - simplify to accept-encoding only
    logDebug('SYNC_CACHE: Simplified Vary header (removed User-Agent) for better cache efficiency', {
      original: varyValue,
      simplified: 'accept-encoding'
    });
    headers.set('vary', 'accept-encoding');
  }
}

// For transformed responses, completely remove Vary for maximum cache efficiency
if (isTransformed) {
  if (headers.has('vary')) {
    logDebug('SYNC_CACHE: Removed Vary header completely for maximum cache reliability');
    headers.delete('vary');
  }
}
```

For transformed responses, Vary is removed completely to maximize cache hit rates.

## Error Handling

The Cache API implementation includes comprehensive error handling:

### Cache Operation Errors

```typescript
// Store in cache with error handling
try {
  await cache.put(simpleCacheKey, cacheable);
  logDebug('SYNC_CACHE: Successfully stored in Cache API', {
    url: request.url,
    cacheKey: simpleCacheKey.url
  });
} catch (putError) {
  logErrorWithContext(
    'SYNC_CACHE: Error storing in Cache API',
    putError,
    { url: request.url },
    'CacheManagementService'
  );
  // Continue execution despite the error
  return response;
}
```

### Match Failures

```typescript
// Retrieve from cache with error handling
try {
  const matchedResponse = await cache.match(request);
  
  if (matchedResponse) {
    logDebug('SYNC_CACHE: Successfully matched response from Cache API', {
      url: request.url,
      status: matchedResponse.status
    });
    return matchedResponse;
  } else {
    logDebug('SYNC_CACHE: No matching response found in Cache API', {
      url: request.url
    });
    // Return the original response
    return response;
  }
} catch (matchError) {
  logErrorWithContext(
    'SYNC_CACHE: Error matching from Cache API',
    matchError,
    { url: request.url },
    'CacheManagementService'
  );
  // Return the original response
  return response;
}
```

### Response Preparation Errors

```typescript
// Prepare response for caching with error handling
try {
  // Extract body and create cacheable response
  const body = await responseClone.arrayBuffer();
  
  // Create headers with validation
  // ...
  
  // Create cacheable response
  const cacheable = new Response(body, {
    status: responseClone.status,
    statusText: responseClone.statusText,
    headers
  });
  
  return cacheable;
} catch (error) {
  logErrorWithContext(
    'Error preparing response for caching',
    error,
    { url: request.url },
    'CacheManagementService'
  );
  
  // Return the original response
  return response;
}
```

## Cache Efficiency Optimizations

Several optimizations improve Cache API efficiency:

### 1. Minimal Headers

```typescript
// Use minimal essential headers for transformed content
if (isTransformed) {
  const essentialHeaders = [
    'content-type',
    'content-length',
    'cache-control',
    'etag',
    'last-modified',
    'accept-ranges'
  ];
  
  // Clear all headers and only copy essential ones
  for (const key of headerKeys) {
    if (!essentialHeaders.includes(key.toLowerCase())) {
      headers.delete(key);
    }
  }
}
```

This approach:
- Reduces the risk of header-based cache misses
- Removes unnecessary headers for transformed content
- Keeps only headers essential for proper operation

### 2. Multi-Strategy Cache Lookup

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

This approach tries multiple cache lookup strategies to maximize hit rates.

### 3. Optimistic Response Return

```typescript
// Store in cache
await cache.put(simpleCacheKey, cacheable);

// Check if the Cache-Control allows reusing the prepared response
const cacheControl = cacheable.headers.get('Cache-Control') || '';
const allowDirectReturn = !cacheControl.includes('no-store') && 
                         !cacheControl.includes('no-cache');

// If it's cacheable and doesn't have Range header, return it directly
if (allowDirectReturn && !request.headers.has('Range')) {
  return cacheable;
}

// Otherwise, try to get from cache
const matchedResponse = await cache.match(request);
return matchedResponse || cacheable;
```

This optimization:
- Returns the prepared response directly when appropriate
- Avoids an extra cache lookup for non-range requests
- Still uses cache.match for range requests

## Integration with KV Cache

The Cache API implementation integrates with the KV cache:

### Layered Caching Approach

```typescript
// Layered caching implementation
async function getCachedResponse(
  request: Request,
  options: VideoTransformOptions
): Promise<Response | null> {
  // 1. Try KV cache first (global, persistent)
  const kvResponse = await getFromKVCache(env, sourcePath, options);
  if (kvResponse) {
    return kvResponse;
  }
  
  // 2. Try Cache API second (edge, HTTP standards)
  const cacheResponse = await getCacheApiResponse(request);
  if (cacheResponse) {
    return cacheResponse;
  }
  
  // 3. No cache hit
  return null;
}
```

### Dual Storage on Miss

```typescript
// Dual storage implementation
async function cacheResponse(
  request: Request,
  response: Response,
  options: VideoTransformOptions
): Promise<Response> {
  // Clone response for multiple uses
  const responseForKV = response.clone();
  const responseForCacheAPI = response.clone();
  
  // Store in KV (global, persistent)
  ctx.waitUntil(storeInKVCache(env, sourcePath, responseForKV, options));
  
  // Store in Cache API synchronously (edge, HTTP standards)
  return await storeCacheApiResponse(request, responseForCacheAPI);
}
```

This approach leverages the strengths of both caching systems:
- KV provides global, persistent caching
- Cache API provides edge caching with HTTP standards support

## Debugging and Diagnostics

The Cache API implementation includes comprehensive diagnostics:

### 1. Cache Headers

```typescript
// Add diagnostic headers
response.headers.set('X-Cache-Source', 'cf-cache');
response.headers.set('X-Cache-Match-Type', matchSuccessType);
response.headers.set('X-Cache-Time', new Date().toISOString());
```

### 2. Detailed Logging

```typescript
// Detailed cache operation logging
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

### 3. Debug UI Integration

The Cache API system integrates with the Debug UI:

```typescript
// Add Cache API information to diagnostics
if (context.diagnosticsInfo) {
  context.diagnosticsInfo.cache = {
    ...context.diagnosticsInfo.cache,
    cfCache: {
      source: 'cf-cache',
      hit: !!matchedResponse,
      matchType: matchSuccessType,
      time: new Date().toISOString(),
      key: simpleCacheKey.url,
      headers: {
        varyInRequest: request.headers.get('vary'),
        varyInResponse: matchedResponse ? matchedResponse.headers.get('vary') : null,
        cacheControl: matchedResponse ? matchedResponse.headers.get('cache-control') : null
      }
    }
  };
}
```

## Best Practices

1. **Simplified Cache Keys**:
   - Use minimal headers in cache keys
   - Normalize URLs by removing irrelevant query parameters
   - Use consistent key generation

2. **Header Management**:
   - Remove or simplify Vary headers
   - Remove headers that prevent caching
   - Add strong validation headers

3. **Synchronous Caching**:
   - Use await for cache operations
   - Verify cache operations when possible
   - Plan for cache propagation delays

4. **Range Request Support**:
   - Always add Accept-Ranges: bytes
   - Set accurate Content-Length
   - Use Cloudflare's built-in range handling

5. **Error Handling**:
   - Implement graceful fallbacks
   - Log detailed diagnostics
   - Never block response return

## Implementation Examples

### Synchronous Cache Storage

```typescript
// Synchronous cache storage implementation
async function cacheSynchronously(
  request: Request,
  response: Response
): Promise<Response> {
  try {
    // Clone response for manipulation
    const responseClone = response.clone();
    
    // Extract the body
    const body = await responseClone.arrayBuffer();
    
    // Create sanitized headers
    const headers = new Headers(responseClone.headers);
    
    // Remove problematic headers
    headers.delete('set-cookie');
    headers.delete('vary');
    
    // Set critical headers for caching and range support
    headers.set('Accept-Ranges', 'bytes');
    headers.set('Content-Length', body.byteLength.toString());
    
    // Add validation headers
    const hashCode = Math.abs(body.byteLength).toString(16);
    headers.set('ETag', `"${hashCode}-${Date.now().toString(36)}"`);
    headers.set('Last-Modified', new Date().toUTCString());
    
    // Appropriate Cache-Control
    headers.set('Cache-Control', 'public, max-age=86400');
    
    // Create cacheable response
    const cacheable = new Response(body, {
      status: responseClone.status,
      statusText: responseClone.statusText,
      headers
    });
    
    // Create simplified cache key (no headers)
    const url = new URL(request.url);
    const simpleCacheKey = new Request(url.toString(), { method: 'GET' });
    
    // Store in cache
    await caches.default.put(simpleCacheKey, cacheable);
    
    // Immediately try to retrieve from cache
    const matchedResponse = await caches.default.match(request);
    
    // Return cached response or fallback to prepared response
    return matchedResponse || cacheable;
  } catch (error) {
    console.error('Error in synchronous caching', error);
    // Fallback to original response
    return response;
  }
}
```

### Multi-Strategy Cache Lookup

```typescript
// Multi-strategy cache lookup implementation
async function getCachedResponse(request: Request): Promise<Response | null> {
  try {
    const cache = caches.default;
    
    // Strategy 1: Exact match
    let matchedResponse = await cache.match(request);
    
    if (matchedResponse) {
      return matchedResponse;
    }
    
    // Strategy 2: Match with simplified request
    const url = new URL(request.url);
    const simpleKey = new Request(url.toString(), { method: 'GET' });
    
    matchedResponse = await cache.match(simpleKey);
    
    if (matchedResponse) {
      // If this is a range request, the Cache API should handle it
      return matchedResponse;
    }
    
    // No match found
    return null;
  } catch (error) {
    console.error('Error retrieving from cache', error);
    return null;
  }
}
```
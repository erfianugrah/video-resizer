# Cache Filtering System

The video-resizer project implements intelligent cache filtering to ensure only appropriate content is cached. This document explains the cache filtering system and how it works.

## Overview

Not all responses should be cached, even if caching is generally enabled. The cache filtering system ensures that:

1. Only successful responses are cached
2. Only appropriate content types are cached
3. Error responses are not cached
4. Cache-Control directives are respected

This filtering happens at multiple levels in the caching system.

## Cache Filtering Rules

### 1. Status Code Filtering

The system filters based on HTTP status codes:

- **2xx Successful Responses**: Cached with the primary TTL
- **3xx Redirects**: Cached with a reduced TTL (configurable)
- **4xx Client Errors**: Not cached by default
- **5xx Server Errors**: Not cached by default

### 2. Content Type Filtering

We only cache specific content types:

#### Video Content Types (Cached)
- `video/mp4`
- `video/webm`
- `video/ogg`
- `video/x-msvideo` (AVI)
- `video/quicktime` (MOV)
- `video/x-matroska` (MKV)
- `video/x-flv`
- `video/3gpp`
- `video/3gpp2`
- `video/mpeg`
- `application/x-mpegURL` (HLS)
- `application/dash+xml` (DASH)

#### Image Content Types (Cached)
- `image/jpeg`
- `image/png`
- `image/gif`
- `image/webp`
- `image/avif`
- `image/tiff`
- `image/svg+xml`
- `image/bmp`

#### Other Content Types (Not Cached)
- HTML, JSON, CSS, JavaScript, etc.

### 3. Cache-Control Directive Handling

The system respects standard Cache-Control directives:

- `no-cache`: Forces revalidation with origin
- `no-store`: Prevents caching entirely
- `max-age=X`: Honors max-age up to configured TTL limits
- `private`: Treated as non-cacheable

### 4. Request Method Filtering

Only certain HTTP methods can be cached:

- **GET** requests: Cacheable
- All other methods (POST, PUT, DELETE, etc.): Not cacheable

## Implementation in Different Cache Layers

### Cloudflare Cache API Layer

The Cache API implementation in `cacheManagementService.ts` enforces these rules through:

```typescript
export async function cacheResponse(
  request: Request, 
  response: Response,
  context?: ExecutionContext
): Promise<void> {
  // Only cache successful GET requests
  if (request.method !== 'GET' || !response.ok) {
    return;
  }
  
  // Check the content type
  const contentType = response.headers.get('content-type') || '';
  const isError = response.status >= 400;
  
  // Check if content type is cacheable
  const isVideoResponse = videoMimeTypes.some(mimeType => 
    contentType.startsWith(mimeType));
  const isImageResponse = imageMimeTypes.some(mimeType => 
    contentType.startsWith(mimeType));
  const isCacheableContent = isVideoResponse || isImageResponse;
  
  // Skip caching for 4xx, 5xx responses or non-video/image content
  if (isError || !isCacheableContent) {
    return;
  }
  
  // Cache-Control check
  const cacheControl = response.headers.get('Cache-Control');
  if (cacheControl && cacheControl.includes('no-store')) {
    return;
  }
  
  // Proceed with caching...
}
```

### Cloudflare CF Object Layer

For the Cloudflare Workers `cf` object caching configuration, we enforce similar rules:

```typescript
export function createCfObjectParams(
  status: number,
  cacheConfig?: CacheConfig | null,
  source?: string,
  derivative?: string,
  contentType?: string
): Record<string, unknown> {
  // Default to no caching
  const cfObject: Record<string, unknown> = {};
  
  // Skip caching for error status codes
  const isError = status >= 400;
  if (isError) {
    cfObject.cacheEverything = false;
    cfObject.cacheTtl = 0;
    return cfObject;
  }
  
  // Skip caching for non-cacheable content types
  if (contentType) {
    const isVideoResponse = videoMimeTypes.some(mimeType => 
      contentType.startsWith(mimeType));
    const isImageResponse = imageMimeTypes.some(mimeType => 
      contentType.startsWith(mimeType));
    const isCacheableContent = isVideoResponse || isImageResponse;
    
    if (!isCacheableContent) {
      cfObject.cacheEverything = false;
      cfObject.cacheTtl = 0;
      return cfObject;
    }
  }
  
  // Proceed with caching configuration...
}
```

### KV Cache Layer

The KV cache layer in `cacheOrchestrator.ts` applies similar filtering:

```typescript
// Check if it's a video response and not an error
const contentType = response.headers.get('content-type') || '';
const isError = response.status >= 400;

// Check if content type is cacheable
const isVideoResponse = videoMimeTypes.some(mimeType => 
  contentType.startsWith(mimeType));
const isImageResponse = imageMimeTypes.some(mimeType => 
  contentType.startsWith(mimeType));
const isCacheableContent = isVideoResponse || isImageResponse;

if (options && env && response.ok && request.method === 'GET' 
    && !skipCache && isCacheableContent && !isError) {
  // Proceed with KV storage...
}
```

## Debugging Cache Filtering

When debug mode is enabled, the system adds headers to help troubleshoot cache filtering:

- `X-Cache-Enabled`: Whether caching is enabled in general
- `X-Cache-Method`: Which caching method is being used
- `X-Cache-Skip-Reason`: Why caching was skipped (if applicable)

In verbose debug mode, more detailed logging is provided:

```
DebugHeadersUtils: Skipped KV storage {
  method: "GET",
  isOk: true,
  hasDebug: false,
  isVideoResponse: false,
  isError: false,
  statusCode: 200,
  contentType: "text/html"
}
```

## Configuration

You can configure caching filters in several ways:

### Wrangler Configuration

```jsonc
{
  "CACHE_CONFIG": {
    "method": "cf", // "cf" or "cache-api"
    "defaultTtl": 86400,
    "ttlByStatus": {
      "ok": 86400, // 2xx responses - 1 day
      "redirects": 3600, // 3xx responses - 1 hour
      "clientError": 60, // 4xx responses - 1 minute, usually not cached
      "serverError": 0 // 5xx responses - never cached
    },
    "contentTypeOverrides": {
      "image/svg+xml": true, // Force cache specific type
      "text/html": false // Force not cache specific type
    }
  }
}
```

### Per-Path TTL Configuration

In path patterns, you can set TTLs for specific paths:

```json
"PATH_PATTERNS": [
  {
    "name": "videos",
    "matcher": "^/videos/",
    "processPath": true,
    "cache": {
      "ttl": {
        "ok": 86400,
        "redirects": 3600,
        "clientError": 0,
        "serverError": 0
      }
    }
  }
]
```

## Best Practices

1. **Set Appropriate TTLs**: Use shorter TTLs for frequently changing content
2. **Consider Error Caching**: For some applications, caching 404s might make sense
3. **Use Cache Tags**: Add cache tags for easier purging of related content
4. **Monitor Cache Performance**: Use debug headers to check caching behavior
5. **Content Negotiation**: Consider varying cache by Accept headers for different formats
# Video Resizer KV Caching System

This document describes the KV caching system implementation for the Video Resizer service. The system is designed to improve performance and reduce origin requests for frequently accessed video transformations.

## Overview

The Video Resizer KV caching system provides a secondary caching layer that complements Cloudflare's Cache API. It allows storing transformed video variants in Cloudflare KV storage for faster retrieval and reduced computation costs.

### Key Benefits

- **Faster response times**: Cached variants can be retrieved directly from KV storage without transformation.
- **Reduced compute costs**: Avoids repeated transformation of the same variants.
- **Origin traffic reduction**: Minimizes requests to origin storage services.
- **Variant management**: Cache specific variants based on transformation parameters.
- **Purge flexibility**: Support for cache tags to purge related cached content.

## Architecture

![KV Caching Architecture](https://i.imgur.com/b7vmQGa.png)

The KV caching system follows a multi-layered approach:

1. **Request Processing**:
   - Incoming video URL requests are parsed for transformation parameters.
   - A cache key is generated based on the source path and transformation options.

2. **Cache Orchestration**:
   - First, check Cloudflare Cache API for a cached response.
   - If not found, check KV storage for a cached variant.
   - If still not found, transform the video and store in KV for future use.

3. **Background Storage**:
   - Transformed videos are stored in the background using `waitUntil()`.
   - This ensures the response is returned to the client quickly while caching happens asynchronously.

4. **Cache Management**:
   - Different TTLs based on response status codes.
   - Metadata stored alongside the video for variant information.
   - Cache tags for coordinated purging of related content.

## Implementation Details

### Key Components

1. **kvStorageService.ts**
   - Core service for KV operations
   - Handles key generation, storage, and retrieval
   - Manages metadata association with stored content

2. **kvCacheUtils.ts**
   - Helper utilities for the KV caching system
   - Handles TTL determination
   - Provides cache bypass functions
   - Manages cache headers

3. **cacheOrchestrator.ts**
   - Coordinates the caching workflow
   - Determines which cache layer to check
   - Handles background storage with waitUntil
   - Manages error handling and fallbacks

4. **videoHandlerWithCache.ts**
   - Integration point with the video processing handler
   - Extracts transformation options from requests
   - Wraps the transformation service with caching

### Key Generation

Keys in the KV storage are generated based on the source path and transformation options:

```
video:<source_path>[:option=value][:option=value]...
```

For example:
- `video:videos/sample.mp4` (original video)
- `video:videos/sample.mp4:derivative=mobile` (mobile derivative)
- `video:videos/sample.mp4:w=640:h=360:f=mp4:q=high` (specific transformation)

This schema allows for efficient storage and retrieval of specific video variants.

### Metadata Storage

Each transformed video is stored with metadata that includes:

```typescript
interface TransformationMetadata {
  sourcePath: string;
  width?: number | null;
  height?: number | null;
  format?: string | null;
  quality?: string | null;
  compression?: string | null;
  derivative?: string | null;
  cacheTags: string[];
  contentType: string;
  contentLength: number;
  createdAt: number;
  expiresAt?: number;
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

### TTL Management

Different TTLs are applied based on response status:

| Status Category | Default TTL | Description |
|-----------------|-------------|-------------|
| 2xx (Success)   | 86400s (24h)| Successful responses are cached longer |
| 3xx (Redirect)  | 3600s (1h)  | Redirects are cached for a medium duration |
| 4xx (Client Error) | 60s (1m) | Client errors are cached briefly |
| 5xx (Server Error) | 10s (10s) | Server errors are cached very briefly |

These TTLs can be configured in the environment configuration.

### Cache Tags

Cache tags are stored with each video variant, allowing for coordinated purging:

- Source-based tags: `video-<source_identifier>`
- Derivative-based tags: `video-derivative-<derivative_name>`
- Format-based tags: `video-format-<format>`

Example usage: 
- Purge all "mobile" derivatives: purge tag `video-derivative-mobile`
- Purge all WebM videos: purge tag `video-format-webm`

## Configuration

### Environment Configuration

The KV caching system is configured via the environment configuration:

```typescript
export interface CacheConfig {
  enableKVCache: boolean;      // Enable/disable KV caching
  kvTtl: {
    ok: number;                // TTL for 2xx responses
    redirects: number;         // TTL for 3xx responses
    clientError: number;       // TTL for 4xx responses
    serverError: number;       // TTL for 5xx responses
  };
}
```

### Wrangler Configuration

The KV namespace is configured in `wrangler.jsonc`:

```jsonc
{
  // Other wrangler configuration
  "kv_namespaces": [
    {
      "binding": "VIDEO_TRANSFORMATIONS_CACHE",
      "id": "your-kv-namespace-id"
    }
  ]
}
```

## Usage

### Basic Usage

The KV caching system is automatically used when handling video requests through the `videoHandlerWithCache.ts` handler:

```typescript
// Example route handler
router.get('/videos/:path', (request, env, ctx) => {
  return handleRequestWithCaching(request, env, ctx);
});
```

### Debugging and Bypassing Cache

You can bypass the KV cache in various ways:

1. Add `?debug=true` to the URL to bypass all caching layers
2. Add `?no-kv-cache=true` to bypass only the KV cache layer
3. Set the `debugEnabled` flag in the request context

## Performance Considerations

1. **Storage Limits**: 
   - Cloudflare KV has storage limits per namespace
   - Consider purging older or less frequently accessed variants

2. **Latency**:
   - KV reads are generally fast (in the low milliseconds)
   - KV writes can take longer, which is why we use background storage

3. **Cost Optimization**:
   - KV operations incur costs based on reads, writes, and stored data size
   - Use cache tags for efficient purging instead of individual key deletion

## Testing

The KV caching system includes comprehensive tests:

- Unit tests for the KV storage service
- Unit tests for the KV cache utilities
- Unit tests for the cache orchestrator
- Integration tests for the full caching flow

## Future Improvements

1. **Analytics**:
   - Track KV cache hit/miss rates
   - Monitor KV storage usage and limits

2. **Intelligent Caching**:
   - Prioritize caching for popular variants
   - Automatically adjust TTLs based on access patterns

3. **Advanced Purge Strategies**:
   - Implement LRU (Least Recently Used) eviction
   - Time-based purging for older variants
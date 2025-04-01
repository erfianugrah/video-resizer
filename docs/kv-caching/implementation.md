# KV Caching Implementation Details

## Key Components

1. **kvStorageService.ts**
   - Core service for KV operations
   - Handles key generation, storage, and retrieval
   - Manages metadata association with stored content

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
```
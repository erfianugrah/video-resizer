# Cache Invalidation

This document describes how cache invalidation works in the video resizer system.

## Overview

The video resizer uses a versioning-based cache invalidation strategy that allows for efficient cache busting without changing cache keys.

## Architecture

### KV Namespaces

1. **VIDEO_TRANSFORMATIONS_CACHE** - Stores the actual transformed video content
   - Key: Stable cache key (e.g., `video:path/to/video.mp4:derivative=mobile:width=854:height=480`)
   - Value: Video content (chunked or single entry)
   - Metadata: Includes `cacheVersion` field

2. **VIDEO_CACHE_KEY_VERSIONS** - Tracks version numbers for cache invalidation
   - Key: Version tracking key (e.g., `version-video-path-to-video-mp4-derivative-mobile-width-854-height-480`)
   - Value: Empty string
   - Metadata: Contains version number and timestamps

## How It Works

### 1. Version Retrieval
When a request comes in, the system:
- Generates a cache key based on the path and transformation parameters
- Retrieves the current version from `VIDEO_CACHE_KEY_VERSIONS` (defaults to 1 if not found)
- Uses this version when checking the cache and making CDN requests

### 2. Cache Lookup
The system looks up content in `VIDEO_TRANSFORMATIONS_CACHE` using the stable cache key:
- If found (cache hit): Serves the content directly
- If not found (cache miss): Proceeds to fetch from origin

### 3. Version Increment on Cache Miss
When there's a cache miss:
- The version is automatically incremented in `VIDEO_CACHE_KEY_VERSIONS`
- This ensures the next request will use the new version number
- The increment happens in `getVideo.ts` when the base key is not found

### 4. CDN Request with Version
When fetching from the CDN-cgi proxy:
- The version is appended as a query parameter (e.g., `?v=2`)
- This forces the CDN to fetch fresh content, bypassing its cache
- The version is added in `TransformVideoCommand.ts` when constructing the CDN URL

### 5. Storage with Version
When storing the fetched content:
- The content is stored with the stable cache key (no version in key)
- The version number is stored in the metadata's `cacheVersion` field
- Future requests can verify they have the correct version

## Example Flow

1. **First Request** (version not set):
   ```
   Request: /videos/sample.mp4?imwidth=854
   Version lookup: Not found, defaults to 1
   Cache lookup: Miss
   Version increment: Set to 1 (first time)
   CDN request: /cdn-cgi/media/width=854/videos/sample.mp4 (no version parameter for v1)
   Store: Key without version, metadata with cacheVersion=1
   ```

2. **Subsequent Request** (cached):
   ```
   Request: /videos/sample.mp4?imwidth=854
   Version lookup: Returns 1
   Cache lookup: Hit (serves from cache)
   ```

3. **After Cache Clear** (invalidation):
   ```
   Request: /videos/sample.mp4?imwidth=854
   Version lookup: Returns 1
   Cache lookup: Miss (cache was cleared)
   Version increment: 1 → 2
   CDN request: /cdn-cgi/media/width=854/videos/sample.mp4?v=2
   Store: Key without version, metadata with cacheVersion=2
   ```

4. **Next Request** (new version):
   ```
   Request: /videos/sample.mp4?imwidth=854
   Version lookup: Returns 2
   Cache lookup: Hit (serves new content)
   ```

## Benefits

1. **Stable Cache Keys**: The actual cache keys never change, making cache management simpler
2. **Automatic Invalidation**: Cache misses automatically trigger version increments
3. **CDN Cache Busting**: Version parameters ensure fresh content from CDN when needed
4. **No Manual Intervention**: The system self-manages versions based on cache state
5. **Granular Control**: Each unique transformation has its own version

## Configuration

### Enabling/Disabling Versioning

Versioning can be controlled via the cache configuration:

```json
{
  "cache": {
    "enableVersioning": true  // Set to false to disable versioning
  }
}
```

When disabled, all cache keys use version 1 and no version tracking occurs.

### Storage Duration

Since TTL has been removed from KV storage, all items are stored indefinitely. Cache invalidation happens through:
1. Manual cache purging
2. Version-based invalidation (described above)
3. KV namespace limits (LRU eviction)

## Integration Points

### Video Handler with Origins
The `videoHandlerWithOrigins.ts` retrieves the current version when processing requests and passes it through the transformation pipeline.

### Cache Orchestrator
The `cacheOrchestrator.ts` uses the version when generating cache keys for request coalescing but does not modify the version.

### KV Storage Service
The `getVideo.ts` in the KV storage service handles version increments on cache misses.

### Transformation Command
The `TransformVideoCommand.ts` appends the version parameter to CDN-cgi URLs when the version is greater than 1.

## Troubleshooting

### Version Not Incrementing
- Check if `VIDEO_CACHE_KEY_VERSIONS` KV namespace is properly bound
- Verify `enableVersioning` is set to `true` in configuration
- Check logs for "Incremented version on cache miss" messages

### CDN Not Returning Fresh Content
- Verify the version parameter is being added to CDN URLs
- Check if the CDN respects query parameters for cache keys
- Look for "Added version parameter to CDN-CGI URL" in logs

### Cache Not Invalidating
- Ensure the content was actually removed from `VIDEO_TRANSFORMATIONS_CACHE`
- Check if the version was incremented in `VIDEO_CACHE_KEY_VERSIONS`
- Verify the new version is being used in subsequent requests
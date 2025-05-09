# Caching Performance Optimizations

*Last Updated: May 10, 2025*

## Table of Contents

- [Overview](#overview)
- [Non-Blocking Cache Version Writes](#non-blocking-cache-version-writes)
- [KV Edge Cache](#kv-edge-cache)
- [Automatic TTL Refresh](#automatic-ttl-refresh)
- [Range Request Optimizations](#range-request-optimizations)
- [Cache Key Structure](#cache-key-structure)
- [Smart Purging](#smart-purging)
- [Memory Optimization](#memory-optimization)
- [Implementation Best Practices](#implementation-best-practices)

## Overview

The Video Resizer includes several performance optimizations in its caching system to ensure efficient operation and minimize latency. These optimizations are designed to provide the best possible user experience while maintaining system reliability and minimizing costs.

## Non-Blocking Cache Version Writes

One key optimization is the use of non-blocking writes for cache version metadata. This prevents the initial user request from being delayed by KV write operations.

### Implementation Details

The system uses Cloudflare's `waitUntil` API to perform cache version updates in the background:

```typescript
// Store updated version in background if possible
const requestContextForWaitUntil = getCurrentContext(); // Get the current request context
const executionCtxForWaitUntil = requestContextForWaitUntil?.executionContext;

if (executionCtxForWaitUntil?.waitUntil) { // Use the context obtained from getCurrentContext()
  executionCtxForWaitUntil.waitUntil(
    storeCacheKeyVersion(env, cacheKey, nextVersion, versionTtl)
  );
} else {
  // Fall back to direct storage
  logDebug('Falling back to await for storeCacheKeyVersion, waitUntil not available via requestContext', { cacheKey });
  await storeCacheKeyVersion(env, cacheKey, nextVersion, versionTtl);
}
```

### Reliable Context Retrieval

The system uses a reliable method to get the current execution context:

1. Uses `getCurrentContext()` to retrieve the current request context
2. Accesses the `executionContext` property from the `RequestContext`
3. Uses `executionContext.waitUntil()` for non-blocking operations
4. Falls back to synchronous operations if needed

### Benefits

- Initial response is sent to the client without waiting for KV writes
- Improves perceived performance for users
- Reduces the risk of request timeouts for large videos
- Provides better logging when falling back to a blocking operation
- Maintains cache version consistency even in edge cases

## KV Edge Cache

The Video Resizer leverages Cloudflare's edge cache for KV reads to reduce latency and KV operation costs.

### Implementation Details

KV reads are configured with a cacheTtl parameter:

```typescript
const DEFAULT_KV_READ_CACHE_TTL = 3600; // 1 hour

// Used in KV read operations
const kvReadOptions = { cacheTtl: DEFAULT_KV_READ_CACHE_TTL };
const cachedValue = await namespace.get(key, 'arrayBuffer', kvReadOptions);
```

### Benefits

- Reduces KV read operations for frequently accessed content
- Lowers latency by serving KV data from the edge
- Decreases costs associated with KV operations
- Provides multiple layers of caching (edge cache + KV)

## Automatic TTL Refresh

The caching system implements automatic TTL refresh for frequently accessed content.

### Implementation Details

When a video is accessed near its expiration time, the TTL is automatically extended:

```typescript
// Check if this is a good candidate for TTL refresh
const shouldRefreshTtl = isFrequentlyAccessed && 
  remainingTtlPercentage < TTL_REFRESH_THRESHOLD;

if (shouldRefreshTtl) {
  // Refresh TTL in the background
  const refreshContext = getCurrentContext();
  if (refreshContext?.executionContext?.waitUntil) {
    refreshContext.executionContext.waitUntil(
      refreshCacheTtl(key, videoContentType, metadata, originalTtl)
    );
  }
}
```

### Benefits

- Keeps frequently accessed content in cache longer
- Reduces origin load for popular content
- Operates in the background without adding latency
- Configurable thresholds for different content types

## Range Request Optimizations

The system includes several optimizations specifically for range requests.

### Implementation Details

For chunked videos, the system calculates which chunks contain the requested range:

```typescript
// Calculate needed chunks for range request
const neededChunks = [];
let currentPos = 0;

for (let i = 0; i < manifest.chunkCount; i++) {
  const chunkSize = manifest.actualChunkSizes[i];
  const chunkStart = currentPos;
  const chunkEnd = chunkStart + chunkSize - 1;
  
  // Check if this chunk overlaps with requested range
  if (rangeEnd >= chunkStart && rangeStart <= chunkEnd) {
    neededChunks.push({
      index: i,
      size: chunkSize,
      start: chunkStart,
      end: chunkEnd
    });
  }
  
  currentPos += chunkSize;
}

// Only fetch needed chunks
for (const chunk of neededChunks) {
  // Fetch and process chunk
}
```

### Benefits

- Reduces data transfer for range requests
- Improves seeking performance in video players
- Minimizes memory usage for large videos
- Speeds up initial playback start time

## Cache Key Structure

The caching system uses an optimized cache key structure.

### Implementation Details

Key structure is designed for efficient lookups and consistent hashing:

```typescript
// Generating a cache key
function generateKVKey(
  sourcePath: string, 
  options: TransformOptions
): string {
  const sortedOptions = sortObjectKeys(filterOptions(options));
  const optionsHash = hashObject(sortedOptions);
  
  return `video:${sourcePath}:${optionsHash}`;
}
```

### Benefits

- Consistent cache keys across requests
- Efficient storage and lookup
- Avoids key collisions while minimizing key length
- Supports versioning and invalidation

## Smart Purging

The caching system uses smart purging with cache tags to efficiently invalidate related content.

### Implementation Details

Content is tagged with multiple cache tags based on different characteristics:

```typescript
// Generate cache tags for a video
function generateCacheTags(sourcePath: string, options: TransformOptions): string[] {
  return [
    `source:${sourcePath}`,
    `width:${options.width || 'default'}`,
    `height:${options.height || 'default'}`,
    `format:${options.format || 'default'}`,
    `mode:${options.mode || 'video'}`
  ];
}

// These tags are used during purging
async function purgeByTag(tag: string): Promise<void> {
  // Find all keys with this tag and purge them
}
```

### Benefits

- Granular cache invalidation
- Efficient purging of related content
- Prevents orphaned content in the cache
- Supports targeted invalidation strategies

## Memory Optimization

The system implements several memory optimizations to ensure efficient operation.

### Implementation Details

Streaming responses are used to minimize memory usage:

```typescript
// Create streaming response
const { readable, writable } = new TransformStream();
const writer = writable.getWriter();

// Return response immediately
const response = new Response(readable, {
  headers: responseHeaders
});

// Process chunks and write to stream in background
streamChunks(writer, chunks);

return response;
```

### Benefits

- Reduces memory usage for large videos
- Enables handling of videos of any size
- Prevents worker out-of-memory errors
- Improves response time by streaming immediately

## Implementation Best Practices

When implementing or modifying the caching system, follow these best practices:

1. **Always Use Non-Blocking Operations**: Use `waitUntil` for background operations
2. **Leverage Edge Cache**: Configure appropriate edge cache TTLs
3. **Implement Fallbacks**: Always have a synchronous fallback if the non-blocking approach fails
4. **Add Detailed Logging**: Log performance metrics and operation durations
5. **Use Streaming for Large Content**: Stream responses to minimize memory usage
6. **Calculate Chunk Needs Upfront**: For range requests, determine needed chunks before fetching
7. **Monitor Performance**: Track cache hit rates and operation durations
8. **Optimize Cache Keys**: Use efficient, consistent key generation
9. **Implement TTL Refresh**: Automatically refresh TTL for popular content
10. **Use Smart Purging**: Implement granular cache invalidation with tags
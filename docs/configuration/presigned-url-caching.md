# AWS S3 Presigned URL Caching

## Problem Statement

AWS S3 presigned URLs must be regenerated for each request when using query-parameter based signing. This results in:

1. Increased latency as new signatures must be calculated for every request
2. Additional CPU usage for signature generation
3. Unnecessary AWS SDK calls when the same assets are requested multiple times
4. Potential rate limiting when many requests occur simultaneously

## Solution Architecture

Implement a caching layer for presigned URLs to allow reuse of the same signed URL for multiple requests to the same asset within the URL's validity period.

```
┌───────────┐     ┌───────────────┐     ┌──────────────┐     ┌────────────┐
│           │     │               │     │              │     │            │
│  Request  │────►│ URL Signature │────►│ KV URL Cache │────►│ AWS S3 API │
│           │     │    Service    │     │              │     │            │
└───────────┘     └───────────────┘     └──────────────┘     └────────────┘
                           │                    ▲
                           │                    │
                           ▼                    │
                  ┌────────────────┐           │
                  │                │           │
                  │ Cache Hit/Miss │───────────┘
                  │                │
                  └────────────────┘
```

## Implementation Plan

### 1. Create PresignedUrlCacheService

Create a new service responsible for storing and retrieving presigned URLs in KV storage with proper expiration handling.

### 2. Integrate with VideoStorageService

Modify the existing AWS S3 presigned URL generation logic to first check for a cached URL before generating a new one.

### 3. Set Up KV Namespace

Configure a KV namespace dedicated to storing presigned URLs with appropriate TTL settings.

### 4. Add Refresh Logic

Implement background refresh for URLs nearing expiration to prevent serving stale URLs.

## Technical Design

### PresignedUrlCacheService

```typescript
interface PresignedUrlCacheEntry {
  url: string;              // The presigned URL
  originalUrl: string;      // The original URL without signing
  createdAt: number;        // When the URL was generated
  expiresAt: number;        // When the URL will expire
  path: string;             // The asset path
  storageType: 'remote' | 'fallback';  // Origin type
  authType: string;         // Auth type (aws-s3-presigned-url)
  region?: string;          // AWS region
  service?: string;         // AWS service (typically s3)
}

// Key functions:
- generatePresignedUrlKey(): Generate a cache key for a specific asset path and auth config
- storePresignedUrl(): Store a generated URL in the cache with appropriate TTL
- getPresignedUrl(): Retrieve a cached URL if not expired
- isUrlExpiring(): Check if a URL is nearing expiration
- refreshPresignedUrl(): Generate a new URL in the background
```

### Cache Key Strategy

- Format: `presigned:{storageType}:{normalizedPath}:{authType}:{region}:{service}`
- Ensures unique keys for different asset paths and authentication configurations
- Allows efficient retrieval by path

### TTL Management

- Set KV TTL to 90% of the presigned URL's expiration time
- Safety buffer prevents serving expired URLs
- Background refresh for URLs nearing expiration (e.g., within last 10%)

### Integration with VideoStorageService

In both `fetchFromRemoteImpl` and `fetchFromFallbackImpl` methods:

1. Add check for cached presigned URL
2. Use cached URL if available and not expiring soon
3. Generate new URL only when needed
4. Store newly generated URL in cache
5. Use waitUntil for background refresh of expiring URLs

## Testing Approach

1. **Unit tests**: Verify caching logic, TTL calculations, and key generation
2. **Integration tests**: Test interaction with KV storage
3. **End-to-end tests**: Verify presigned URL reuse with actual S3 assets
4. **Load tests**: Measure performance improvements under load

## Performance Considerations

- **Memory Usage**: Minimal impact as only URLs are cached, not content
- **KV Operations**: Read-heavy with occasional writes
- **Cache Hit Rate**: Expected >90% for frequently accessed assets
- **Latency Reduction**: Up to 100ms per request on cache hit

## Implementation Steps

1. Create PresignedUrlCacheService module with core caching functions
2. Add KV namespace to wrangler.jsonc for presigned URL cache
3. Modify VideoStorageService to integrate with the cache
4. Add logging and diagnostics for cache hits/misses
5. Implement background refresh for expiring URLs
6. Create comprehensive tests for the caching functionality

## Configuration Parameters

- `expiresInSeconds`: Time until presigned URL expiration (default: 3600)
- `refreshThreshold`: Percentage of TTL remaining to trigger refresh (default: 10%)
- `cacheBufferFactor`: TTL reduction factor for safety margin (default: 0.9)

## Deployment Considerations

- **KV Namespace Limits**: Monitor usage against Cloudflare KV limits
- **Gradual Rollout**: Consider A/B testing to validate performance improvements
- **Monitoring**: Add metrics for cache hit rate and URL generation statistics
- **Purge Strategy**: Implement cache clearing for credential rotation

## Future Enhancements

- Adaptive TTL based on asset access patterns
- Bulk prefetching for commonly accessed assets
- Regional caching strategy for multi-region deployments
- Automated cache warming after credential rotation
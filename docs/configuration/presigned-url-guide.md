# AWS S3 Presigned URL Implementation Guide

## Overview

This comprehensive guide covers the implementation of AWS S3 presigned URLs in the video-resizer project. It addresses the architecture, implementation details, integration with Cloudflare Media Transformation, caching strategy, monitoring, and future enhancements.

## Table of Contents

1. [Problem Statement](#problem-statement)
2. [Solution Architecture](#solution-architecture)
3. [Implementation Components](#implementation-components)
4. [Integration with Cloudflare Media Transformation](#integration-with-cloudflare-media-transformation)
5. [Caching Strategy](#caching-strategy)
6. [Configuration Guide](#configuration-guide)
7. [Performance Considerations](#performance-considerations)
8. [Monitoring and Metrics](#monitoring-and-metrics)
9. [Testing Strategy](#testing-strategy)
10. [Operational Guidelines](#operational-guidelines)
11. [Future Enhancements](#future-enhancements)

## Problem Statement

AWS S3 presigned URLs present several challenges in the context of Cloudflare Media Transformation:

1. **Authentication Requirements**: Private S3 buckets require authentication via presigned URLs containing query parameters with signatures
2. **Signature Preservation**: Presigned URLs must be preserved exactly to maintain valid AWS signatures
3. **Integration Complexity**: The presigning step must occur *before* constructing the transformation URL
4. **Performance Concerns**: Generating presigned URLs for every request is inefficient and increases latency
5. **URL Composition**: Cloudflare Media Transformation uses a `/cdn-cgi/media/` URL pattern where the origin content URL is appended at the end, requiring special handling for presigned URLs

Without proper handling, this leads to "Failed to determine file size" errors when Cloudflare attempts to access content with invalid signatures.

## Solution Architecture

The solution implements a comprehensive approach to handle presigned URLs:

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

Key architectural components:

1. **Asynchronous URL Construction**:
   - Identifies URLs requiring presigning
   - Retrieves cached URLs or generates new ones
   - Preserves signatures for AWS presigned URLs
   - Constructs the final transformation URL

2. **KV-based Caching**:
   - Stores presigned URLs with metadata
   - Implements TTL management
   - Handles background refresh
   - Reduces AWS API calls

3. **Signature Preservation Mechanisms**:
   - No manipulation of AWS presigned URLs
   - No version parameters added to presigned URLs
   - Proper path extraction using pattern context

## Implementation Components

### 1. Presigned URL Cache Service (`presignedUrlCacheService.ts`)

The core service responsible for caching and retrieving presigned URLs:

```typescript
export interface PresignedUrlCacheEntry {
  url: string;                        // The presigned URL
  originalUrl: string;                // The original URL without signing
  createdAt: number;                  // When the URL was generated
  expiresAt: number;                  // When the URL will expire
  path: string;                       // The asset path
  storageType: 'remote' | 'fallback'; // Origin type
  authType: string;                   // Auth type (aws-s3-presigned-url)
  region?: string;                    // AWS region
  service?: string;                   // AWS service (typically s3)
  version?: number;                   // Cache version for invalidation
}
```

Key functions:
- `generatePresignedUrlKey`: Creates unique cache keys for presigned URLs
- `storePresignedUrl`: Stores URLs in KV storage with appropriate TTL
- `getPresignedUrl`: Retrieves cached URLs with expiration checking
- `isUrlExpiring`: Determines if a URL is nearing expiration
- `refreshPresignedUrl`: Updates expiring URLs in the background

### 2. Presigned URL Utilities (`presignedUrlUtils.ts`)

Utilities for handling presigned URLs:

```typescript
// Check if a URL needs to be presigned
export function needsPresigning(
  url: string, 
  storageConfig?: StorageConfig,
  patternContext?: PresigningPatternContext | null
): boolean

// Get or generate a presigned URL for an asset
export const getOrGeneratePresignedUrl = tryOrNull<
  [EnvVariables, string, StorageConfig, PresigningPatternContext | null],
  Promise<string>
>

// Leave AWS presigned URLs completely unmodified to preserve the signature
export function encodePresignedUrl(url: string): string {
  if (url.includes('X-Amz-Credential') && url.includes('X-Amz-Signature')) {
    return url;
  }
  
  // For non-AWS URLs, apply standard encoding
  // ...
}
```

### 3. URL Transformation Utilities (`pathUtils.ts`)

Handles the integration with Cloudflare Media Transformation:

```typescript
// Async URL construction with presigned URL support
export async function buildCdnCgiMediaUrlAsync(
  options: TransformParams,
  originUrl: string,
  requestUrl?: string,
  env?: any,
  matchedPattern?: PathPattern | null
): Promise<string> {
  // Check if origin URL needs presigning
  if (needsPresigning(originUrl, storageConfig, patternContext)) {
    // Get or generate presigned URL
    originUrl = await getOrGeneratePresignedUrl(env, originUrl, storageConfig, patternContext);
  }
  
  // Build the CDN-CGI URL with the presigned content URL
  // ...
}
```

### 4. URL Versioning (`urlVersionUtils.ts`)

Handles version parameters with special treatment for presigned URLs:

```typescript
export function addVersionToUrl(url: string, version: number): string {
  // Skip adding version parameters to AWS presigned URLs entirely
  if (url.includes('X-Amz-Signature=')) {
    return url; // Return unmodified for AWS presigned URLs
  }
  
  // Standard approach for regular URLs
  // ...
}
```

## Integration with Cloudflare Media Transformation

The integration with Cloudflare Media Transformation follows this flow:

1. **Request Processing**:
   - Request is received and matched to a path pattern
   - Video URL is constructed based on the matched pattern

2. **Transformation Preparation**:
   - TransformationService prepares parameters for video transformation
   - Pattern context is preserved throughout the pipeline

3. **URL Construction**:
   - `buildCdnCgiMediaUrlAsync` is called to create the transformation URL
   - Presigning check is performed using the pattern context
   - If needed, a presigned URL is retrieved from cache or generated
   - The presigned URL is preserved exactly to maintain signatures
   - The final CDN-CGI URL incorporates the presigned content URL

4. **Request Execution**:
   - The constructed URL is returned to the client
   - Cloudflare Media Transformation processes the request
   - The embedded presigned URL provides authenticated access to the S3 content

### Key Implementation Detail: Signature Preservation

The most critical aspect is preserving AWS signatures exactly:

1. `encodePresignedUrl` returns AWS presigned URLs completely unchanged
2. `addVersionToUrl` skips adding version parameters to AWS presigned URLs
3. AWS signatures themselves act as natural cache busters, making versioning unnecessary

This eliminates the "Failed to determine file size" error that occurs when signatures are invalidated.

## Caching Strategy

The caching implementation uses Cloudflare KV storage with a well-defined strategy:

### Cache Key Format

```
presigned:{storageType}:{normalizedPath}:{authType}:{region}:{service}
```

This format ensures unique keys for different asset paths and authentication configurations.

### TTL Management

- KV TTL is set to 90% of the presigned URL's expiration time
- This safety buffer prevents serving expired URLs
- Background refresh occurs for URLs nearing expiration (e.g., within last 10%)

### Cache Operations

1. **Cache Check**:
   - Before generating a new presigned URL, check the cache first
   - Use the normalized path and auth config to create the cache key
   - Retrieve the cached entry if available

2. **Cache Miss**:
   - Generate a new presigned URL using AWS SDK
   - Store the URL in cache with appropriate TTL
   - Return the newly generated URL

3. **Cache Hit**:
   - Return the cached URL directly if not expiring soon
   - If URL is nearing expiration, trigger background refresh
   - Continue using the current URL while refresh happens asynchronously

4. **Background Refresh**:
   - For URLs nearing expiration, generate a new URL
   - Update the cache entry with the new URL
   - Use `waitUntil` to handle this asynchronously

## Configuration Guide

### KV Namespace Configuration

In `wrangler.jsonc`:
```json
{
  "kv_namespaces": [
    {
      "binding": "PRESIGNED_URLS",
      "id": "your-kv-namespace-id",
      "preview_id": "your-preview-kv-namespace-id"
    }
  ]
}
```

### AWS Credentials

Environment variables required:
- `AWS_ACCESS_KEY_ID`: Access key for AWS authentication
- `AWS_SECRET_ACCESS_KEY`: Secret key for AWS authentication
- `AWS_REGION`: Default AWS region for operations

### Path Pattern Configuration

```json
"pathPatterns": [
  {
    "name": "standard",
    "matcher": "^/(.*\\.(mp4|webm|mov))",
    "processPath": true,
    "baseUrl": "https://example.com",
    "originUrl": "https://your-bucket.s3.amazonaws.com/videos/",
    "auth": {
      "type": "aws-s3-presigned-url",
      "enabled": true,
      "accessKeyVar": "STANDARD_AWS_ACCESS_KEY_ID",
      "secretKeyVar": "STANDARD_AWS_SECRET_ACCESS_KEY",
      "region": "us-east-1",
      "service": "s3",
      "expiresInSeconds": 3600
    }
  }
]
```

### Configuration Parameters

- `expiresInSeconds`: Time until presigned URL expiration (default: 3600)
- `refreshThreshold`: Percentage of TTL remaining to trigger refresh (default: 10%)
- `cacheBufferFactor`: TTL reduction factor for safety margin (default: 0.9)

## Performance Considerations

### Memory and KV Usage

- **Memory Impact**: Minimal as only URLs are cached, not content
- **KV Operations**: Read-heavy with occasional writes
- **Request Pattern**: Cache hit rate expected >90% for frequently accessed assets

### Latency Improvements

- **Cold Path**: First request to an asset ~100-200ms (AWS SDK call included)
- **Hot Path**: Subsequent requests ~20-50ms (cache hit, no AWS SDK call)
- **Overall**: Up to 100ms latency reduction per request on cache hit

### Resource Utilization

- **AWS API Calls**: Dramatically reduced through caching
- **Worker CPU**: Minimal impact from URL generation
- **KV Operations**: Well within Cloudflare limits for typical usage

## Monitoring and Metrics

### Key Metrics to Track

1. **Performance Metrics**:
   - Presigned URL generation time
   - Cache hit rate
   - URL refresh rate
   - End-to-end latency

2. **Reliability Metrics**:
   - Presigning error rate
   - Fallback usage rate
   - KV operation success rate
   - URL expiration events

3. **Resource Usage Metrics**:
   - KV storage size
   - KV rate limiting events
   - AWS API call volume

### Implementation

Add instrumentation to key functions:
```typescript
export async function getPresignedUrl(/* params */) {
  const start = performance.now();
  
  try {
    // Function logic
    if (cachedData) {
      logMetric('presigned_url_cache_hit', { path: truncatePath(path) });
    } else {
      logMetric('presigned_url_cache_miss', { path: truncatePath(path) });
    }
    
    // More logic...
  } catch (err) {
    logMetric('presigned_url_cache_error', { 
      path: truncatePath(path),
      error: err.message 
    });
    throw err;
  } finally {
    const duration = performance.now() - start;
    logMetric('presigned_url_cache_duration', { 
      duration_ms: Math.round(duration),
      operation: 'get'
    });
  }
}
```

### Alerting Thresholds

- **Critical Alerts**:
  - High error rates (>1%)
  - Sustained high latency (>300ms for 5 minutes)
  - KV rate limiting events
  - Multiple URL expiration events

- **Warning Alerts**:
  - Cache hit rate drops below 85%
  - Refresh rate exceeds 15%
  - KV storage approaching 80% capacity
  - Unusual traffic patterns

## Testing Strategy

### Unit Tests

1. **Presigned URL Utilities**:
   - Test URL detection for presigning needs
   - Verify signature preservation for AWS URLs
   - Test path extraction with different pattern contexts

2. **Caching Service**:
   - Test cache key generation
   - Verify TTL calculations
   - Test expiration detection
   - Validate refresh logic

### Integration Tests

1. **KV Integration**:
   - Test storage and retrieval with mock KV
   - Verify proper TTL settings
   - Test cache hit/miss scenarios

2. **AWS Integration**:
   - Test presigned URL generation
   - Verify signature format
   - Test URL composition

3. **End-to-End Flow**:
   - Test complete transformation with presigned URLs
   - Verify Cloudflare access to private content
   - Test fallback mechanisms

## Operational Guidelines

### Best Practices

1. **Credential Management**:
   - Rotate credentials regularly
   - Use environment-specific credentials
   - Consider using temporary credentials or IAM roles

2. **Cache Tuning**:
   - Set appropriate TTLs based on content access patterns
   - Monitor cache hit rates and adjust parameters
   - Consider longer expiration for rarely changing content

3. **Error Handling**:
   - Implement proper fallbacks for authentication failures
   - Log detailed diagnostics for troubleshooting
   - Consider circuit breakers for repeated AWS API failures

4. **Monitoring**:
   - Track cache hit/miss rates
   - Monitor URL generation times
   - Set alerts for anomalous behavior

### Incident Response

For high error rates or performance issues:
1. Check AWS credential status
2. Verify KV namespace accessibility
3. Review recent code deployments
4. Consider rolling back recent changes
5. Check for AWS service outages

## Future Enhancements

1. **Multi-provider Support**:
   - Add support for Azure Blob Storage
   - Support Google Cloud Storage
   - Create a generic interface for different providers

2. **Advanced Caching**:
   - Implement predictive prefetching for common assets
   - Add adaptive TTL based on access patterns
   - Support cache warming for critical assets

3. **Performance Optimizations**:
   - Batch refresh operations
   - Regional caching strategy
   - Edge-optimized signature generation

4. **Security Enhancements**:
   - Add IP-based restrictions
   - Implement request signing for added security
   - Add access logging for audit purposes
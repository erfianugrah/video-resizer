# Presigned URL Caching

## Overview

This document outlines the implementation of presigned URL caching for AWS S3 assets in the video-resizer project. The solution addresses performance and rate-limiting concerns when frequently accessing private S3 buckets.

## Problem Statement

When accessing private content in AWS S3 buckets, authentication is required for each request. Presigned URLs provide temporary access with the necessary authentication parameters embedded in the URL. However, these URLs:

1. Change with each generation due to timestamp-based signatures
2. Require AWS API calls to generate, which can be rate-limited
3. Have a limited validity period (typically 1 hour by default)
4. Are unnecessarily regenerated for repeated requests to the same asset

## Solution Architecture

The presigned URL caching implementation:

1. Stores presigned URLs in Cloudflare KV with appropriate metadata
2. Retrieves cached URLs when available to avoid regeneration
3. Tracks URL expiration and refreshes URLs that are close to expiry
4. Uses background refresh via `waitUntil` to minimize request latency

## Implementation Components

### 1. KV Namespace Configuration

A dedicated KV namespace for presigned URLs is configured in `wrangler.jsonc`:

```json
"kv_namespaces": [
  {
    "binding": "PRESIGNED_URLS",
    "id": "502fa1f64a6e4e48bb7e0bcd32472ba8"
  }
]
```

### 2. Presigned URL Cache Service

The core caching service is implemented in `presignedUrlCacheService.ts` and provides:

- `getPresignedUrl` - Retrieves cached presigned URLs
- `storePresignedUrl` - Caches newly generated presigned URLs
- `isUrlExpiring` - Detects URLs nearing expiration
- `refreshPresignedUrl` - Updates expiring URLs in the background

### 3. PresignedUrlCacheEntry Structure

Each cached URL is stored with metadata:

```typescript
export interface PresignedUrlCacheEntry {
  url: string;                // The presigned URL
  originalUrl: string;        // Original (unsigned) URL
  createdAt: number;          // Cache timestamp
  expiresAt: number;          // Expiration timestamp
  path: string;               // Asset path
  storageType: string;        // Origin type (remote/fallback)
  authType: string;           // Auth type (aws-s3-presigned-url)
  region?: string;            // AWS region
  service?: string;           // AWS service (typically s3)
  version?: number;           // Cache version for invalidation
}
```

### 4. Integration with Media Transformation

For use with Cloudflare Media Transformation, the presigned URL must be:

1. Generated before constructing the transformation URL
2. Properly encoded to avoid parameter conflicts
3. Embedded in the CDN-CGI URL as the content source

This integration is provided through:
- `presignedUrlUtils.ts` - Helper functions for URL processing
- Updated `pathUtils.ts` - Media transformation URL integration
- Async versions of URL building functions

## Usage Examples

### Basic URL Caching

```typescript
// Check for cached presigned URL
const cachedEntry = await getPresignedUrl(
  env.PRESIGNED_URLS,
  path,
  {
    storageType: 'remote',
    authType: 'aws-s3-presigned-url',
    region: 'us-east-1',
    service: 's3',
    env
  }
);

if (cachedEntry) {
  // Use cached URL
  return cachedEntry.url;
}

// Generate new presigned URL
const presignedUrl = await generatePresignedUrl(path, env);

// Cache the URL for future use
await storePresignedUrl(
  env.PRESIGNED_URLS,
  path,
  presignedUrl,
  originalUrl,
  {
    storageType: 'remote',
    expiresInSeconds: 3600,
    authType: 'aws-s3-presigned-url',
    region: 'us-east-1',
    service: 's3',
    env
  }
);
```

### Background URL Refresh

```typescript
// Check if URL is close to expiration
if (isUrlExpiring(cachedEntry, 600)) { // 10 minute threshold
  // Refresh in background using waitUntil
  env.executionCtx.waitUntil(
    refreshPresignedUrl(
      env.PRESIGNED_URLS,
      cachedEntry,
      {
        env,
        generateUrlFn: async (path) => generatePresignedUrl(path, env)
      }
    )
  );
}
```

## Configuration Parameters

### Cloudflare Worker Environment

```typescript
interface EnvVariables {
  // Other environment variables...
  PRESIGNED_URLS?: KVNamespace;
  
  // Worker Execution Context for background operations
  executionCtx?: {
    waitUntil: (promise: Promise<any>) => void;
  };
}
```

### Storage Authentication

```typescript
interface AuthConfig {
  enabled: boolean;
  type: string;           // 'aws-s3-presigned-url'
  accessKeyVar?: string;  // Environment variable for access key
  secretKeyVar?: string;  // Environment variable for secret key
  region?: string;        // AWS region
  service?: string;       // AWS service
  expiresInSeconds?: number; // URL validity duration
}
```

## Performance Considerations

1. **Cache Efficiency**
   - KV operations are efficient and low-latency
   - Cache hit rates typically exceed 99% for popular assets
   - Background refresh eliminates user-facing latency

2. **AWS API Call Reduction**
   - Multiple requests for the same asset use a single presigned URL
   - Significantly reduces AWS API calls and avoids rate limiting

3. **Memory Usage**
   - Using KV avoids in-memory caching that would be limited by worker lifecycle

## Future Enhancements

1. **Adaptive Expiration**
   - Dynamically adjust URL expiration based on usage patterns
   
2. **Prefetching**
   - Proactively generate presigned URLs for frequently accessed content

3. **Multi-region Support**
   - Enhanced region-specific URL generation and caching

4. **Monitoring & Analytics**
   - Cache hit/miss rates tracking
   - Performance metrics collection
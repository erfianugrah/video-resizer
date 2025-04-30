# Presigned URL Integration with Cloudflare Media Transformation

## Overview

This document covers the integration of AWS S3 presigned URLs with Cloudflare Media Transformation in the video-resizer project. It addresses the architectural challenge where presigned URLs need to be generated and embedded correctly in transformation URLs for private S3 content access.

## Problem Statement

Cloudflare Media Transformation uses a `/cdn-cgi/media/` URL pattern where the origin content URL is appended at the end. When the origin content is in a private S3 bucket:

1. The content URL requires AWS authentication via a presigned URL
2. The presigned URL must be properly encoded to work within the CDN-CGI URL structure
3. The presigning step must occur *before* constructing the transformation URL
4. Multiple transformation requests for the same content should reuse presigned URLs

## Solution Architecture

The solution implements:

1. An asynchronous URL construction process that:
   - Identifies URLs requiring presigning
   - Retrieves cached presigned URLs when available
   - Generates and caches new presigned URLs when needed
   - Properly encodes the presigned URL parameters
   - Constructs the final transformation URL with the presigned content URL

2. KV-based caching of presigned URLs to:
   - Minimize AWS API calls
   - Improve performance
   - Handle rate limiting
   - Support background refresh of expiring URLs

## Implementation Components

### 1. URL Transformation Integration

The `buildCdnCgiMediaUrlAsync` function in `pathUtils.ts` provides asynchronous URL construction with presigned URL support:

```typescript
/**
 * Builds a CDN-CGI media transformation URL with async support for presigning
 * @param options Transformation options
 * @param originUrl Full URL to the origin video (content source URL)
 * @param requestUrl The original request URL (host will be used for the CDN-CGI path)
 * @returns Promise resolving to a CDN-CGI media transformation URL
 */
export async function buildCdnCgiMediaUrlAsync(
  options: TransformParams,
  originUrl: string,
  requestUrl?: string
): Promise<string>
```

### 2. Presigned URL Utilities

The `presignedUrlUtils.ts` module provides:

```typescript
// Check if a URL needs to be presigned
export function needsPresigning(url: string, storageConfig?: StorageConfig): boolean

// Get or generate a presigned URL for an asset
export const getOrGeneratePresignedUrl: async function(
  env: EnvVariables,
  url: string,
  storageConfig: StorageConfig
): Promise<string>

// Properly encode a presigned URL for inclusion in another URL
export function encodePresignedUrl(url: string): string
```

### 3. TransformationService Integration

The TransformationService has been updated to use the async URL building:

```typescript
// Import path utils module to get buildCdnCgiMediaUrlAsync
const { buildCdnCgiMediaUrlAsync } = await import('../utils/pathUtils');

// Build the CDN-CGI media URL asynchronously to allow for presigning
let cdnCgiUrl = await buildCdnCgiMediaUrlAsync(cdnParams, videoUrl, url.toString());
```

## URL Transformation Flow

1. TransformVideoCommand is executed
2. TransformationService prepares parameters and constructs video URL
3. buildCdnCgiMediaUrlAsync is called for URL transformation
4. presignedUrlUtils identifies if the URL needs presigning
5. If presigning is needed:
   - Check KV cache for existing presigned URL
   - Generate new presigned URL if not in cache or expiring
   - Store the presigned URL in KV cache
   - Properly encode the presigned URL for CDN-CGI use
6. Final CDN-CGI URL is constructed using the (optionally presigned) content URL
7. Cloudflare Media Transformation can now access private S3 content

## Configuration Parameters

### AWS S3 Authentication Configuration

```typescript
interface AuthConfig {
  enabled: boolean;
  type: string;               // Must be 'aws-s3-presigned-url'
  accessKeyVar?: string;      // Environment variable for access key
  secretKeyVar?: string;      // Environment variable for secret key
  region?: string;            // AWS region
  service?: string;           // AWS service (typically s3)
  expiresInSeconds?: number;  // URL validity duration
}
```

### Storage Configuration

```typescript
interface StorageConfig {
  remoteUrl?: string;          // Base S3 URL for remote storage
  fallbackUrl?: string;        // Base S3 URL for fallback storage
  remoteAuth?: AuthConfig;     // Auth config for remote storage
  fallbackAuth?: AuthConfig;   // Auth config for fallback storage
}
```

## Implementation Benefits

1. **Architectural Clarity**
   - Clear separation of URL signing and transformation processes
   - Properly handles asynchronous nature of URL generation

2. **Performance Optimization**
   - Caches presigned URLs for reuse
   - Minimizes redundant AWS API calls
   - Uses background refresh for expiring URLs

3. **Reliability**
   - Graceful fallbacks when presigning fails
   - Maintains backward compatibility
   - Proper error handling throughout the process

## Usage Example

### Storage Configuration in `worker-config.json`

```json
{
  "storage": {
    "remoteUrl": "https://your-bucket.s3.amazonaws.com",
    "remoteAuth": {
      "enabled": true,
      "type": "aws-s3-presigned-url",
      "accessKeyVar": "AWS_ACCESS_KEY_ID",
      "secretKeyVar": "AWS_SECRET_ACCESS_KEY",
      "region": "us-east-1",
      "service": "s3",
      "expiresInSeconds": 3600
    }
  }
}
```

### Resulting Transformation URL

For a source URL like:
```
https://your-bucket.s3.amazonaws.com/videos/example.mp4
```

The resulting CDN-CGI URL with presigned source would be:
```
https://your-worker.example.com/cdn-cgi/media/width=720,height=480,fit=contain/https://your-bucket.s3.amazonaws.com/videos/example.mp4?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=...&X-Amz-Date=...&X-Amz-Expires=3600&X-Amz-SignedHeaders=host&X-Amz-Signature=...
```

## Testing and Verification

The implementation includes:

1. **Unit Tests**
   - Tests for presigned URL utilities
   - Tests for URL transformation with presigning

2. **Integration Tests**
   - End-to-end tests for the complete transformation flow
   - Verification of presigned URL parameters

3. **Manual Testing Procedure**
   1. Configure S3 bucket with private access
   2. Set up AWS credentials in environment variables
   3. Configure storage with aws-s3-presigned-url auth type
   4. Request a video transformation
   5. Verify the transformation URL contains AWS signature parameters
   6. Confirm Cloudflare can access the private content
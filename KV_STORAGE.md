# KV Storage for Transformed Video Variants

This document explains how to use Cloudflare KV to store transformed video variants, enabling faster delivery of previously transformed videos.

## Overview

The KV storage implementation allows video-resizer to:

1. Store transformed video variants in Cloudflare KV for quick retrieval
2. Include metadata with each variant for tracking and cache invalidation
3. Use cache tags to identify related variants
4. Set appropriate TTLs based on response status and content type

## Key Files

- `src/services/kvStorageService.ts`: Core service for storing and retrieving videos from KV
- `src/utils/kvCacheUtils.ts`: Helper utilities for integrating KV with the transformation process
- `src/services/integrationExample.ts`: Example of integrating KV with the existing transformation flow

## Metadata Structure

Each KV entry includes the following metadata:

```typescript
interface TransformationMetadata {
  // Original source path
  sourcePath: string;
  
  // Transformation parameters
  width?: number;
  height?: number;
  format?: string;
  quality?: string;
  compression?: string;
  derivative?: string;
  
  // Cache information
  cacheTags: string[];
  
  // Content information
  contentType: string;
  contentLength: number;
  
  // Timestamps
  createdAt: number;
  expiresAt?: number;
  
  // Additional metadata
  duration?: number;
  fps?: number;
  customData?: Record<string, unknown>;
}
```

## Key Naming Convention

KV keys follow this format:

```
video:{normalizedPath}:derivative={derivative}
```

or when no derivative is used:

```
video:{normalizedPath}:w={width}:h={height}:f={format}:q={quality}:c={compression}
```

For example:
- `video:assets/videos/intro.mp4:derivative=mobile`
- `video:content/marketing/demo.mp4:w=640:h=360:f=mp4:q=medium:c=high`

## Configuration

Add these to your wrangler.jsonc file:

```jsonc
"kv_namespaces": [
  {
    "binding": "VIDEO_TRANSFORMATIONS_CACHE",
    "id": "8e790768576242cc98fa3e4aa327f815" 
  }
],
"vars": {
  "CACHE_ENABLE_KV": "true",
  "CACHE_KV_TTL_OK": "86400",        // 24 hours for successful responses
  "CACHE_KV_TTL_REDIRECTS": "3600",  // 1 hour for redirects
  "CACHE_KV_TTL_CLIENT_ERROR": "60", // 1 minute for client errors
  "CACHE_KV_TTL_SERVER_ERROR": "10"  // 10 seconds for server errors
}
```

## Setup

1. Create the KV namespace:
   ```bash
   wrangler kv:namespace create "VIDEO_TRANSFORMATIONS_CACHE"
   ```

2. For local development, create a preview namespace:
   ```bash
   wrangler kv:namespace create "VIDEO_TRANSFORMATIONS_CACHE" --preview
   ```

3. Add the namespace ID to your wrangler.jsonc file

## Usage Examples

### Basic Usage

```typescript
import { transformVideoWithKVCache } from './services/integrationExample';

// Use in place of transformVideo
const response = await transformVideoWithKVCache(
  request,
  videoOptions,
  pathPatterns,
  debugInfo,
  env
);
```

### List Variants

```typescript
import { listVideoVariants } from './services/integrationExample';

// List all transformed variants for a source video
const variants = await listVideoVariants(env, '/assets/videos/intro.mp4');
console.log(`Found ${variants.length} variants`);
```

### Delete a Variant

```typescript
import { deleteVideoVariant } from './services/integrationExample';

// Delete a specific variant
const deleted = await deleteVideoVariant(
  env, 
  'video:assets/videos/intro.mp4:derivative=mobile'
);
```

## Debugging

Add `?debug=true` or `?no-kv-cache=true` to the URL to bypass KV caching during development.

## Cache Invalidation

Cache tags are stored in the metadata, making it easy to identify related variants. To invalidate all variants of a specific source video, list the variants and delete them:

```typescript
const variants = await listVideoVariants(env, '/assets/videos/intro.mp4');
for (const variant of variants) {
  await deleteVideoVariant(env, variant.key);
}
```

## Considerations

1. KV has a maximum value size of 25MB per entry - larger videos won't be cached
2. Maximum of 50 list operations per second per namespace
3. Optimal for videos that are frequently accessed with the same transformation parameters
4. KV read performance is fast and globally distributed, but writes are slower and should be done asynchronously
5. Use waitUntil for background writes to avoid impacting response time
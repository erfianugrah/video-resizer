# KV Cache Versioning System

## Overview

The KV Cache Versioning System enhances the video-resizer by tracking version numbers for cached content, enabling automatic cache busting when content changes. This system addresses the challenge of clients continuing to receive stale content after cache updates by appending version parameters to URLs.

## Architecture

The versioning system uses a dedicated KV namespace (`VIDEO_CACHE_KEY_VERSIONS`) to store version numbers separately from content, ensuring version persistence even when cached content expires or is deleted.

![KV Cache Versioning Architecture](https://i.imgur.com/W5CrL5a.png)

The system consists of three main components:

1. **Version Storage**:
   - Dedicated `VIDEO_CACHE_KEY_VERSIONS` KV namespace stores version metadata
   - Versions persist even when content is removed or expires
   - Metadata includes version number, creation timestamp, and update timestamp

2. **URL Manipulation**:
   - URL normalization removes version parameters for consistent caching
   - URL versioning adds version parameters for cache busting (e.g., `?v=2`)
   - Seamless integration with existing URL transformation pipeline

3. **Version Management**:
   - Automatic version incrementation on cache misses
   - Automatic version incrementation on errors
   - Version synchronization between content storage and version store

## Key Components

1. **cacheVersionService.ts**
   - Core service for version management
   - Handles version key generation, retrieval, and incrementation
   - Uses KV metadata for efficient storage

2. **urlVersionUtils.ts**
   - Utilities for URL manipulation
   - Normalizes URLs to remove version parameters
   - Adds version parameters to URLs for cache busting

3. **kvStorageService.ts Integration**
   - Stores version information in content metadata
   - Synchronizes with cacheVersionService
   - Uses version information in headers and diagnostics

4. **TransformationService.ts Integration**
   - Detects cache misses using KV list API
   - Increments versions when content isn't in cache
   - Adds version parameters to transformed URLs

## Version Metadata Structure

Each version entry in the KV namespace includes metadata:

```typescript
interface VersionMetadata {
  version: number;
  createdAt?: number;  // When the version was first created
  updatedAt?: number;  // When the version was last updated
}
```

This metadata provides:
- Current version number for cache busting
- Timestamps for tracking version history
- No value is stored, only metadata, for efficiency

## Key Generation

Version keys are derived from cache keys by sanitizing and prefixing:

```typescript
function createVersionKey(cacheKey: string): string {
  return `version-${cacheKey.replace(/[^\w\/.-]/g, '-').substring(0, 512)}`;
}
```

This ensures consistent key generation for any cached content.

## Version Incrementation Logic

Versions are incremented based on specific conditions:

1. **Cache Misses**: When requested content isn't found in KV cache
   ```typescript
   if (!exists) {
     shouldIncrement = true;
   }
   ```

2. **Errors**: When KV storage operations fail
   ```typescript
   try {
     return await getTransformedVideoImpl(namespace, sourcePath, options, request);
   } catch (err) {
     // Increment version on error
     if (options.env?.VIDEO_CACHE_KEY_VERSIONS) {
       const nextVersion = await getNextCacheKeyVersion(options.env, key, true);
       // ...store updated version
     }
     // ...handle error
   }
   ```

3. **Forced Updates**: When explicitly requested by the application
   ```typescript
   const nextVersion = await getNextCacheKeyVersion(env, cacheKey, forceIncrement);
   ```

## URL Versioning

The system adds version parameters to URLs for cache busting:

```typescript
export function addVersionToUrl(url: string, version: number): string {
  try {
    const parsedUrl = new URL(url);
    parsedUrl.searchParams.set('v', version.toString());
    return parsedUrl.toString();
  } catch (err) {
    // Fallback for invalid URLs
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}v=${version}`;
  }
}
```

Only version > 1 is added to URLs to avoid unnecessary parameters:

```typescript
// Only add version param for version > 1 to avoid unnecessary params
if (nextVersion > 1) {
  // Create a modified URL with version parameter
  const versionedCdnCgiUrl = addVersionToUrl(cdnCgiUrl, nextVersion);
  
  // Update the URL with version
  cdnCgiUrl = versionedCdnCgiUrl;
}
```

## Performance Optimization

The system uses several optimizations for performance:

1. **Non-blocking Operations**: `waitUntil` for background version updates
   ```typescript
   if (env && 'executionCtx' in env && env.executionCtx?.waitUntil) {
     env.executionCtx.waitUntil(
       storeCacheKeyVersion(env, cacheKey, nextVersion, versionTtl)
     );
   }
   ```

2. **Metadata-only Storage**: No values, only metadata for versions
   ```typescript
   const options: KVNamespacePutOptions = {
     metadata
   };
   
   // Store an empty string as the value, with metadata containing the version
   await env.VIDEO_CACHE_KEY_VERSIONS.put(versionKey, '', options);
   ```

3. **Error Resilience**: Fail gracefully if version operations fail
   ```typescript
   try {
     // Attempt version operations
   } catch (err) {
     // Log error but continue - version operations are not critical
     logDebug('Error incrementing version on cache miss', {
       key,
       error: err instanceof Error ? err.message : String(err)
     });
   }
   ```

## Benefits

1. **Automatic Cache Busting**: Version parameters force clients to fetch fresh content
2. **Version Persistence**: Versions survive even when content is removed
3. **Transparent Integration**: Works with existing caching and transformation pipeline
4. **Performance Efficiency**: Optimized for minimal impact on response time
5. **Enhanced Diagnostics**: Version information in headers and debug UI

## Configuration

No additional configuration is required. The system is automatically enabled when the `VIDEO_CACHE_KEY_VERSIONS` KV namespace is bound to the worker.

```jsonc
// wrangler.jsonc
{
  "kv_namespaces": [
    {
      "binding": "VIDEO_CACHE_KEY_VERSIONS",
      "id": "949610c936b8480bad5b61f3aa934de1"
    }
  ]
}
```

## Debugging

The system adds version information to response headers:

```http
X-Cache-Version: 2
```

And to diagnostic information in the debug UI:

```json
{
  "cacheVersion": 2,
  "cacheability": true,
  "cacheTtl": 300
}
```

## Example Use Cases

1. **Content Updates**: When a video is updated at the origin, versions increment automatically on cache miss
2. **Error Recovery**: If a cached item causes errors, version incrementation forces fresh content
3. **Configuration Changes**: Changes to transformation parameters trigger new versions
4. **Format Migrations**: When moving to new formats, versions ensure clients see the latest format

## Integration with Existing Systems

The versioning system integrates with:

1. **KV Storage Service**: Stores and retrieves version information alongside content
2. **Transformation Service**: Detects cache misses and increments versions
3. **Debug UI**: Displays version information for diagnostics
4. **URL Transformation Pipeline**: Adds version parameters to URLs

## Implementation Notes

1. **Version Increment on Cache Miss**:
   ```typescript
   if (!exists) {
     shouldIncrement = true;
     const nextVersion = await getNextCacheKeyVersion(env, cacheKey, shouldIncrement);
     // Store and use the new version
   }
   ```

2. **Version in Content Metadata**:
   ```typescript
   const metadata: TransformationMetadata = {
     // ... other metadata ...
     cacheVersion: cacheVersion, // Add version to metadata
     // ... other metadata ...
   };
   ```

3. **Version Headers in Response**:
   ```typescript
   if (cacheVersion) {
     headers.set('X-Cache-Version', cacheVersion.toString());
   }
   ```

4. **Version in Diagnostics**:
   ```typescript
   if (requestContext.diagnostics) {
     requestContext.diagnostics.cacheVersion = cacheVersion;
   }
   ```
# KV-Only Caching Implementation: Completed

**Goal**: Refactor the `video-resizer` codebase to exclusively use Cloudflare KV for caching transformed video variants, removing the Cloudflare Cache API and `cf` object caching methods. This implementation maintains the critical manual range slicing logic for video responses.

## Completed Implementation

### Step 1: Configuration Cleanup ✅
- Removed `method: z.enum(['cf', 'cacheApi']).default('cacheApi')` from CacheConfigSchema and updated to only accept 'kv'
- Updated getCacheMethod() to always return 'kv'
- Removed `method: 'cf'` from defaultCacheConfig
- Removed `method` from EnvironmentConfig cache interface
- Removed CACHE_METHOD from EnvVariables interface
- Removed CACHE_METHOD parsing in getEnvironmentConfig
- Removed "method": "cacheApi" from worker-config.json

### Step 2: Remove Cloudflare Object (`cf`) Caching Logic ✅
- Deleted `src/utils/cacheCfUtils.ts` file
- Removed `cf` property from fetch options in TransformVideoCommand.ts
- Removed createCfObjectParams import and usage in TransformVideoCommand.ts
- Updated debug mode log messages to reference 'kv' as the only caching method

### Step 3: Remove Cache API Caching Logic ✅
- Simplified `getCachedResponseImpl` in `src/utils/cacheRetrievalUtils.ts` to always return null, effectively bypassing Cache API
- Removed `storeInCacheWithRangeSupport` function and updated imports in `src/utils/cacheStorageUtils.ts`
- Simplified `cacheResponseImpl` function in `src/utils/cacheResponseUtils.ts` to focus only on preparing responses and handling range requests
- Updated `cacheManagementService.ts` to remove createCfObjectParams import/export and references to Cache API
- Completely refactored `cacheOrchestrator.ts` to only use KV caching, removing all Cache API logic
- Preserved all range request handling logic for both KV and direct responses

### Step 4: Refactor videoHandler.ts ✅
- Updated videoHandler.ts to replace all instances of skipCfCache with skipCache
- Simplified cache checking logic to only check KV cache
- Maintained robust error handling and range request support

### Step 5: Fix Range Request Handling for CDN-CGI Responses ✅
- Identified issue where CDN-CGI responses weren't using the manual range slicing logic
- Modified TransformVideoCommand.ts to use cacheResponse function for all video fetches
- Wrapped both normal and retry fetch calls to CDN-CGI endpoint with cacheResponse
- This ensures all video responses (from KV and CDN-CGI) correctly handle range requests

## Technical Details

### Range Request Handling
- Range requests are now properly handled in two places:
  1. In kvStorageService.ts for videos served from KV cache
  2. In cacheResponseUtils.ts for videos fetched directly from CDN-CGI endpoint
- Both implementations use the same core logic:
  1. Parse Range header using parseRangeHeader function
  2. Extract requested byte range from full response
  3. Return 206 Partial Content with proper Content-Range headers
  4. Return 416 Range Not Satisfiable for invalid ranges

### Type Safety
- Fixed all TypeScript errors to ensure type safety throughout the codebase
- Updated CacheConfigurationManager.ts to only accept 'kv' as a valid caching method
- Removed references to non-existent methods or properties in environmentConfig.ts
- Ensured proper imports/exports of range handling functions

### Performance Improvements
- Simplified caching logic reduces code execution time
- Removed parallel cache checks (previously checked both Cache API and KV)
- Maintained waitUntil for non-blocking KV storage operations
- Preserved cache optimization for IMQuery requests

This implementation successfully consolidates caching to use only Cloudflare KV while maintaining all the performance, reliability, and functionality of the system, particularly the critical range request handling for video streaming.

# Cache Versioning System Implementation Plan

## Overview

Implement a cache versioning system to enable cache busting at the media proxy level. This feature will use a dedicated KV namespace (VIDEO_CACHE_KEY_VERSIONS) to track the version of each cache key, incrementing the version when needed to ensure fresh content is fetched.

## KV Namespace Details
- Name: VIDEO_CACHE_KEY_VERSIONS
- ID: 949610c936b8480bad5b61f3aa934de1
- Purpose: Store version information in metadata for each cache key

## Implementation Approach
Using KV metadata for version tracking provides several benefits:
- More efficient retrieval (metadata access is faster than value)
- Clearer separation of concerns (version as metadata, not value)
- Ability to store additional version-related information like timestamps
- Follows best practices for Cloudflare KV usage

## Implementation Flow

### Initial Request (No Cached Content)
1. Request comes in for video resource
2. Check VIDEO_TRANSFORMATIONS_CACHE KV: No cached content found (MISS)
3. Check VIDEO_CACHE_KEY_VERSIONS KV: No version found for this cache key
4. Fetch from media proxy without version param (e.g., `/cdn-cgi/media/...`)
5. Store response in VIDEO_TRANSFORMATIONS_CACHE KV
6. Store version information as metadata in VIDEO_CACHE_KEY_VERSIONS KV (version: 1)

### Subsequent Request (After Cache Expiration)
1. Request comes in for same video resource
2. Check VIDEO_TRANSFORMATIONS_CACHE KV: No cached content found (MISS due to expiration)
3. Check VIDEO_CACHE_KEY_VERSIONS KV: Version metadata found for this cache key (version: 1)
4. Increment to next version (version: 2)
5. Fetch from media proxy with `v=2` param (e.g., `/cdn-cgi/media/...?v=2`)
6. Store response in VIDEO_TRANSFORMATIONS_CACHE KV
7. Update version metadata in VIDEO_CACHE_KEY_VERSIONS KV (version: 2, updatedAt: timestamp)

## Technical Implementation Plan

### Step 1: Update TransformationMetadata Interface
Extend the existing `TransformationMetadata` interface in `src/services/kvStorageService.ts` to include version information:

```typescript
interface TransformationMetadata {
  // ... existing fields ...
  sourcePath: string;
  mode?: string | null;
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
  // New fields for versioning
  version?: number;
  // ... other existing fields ...
  duration?: number | string | null;
  fps?: number | null;
  time?: string | null;
  columns?: number | null;
  rows?: number | null;
  interval?: string | null;
  customData?: Record<string, unknown>;
}
```

### Step 2: Implement Version Helper Functions
Create helper functions to handle version management in `src/utils/kvCacheUtils.ts`:

```typescript
/**
 * Extracts version from KV metadata or returns null if not found
 * @param metadata The KV metadata object
 * @returns The version number or null
 */
export function getVersionFromMetadata(metadata?: TransformationMetadata | null): number | null {
  if (!metadata || typeof metadata.version !== 'number') {
    return null;
  }
  return metadata.version;
}

/**
 * Normalizes a URL by removing version parameter
 * @param url The URL to normalize
 * @returns Normalized URL string
 */
export function normalizeUrlForCaching(url: string): string {
  try {
    const parsedUrl = new URL(url);
    // Remove version parameter to ensure consistent cache keys
    parsedUrl.searchParams.delete('v');
    return parsedUrl.toString();
  } catch (err) {
    // If parsing fails, just return the original
    return url;
  }
}

/**
 * Gets the next version number based on current metadata
 * @param currentMetadata The current transformation metadata
 * @returns The next version number (1 if no previous version)
 */
export function getNextVersionNumber(currentMetadata?: TransformationMetadata | null): number {
  const currentVersion = getVersionFromMetadata(currentMetadata);
  return currentVersion ? currentVersion + 1 : 1;
}

/**
 * Adds version parameter to a URL
 * @param url The URL to modify
 * @param version The version number to add
 * @returns URL with version parameter
 */
export function addVersionToUrl(url: string, version: number): string {
  try {
    const parsedUrl = new URL(url);
    parsedUrl.searchParams.set('v', version.toString());
    return parsedUrl.toString();
  } catch (err) {
    // If parsing fails, append version parameter directly
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}v=${version}`;
  }
}
```

### Step 3: Modify TransformationService
Update `src/services/TransformationService.ts` to incorporate versioning in URL construction:

```typescript
// In prepareVideoTransformation function, after building the CDN-CGI URL:

// After building the cdnCgiUrl
// Check if we should attempt to get previous metadata to determine version
const skipCache = url.searchParams.has('debug') || !cacheConfig?.cacheability;

// Only proceed with versioning if env is available and we're not skipping cache
if (env && !skipCache) {
  try {
    // Generate a consistent cache key for this transformation
    const cacheKey = generateKVKey(path, options);
    
    // Try to get metadata from previous version if available
    const { metadata } = await getTransformedVideoMetadata(env, cacheKey);
    
    // Get next version number
    const nextVersion = getNextVersionNumber(metadata);
    
    // Only add version param for version > 1 to avoid unnecessary params
    if (nextVersion > 1) {
      // Create a modified URL with version parameter
      const versionedCdnCgiUrl = addVersionToUrl(cdnCgiUrl, nextVersion);
      
      // Log the version addition
      logDebug('Added version parameter for cache busting', {
        originalUrl: cdnCgiUrl,
        versionedUrl: versionedCdnCgiUrl,
        cacheKey,
        previousVersion: metadata?.version || 'none',
        nextVersion
      });
      
      // Add a breadcrumb for tracking
      if (requestContext) {
        addBreadcrumb(requestContext, 'Cache', 'Added version for cache busting', {
          cacheKey, 
          nextVersion,
          previousVersion: metadata?.version || 'none',
          path,
          originalUrl: url.toString()
        });
      }
      
      // Add version info to diagnostics
      diagnosticsInfo.cacheVersion = nextVersion;
      
      // Use the versioned URL
      return {
        cdnCgiUrl: versionedCdnCgiUrl,
        cacheConfig,
        source,
        derivative: options.derivative || '',
        diagnosticsInfo
      };
    }
  } catch (err) {
    // Log error but continue with unversioned URL
    logDebug('Error adding version parameter', {
      error: err instanceof Error ? err.message : String(err),
      path
    });
  }
}

// Continue with original URL if no versioning applied
return {
  cdnCgiUrl,
  cacheConfig,
  source,
  derivative: options.derivative || '',
  diagnosticsInfo
};
```

### Step 4: Update KV Storage Service
Modify `src/services/kvStorageService.ts` to include version in metadata:

```typescript
// In storeTransformedVideo function:

// Add version to metadata
metadata = {
  ...metadata,
  version: videoOptions.version || 1, // Include version from options or default to 1
  createdAt: Date.now(),
  // ... other existing metadata fields
};

// Store video data with metadata
await namespace.put(key, videoData, { metadata, expirationTtl: ttl });
```

### Step 5: Add Version Support to getFromKVCache
Update `src/utils/kvCacheUtils.ts` to handle normalized URLs and integrate versioning:

```typescript
export async function getFromKVCache(
  env: EnvVariables,
  sourcePath: string,
  options: TransformOptions,
  request?: Request
): Promise<Response | null> {
  // ... existing code ...

  // Normalize the source path for caching (remove v parameter)
  const normalizedPath = normalizeUrlForCaching(sourcePath);
  
  try {
    // ... existing KV cache lookup logic ...
    
    // If we have a result, include version in diagnostics if available
    if (result?.metadata?.version) {
      // Add the version to diagnostics info if available
      options.diagnosticsInfo = options.diagnosticsInfo || {};
      options.diagnosticsInfo.cacheVersion = result.metadata.version;
    }
    
    return result?.response || null;
  } catch (err) {
    // ... error handling ...
  }
}
```

### Step 6: Update storeInKVCache to Work with Versioning
Modify `storeInKVCache` in `src/utils/kvCacheUtils.ts`:

```typescript
export async function storeInKVCache(
  env: EnvVariables,
  sourcePath: string,
  response: Response,
  options: TransformOptions
): Promise<boolean> {
  // ... existing code ...

  // Normalize the source path for caching (remove v parameter)
  const normalizedPath = normalizeUrlForCaching(sourcePath);
  
  // Include version in options for storage
  if (options.diagnosticsInfo?.cacheVersion) {
    options.version = options.diagnosticsInfo.cacheVersion;
  }
  
  // ... rest of function using normalizedPath ...
}
```

### Step 7: Update Debug Headers
Update `src/utils/debugHeadersUtils.ts` to include version information in debug headers:

```typescript
// Add version info to diagnostics structure:
export interface DiagnosticsInfo {
  // ...existing properties...
  cacheVersion?: number; // Cache version used for this request
}

// In addDebugHeaders function, include version info in debug response headers:
if (diagnosticsInfo?.cacheVersion) {
  headers.set('X-Cache-Version', diagnosticsInfo.cacheVersion.toString());
}
```

## Testing Plan

1. Test Initial Request Flow:
   - Make a request for a video resource
   - Verify KV cache miss
   - Verify response is cached in KV with version=1 in metadata

2. Test Cache Expiration Flow:
   - Request a cached video
   - Manually clear the KV cache (using wrangler kv:key delete)
   - Make the same request again
   - Verify v=2 parameter is added to the CDN-CGI URL
   - Verify version=2 is stored in metadata
   - Verify diagnostics/debug headers show correct version

3. Test Debug Mode Bypass:
   - Make a request with debug=true parameter
   - Verify caching is skipped
   - Verify version tracking still works but v parameter isn't added

4. Test Range Requests:
   - Request a video with Range header and version parameter
   - Verify range request is handled correctly
   - Verify response contains proper Content-Range header

5. Test Error Handling:
   - Test with invalid URLs
   - Verify graceful fallback to unversioned URLs

## Performance Considerations

1. **Efficiency**:
   - Only add version parameters when necessary (v > 1)
   - Only apply versioning when caching is enabled
   - Use existing KV metadata storage rather than separate KV namespace
   - Use waitUntil for non-blocking operations where possible
   
2. **Metadata Size**:
   - The version field adds minimal overhead to existing metadata
   - No additional KV operations required for version tracking
   
3. **Concurrency**:
   - The design handles concurrent requests gracefully
   - Version increments are determined at request time

## Security Considerations

1. **URL Validation**:
   - Ensure URL parsing is error-handled for malformed URLs
   - Validate version parameters to prevent injection

2. **Header Protection**:
   - Only include version information in debug headers when debug mode is enabled

This implementation creates a robust cache versioning system that enables targeted cache busting at the media proxy level, while leveraging the existing KV metadata system for tracking versions. This approach is more efficient than a separate KV namespace as it requires fewer KV operations and integrates seamlessly with the existing caching infrastructure.
```

### Step 4: Integrate with kvCacheUtils.ts
Update `src/utils/kvCacheUtils.ts` to check version and normalize URLs:

```typescript
// Import the version service
import { getCacheKeyVersion, getNextCacheKeyVersion, storeCacheKeyVersion } from '../services/cacheVersionService';

// Add normalizeUrlForCaching helper function
function normalizeUrlForCaching(url: string): string {
  // Create a new URL object to manipulate
  try {
    const parsedUrl = new URL(url);
    // Remove version parameter to ensure consistent cache keys
    parsedUrl.searchParams.delete('v');
    return parsedUrl.toString();
  } catch (err) {
    // If parsing fails, just return the original
    return url;
  }
}

// In getFromKVCache, add check for version parameter:
export async function getFromKVCache(
  env: EnvVariables,
  sourcePath: string,
  options: TransformOptions,
  request?: Request
): Promise<Response | null> {
  // ...existing code...

  // Normalize the source path for caching (remove v parameter)
  const normalizedPath = normalizeUrlForCaching(sourcePath);
  
  try {
    // ...existing KV cache lookup logic...
    
    // On cache miss, check if we have a version for future use
    if (!result) {
      // Check for version, but don't wait on the result
      // This is just to prefetch for the transformation service
      getCacheKeyVersion(env, normalizedPath);
    }
    
    return result?.response || null;
  } catch (err) {
    // ...error handling...
  }
}

// In storeInKVCache, ensure we store with the normalized path:
export async function storeInKVCache(
  env: EnvVariables,
  sourcePath: string,
  response: Response,
  options: TransformOptions
): Promise<boolean> {
  // ...existing code...

  // Normalize the source path for caching (remove v parameter)
  const normalizedPath = normalizeUrlForCaching(sourcePath);
  
  // ...rest of function...
}
```

### Step 5: Modify TransformationService

Update `src/services/TransformationService.ts` to incorporate versioning in URL construction:

```typescript
// Import the cache version service
import { getNextCacheKeyVersion, storeCacheKeyVersion } from '../services/cacheVersionService';
import { generateKVKey } from '../services/kvStorageService';

// In prepareVideoTransformation function, after building the CDN-CGI URL:

// After line 266: const cdnCgiUrl = buildCdnCgiMediaUrl(cdnParams, videoUrl, url.toString());
// Add version handling:

// Check if this is a cache miss situation
const skipCache = url.searchParams.has('debug') || !cacheConfig?.cacheability;

// Only proceed with versioning if env is available and we're not skipping cache
if (env && !skipCache) {
  try {
    // Generate a consistent cache key for this transformation
    const cacheKey = generateKVKey(path, options);
    
    // Check if we need a new version
    const version = await getNextCacheKeyVersion(env, cacheKey);
    
    // Only add version param for version > 1 to avoid unnecessary params
    if (version > 1) {
      // Create a modified URL with version parameter
      const cdnCgiUrlObj = new URL(cdnCgiUrl);
      cdnCgiUrlObj.searchParams.set('v', version.toString());
      
      // Store the new version with a longer TTL than the video cache
      // This ensures version tracking outlasts the cache
      const versionTtl = (cacheConfig?.ttl?.ok || 300) * 2; // Double the video cache TTL
      
      // Store the version in background if possible
      const envWithCtx = env as any;
      if (envWithCtx.executionCtx?.waitUntil) {
        envWithCtx.executionCtx.waitUntil(
          storeCacheKeyVersion(env, cacheKey, version, versionTtl)
        );
      } else {
        // Fall back to direct storage
        await storeCacheKeyVersion(env, cacheKey, version, versionTtl);
      }
      
      // Update the URL with version
      const versionedCdnCgiUrl = cdnCgiUrlObj.toString();
      
      // Log the version addition
      logDebug('Added version parameter for cache busting', {
        originalUrl: cdnCgiUrl,
        versionedUrl: versionedCdnCgiUrl,
        cacheKey,
        version
      });
      
      // Add a breadcrumb for tracking
      if (requestContext) {
        addBreadcrumb(requestContext, 'Cache', 'Added version for cache busting', {
          cacheKey, 
          version,
          path,
          originalUrl: url.toString()
        });
      }
      
      // Add version info to diagnostics
      diagnosticsInfo.cacheVersion = version;
      
      // Use the versioned URL
      return {
        cdnCgiUrl: versionedCdnCgiUrl,
        cacheConfig,
        source,
        derivative: options.derivative || '',
        diagnosticsInfo
      };
    }
  } catch (err) {
    // Log error but continue with unversioned URL
    logDebug('Error adding version parameter', {
      error: err instanceof Error ? err.message : String(err),
      path
    });
  }
}

// Continue with original URL if no versioning applied
return {
  cdnCgiUrl,
  cacheConfig,
  source,
  derivative: options.derivative || '',
  diagnosticsInfo
};
```

### Step 6: Add Version Support to Range Request Handling

Update `cacheResponseUtils.ts` to ensure range requests work with versioned URLs:

```typescript
// In handleRangeRequest, ensure we handle URLs with version parameters correctly
// This should already work as the function doesn't depend on URL parameters
// But add logging to verify version parameter presence:

// Inside handleRangeRequest function:
logDebug('Processing range request', {
  rangeHeader,
  totalSize,
  hasVersionParam: request.url.includes('v='),
  versionParam: new URL(request.url).searchParams.get('v') || 'none'
});
```

### Step 7: Update Debug Headers

Update `src/utils/debugHeadersUtils.ts` to include version information in debug headers:

```typescript
// Add version info to diagnostics structure:
export interface DiagnosticsInfo {
  // ...existing properties...
  cacheVersion?: number; // Cache version used for this request
}

// In addDebugHeaders function, include version info in debug response headers:
if (diagnosticsInfo?.cacheVersion) {
  headers.set('X-Cache-Version', diagnosticsInfo.cacheVersion.toString());
}
```

## Testing Plan

1. Test Initial Request Flow:
   - Make a request for a video resource
   - Verify KV cache miss
   - Verify response is cached in KV
   - Verify version=1 is stored in VIDEO_CACHE_KEY_VERSIONS

2. Test Cache Expiration Flow:
   - Request a cached video
   - Manually clear the KV cache (using wrangler kv:key delete)
   - Make the same request again
   - Verify v=2 parameter is added to the CDN-CGI URL
   - Verify version=2 is stored in VIDEO_CACHE_KEY_VERSIONS
   - Verify diagnostics/debug headers show correct version

3. Test Debug Mode Bypass:
   - Make a request with debug=true parameter
   - Verify caching is skipped
   - Verify version tracking still works but v parameter isn't added

4. Test Range Requests:
   - Request a video with Range header and version parameter
   - Verify range request is handled correctly
   - Verify response contains proper Content-Range header

5. Test Error Handling:
   - Test with missing KV binding
   - Test with invalid cache keys
   - Verify graceful fallback to unversioned URLs

## Performance Considerations

1. **Efficiency**:
   - Only add version parameters when necessary (v > 1)
   - Only apply versioning when caching is enabled
   - Use waitUntil for non-blocking version storage operations
   
2. **TTL Management**:
   - Set VERSION_CACHE_KEY_VERSIONS TTL longer than video cache TTL
   - Use double the normal cache TTL to ensure version tracking outlasts cache items
   
3. **Concurrency**:
   - Use atomic operations for version tracking to handle concurrent requests
   - Implement error handling to avoid blocking responses on version operations

## Security Considerations

1. **Sanitization**:
   - Properly sanitize cache keys using createVersionKey function
   - Ensure version numbers are validated as integers
   
2. **Header Protection**:
   - Don't expose sensitive cache key data in response headers
   - Only include version information in debug headers when debug mode is enabled

3. **URL Validation**:
   - Ensure URL parsing is error-handled for malformed URLs
   - Validate version parameters to prevent injection

This implementation creates a robust cache versioning system that enables targeted cache busting at the media proxy level, while maintaining compatibility with the existing KV-only caching infrastructure and range request handling.


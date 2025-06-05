# Cache Versioning and 206 Response Fixes

## Summary

This document describes the fixes implemented for two critical issues:
1. Cache key versioning not working as expected
2. HTTP 206 Partial Content response stream consumption errors

**Update**: Automatic version increment on cache miss has been disabled to prevent version inflation.

## Issues Fixed

### 1. Cache Key Versioning

**Problem**: The cache versioning system was incrementing versions in the VIDEO_CACHE_KEY_VERSIONS KV namespace, but the CDN requests were still using version 1.

**Root Cause**: The version was being incremented during cache miss in `getVideo.ts`, but this happened after the transformation options were already set with the old version.

**Solution**: 
- In `videoHandlerWithOrigins.ts`, after detecting a cache miss, we now check if the version was incremented and update the transformation options accordingly
- This ensures the CDN request uses the correct incremented version for cache busting

**Key Changes**:
```typescript
// After cache miss, check if version was incremented and update our options
if (env && !skipCache && env.VIDEO_CACHE_KEY_VERSIONS) {
  const updatedVersion = await getCacheKeyVersion(env, updatedCacheKey) || 1;
  
  // If version was incremented, update our options
  if (updatedVersion > (initialVideoOptions.version || 1)) {
    initialVideoOptions.version = updatedVersion;
    if (videoOptions) {
      videoOptions.version = updatedVersion;
    }
  }
}
```

### 2. HTTP 206 Partial Content Response Issues

**Problem**: Stream consumption errors when handling range requests due to complex Cache API logic that was trying to store and immediately retrieve responses.

**Root Cause**: The `handleRangeRequestForInitialAccess` function was attempting to:
1. Store the full response in Cache API
2. Immediately fetch it back for range processing
3. This caused race conditions and stream consumption errors

**Solution**: 
- Simplified `handleRangeRequestForInitialAccess` to just return the original response
- Range request handling is now done entirely when serving from KV storage
- Removed complex Cache API logic that was causing race conditions

**Key Changes**:
```typescript
export async function handleRangeRequestForInitialAccess(
  originalResponse: Response,
  request: Request
): Promise<Response> {
  // Simply return the original response
  // Range request handling is done when serving from KV storage
  return originalResponse;
}
```

### 3. TTL Removal

**Problem**: TTL expiration was interfering with the versioning system.

**Solution**: 
- Removed TTL from KV storage operations in `storageHelpers.ts`
- Items are now stored indefinitely
- Version increments handle cache invalidation instead of TTL expiration

### 4. Automatic Version Increment Removal

**Problem**: Versions were incrementing on every cache miss, causing version inflation (e.g., jumping to version 3 even after clearing both KV namespaces).

**Solution**: 
- Removed automatic version increment on cache miss in `getVideo.ts`
- Removed automatic version increment on KV retrieval errors
- Versions now only change when you explicitly manage them

**Result**: More predictable version behavior and no unnecessary version inflation

## Testing

All existing tests have been updated to reflect the new behavior:
- Cache version service tests verify version increment only on cache miss
- HTTP utilities tests confirm simplified range request handling
- Storage tests validate indefinite storage without TTL

## Impact

These fixes ensure:
1. Proper cache busting when KV entries are deleted - version increments trigger new CDN requests
2. Reliable range request handling without stream consumption errors
3. Indefinite storage in KV with version-based cache invalidation
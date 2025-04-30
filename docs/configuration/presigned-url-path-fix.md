# Presigned URL Path Context Fix

## Summary

This documentation outlines the implementation of a critical fix for the presigned URL mechanism to ensure that path patterns with specific origin URLs are handled correctly. The fix ensures that paths are extracted and presigned correctly relative to their specific origin URL as defined in the matching path pattern.

## Problem

The presigned URL generation system was ignoring the specific `originUrl` defined in path patterns when extracting paths for presigned URL generation, leading to:

- Incorrect paths being used for presigned URL generation
- Mismatch between cache keys and actual paths
- Reliance on fallback mechanisms when the primary path should work correctly
- Transformation errors when using prefixed paths (e.g., `/videos/` prefix)

## Solution

The solution implemented passes the matched path pattern context through the entire presigned URL generation flow, ensuring that path extraction and presigning use the correct origin URL from the pattern.

### Key Changes

1. **Added `PresigningPatternContext` Interface**:
   - Created a new interface to pass pattern-specific context
   - Includes `originUrl`, `auth`, and `name` fields from the matched pattern

2. **Enhanced Presigned URL Utilities**:
   - Modified `getOrGeneratePresignedUrlImpl` to accept a `PresigningPatternContext` parameter
   - Updated path extraction logic to prioritize using the pattern's origin URL
   - Improved `needsPresigning` and `getAuthConfig` to use pattern context when available

3. **Updated Path Utilities**:
   - Modified `buildCdnCgiMediaUrlAsync` and `buildCdnCgiMediaUrlImpl` to accept and pass the matched pattern
   - Added pattern context preparation and passing through the transformation pipeline

4. **Updated Transformation Service**:
   - Modified `prepareVideoTransformation` to pass the matched pattern to URL building functions

### New Processing Flow

1. Pattern matching occurs in `TransformationService`
2. The matched pattern is passed to `buildCdnCgiMediaUrlAsync` 
3. Inside path utils, the pattern is converted to a `PresigningPatternContext`
4. This context is passed to `getOrGeneratePresignedUrl`
5. The presigning function uses the pattern's `originUrl` for path extraction
6. Generated presigned URL is correctly constructed with paths relative to the specific origin

## Code Detail

### Pattern Context Interface
```typescript
export interface PresigningPatternContext {
  originUrl: string | null; // The specific origin URL for this pattern
  auth: AwsAuthConfig | null; // Auth config from the pattern
  name: string; // Pattern name for logging/context
}
```

### Path Extraction Logic
```typescript
// Determine the correct base URL for path extraction
let baseUrlForPathExtraction: string | null = null;
let authConfigForPresigning: AwsAuthConfig | null = null;
let storageTypeForCache: 'remote' | 'fallback' | string = 'remote';

if (patternContext && patternContext.originUrl) {
  baseUrlForPathExtraction = patternContext.originUrl;
  authConfigForPresigning = patternContext.auth;
  storageTypeForCache = patternContext.name;
  logDebug('Using pattern context for presigning', {
    patternName: patternContext.name,
    baseUrl: baseUrlForPathExtraction,
    hasAuth: !!authConfigForPresigning
  });
} else {
  // Fall back to storage config
  // ...
}
```

### Pattern Context Passing
```typescript
// Inside path utils
const patternContextForPresigning: presignedUrlUtils.PresigningPatternContext | null = matchedPattern ? {
  originUrl: matchedPattern.originUrl,
  auth: matchedPattern.auth || null,
  name: matchedPattern.name
} : null;

// Generate the presigned URL with pattern context
const presignedUrl = await presignedUrlUtils.getOrGeneratePresignedUrl(
  env,
  originUrl,
  videoConfig,
  patternContextForPresigning // Pass the specific pattern context
);
```

## Testing

Testing of this implementation was performed using:

1. **Unit Tests**: Verifying that pattern context is correctly used for presigning decisions
2. **Path Extraction Tests**: Ensuring paths are correctly extracted relative to origin URLs
3. **Auth Configuration Tests**: Confirming that pattern-specific auth is used correctly

## Benefits

1. **Accuracy**: Presigned URLs are now generated with correct paths relative to their origin
2. **Cache Efficiency**: Cache keys are consistent with the actual paths
3. **Reliability**: Reduced reliance on fallback mechanisms
4. **Maintainability**: Explicit passing of context makes the code more maintainable
5. **Performance**: Fewer transformation errors and retries

## Verification Checklist

- [x] Updated `presignedUrlUtils.ts` to accept pattern context
- [x] Enhanced path extraction logic to use correct base URL
- [x] Modified `pathUtils.ts` to pass pattern context through
- [x] Updated `TransformationService.ts` to pass pattern through transformation pipeline
- [x] Added unit tests to verify the changes
- [x] Documented the implementation
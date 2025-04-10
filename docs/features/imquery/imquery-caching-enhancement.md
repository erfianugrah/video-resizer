# IMQuery Parameter Caching Enhancement

## Overview

This documentation describes the enhancements to the video-resizer's caching system to better handle IMQuery parameters. IMQuery is Akamai's responsive image URL format that we support for backwards compatibility.

## Problem History

### First Enhancement (Version 1.0)

Initially, when a request with IMQuery parameters (like `imwidth=800`) came in, the system would match it to the appropriate derivative (e.g., "mobile" for 854x640 resolution), but would only use the derivative name in the cache key. This led to a few issues:

1. The cache key reflected only the derivative ("mobile") rather than the actual requested dimension (`imwidth=800`)
2. Different IMQuery values that mapped to the same derivative would share the same cache key
3. The cache metadata didn't reflect the IMQuery origins of the transformation

### Initial Solution

Our first enhancement improved the handling of IMQuery parameters in the caching system:

1. Modified `generateKVKey` in `kvStorageService.ts` to include IMQuery parameters in the cache key
2. Updated the video handlers to capture IMQuery parameters and add them to the `customData` field
3. Updated the cache orchestrator to use IMQuery parameters in both lookups and storage operations

For example:
- Old: `video:erfi.mp4:derivative=mobile`
- New: `video:erfi.mp4:imwidth=800:via=mobile`

## Current Enhancement (Version 2.0)

### Current Problem

After implementing the first enhancement, we discovered additional issues:

1. **Inconsistent URL Parameters**: Even though we mapped to derivatives correctly, the CDN-CGI transformation URL still used the original requested dimensions (`width=800`) rather than the derivative's actual dimensions (`width=854`)
2. **Metadata Inconsistency**: The KV cache metadata stored the requested dimensions rather than the derivative's actual dimensions
3. **Cache Tag Confusion**: Cache tags included the requested dimensions, making cache analysis challenging
4. **Code Duplication**: The derivative dimension lookup logic was duplicated across multiple components
5. **KV Size Limits**: A pre-emptive size check was sometimes incorrectly rejecting content within the actual KV size limits

### New Solution

We've now implemented additional improvements:

1. **Use Derivative Dimensions in Transformation URL**: 
   - When a derivative is matched (e.g., `imwidth=855` → `tablet`), we now use the derivative's actual dimensions (`width=1280,height=720`) in the CDN-CGI media URL
   - This ensures that the transformed media is consistent regardless of how it was requested

2. **Consistent Metadata Storage**:
   - KV metadata now stores the derivative's actual dimensions as the primary width/height 
   - Original requested dimensions are preserved in the `customData` field for reference

3. **Enhanced Cache Tags**:
   - Primary cache tags now use the derivative's dimensions (`video-width-1280`)
   - Additional tags include the original requested dimensions with a different prefix (`video-requested-width-855`)

4. **Centralized Dimension Lookup**:
   - Created a new utility function `getDerivativeDimensions` in `imqueryUtils.ts` 
   - This function centralizes the derivative dimension lookup to avoid code duplication
   - All components now use this utility instead of implementing their own lookups
   - Improves maintainability and ensures consistent behavior across components

5. **Improved KV Size Handling**:
   - Removed pre-emptive KV size limit check to let KV naturally enforce its own limits
   - Added enhanced logging for debugging size-related issues
   - This prevents incorrect rejections due to inaccurate content size calculations

6. **Improved Diagnostics**:
   - Debug info now clearly shows both requested dimensions and the actual dimensions used
   - Mapping logic and decisions are recorded in diagnostics for troubleshooting

## Benefits

This enhancement provides several additional benefits:

1. **Consistent Transformation**: URLs with IMQuery parameters use the same exact transformation parameters as direct derivative requests
2. **Optimized Caching**: Similar content is consistently cached with the same dimensions
3. **Better Debug Experience**: Clear distinction between requested and actual dimensions
4. **Simplified Cache Analysis**: Cache tags reflect the actual content dimensions
5. **Improved KV Storage**: More videos can be cached as the artificial size limit check was removed

## Implementation Details

The enhancement involved updating:

1. `TransformationService.ts` - Using derivative dimensions in CDN-CGI URL parameters
2. `kvStorageService.ts` - Storing both derivative and requested dimensions in metadata
3. `videoStorageService.ts` - Updating cache tag generation to reflect both dimensions
4. `videoOptionsService.ts` - Preserving original dimensions while using derivative dimensions
5. `imqueryUtils.ts` - Adding a centralized utility function `getDerivativeDimensions` for accessing derivative dimensions consistently
6. `kvCacheUtils.ts` - Removing pre-emptive size limit check to let KV naturally enforce its own limits

The `getDerivativeDimensions` utility function centralizes the logic for accessing derivative dimensions, which improves code organization by:

```typescript
/**
 * Get the actual dimensions for a derivative
 * Centralizes accessing derivative dimensions to avoid duplication across components
 * 
 * @param derivative - The name of the derivative (mobile, tablet, desktop)
 * @returns The actual dimensions {width, height} or null if derivative not found
 */
export function getDerivativeDimensions(derivative: string | null): { width: number; height: number } | null {
  if (!derivative) return null;
  
  const configManager = VideoConfigurationManager.getInstance();
  const derivatives = configManager.getConfig().derivatives;
  
  if (derivatives && derivatives[derivative]) {
    const derivativeConfig = derivatives[derivative];
    if (derivativeConfig.width && derivativeConfig.height) {
      // Optional debug logging with proper context handling
      const requestContext = getCurrentContext();
      if (requestContext) {
        const logger = createLogger(requestContext);
        logger.debug('Retrieved derivative dimensions', {
          derivative,
          width: derivativeConfig.width,
          height: derivativeConfig.height
        });
      }
      
      return {
        width: derivativeConfig.width,
        height: derivativeConfig.height
      };
    }
  }
  
  // Log not found case
  const requestContext = getCurrentContext();
  if (requestContext) {
    const logger = createLogger(requestContext);
    logger.debug('Derivative dimensions not found', {
      derivative,
      availableDerivatives: derivatives ? Object.keys(derivatives) : []
    });
  }
  
  return null;
}
```

This function is now used in multiple components that need to access derivative dimensions, eliminating duplicated code and ensuring consistent behavior across the codebase.

Additionally, we removed the pre-emptive KV size limit check in `kvCacheUtils.ts`:

```typescript
// REMOVED: This pre-emptive size check that might incorrectly reject content
const exceedsKVLimit = contentLength > KV_SIZE_LIMIT;
if (exceedsKVLimit) {
  logDebug(`Skipping KV storage for content exceeding size limit`);
  return false;
}
```

Instead, we now let KV naturally enforce its own size limits, which:
1. Prevents incorrect rejections due to inaccurate content size calculations
2. Simplifies the codebase by removing unnecessary logic
3. Relies on the KV service's own rules for size constraints
4. Improves caching for videos that were incorrectly being rejected

## Example

A request for `/video.mp4?imwidth=855` that is mapped to the "tablet" derivative now:

1. Uses `width=1280,height=720` in the CDN-CGI URL (the tablet derivative's actual dimensions)
2. Is cached with metadata showing `width: 1280, height: 720` and `customData: { requestedWidth: 855 }`
3. Has cache tags that include `video-width-1280` and `video-requested-width-855`
4. Returns the same exact content as a direct request for the tablet derivative

This enhancement ensures consistent video transformations while maintaining responsive web support.

## Testing

The enhancements can be verified by:

1. Making a request with IMQuery parameters (e.g., `GET /video.mp4?imwidth=855`)
2. Examining the transformation URL to verify it uses the derivative dimensions (1280x720)
3. Checking the cache metadata to confirm it stores:
   - The derivative's dimensions as the primary width/height
   - The requested dimensions in the customData field
4. Verifying that cache tags include both derivative and requested dimensions
5. Testing boundary cases (e.g., `imwidth=854` → mobile, `imwidth=855` → tablet)
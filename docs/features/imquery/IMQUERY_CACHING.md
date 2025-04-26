# IMQuery Caching Behavior

## Overview

This document explains how the video-resizer application handles caching for requests with IMQuery parameters (`imwidth`, `imheight`, etc.). Understanding this behavior is essential for optimizing cache usage and ensuring consistent video delivery.

## IMQuery and Derivative Mapping

### How IMQuery Parameters Work

IMQuery is a responsive image/video solution that allows clients to request dimensions that match their viewport:

- `imwidth`: Requested width for the video
- `imheight`: Requested height for the video
- `im-viewwidth`, `im-viewheight`: Viewport dimensions
- `im-density`: Pixel density (like DPR)
- `imref`: Reference parameters in key-value format

When a request includes IMQuery parameters, the system maps these dimensions to a predefined "derivative" - a set of transformation parameters that matches the requested dimensions as closely as possible.

### Derivative Mapping Methods

The system uses two methods to map IMQuery parameters to derivatives, with built-in consistency features to ensure similar dimensions always map to the same derivative:

1. **Breakpoint-Based Mapping** (Preferred): When only `imwidth` is provided, the system uses responsive breakpoints to determine the appropriate derivative. This is configured through the `responsiveBreakpoints` setting.
   - For widths that fall outside exact breakpoint ranges, the system finds the closest breakpoint rather than defaulting to the highest one
   - Includes smart distance-based calculations to ensure consistent mapping for edge cases

2. **Percentage-Based Mapping** (Fallback): When both width and height are provided or breakpoint mapping fails, the system calculates the closest derivative based on the percentage difference between requested dimensions and available derivatives.
   - Takes aspect ratio into account when calculating match quality
   - Uses expanded thresholds for edge cases to improve cache hit rates
   - Normalizes similar dimensions to ensure consistent derivative mapping

3. **In-Memory Caching**: The system also uses in-memory caching to ensure consistent derivative mapping for similar dimensions:
   - Dimensions are normalized to the nearest 10 pixels
   - Previous mapping results are cached to ensure consistent behavior
   - This provides consistent cache keys even when client dimensions vary slightly

## Caching Implementation

### Special Caching Behavior for IMQuery

IMQuery requests with derivatives are given special treatment for caching:

1. **Forced Cacheability**: Even if the path or content would normally not be cacheable, IMQuery requests that map to a derivative are forced to be cacheable:

```typescript
// From TransformationService.ts
if (isIMQuery && hasDerivative) {
  // Ensure cacheability is set to true for IMQuery derivatives
  if (!cacheConfig.cacheability) {
    logDebug('Forcing cacheability for IMQuery derivative', {
      derivative: options.derivative,
      originalCacheability: cacheConfig.cacheability
    });
    cacheConfig.cacheability = true;
  }
}
```

2. **Derivative-Based Cache Keys**: Instead of using the specific IMQuery dimensions for cache keys, the system uses only the essential transformation parameters in the cache key, focusing on the derivative name:

```typescript
// From videoHandler.ts - Enhanced implementation
if (hasIMQueryParams) {
  if (videoOptions.derivative) {
    debug(context, logger, 'VideoHandler', 'Using derivative-based caching for IMQuery request', {
      imwidth,
      imheight,
      hasIMRef,
      derivative: videoOptions.derivative,
      cacheType: 'derivative-based'
    });
    
    // For IMQuery requests, include only the derivative, width and height in cache key
    // This ensures consistent cache keys regardless of custom parameters
    let optimizedCacheOptions: TransformOptions = {
      derivative: videoOptions.derivative,
      width: videoOptions.width,
      height: videoOptions.height,
      // Keep mode in case this is a video/frame/spritesheet request
      mode: videoOptions.mode
    };
    
    // Use this optimized cache key for better cache consistency
    videoOptionsWithIMQuery = optimizedCacheOptions;
  }
}
```

3. **Dimension Normalization**: For improved cache consistency, similar dimensions are normalized before generating cache keys:

```typescript
// Create cache key for width/height combination to normalize similar requests
// Round to nearest 10px to improve cache hit rates for slightly different dimensions
const normalizedWidth = targetWidth ? Math.round(targetWidth / 10) * 10 : null;
const normalizedHeight = targetHeight ? Math.round(targetHeight / 10) * 10 : null;
```

4. **Aspect Ratio Consideration**: When both width and height are provided, the system factors in aspect ratio to ensure consistent visual results:

```typescript
// Calculate aspect ratio match to prefer dimensions with similar aspect ratio
const targetAspectRatio = targetWidth / targetHeight;
const derivativeAspectRatio = width / height;
const aspectRatioDiff = Math.abs(targetAspectRatio - derivativeAspectRatio) / targetAspectRatio;
```

5. **Using Derivative Dimensions in Transformation**: The most recent enhancement ensures the actual derivative dimensions (not the requested dimensions) are used in the transformation URL:

```typescript
// Get the actual dimensions for the derivative
const derivativeDimensions = getDerivativeDimensions(options.derivative);

if (derivativeDimensions) {
  // Use the derivative's actual dimensions in the transformation
  cdnParams.width = derivativeDimensions.width;
  cdnParams.height = derivativeDimensions.height;
}
```

### Benefits of This Approach

1. **Enhanced Cache Efficiency**: By mapping similar dimensions to the same derivative and normalizing cache keys, we achieve significantly better cache reuse. Many slightly different IMQuery parameters hit the same cached response.

2. **Reduced Origin Load**: Higher cache hit rates significantly reduce load on origin servers and minimize transformation processing.

3. **Consistent Quality**: Ensures users with similar viewport sizes get consistent video quality, even with slightly different dimensions.

4. **Better Edge Case Handling**: The improved mapping system handles edge cases more gracefully:
   - Dimensions that fall outside exact breakpoint ranges get mapped to the closest one
   - Similar aspect ratios are grouped together for consistent visual results
   - Expanded thresholds provide better fallbacks for non-standard dimensions
   
5. **Improved Memory Utilization**: By caching derivative mapping results in memory, the system:
   - Ensures consistent behavior across requests
   - Reduces computational overhead of repeated derivative calculations
   - Minimizes variation in cache keys for similar client dimensions

6. **Consistent Transformations**: By using the derivative's actual dimensions in transformation URLs, we ensure:
   - All videos with the same derivative look identical
   - Cache tags accurately reflect content dimensions
   - Debugging is clearer and more accurate

## Implementation Details

### Caching Strategy

1. **Mapping Step**:
   - Map IMQuery dimensions to a derivative using breakpoint or percentage methods
   - The derivative name becomes part of the cache key
   - Store the actual derivative dimensions in metadata

2. **Cacheability Check**:
   - For IMQuery requests with derivatives, cacheability is forced to true
   - This override is applied in `TransformationService.ts`

3. **Cache Storage**:
   - In `videoHandler.ts`, derivative-based caching is used instead of dimension-specific caching
   - The cached response is stored using the derivative name as part of the key
   - Metadata includes both derivative dimensions and requested dimensions

4. **Cache Retrieval**:
   - When a new request comes in with IMQuery parameters, it follows the same mapping process
   - If it maps to the same derivative as a previously cached response, it will get a cache hit

### Centralized Utility Functions

A key improvement is the centralization of derivative dimension lookup:

```typescript
/**
 * Get the actual dimensions for a derivative
 * 
 * @param derivative - The name of the derivative
 * @returns The dimensions {width, height} or null if not found
 */
export function getDerivativeDimensions(derivative: string | null): { width: number; height: number } | null {
  if (!derivative) return null;
  
  const configManager = VideoConfigurationManager.getInstance();
  const derivatives = configManager.getConfig().derivatives;
  
  if (derivatives && derivatives[derivative]) {
    const derivativeConfig = derivatives[derivative];
    if (derivativeConfig.width && derivativeConfig.height) {
      return {
        width: derivativeConfig.width,
        height: derivativeConfig.height
      };
    }
  }
  
  return null;
}
```

## Configuration Options

### Breakpoint Configuration

Configure responsive breakpoints in the worker configuration:

```json
{
  "video": {
    "responsiveBreakpoints": {
      "small": {
        "min": 0,
        "max": 854,
        "derivative": "mobile"
      },
      "medium": {
        "min": 855,
        "max": 1280,
        "derivative": "tablet"
      },
      "large": {
        "min": 1281,
        "derivative": "desktop"
      }
    }
  }
}
```

> **Note**: The updated breakpoint configuration now aligns with the actual derivative dimensions (854→mobile, 855-1280→tablet, 1281+→desktop) to ensure consistent behavior.

### Derivative Configuration

Define derivatives with their transformation parameters:

```json
{
  "video": {
    "derivatives": {
      "mobile": {
        "width": 854,
        "height": 640,
        "quality": "low",
        "compression": "high"
      },
      "tablet": {
        "width": 1280,
        "height": 720,
        "quality": "medium"
      },
      "desktop": {
        "width": 1920,
        "height": 1080,
        "quality": "high",
        "compression": "medium"
      }
    }
  }
}
```

## Example Scenarios

### Scenario 1: Multiple Mobile Devices

1. Device A requests `imwidth=380`
2. Device B requests `imwidth=412`
3. Device C requests `imwidth=428`

All three map to the `mobile` derivative (assuming breakpoints above).
Only one transformation is stored in cache, and all three devices get a cache hit.

### Scenario 2: Different Aspect Ratios

1. Device A requests `imwidth=1000&imheight=700`
2. Device B requests `imwidth=1000&imheight=680`

Both likely map to the same derivative based on percentage difference.
The first request populates the cache, and the second gets a cache hit.

### Scenario 3: Boundary Cases

1. Device A requests `imwidth=854`
2. Device B requests `imwidth=855`

Device A maps to `mobile` derivative (854x640)
Device B maps to `tablet` derivative (1280x720)

Both will use the exact dimensions of their respective derivatives in the transformation URL, ensuring consistent results.

## Troubleshooting

### Debug Information

When investigating IMQuery caching issues, enable debug mode to see:

- Requested dimensions vs. derivative dimensions
- Matching process details (breakpoint or percentage-based)
- Cache key generation
- Cache hit/miss information

### Common Issues

1. **Unexpected derivative mapping**: Check the breakpoint configuration to ensure it matches expected behavior
2. **Inconsistent cache keys**: Verify that the centralized dimension utility is being used everywhere
3. **Cache size issues**: If videos are unexpectedly not being cached, check debug logs for size-related information\n## Caching Enhancements\n
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
5. Testing boundary cases (e.g., `imwidth=854` → mobile, `imwidth=855` → tablet)\n## Caching Fixes\n
# IMQuery Caching Enhancements

## Issue 1: IMQuery Parameters Prevent Caching

When using IMQuery parameters like `imwidth=800`, URLs were not being cached in KV storage. This was happening despite successfully matching the IMQuery parameters to derivatives like `low` (854x480).

### Investigation & Root Cause

Upon investigation, the logs showed:

```
(debug) RequestContext: Adding breadcrumb {
  category: 'Response',
  message: 'Caching disabled',
  elapsedMs: '226.00',
  durationMs: '0.00'
}
```

The issue was in the derivative translation process and how cacheability is determined for transformed URLs:

1. When IMQuery parameters are present, they are matched to a derivative (e.g., `imwidth=800` matches to the `low` derivative).
2. The cache configuration determination in `determineCacheConfig` didn't properly handle derivative information.
3. The system incorrectly determined cacheability based on the URL with query parameters rather than recognizing it's using a derivative.

### Fix Implementation

The fix was implemented by adding special handling for IMQuery parameters in the `TransformationService`:

```typescript
// Special handling for IMQuery - ensure it's cacheable
const isIMQuery = url.searchParams.has('imwidth') || url.searchParams.has('imheight');
const hasDerivative = !!options.derivative;

if (isIMQuery && hasDerivative) {
  logDebug('IMQuery with derivative found - checking cache config', {
    url: url.toString(),
    derivative: options.derivative,
    cacheability: cacheConfig.cacheability,
    hasIMQuery: isIMQuery,
    imwidth: url.searchParams.get('imwidth'),
    imheight: url.searchParams.get('imheight')
  });
  
  // Ensure cacheability is set to true for IMQuery derivatives
  if (!cacheConfig.cacheability) {
    logDebug('Forcing cacheability for IMQuery derivative', {
      derivative: options.derivative,
      originalCacheability: cacheConfig.cacheability
    });
    cacheConfig.cacheability = true;
  }
}
```

This ensures that even when a URL contains IMQuery parameters (which are translated to derivatives), the caching system recognizes it as cacheable.

## Issue 2: Dimension Information in Cache Metadata

### Background

When a request with IMQuery parameters (like `imwidth=400`) is received:

1. The system maps the dimensions to a specific derivative (e.g., `mobile`)
2. The derivative's configuration defines the transformation (e.g., `mobile` is configured as 854x640)
3. The transformation occurs using a `fit` mode (usually "contain")
4. The result is cached in KV storage with metadata including dimensions and tags

### Observed Issue

When the system maps `imwidth=400` to the `mobile` derivative (854x640), the cache metadata showed:
- `derivative: "mobile"`
- `width: 400` (the requested value, not the derivative's configured value of 854)
- Cache tags included `video-prod-width-400`

This discrepancy between the requested width and the derivative's configured width can cause confusion when analyzing cache entries.

### Enhancement

We've enhanced the cache metadata to store both values:

1. The primary cache metadata still uses the requested dimensions for consistency
2. The `customData` field now includes `requestedWidth` and `requestedHeight` properties
3. Cache tags include both the derivative name and the requested dimensions

### Example Cache Entry (Before)

```json
{
  "name": "video:white-fang.mp4:derivative=mobile",
  "metadata": {
    "width": 400,              // Original requested width
    "height": 640,             // Original requested height (aspect ratio maintained)
    "derivative": "mobile",    // Mapped derivative
    "customData": {
      "requestedWidth": 400,   // Original requested width (duplicated for clarity)
      "requestedHeight": 640   // Original requested height (duplicated for clarity)
    },
    "cacheTags": [
      "video-prod-path-white-fang-mp4",
      "video-prod-derivative-mobile", 
      "video-prod-width-400",
      "video-prod-height-640",
      "video-prod-dimensions-400x640"
    ]
  }
}
```

### Example Cache Entry (After Enhancement)

```json
{
  "name": "video:white-fang.mp4:derivative=mobile",
  "metadata": {
    "width": 854,              // Derivative's actual width
    "height": 640,             // Derivative's actual height
    "derivative": "mobile",    // Mapped derivative
    "customData": {
      "requestedWidth": 400,   // Original requested width
      "requestedHeight": null, // Original requested height (null if not provided)
      "mappedFrom": "imquery"  // Indicates this was mapped from imquery parameters
    },
    "cacheTags": [
      "video-prod-path-white-fang-mp4",
      "video-prod-derivative-mobile", 
      "video-prod-width-854",            // Uses derivative's actual width
      "video-prod-height-640",           // Uses derivative's actual height
      "video-prod-dimensions-854x640",   // Uses derivative's actual dimensions
      "video-prod-requested-width-400",  // Original requested width is still stored
      "video-prod-source-imquery"        // Indicates source as imquery
    ]
  }
}
```

### Implications for Transformation and Caching

The actual video transformation and caching now follow these rules:

1. The `imwidth=400` request is mapped to the `mobile` derivative (based on breakpoint configuration)
2. The derivative's actual dimensions (854x640) are used for the URL transformation and metadata
3. Since derivatives use `fit: "contain"` mode:
   - The system uses the derivative's dimensions (854x640)
   - The aspect ratio is maintained within these dimensions
   - The result is visually equivalent regardless of whether the request used `imwidth=400` or `derivative=mobile`
4. Cache keys use `derivative=mobile` for better cache efficiency 
5. Metadata stores both:
   - The derivative's actual dimensions (width: 854, height: 640)
   - The original requested dimensions (in customData.requestedWidth/Height)
6. Cache tags incorporate the derivative's actual dimensions, improving cache coherence
7. The original requested dimensions are preserved in additional tags with `requested-` prefix

## Related Files Changed

1. `src/services/TransformationService.ts` - Added special handling for IMQuery parameters with derivatives
2. `src/handlers/videoOptionsService.ts` - Updated to store original requested dimensions and use derivative dimensions
3. `src/services/kvStorageService.ts` - Enhanced metadata storage to use derivative dimensions while preserving requested dimensions
4. `src/services/videoStorageService.ts` - Updated cache tag generation to use derivative dimensions for main tags while keeping requested dimensions in additional tags
5. `config/worker-config.json` - Updated breakpoint configuration to align with derivative dimensions (854 and below → mobile, 855-1280 → tablet, 1281+ → desktop)

## Testing

The enhancements can be verified by:

1. Making a request with IMQuery parameters (e.g., `GET /erfi.mp4?imwidth=400`)
2. Checking logs to ensure it maps to the correct derivative (mobile)
3. Verifying that the transformation parameters in the URL use the derivative's dimensions (854x640)
4. Making the same request again and verifying a KV cache hit occurs
5. Examining the cache metadata to verify it includes:
   - The derivative's dimensions in the main metadata (width: 854, height: 640)
   - The original requested dimensions in customData (requestedWidth: 400)
   - Cache tags with derivative dimensions (`video-prod-width-854`)
   - Cache tags with requested dimensions (`video-prod-requested-width-400`)
6. Testing with a value on the boundary (e.g., imwidth=854) and verifying it maps to mobile
7. Testing with a value just above the boundary (e.g., imwidth=855) and verifying it maps to tablet

## Related Documentation

- [IMQuery Support](./imquery-support.md) - Comprehensive document explaining IMQuery parameter handling and caching behavior
- [Breakpoint-based Derivative Mapping](./breakpoint-based-derivative-mapping.md) - How IMQuery width parameters map to specific derivatives
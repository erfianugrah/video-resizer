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
3. **Cache size issues**: If videos are unexpectedly not being cached, check debug logs for size-related information
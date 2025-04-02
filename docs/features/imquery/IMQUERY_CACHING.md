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

The system uses two methods to map IMQuery parameters to derivatives:

1. **Breakpoint-Based Mapping** (Preferred): When only `imwidth` is provided, the system uses responsive breakpoints to determine the appropriate derivative. This is configured through the `responsiveBreakpoints` setting.

2. **Percentage-Based Mapping** (Fallback): When both width and height are provided or breakpoint mapping fails, the system calculates the closest derivative based on the percentage difference between requested dimensions and available derivatives.

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

2. **Derivative-Based Cache Keys**: Instead of using the specific IMQuery dimensions for cache keys, the system uses the derived derivative name:

```typescript
// From videoHandler.ts
if (imwidth || imheight) {
  debug(context, logger, 'VideoHandler', 'Using derivative-based caching for IMQuery request', {
    imwidth,
    imheight,
    derivative: videoOptions.derivative
  });
}
```

### Benefits of This Approach

1. **Cache Efficiency**: By mapping similar dimensions to the same derivative, we achieve better cache reuse. Many slightly different IMQuery parameters can hit the same cached response.

2. **Reduced Origin Load**: By increasing cache hit rates, we reduce load on origin servers.

3. **Consistent Quality**: Ensures users with similar viewport sizes get consistent video quality, even with slightly different dimensions.

## Implementation Details

### Caching Strategy

1. **Mapping Step**:
   - Map IMQuery dimensions to a derivative using breakpoint or percentage methods
   - The derivative name becomes part of the cache key

2. **Cacheability Check**:
   - For IMQuery requests with derivatives, cacheability is forced to true
   - This override is applied in `TransformationService.ts`

3. **Cache Storage**:
   - In `videoHandler.ts`, derivative-based caching is used instead of dimension-specific caching
   - The cached response is stored using the derivative name as part of the key

4. **Cache Retrieval**:
   - When a new request comes in with IMQuery parameters, it follows the same mapping process
   - If it maps to the same derivative as a previously cached response, it will get a cache hit

## Configuration Options

### Breakpoint Configuration

Configure responsive breakpoints in the worker configuration:

```json
{
  "video": {
    "responsiveBreakpoints": {
      "small": {
        "min": 0,
        "max": 640,
        "derivative": "mobile"
      },
      "medium": {
        "min": 641,
        "max": 1200,
        "derivative": "tablet"
      },
      "large": {
        "min": 1201,
        "derivative": "desktop"
      }
    }
  }
}
```

### Derivative Configuration

Define derivatives with their transformation parameters:

```json
{
  "video": {
    "derivatives": {
      "mobile": {
        "width": 640,
        "height": 360,
        "quality": "low",
        "compression": "high"
      },
      "tablet": {
        "width": 960,
        "height": 540,
        "quality": "medium"
      },
      "desktop": {
        "width": 1280,
        "height": 720,
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

## Troubleshooting

### Unexpected Cache Misses

If you're experiencing unexpected cache misses for IMQuery requests:

1. Check the logs for `Using derivative-based caching for IMQuery request` to confirm the derivative mapping
2. Verify the derivative exists in configuration
3. Ensure breakpoints are configured correctly
4. Check if percentage thresholds need adjustment (default is 25%)
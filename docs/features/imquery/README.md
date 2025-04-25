# IMQuery Support for Video Resizer

## Overview

IMQuery is a responsive image technology originally developed by Akamai that uses URL parameters (`imwidth`, `imheight`, etc.) to request appropriately sized videos based on the client's viewport. Video Resizer provides full support for IMQuery parameters, enabling responsive video delivery that integrates seamlessly with existing responsive image workflows.

This document provides a comprehensive guide to IMQuery support in Video Resizer, including parameter handling, derivative mapping, caching behavior, and configuration options.

## Key Features

| Feature | Description | Benefits |
|---------|-------------|----------|
| **Responsive Sizing** | Automatically selects video dimensions based on client viewport | Optimized video delivery for different devices |
| **Derivative Mapping** | Maps IMQuery dimensions to predefined video derivatives | Consistent quality tiers with optimized settings |
| **Breakpoint-Based Matching** | Uses breakpoint ranges similar to CSS media queries | Predictable and intuitive dimension mapping |
| **Enhanced Caching** | Optimized storage and retrieval of IMQuery requests | Improved performance and reduced transformation costs |
| **Centralized Dimension Handling** | Consistent dimension management across components | Better code organization and maintenance |
| **Metadata Enrichment** | Stores both requested and actual dimensions in metadata | Improved diagnostics and cache analysis |

## IMQuery Parameters

| Parameter | Description | Example | Usage |
|-----------|-------------|---------|-------|
| `imwidth` | Requested width in pixels | `imwidth=854` | Primary parameter for responsive sizing |
| `imheight` | Requested height in pixels | `imheight=480` | Optional parameter for aspect ratio control |
| `im-viewwidth` | Client viewport width | `im-viewwidth=1200` | Converted to client hints for better optimization |
| `im-viewheight` | Client viewport height | `im-viewheight=800` | Converted to client hints for better optimization |
| `im-density` | Device pixel ratio | `im-density=2` | Helps optimize for retina/high-DPI displays |
| `imref` | Reference parameters | `imref=key1:value1,key2:value2` | Additional parameters in key-value format |

## How IMQuery Works

When a request includes IMQuery parameters, the following process occurs:

1. **Parameter Detection**: System identifies IMQuery parameters in the URL
2. **Derivative Mapping**: Parameters are mapped to the appropriate derivative using either:
   - **Breakpoint-Based Mapping** (for `imwidth` only)
   - **Percentage-Based Mapping** (for width + height or fallback)
3. **Dimension Handling**: The derivative's actual dimensions are used for transformation
4. **Cache Management**: Special caching rules ensure efficient storage and retrieval
5. **Metadata Enrichment**: Both requested dimensions and derivative dimensions are stored

## Breakpoint-Based Derivative Mapping

Video Resizer maps `imwidth` parameters to derivatives using breakpoint ranges, similar to CSS media queries:

| Width Range | Maps To | Resolution | Quality | Use Case |
|------------|---------|------------|---------|----------|
| ≤ 854px    | mobile  | 854x640    | low     | Mobile devices, bandwidth-constrained scenarios |
| 855-1280px | tablet  | 1280x720   | medium  | Tablets, small laptops |
| ≥ 1281px   | desktop | 1920x1080  | high    | Desktop computers, large displays |

This mapping approach:
- Provides predictable, consistent results
- Aligns with common responsive design breakpoints
- Maps similar dimensions to the same derivative for better cache efficiency
- Uses boundary values that match actual derivative dimensions

### Example Scenarios

- `imwidth=640` → Maps to `mobile` (854x640)
- `imwidth=855` → Maps to `tablet` (1280x720)
- `imwidth=1920` → Maps to `desktop` (1920x1080)

### Percentage-Based Fallback

For requests with both width and height, or in cases where breakpoint mapping isn't applicable, the system falls back to percentage-based mapping:

1. Calculates percentage difference between requested dimensions and available derivatives
2. Selects the derivative with the smallest percentage difference below threshold (default 25%)
3. Normalizes dimensions to improve cache hit rates for similar requests

## Caching Behavior

IMQuery requests benefit from special caching optimizations to improve performance:

### Cache Key Generation

For IMQuery requests that map to derivatives, the cache key includes the derivative information:

```
video:${sourcePath}:derivative=${matchedDerivative}
```

This approach:
- Enables efficient cache lookups
- Groups similar IMQuery requests that map to the same derivative
- Reduces duplicate transformations for similar dimensions

### Enhanced Caching Behavior

1. **Forced Cacheability**: IMQuery requests that map to derivatives are always made cacheable
2. **Derivative-Based Cache Keys**: Using derivative information rather than specific dimensions
3. **Dimension Normalization**: Similar dimensions (within 10px) are normalized to improve cache hit rates
4. **Metadata Enrichment**: Both derivative dimensions and requested dimensions are stored

### Cache Tags and Metadata

The cache system stores enriched metadata for IMQuery requests:

```json
{
  "width": 1280,              // Derivative's actual width
  "height": 720,              // Derivative's actual height
  "derivative": "tablet",     // Matched derivative
  "customData": {
    "requestedWidth": 855,    // Original IMQuery requested width
    "requestedHeight": null,  // Original IMQuery requested height
    "mappedFrom": "imquery"   // Indicates this was mapped from IMQuery
  },
  "cacheTags": [
    "video-prod-path-sample-mp4",
    "video-prod-derivative-tablet", 
    "video-prod-width-1280",         // Derivative's width
    "video-prod-height-720",         // Derivative's height
    "video-prod-dimensions-1280x720",
    "video-prod-requested-width-855" // Original requested width
  ]
}
```

## Centralized Dimension Handling

A key improvement to IMQuery support is the centralized dimension handling:

```typescript
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

This function ensures:
- Consistent dimension access across all components
- Single source of truth for derivative dimensions
- Simplified code maintenance and debugging
- Reliable dimension handling in transformations

## Configuration

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

## Integration Examples

### Basic Responsive Video

```html
<video src="https://cdn.example.com/video.mp4?imwidth=854" controls></video>
```

### Advanced Responsive Video with Picture Element

```html
<picture>
  <!-- Mobile -->
  <source media="(max-width: 854px)" 
          srcset="https://cdn.example.com/video.mp4?imwidth=854" />
  
  <!-- Tablet -->
  <source media="(max-width: 1280px)" 
          srcset="https://cdn.example.com/video.mp4?imwidth=1280" />
  
  <!-- Desktop -->
  <source srcset="https://cdn.example.com/video.mp4?imwidth=1920" />
  
  <!-- Fallback -->
  <video src="https://cdn.example.com/video.mp4" controls></video>
</picture>
```

### JavaScript Implementation

```javascript
function getResponsiveVideoUrl(baseUrl, viewportWidth) {
  // Map viewport width to appropriate IMQuery parameter
  let imwidth;
  if (viewportWidth <= 854) {
    imwidth = 854;  // Mobile
  } else if (viewportWidth <= 1280) {
    imwidth = 1280; // Tablet
  } else {
    imwidth = 1920; // Desktop
  }
  
  // Construct IMQuery URL
  return `${baseUrl}?imwidth=${imwidth}`;
}

// Usage
const videoElement = document.querySelector('video');
const baseUrl = 'https://cdn.example.com/video.mp4';
videoElement.src = getResponsiveVideoUrl(baseUrl, window.innerWidth);

// Update on resize
window.addEventListener('resize', () => {
  videoElement.src = getResponsiveVideoUrl(baseUrl, window.innerWidth);
});
```

## Diagnostics and Debugging

When using IMQuery parameters, you can enable debug output to understand the mapping process:

```
https://cdn.example.com/video.mp4?imwidth=855&debug=true
```

Debug output will show:
- Detected IMQuery parameters
- Mapping process (breakpoint or percentage-based)
- Selected derivative and its dimensions
- Cache key generation
- Transformed URL

## Best Practices

1. **Align Breakpoints**: Configure breakpoints to match your CSS media queries
2. **Use Width-Based Matching**: Prefer `imwidth` parameter for more predictable results
3. **Define Clear Derivatives**: Create derivatives with meaningful differences in quality and size
4. **Test Boundary Values**: Verify behavior at breakpoint boundaries (e.g., 854 vs. 855)
5. **Monitor Cache Efficiency**: Review cache hit rates to optimize breakpoint configuration

## Troubleshooting

| Issue | Possible Cause | Solution |
|-------|---------------|----------|
| Unexpected derivative mapping | Misconfigured breakpoints | Check breakpoint configuration and ensure values align with derivative dimensions |
| Caching not working for IMQuery | Cacheability settings | Verify the IMQuery caching special case is enabled |
| Poor cache hit rates | Too many unique dimensions | Consider using fewer breakpoints or normalizing dimensions further |
| Inconsistent quality | Breakpoint boundaries | Ensure breakpoint boundaries align with derivative dimensions |

## Recent Enhancements

1. **Centralized Dimension Handling**: Added `getDerivativeDimensions` utility for consistent dimension access
2. **Consistent Transformation URLs**: Now using derivative's actual dimensions in CDN-CGI URLs
3. **Enhanced Cache Metadata**: Storing both derivative dimensions and requested dimensions
4. **Refined Breakpoint Boundaries**: Updated to align with actual derivative dimensions
5. **Improved Cache Tags**: Added derivative-specific and request-specific tags
6. **Removed Size Limit Check**: Let KV naturally handle size limits to avoid incorrect content rejection

## Related Documentation

- [Video Mode](../video-mode.md) - Standard video transformation documentation
- [Transformation Modes](../transformation-modes.md) - Overview of all transformation modes
- [KV Caching](../../kv-caching/README.md) - Details about the KV caching system

## Last Updated

*April 25, 2025*
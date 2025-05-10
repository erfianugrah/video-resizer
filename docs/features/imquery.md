# IMQuery Integration

*Last Updated: May 10, 2025*

## Table of Contents

- [Overview](#overview)
- [IMQuery Parameters](#imquery-parameters)
- [Responsive Behavior](#responsive-behavior)
- [Derivative Mapping](#derivative-mapping)
- [Client Hints Integration](#client-hints-integration)
- [Caching Behavior](#caching-behavior)
- [Example Usage](#example-usage)
- [Implementation Patterns](#implementation-patterns)
- [Technical Considerations](#technical-considerations)
- [Performance Benefits](#performance-benefits)
- [Best Practices](#best-practices)
- [Troubleshooting](#troubleshooting)

## Overview

IMQuery integration enables responsive video transformations that adapt to the viewer's device and viewport. This feature allows videos to be automatically sized and optimized for different screen sizes and device capabilities, improving user experience and reducing bandwidth consumption.

IMQuery parameters provide context about the intended display size of videos, allowing the Video Resizer to select appropriate dimensions, quality settings, and compression levels automatically.

## IMQuery Parameters

The Video Resizer supports the following IMQuery parameters:

| Parameter | Type | Description | Example |
|-----------|------|-------------|---------|
| `imwidth` | number | Requested width in CSS pixels | `imwidth=400` |
| `imheight` | number | Requested height in CSS pixels | `imheight=300` |
| `im-viewwidth` | number | Viewport width in CSS pixels | `im-viewwidth=1200` |
| `im-viewheight` | number | Viewport height in CSS pixels | `im-viewheight=800` |
| `im-density` | number | Device pixel ratio (DPR) | `im-density=2` |
| `imref` | string | Reference identifier for the image | `imref=hero-video` |

### Primary Parameters

The two most commonly used parameters are:

1. **`imwidth`**: The desired width of the video in CSS pixels, typically matching the CSS width you've set in your frontend.

2. **`im-viewwidth`**: The width of the viewport or container in which the video appears. This provides important context for responsive sizing.

Example URL with IMQuery parameters:
```
https://cdn.example.com/videos/sample.mp4?imwidth=400&im-viewwidth=1200
```

## Responsive Behavior

IMQuery enables fully responsive video delivery through several mechanisms:

### 1. Relative Sizing

When `imwidth` is provided as a percentage of `im-viewwidth`, the system calculates the intended display size:

```
https://cdn.example.com/videos/sample.mp4?imwidth=50%&im-viewwidth=1200
```

In this example, the video width would be calculated as 600px (50% of 1200px).

### 2. Automatic Quality Adaptation

The Video Resizer automatically adjusts quality settings based on the relationship between:

- The requested size (`imwidth`/`imheight`)
- The viewport size (`im-viewwidth`/`im-viewheight`)
- The device pixel density (`im-density` or Client-Hints)

For example, a video displayed at a small size on a large, high-resolution screen might receive higher compression, while the same video filling a mobile screen would receive higher quality.

### 3. Device-Aware Optimization

When combined with Client Hints, IMQuery delivers device-optimized videos:

- Mobile devices receive formats and qualities suited for mobile networks
- High-DPR displays receive appropriately scaled videos
- Bandwidth conditions are considered for compression levels

## Derivative Mapping

One of the most powerful features of IMQuery is derivative mapping, which maps responsive dimensions to predefined video derivatives.

### Mapping Process

1. The system analyzes the `imwidth`, `im-viewwidth`, and other parameters
2. It calculates the relative size of the video in the viewport
3. It maps this to the most appropriate derivative
4. The derivative's predefined settings are applied

For example:

| Viewport Width | Video Width | Selected Derivative |
|----------------|-------------|---------------------|
| >1200px | >900px | `high` (1920×1080) |
| 768-1200px | 600-900px | `medium` (1280×720) |
| <768px | <600px | `mobile` (640×360) |

This mapping is configured through the `responsiveWidthBreakpoints` setting in the configuration.

### Percentage-Based Mapping

The system also supports percentage-based mapping:

```json
{
  "responsiveWidthMapping": {
    "breakpoints": {
      "small": {
        "maxWidthPct": 30,
        "derivative": "mobile"
      },
      "medium": {
        "maxWidthPct": 60,
        "derivative": "medium"
      },
      "large": {
        "derivative": "high"
      }
    }
  }
}
```

With this configuration:
- Videos taking up less than 30% of the viewport get the `mobile` derivative
- Videos taking 30-60% of the viewport get the `medium` derivative
- Videos taking over 60% of the viewport get the `high` derivative

## Client Hints Integration

IMQuery works seamlessly with Client Hints to provide comprehensive device information:

| Client Hint | Description | IMQuery Equivalent |
|-------------|-------------|-------------------|
| `Viewport-Width` | Width of the viewport | `im-viewwidth` |
| `Width` | Requested resource width | `imwidth` |
| `Device-Memory` | Device memory in GB | - |
| `DPR` | Device pixel ratio | `im-density` |
| `Sec-CH-Viewport-Width` | Viewport width (delegated) | `im-viewwidth` |
| `Sec-CH-Width` | Resource width (delegated) | `imwidth` |
| `Sec-CH-DPR` | Device pixel ratio (delegated) | `im-density` |

When both IMQuery parameters and Client Hints are provided, IMQuery parameters take precedence. When neither is available, the system falls back to User-Agent analysis.

## Caching Behavior

IMQuery has special caching behavior designed to maximize cache efficiency:

### 1. Derivative-Based Caching

When IMQuery parameters map to a derivative, the system:
- Uses the derivative name in the cache key instead of specific dimensions
- Caches using `derivative=medium` rather than `width=1280&height=720`
- This significantly improves cache hit rates

### 2. Forced Cacheability

IMQuery requests that map to derivatives are forced to be cacheable, even if the path pattern has `cacheability: false`:

```typescript
// Special handling for IMQuery - ensure it's cacheable
if (isIMQuery && hasDerivative) {
  // Ensure cacheability is set to true for IMQuery derivatives
  if (!cacheConfig.cacheability) {
    cacheConfig.cacheability = true;
  }
}
```

This behavior is intentional and maximizes the benefits of the derivative system.

### 3. Cache Key Normalization

The system normalizes IMQuery parameters in cache keys, ensuring that equivalent parameter combinations map to the same cached resource.

## Example Usage

### Basic Responsive Video

HTML:
```html
<video width="400" src="https://cdn.example.com/videos/sample.mp4?imwidth=400&im-viewwidth=1200"></video>
```

### Responsive Video with Media Queries

HTML and CSS:
```html
<video id="responsive-video" src="https://cdn.example.com/videos/sample.mp4"></video>

<script>
  const video = document.getElementById('responsive-video');
  const viewportWidth = window.innerWidth;
  
  // Set the video width based on screen size
  let videoWidth;
  if (viewportWidth >= 1200) {
    videoWidth = 800;
  } else if (viewportWidth >= 768) {
    videoWidth = 600;
  } else {
    videoWidth = 320;
  }
  
  video.width = videoWidth;
  
  // Update the video src with IMQuery parameters
  const videoSrc = new URL(video.src);
  videoSrc.searchParams.set('imwidth', videoWidth);
  videoSrc.searchParams.set('im-viewwidth', viewportWidth);
  video.src = videoSrc.toString();
</script>
```

### React Integration

```jsx
import React, { useState, useEffect } from 'react';

const ResponsiveVideo = ({ videoUrl }) => {
  const [dimensions, setDimensions] = useState({
    width: window.innerWidth,
    videoWidth: 0
  });
  
  // Calculate video width based on viewport
  useEffect(() => {
    const handleResize = () => {
      const viewportWidth = window.innerWidth;
      let videoWidth;
      
      if (viewportWidth >= 1200) {
        videoWidth = Math.min(800, viewportWidth * 0.7);
      } else if (viewportWidth >= 768) {
        videoWidth = Math.min(600, viewportWidth * 0.8);
      } else {
        videoWidth = Math.min(320, viewportWidth * 0.9);
      }
      
      setDimensions({
        width: viewportWidth,
        videoWidth: Math.round(videoWidth)
      });
    };
    
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);
  
  // Construct URL with IMQuery parameters
  const fullVideoUrl = `${videoUrl}?imwidth=${dimensions.videoWidth}&im-viewwidth=${dimensions.width}`;
  
  return (
    <video 
      width={dimensions.videoWidth} 
      controls
      src={fullVideoUrl}
    />
  );
};

export default ResponsiveVideo;
```

## Implementation Patterns

### Client Hints Integration

To fully leverage IMQuery with Client Hints:

1. **Opt-in to Client Hints**:
   ```html
   <meta http-equiv="Accept-CH" content="Width,Viewport-Width,DPR">
   ```

2. **Delegate to trusted origins** (recommended for Cloudflare setup):
   ```html
   <meta http-equiv="Delegate-CH" content="Width,Viewport-Width,DPR;src=https://cdn.example.com">
   ```

### Dimension Calculation

For optimal IMQuery usage:

1. **Standalone videos**:
   - `imwidth`: The CSS width of the video element
   - `im-viewwidth`: The width of the viewport

2. **Responsive layouts**:
   - `imwidth`: The actual rendered width of the video
   - `im-viewwidth`: The width of the container or viewport

3. **Flexible videos**:
   - For videos with percentage-based widths, calculate the actual pixel width for `imwidth`

## Technical Considerations

### 1. Parameter Precedence

The order of precedence for determining video dimensions:

1. Explicit `width` and `height` URL parameters
2. IMQuery parameters (`imwidth`, `imheight`, etc.)
3. Client Hints (`Width`, `Viewport-Width`, etc.)
4. Derivative default values
5. Default configuration values

### 2. Device Detection Impact

IMQuery significantly enhances device detection:

- Provides actual display dimensions rather than theoretical device capabilities
- Enables context-aware optimizations based on the video's role in the layout
- Allows for more precise derivative selection

### 3. Backward Compatibility

IMQuery is fully compatible with older URLs and clients:

- Existing URLs without IMQuery parameters continue to work
- No changes required to path patterns or derivatives
- Can be gradually implemented across a site

## Performance Benefits

IMQuery provides significant performance benefits:

### 1. Bandwidth Optimization

By automatically selecting appropriate dimensions and quality settings, IMQuery reduces bandwidth consumption:

- Mobile users receive appropriately sized videos
- Small video embeds don't download full-resolution videos
- Quality and compression are balanced with display size

### 2. Cache Efficiency

Derivative-based caching significantly improves cache hit rates:

- Many different IMQuery parameter combinations map to the same derivative
- Reduces origin load and improves response times
- Enables efficient global distribution through Cloudflare's network

### 3. Rendering Performance

Properly sized videos improve rendering performance:

- Reduced memory consumption on client devices
- Faster decoding and rendering
- Smoother playback, especially on mobile devices

## Best Practices

1. **Always Include Both Key Parameters**:
   - Always include both `imwidth` and `im-viewwidth` for optimal results
   - This provides the critical context needed for derivative mapping

2. **Use Real Measurements**:
   - Calculate actual CSS pixel dimensions rather than using estimates
   - Update parameters when the viewport or layout changes

3. **Configure Appropriate Derivatives**:
   - Define derivatives that match your common use cases
   - Ensure breakpoints align with your CSS media queries

4. **Enable Client Hints**:
   - Implement Client Hints support for additional context
   - Delegate hints to your Cloudflare domain

5. **Monitor Cache Performance**:
   - Check cache hit rates to verify IMQuery efficiency
   - Look for derivative mapping logs to verify correct mapping

## Troubleshooting

### Common Issues

#### 1. Unexpected Derivative Selection

**Issue**: Videos are mapped to unexpected derivatives
**Solution**: Check your breakpoint configuration and the actual parameters being sent

```
# Debug the derivative mapping
https://cdn.example.com/videos/sample.mp4?imwidth=400&im-viewwidth=1200&debug=view
```

The debug UI will show the derivative selection logic and parameters used.

#### 2. Cache Misses

**Issue**: Poor cache performance despite IMQuery implementation
**Solution**: Verify derivative-based caching is working correctly

Check logs for:
```
Matched IMQuery dimensions to derivative: medium
Applied derivative based on IMQuery dimensions
```

#### 3. Sizing Inconsistencies

**Issue**: Videos appear at unexpected sizes
**Solution**: Verify the `imwidth` value matches the actual CSS width

```javascript
// Calculate the actual rendered width
const videoElement = document.querySelector('video');
const actualWidth = videoElement.getBoundingClientRect().width;
console.log(`Actual width: ${actualWidth}px, IMQuery width: ${imwidth}px`);
```

#### 4. Client Hints Not Working

**Issue**: Client hints are not being received by the worker
**Solution**: Check your Meta tag configuration and CORS setup

```html
<!-- Ensure correct meta tags -->
<meta http-equiv="Accept-CH" content="Width,Viewport-Width,DPR">
<meta http-equiv="Delegate-CH" content="Width,Viewport-Width,DPR;src=https://cdn.example.com">
```

Also verify cross-origin setup is correct.
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

*April 25, 2025*\n## IMQuery Support Implementation\n
# IMQuery Support for Video Resizer

## Overview

IMQuery support enables the video resizer to respond to Akamai-compatible responsive image parameters (`imwidth` and `imheight`), automatically selecting the most appropriate video configuration based on the client's requested dimensions. This allows for responsive video resizing that integrates seamlessly with existing responsive image workflows.

## Features

1. **Derivative Matching**
   - Automatically matches IMQuery dimensions to the closest video derivative
   - Uses Euclidean distance algorithm for optimal matching
   - Applies derivative configuration (quality, format, compression settings)
   - Falls back to exact dimensions when no good match exists

2. **KV Caching Support**
   - Properly caches videos requested with IMQuery parameters
   - Only bypasses cache for specific parameters (`debug`, `nocache`, `bypass`)
   - Improves performance for repeated IMQuery requests

## Derivative Matching

### How It Works

When a request includes IMQuery parameters (`imwidth` or `imheight`):

1. The system filters available derivatives to those with defined dimensions
2. Calculates distance/difference for each derivative:
   - For requests with both width and height: Uses Euclidean distance formula
   - For requests with only width or only height: Uses direct difference
3. Converts distance to percentage difference relative to requested dimensions
4. Selects the derivative with the smallest percentage difference below threshold (default 25%)

### Example

Request: `?imwidth=800&imheight=450`

Available Derivatives:
- mobile: { width: 480, height: 270 }
- medium: { width: 854, height: 480 }
- high: { width: 1280, height: 720 }

Result:
- Matched Derivative: "medium"
- Percent Difference: 9.6%
- Applied: { width: 854, height: 480, quality: "medium" }

## KV Caching Behavior

### Caching Implementation

The system is designed to properly cache videos requested with IMQuery parameters, improving performance for repeated requests:

1. Centralized bypass logic only skips caching for specific parameters:
   - Non-GET requests are not cached
   - Requests with `debug`, `nocache`, or `bypass` query parameters bypass cache
   - Requests with cache-control headers requesting no caching are honored

2. Special handling for IMQuery derivatives:
   - Even though IMQuery parameters are in the URL query string, they are treated differently
   - When IMQuery parameters match to a derivative, cacheability is explicitly enforced
   - This ensures that transformed videos with IMQuery parameters benefit from KV caching

### Cache Bypass Configuration

Bypass query parameters are configured in `CacheConfigurationManager.ts`:

```typescript
bypassQueryParameters: ['nocache', 'bypass'],
```

You can add parameters to this array to trigger cache bypass.

### Cache Key Generation

For IMQuery requests that match to derivatives, the cache key includes the derivative information:

```
video:${sourcePath}:derivative=${matchedDerivative}
```

This ensures efficient caching while still respecting the specific derivative configuration requested via IMQuery parameters.

## Recent Improvements

We recently fixed an issue with IMQuery caching. Previously, the system would sometimes incorrectly disable caching for IMQuery parameters. The fix ensures:

1. IMQuery requests that match to derivatives are always considered cacheable
2. Cache configuration is properly determined even with query parameters
3. Cache keys are consistently generated for efficient lookup

See the [IMQuery Caching Fix](./imquery-caching-fix.md) document for details about this fix.

## Testing Both Features

To verify both features are working correctly:

1. Make a request with IMQuery parameters (e.g., `/videos/test.mp4?imwidth=800`)
2. Check logs to confirm:
   - Derivative matching is selecting the appropriate derivative
   - KV cache storage is not being bypassed
3. Make the same request again to verify a KV cache hit occurs

## Diagnostics Information

When IMQuery matching is used, the system captures:

```typescript
imqueryMatching: {
  requestedWidth: number | null;
  requestedHeight: number | null;
  matchedDerivative: string;
  derivativeWidth: number | null;
  derivativeHeight: number | null;
  percentDifference: string;
}
```

This information is available in debug headers and the Debug UI, helping to understand how IMQuery parameters are processed.

## Configuration Options

- **Derivative Matching Threshold**: Adjust `maxDifferenceThreshold` in `imqueryUtils.findClosestDerivative()` (default: 25%)
- **Cache Bypass Parameters**: Modify `bypassQueryParameters` array in `CacheConfigurationManager`
- **Derivative Configurations**: Define in `videoConfig.derivatives` to provide matching options\n## Akamai Integration Summary\n
# Akamai Integration: Implementation Summary

This document summarizes the implementation of Akamai compatibility features in the video-resizer service.

## Overview

We've enhanced the video-resizer service to support Akamai-style parameters and the IMQuery responsive image technology. This enables a smooth transition from Akamai to Cloudflare while maintaining backward compatibility with existing Akamai-formatted URLs.

## Implemented Features

### 1. Extended Parameter Mapping

We've expanded the `AKAMAI_TO_CLOUDFLARE_MAPPING` in `transformationUtils.ts` to include:

- Standard Akamai parameters (`w`, `h`, `obj-fit`, etc.)
- IMQuery responsive parameters (`imwidth`, `imheight`, `imref`, etc.)
- Additional video parameters (`fps`, `speed`, `crop`, `rotate`)

```typescript
const AKAMAI_TO_CLOUDFLARE_MAPPING = {
  // Akamai Image & Video Manager params
  'w': 'width',
  'h': 'height',
  // ...many more parameters...
  
  // IMQuery responsive image parameters
  'imwidth': 'width',
  'imheight': 'height',
  'imref': 'imref',
  'im-viewwidth': 'viewwidth',
  'im-viewheight': 'viewheight',
  'im-density': 'dpr',
  
  // Additional video parameters
  'fps': 'fps',
  'speed': 'speed',
  'crop': 'crop',
  'rotate': 'rotate'
};
```

### 2. IMQuery Support

We've created a dedicated utility module `imqueryUtils.ts` for handling Akamai's IMQuery technology:

- `parseImQueryRef()` - Parses Akamai's reference query syntax
- `convertImQueryToClientHints()` - Translates IMQuery parameters to client hints
- `hasIMQueryParams()` - Detects IMQuery parameters in requests
- `validateAkamaiParams()` - Validates parameter formats and provides warnings

```typescript
export function parseImQueryRef(imref: string): Record<string, string> {
  // Format: key1=value1,key2=value2,...
  const result: Record<string, string> = {};
  
  if (!imref) return result;
  
  debug('IMQuery', 'Parsing imref parameter', { imref });
  
  const params = imref.split(',');
  for (const param of params) {
    const [key, value] = param.split('=');
    if (key && value) {
      result[key] = value;
    }
  }
  
  return result;
}
```

### 3. Client Hints Integration

We've integrated IMQuery with Cloudflare's client hints system:

- IMQuery parameters are converted to client hints headers
- Enhanced request objects are created with the client hints
- Responsive sizing calculations use the enhanced request

```typescript
// Convert IMQuery to client hints if present
const clientHints = convertImQueryToClientHints(params);
if (Object.keys(clientHints).length > 0) {
  // Create enhanced request with client hints
  const headers = new Headers(request.headers);
  
  // Add client hints headers
  for (const [key, value] of Object.entries(clientHints)) {
    headers.set(key, value);
  }
  
  // Create new request with enhanced headers
  const enhancedRequest = new Request(request.url, {
    method: request.method,
    headers,
    // ...other request properties...
  });
  
  // Use the enhanced request for further processing
  request = enhancedRequest;
}
```

### 4. Parameter Processing

We've enhanced the video options service to handle:

- Traditional Akamai parameters
- IMQuery parameters
- Additional video parameters

```typescript
// Handle parameters based on their proper name
switch (paramKey) {
  // ...existing parameters...
  
  // Handle additional video parameters
  case 'fps':
    const fpsValue = parseFloat(value);
    if (!isNaN(fpsValue) && fpsValue > 0) {
      options.fps = fpsValue;
    }
    break;
    
  case 'speed':
    const speedValue = parseFloat(value);
    if (!isNaN(speedValue) && speedValue > 0) {
      options.speed = speedValue;
    }
    break;
    
  case 'rotate':
    const rotateValue = parseFloat(value);
    if (!isNaN(rotateValue)) {
      options.rotate = rotateValue;
    }
    break;
    
  case 'crop':
    options.crop = value;
    break;
}
```

### 5. Diagnostic Information

We've updated the `DiagnosticsInfo` interface to include Akamai translation information:

```typescript
export interface DiagnosticsInfo {
  // ...existing fields...
  
  // Akamai translation info
  originalAkamaiParams?: Record<string, string>;
  translatedCloudflareParams?: Record<string, string | boolean | number>;
  translationWarnings?: string[];
  usingIMQuery?: boolean;
}
```

This information is collected and stored in the request context for:
- Debugging and troubleshooting
- Future integration with the Debug UI
- Monitoring the translation process

## What's Next

To complete the implementation as outlined in the enhancement plan, the next steps would be:

1. **Debug UI Integration**:
   - Create a new Debug UI component to visualize parameter translations
   - Show original and translated parameters side by side
   - Display any warnings or issues with translations

2. **Performance Optimization**:
   - Implement caching for translated parameters
   - Add benchmarking for translation overhead
   - Optimize translation logic for common parameter sets

3. **Bidirectional Translation**:
   - Implement Cloudflare to Akamai translation
   - Support URL generation in both formats
   - Enable A/B testing between Akamai and Cloudflare transformations

## Usage Examples

### Basic Akamai Parameter Usage

```
https://example.com/videos/sample.mp4?w=800&h=600&obj-fit=cover
```

This URL uses traditional Akamai parameters and will be translated to Cloudflare's:
```
https://example.com/cdn-cgi/media/width=800,height=600,fit=cover/videos/sample.mp4
```

### IMQuery Usage

```
https://example.com/videos/sample.mp4?imwidth=800&imheight=600&imref=w=800,h=600,dpr=2
```

This URL uses IMQuery parameters and will:
1. Convert IMQuery parameters to client hints
2. Use responsive sizing based on the parameters
3. Generate an appropriate Cloudflare transformation URL

### Advanced Video Parameters

```
https://example.com/videos/sample.mp4?fps=30&speed=1.5&rotate=90&crop=100,100,500,500
```

This URL uses the new video parameters for more advanced transformations.

## Conclusion

The implemented Akamai compatibility layer provides a robust foundation for transitioning from Akamai to Cloudflare while maintaining backward compatibility. Users can continue using existing Akamai-formatted URLs while benefiting from Cloudflare's Media Transformation capabilities.\n## Akamai Integration Overview\n
# Akamai Integration for Video Resizer

## Overview

The Akamai integration feature allows Video Resizer to support Akamai-style URL parameters and the IMQuery responsive image technology. This enables a seamless migration path from Akamai to Cloudflare while maintaining backward compatibility with existing applications.

With this feature, you can continue using existing Akamai-formatted URLs with the Video Resizer service, and they will automatically be translated to Cloudflare's Media Transformation API format.

## Key Features

| Feature | Description | Benefits |
|---------|-------------|----------|
| **Parameter Translation** | Converts Akamai-style parameters (`w`, `h`, `obj-fit`, etc.) to Cloudflare format | Maintain compatibility with existing applications |
| **IMQuery Support** | Handles Akamai's responsive image technology parameters (`imwidth`, `imheight`, etc.) | Enable responsive video delivery |
| **Client Hints Integration** | Translates IMQuery parameters to client hints format | Better device-specific optimizations |
| **Validation & Error Handling** | Provides detailed warnings for unsupported parameters | Improved debugging experience |
| **Diagnostic Information** | Captures original and translated parameters for debugging | Easier troubleshooting |

## Parameter Mapping

The integration includes comprehensive parameter mapping between Akamai and Cloudflare formats:

| Akamai Parameter | Cloudflare Parameter | Notes |
|------------------|----------------------|-------|
| `w` | `width` | Video width in pixels |
| `h` | `height` | Video height in pixels |
| `obj-fit` | `fit` | Resize mode (cover, contain, etc.) |
| `q` | `quality` | Quality setting |
| `f` | `format` | Output format |
| `start` | `time` | Start timestamp |
| `dur` | `duration` | Video duration |
| `mute` | `audio` | Audio control (inverted: mute=true → audio=false) |
| `imwidth` | `width` | IMQuery responsive width |
| `imheight` | `height` | IMQuery responsive height |
| `im-viewwidth` | Converted to client hints | Client viewport width |
| `im-viewheight` | Converted to client hints | Client viewport height |
| `im-density` | Converted to client hints | Device pixel ratio |

## Parameter Value Translation

Some parameters have values that need translation:

| Parameter | Akamai Value | Cloudflare Value |
|-----------|--------------|------------------|
| `obj-fit` | `cover` | `cover` |
| `obj-fit` | `contain` | `contain` |
| `obj-fit` | `crop` | `cover` |
| `obj-fit` | `fill` | `contain` |
| `mute` | `true` | `audio=false` |
| `mute` | `false` | `audio=true` |

## IMQuery Support

IMQuery is Akamai's responsive image technology that allows clients to request appropriately sized videos based on the client's viewport. The Video Resizer's IMQuery support includes:

1. **Parameter Recognition**: Detects IMQuery parameters in URL requests
2. **Reference Parameter Parsing**: Handles the `imref` parameter for reference values
3. **Client Hints Integration**: Converts IMQuery parameters to client hints
4. **Responsive Sizing**: Adapts video dimensions based on client capabilities
5. **Device Adaptation**: Optimizes video delivery for different devices

### How IMQuery Works

When a request includes IMQuery parameters (e.g., `imwidth=800`):

1. The parameters are detected in the URL
2. IMQuery reference values are parsed if present
3. Device viewport parameters are converted to client hints
4. The system maps the dimensions to an appropriate derivative
5. The transformation uses the derivative's parameters
6. Diagnostic information captures both original and translated parameters

## Usage Examples

### Basic Akamai Parameter Usage

```
https://cdn.example.com/videos/sample.mp4?w=800&h=600&obj-fit=cover
```

This URL uses traditional Akamai parameters and will be translated to Cloudflare's format.

### IMQuery Usage

```
https://cdn.example.com/videos/sample.mp4?imwidth=800&imheight=600&imref=w=800,h=600,dpr=2
```

This URL uses IMQuery parameters and will leverage client hints and responsive sizing.

### Combined Parameter Usage

```
https://cdn.example.com/videos/sample.mp4?w=800&h=600&mute=true&start=10s&dur=30s
```

This URL combines multiple Akamai parameters for a more complex transformation.

## Implementation Architecture

The Akamai integration is implemented across several key components:

1. **Parameter Translation**: In `transformationUtils.ts`, provides mapping between Akamai and Cloudflare parameters

2. **IMQuery Support**: In `imqueryUtils.ts`, handles all IMQuery-specific functionality

3. **Parameter Processing**: In `videoOptionsService.ts`, integrates translation into the request processing flow

4. **Diagnostic Capture**: Stores original and translated parameters for debugging

## Diagnostic Information

When using Akamai-style parameters, you can enable debug output to see the translation process:

```
https://cdn.example.com/videos/sample.mp4?w=800&h=600&debug=true
```

The debug output includes:
- Original Akamai parameters
- Translated Cloudflare parameters
- Any warnings about unsupported parameters
- IMQuery processing details (if applicable)

## Best Practices

1. **Consistent Parameter Use**: Either use all Akamai-style or all Cloudflare-style parameters in a single request for best predictability
2. **IMQuery for Responsive Design**: Use IMQuery parameters for responsive video delivery
3. **Test Complex Transformations**: Verify complex parameter combinations work as expected
4. **Check Debug Output**: Use the debug parameter to understand how parameters are translated
5. **Monitor Warnings**: Pay attention to warnings about unsupported parameters

## Troubleshooting

| Issue | Possible Cause | Solution |
|-------|---------------|----------|
| Parameter not applied | Unsupported parameter | Check debug output for warnings about unsupported parameters |
| Unexpected transformation | Value range difference | Verify parameter values are within acceptable ranges |
| IMQuery not working | Missing viewport information | Include `im-viewwidth` parameter or ensure client hints are available |
| Audio issues | Inverted `mute` parameter | Remember that `mute=true` translates to `audio=false` |

## Related Documentation

- [IMQuery Support](../imquery/README.md) - Comprehensive documentation on IMQuery support
- [Video Mode](../video-mode.md) - Standard video transformation documentation
- [Transformation Modes](../transformation-modes.md) - Overview of all transformation modes
- [Parameter Compatibility](../../configuration/parameter-compatibility.md) - Complete parameter reference

## Last Updated

*April 25, 2025*
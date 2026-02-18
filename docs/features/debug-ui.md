# Debug UI

_Last Updated: February 18, 2026_

## Table of Contents

- [Overview](#overview)
- [Enabling Debug Mode](#enabling-debug-mode)
- [Debug UI Components](#debug-ui-components)
- [Debug Headers](#debug-headers)
- [Debug View Mode](#debug-view-mode)
- [Configuration Options](#configuration-options)
- [Security Considerations](#security-considerations)
- [Using Debug UI for Troubleshooting](#using-debug-ui-for-troubleshooting)
- [Debug Information API](#debug-information-api)
- [Performance Impact](#performance-impact)
- [Customization](#customization)
- [Examples](#examples)

## Overview

The Debug UI is a comprehensive diagnostic tool in the Video Resizer that provides detailed insights into request processing, transformation decisions, and system behavior. It offers two primary interfaces: a visual HTML dashboard (Debug View Mode) and informative HTTP headers (Debug Headers Mode).

The Debug UI helps developers and operators:

- Understand how requests are processed
- View transformation parameters and decisions
- Diagnose issues with path pattern matching
- Monitor cache behavior and performance
- Verify configuration settings
- Troubleshoot client detection and responsive behavior

## Enabling Debug Mode

Debug mode can be activated in three ways:

### 1. Query Parameter

Add the `debug` query parameter to any video URL:

```
https://cdn.example.com/videos/sample.mp4?debug=view
```

This enables the full debug UI in HTML view mode.

### 2. Debug Headers Only

To only enable debug headers (without the HTML view):

```
https://cdn.example.com/videos/sample.mp4?debug=headers
```

### 3. HTTP Headers

Include the `X-Video-Resizer-Debug` header in your request:

```
X-Video-Resizer-Debug: view
```

or:

```
X-Video-Resizer-Debug: headers
```

## Debug UI Components

The Debug UI is organized into several information panels:

### 1. Request Information

- Original request URL and method
- Client IP address and user agent
- Request headers and query parameters
- Timestamp and request ID

### 2. Path Matching

- Matched path pattern name and regex
- Capture groups extracted from the URL
- Path parameters and validation results
- Transformation overrides from the pattern

### 3. Video Transformation

- Selected transformation mode (video, frame, spritesheet, audio)
- Applied parameters (width, height, quality, etc.)
- Derivative selection (if applicable)
- Generated CDN-CGI transformation URL

### 4. Client Detection

- Detected device type (mobile, tablet, desktop)
- Browser and OS information
- Network quality estimation
- Client hint support status
- Device capabilities assessment

### 5. Cache Information

- Cache status (hit, miss, bypass)
- Cache storage method used
- TTL settings applied
- Cache key construction
- Cache version information

### 6. Performance Metrics

- Total processing time
- Component-specific timings:
  - Path matching time
  - Parameter processing time
  - Cache lookup time
  - Transformation time
  - Origin fetch time (if applicable)

### 7. Live Preview

- Visual preview of the transformed video/image
- Interactive player controls (for video mode)
- Size and format information

## Debug Headers

When Debug Headers mode is enabled, the following HTTP headers are added to the response:

| Header                   | Description                                  | Example                                     |
| ------------------------ | -------------------------------------------- | ------------------------------------------- |
| `X-Video-Resizer-Debug`  | Indicates debug mode is enabled              | `view` or `headers`                         |
| `X-Processing-Time-Ms`   | Total processing time in milliseconds        | `127.35`                                    |
| `X-Transform-Source`     | Source of the transformed content            | `origin` or `cache`                         |
| `X-Transform-Mode`       | Transformation mode used                     | `video`, `frame`, `spritesheet`, or `audio` |
| `X-CF-Error-Code`        | Cloudflare error code from Cf-Resized header | `9401`, `9402`, etc.                        |
| `X-Device-Type`          | Detected device type                         | `mobile`, `tablet`, or `desktop`            |
| `X-Network-Quality`      | Estimated network quality                    | `high`, `medium`, or `low`                  |
| `X-Cache-Enabled`        | Whether caching was enabled                  | `true` or `false`                           |
| `X-Cache-TTL`            | Applied cache TTL in seconds                 | `86400`                                     |
| `X-Cache-Key`            | Simplified cache key used                    | `video:sample.mp4:derivative=mobile`        |
| `X-Cache-Result`         | Cache operation result                       | `hit`, `miss`, or `bypass`                  |
| `X-Pattern-Matched`      | Path pattern that matched                    | `standard`                                  |
| `X-Pattern-Origin`       | Origin URL pattern used                      | `https://videos.example.com/{0}`            |
| `X-Derivative-Applied`   | Derivative used (if any)                     | `mobile`                                    |
| `X-URL-Params-Processed` | Count of URL parameters processed            | `4`                                         |
| `X-Debug-ID`             | Unique ID for this debug session             | `dbg_1234567890abcdef`                      |

For security reasons, some detailed information is omitted from headers and only available in the HTML view.

## Debug View Mode

Debug View Mode renders a comprehensive HTML dashboard with all diagnostic information:

### Header Section

- Title with video information
- Timestamp and request ID
- Quick links to sections
- Toggle buttons for sections

### Information Cards

Each component has a dedicated card with:

- Collapsible sections
- Syntax-highlighted JSON data
- Visual indicators for important information
- Copy-to-clipboard functionality

### Interactive Elements

- Expandable/collapsible sections
- Tabs for different information categories
- Search functionality for large JSON objects
- Tooltips for technical terms

### Live Preview

- Embedded video or image preview
- Player controls for video mode
- Visual dimensions indicator
- Format and size information

## Configuration Options

Debug UI behavior can be configured in the `debug` section of the configuration:

```json
{
  "debug": {
    "enabled": false, // Enable debug globally
    "verbose": false, // Enable verbose debug output
    "includeHeaders": true, // Include headers in debug info
    "includePerformance": true, // Include performance metrics
    "dashboardMode": true, // Enable debug dashboard
    "viewMode": true, // Enable debug view
    "headerMode": true, // Enable debug headers
    "debugQueryParam": "debug", // Query parameter to enable debug
    "debugViewParam": "view", // Value for debug view parameter
    "preserveDebugParams": false, // Preserve debug parameters in transformed URLs
    "debugHeaders": [
      // Headers that enable debugging
      "X-Video-Resizer-Debug"
    ],
    "renderStaticHtml": true, // Render static HTML for debug views
    "includeStackTrace": false, // Include stack traces in debug info
    "maxContentLength": 50000, // Maximum debug content length
    "allowedIps": [], // IPs allowed to see debug info
    "excludedPaths": [] // Paths excluded from debugging
  }
}
```

## Security Considerations

The Debug UI provides detailed system information, so several security measures are built in:

### 1. IP Address Restrictions

Limit debug access to specific IP addresses:

```json
{
  "debug": {
    "allowedIps": ["192.168.1.100", "10.0.0.0/24"]
  }
}
```

When configured, only requests from these IPs can access debug information.

### 2. Path Exclusions

Exclude sensitive paths from debugging:

```json
{
  "debug": {
    "excludedPaths": ["^/admin/.*", "^/private/.*"]
  }
}
```

This prevents debug information from being exposed for sensitive content.

### 3. Sanitized Information

The Debug UI automatically sanitizes sensitive information:

- Authentication tokens are redacted
- API keys are partially masked
- Origin credentials are hidden
- Internal system paths are obscured

### 4. Production Safety

For production environments:

- Set `debug.enabled` to `false` to require explicit debug parameters
- Enable IP restrictions with `allowedIps`
- Disable stack traces with `includeStackTrace: false`
- Consider disabling `preserveDebugParams`

## Using Debug UI for Troubleshooting

### 1. Path Matching Issues

If URLs aren't being processed as expected:

1. Add `?debug=view` to the URL
2. Check the "Path Matching" section to see:
   - Which pattern matched (or why none matched)
   - What capture groups were extracted
   - What parameters were applied

### 2. Transformation Problems

For issues with video appearance:

1. Enable debug mode
2. Check the "Video Transformation" section to see:
   - Applied transformation parameters
   - Derivative selection
   - Generated CDN-CGI URL
   - Parameter validation results

### 3. Cache Behavior

For caching issues:

1. Enable debug mode
2. Check the "Cache Information" section to see:
   - Cache hit/miss status
   - Cache key construction
   - TTL settings
   - Cache version information

### 4. Client Detection

For device-specific problems:

1. Enable debug mode
2. Check the "Client Detection" section to see:
   - Detected device type
   - Client hint availability
   - Responsive parameter processing
   - Network quality assessment

### 5. Performance Analysis

For performance concerns:

1. Enable debug mode with headers: `?debug=headers`
2. Check the `X-Processing-Time-Ms` header for overall performance
3. For detailed breakdowns, use view mode and check the "Performance Metrics" section

## Debug Information API

Advanced users can access debug information programmatically:

### Debug Headers API

Make a request with debug headers enabled:

```javascript
fetch('https://cdn.example.com/videos/sample.mp4?debug=headers').then((response) => {
  // Extract debug headers
  const processingTime = response.headers.get('X-Processing-Time-Ms');
  const cacheResult = response.headers.get('X-Cache-Result');
  const deviceType = response.headers.get('X-Device-Type');

  console.log(`Processing time: ${processingTime}ms`);
  console.log(`Cache result: ${cacheResult}`);
  console.log(`Device type: ${deviceType}`);
});
```

### JSON Debug Format

Request debug information in JSON format:

```
https://cdn.example.com/videos/sample.mp4?debug=json
```

This returns a JSON object with all debug information:

```javascript
fetch('https://cdn.example.com/videos/sample.mp4?debug=json')
  .then((response) => response.json())
  .then((debugInfo) => {
    console.log('Path pattern:', debugInfo.pathPattern.name);
    console.log('Cache status:', debugInfo.cache.result);
    console.log('Processing time:', debugInfo.performance.totalTime);
  });
```

## Performance Impact

Debug mode has some performance implications to consider:

- **Processing Overhead**: Debug information collection adds 10-30ms to request processing
- **Response Size**: Debug view HTML can add 20-100KB to the response
- **Memory Usage**: Collecting detailed diagnostics increases memory usage slightly
- **Caching Impact**: Requests with debug parameters bypass most caches

For these reasons, debug mode should only be used for development, testing, and troubleshooting—not in normal production traffic.

## Customization

The Debug UI can be customized for special needs:

### Custom Diagnostic Info

Add custom diagnostic information:

```typescript
// Add custom information to diagnostics
context.diagnosticsInfo.customData = {
  specialProcessing: true,
  businessLogic: {
    rule: 'premium-content',
    applied: true,
  },
};
```

This information will appear in the Debug UI.

### Extended Debug Headers

Add custom debug headers:

```typescript
// Add custom debug headers
if (isDebugMode) {
  response.headers.set('X-Custom-Debug-Info', JSON.stringify(customInfo));
}
```

### Debug UI Theme

The Debug UI styles can be customized through configuration:

```json
{
  "debug": {
    "uiOptions": {
      "theme": "dark", // 'dark' or 'light'
      "accentColor": "#5D8AA8",
      "fontFamily": "'Roboto Mono', monospace",
      "compactMode": false
    }
  }
}
```

## Examples

### Basic Debug View

```
https://cdn.example.com/videos/sample.mp4?width=720&height=480&debug=view
```

This shows the full Debug UI with information about this specific transformation request.

### Performance Analysis

```
https://cdn.example.com/videos/sample.mp4?debug=headers&debug-include=performance
```

This returns only the performance-related debug headers for lightweight analysis.

### Transformation Debugging

```
https://cdn.example.com/videos/sample.mp4?derivative=mobile&debug=view&debug-focus=transformation
```

This focuses the Debug UI on transformation details, with other sections collapsed.

### Cache Analysis

```
https://cdn.example.com/videos/sample.mp4?debug=view&debug-focus=cache
```

This focuses the Debug UI on cache information, highlighting cache behavior.

### Client Detection Check

```
https://cdn.example.com/videos/sample.mp4?imwidth=400&im-viewwidth=1200&debug=view&debug-focus=client
```

This focuses the Debug UI on client detection, showing how IMQuery parameters are processed.

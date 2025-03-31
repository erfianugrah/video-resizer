# Debug Configuration

The `DebugConfigurationManager` handles debugging capabilities and settings. It provides methods to control debugging features, including debug views, headers, and diagnostic information.

## Debug Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | boolean | false | Enable debug mode globally |
| `verbose` | boolean | false | Enable verbose debug output |
| `includeHeaders` | boolean | false | Include headers in debug info |
| `includePerformance` | boolean | false | Include performance metrics |
| `dashboardMode` | boolean | true | Enable debug dashboard |
| `viewMode` | boolean | true | Enable debug view |
| `headerMode` | boolean | true | Enable debug headers |
| `debugQueryParam` | string | 'debug' | Query parameter to enable debug |
| `debugViewParam` | string | 'view' | Value for debug view parameter |
| `debugHeaders` | string[] | [...] | Headers that enable debugging |
| `renderStaticHtml` | boolean | true | Render static HTML for debug views |
| `includeStackTrace` | boolean | false | Include stack traces in debug info |
| `maxContentLength` | number | 50000 | Maximum debug content length |
| `allowedIps` | string[] | [] | IPs allowed to see debug info |
| `excludedPaths` | string[] | [] | Paths excluded from debugging |

## Debug View

When enabled, the debug view provides a comprehensive HTML interface for analyzing video transformations:

1. **Performance Metrics**:
   - Processing time in milliseconds
   - Cache status indication
   - Device detection information

2. **Video Transformation Details**:
   - All applied parameters and their values
   - Source video information
   - Path pattern matching details
   - Transformation mode and settings

3. **Client Information**:
   - Device type detection (mobile, tablet, desktop)
   - Client hints support status
   - Network quality estimation
   - Browser video capabilities

4. **Interactive Features**:
   - Live preview of the transformed video
   - Expandable/collapsible JSON data
   - Copyable diagnostic information
   - Visual indicators for important settings

## Debug Headers

When header mode is enabled, the service adds detailed debug headers to the response:

- `X-Video-Resizer-Debug`: Indicates debug mode is enabled
- `X-Processing-Time-Ms`: Time taken to process the request
- `X-Transform-Source`: Source of the transformation
- `X-Device-Type`: Detected device type
- `X-Network-Quality`: Estimated network quality
- `X-Cache-Enabled`: Cache status
- `X-Cache-TTL`: Cache time-to-live

## Configuration Methods

- `getConfig()`: Get the entire debug configuration
- `isEnabled()`: Check if debugging is enabled
- `isVerbose()`: Check if verbose debugging is enabled
- `shouldIncludeHeaders()`: Check if headers should be included
- `shouldIncludePerformance()`: Check if performance metrics should be included
- `shouldEnableForRequest(request)`: Check if debug should be enabled for a request
- `isDebugViewRequested(request)`: Check if debug view is requested
- `addAllowedIp(ip)`: Add an allowed IP address
- `addExcludedPath(path)`: Add an excluded path

## Environment Variables

| Variable | Type | Description |
|----------|------|-------------|
| `DEBUG_ENABLED` | boolean | Enable debug mode |
| `DEBUG_VERBOSE` | boolean | Enable verbose debug output |
| `DEBUG_INCLUDE_HEADERS` | boolean | Include headers in debug info |
| `DEBUG_PERFORMANCE` | boolean | Include performance metrics |

## Example Usage

```typescript
import { DebugConfigurationManager } from './config';

const debugConfig = DebugConfigurationManager.getInstance();

// Check if debugging is enabled
if (debugConfig.isEnabled()) {
  console.log('Debug mode is enabled');
}

// Check if debug should be enabled for a specific request
const shouldEnableDebug = debugConfig.shouldEnableForRequest(request);
if (shouldEnableDebug) {
  // Enable debugging for this request
}

// Check if debug view was requested
const isDebugView = debugConfig.isDebugViewRequested(request);
if (isDebugView) {
  // Return debug view HTML instead of processed video
}
```

## Accessing the Debug Interface

Add `?debug=view` to any video URL to access the debug interface:
```
https://your-domain.com/videos/sample.mp4?width=720&height=480&debug=view
```

## Security Considerations

For production environments, it's recommended to:

1. Restrict debug access to specific IP addresses:
   ```typescript
   debugConfig.addAllowedIp('192.168.1.100');
   ```

2. Exclude sensitive paths from debugging:
   ```typescript
   debugConfig.addExcludedPath('^/admin/.*');
   ```

3. Disable stack traces in production:
   ```typescript
   debugConfig.setIncludeStackTrace(false);
   ```
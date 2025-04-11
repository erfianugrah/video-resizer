# Debug View Mode

The video-resizer service provides a powerful debug view mode that helps troubleshoot and understand how video transformation is working. This document explains how to use the debug view mode effectively.

## Activating Debug View

To activate debug view mode, add `?debug=view` to any URL processed by the video-resizer service:

```
https://example.com/videos/sample.mp4?width=640&height=360&debug=view
```

This will render a debug HTML page instead of serving the transformed video, showing detailed information about how the request is processed.

## Debug View Features

### Configuration Section

The debug view provides information about the active configuration:

- **Video Configuration**: Shows active video transformation settings
  - Default parameters
  - Derivatives
  - Path patterns
  - Active transformation parameters

- **Cache Configuration**: Shows active caching settings
  - TTL values
  - Cache strategies
  - KV cache configuration

- **Debug Configuration**: Shows active debugging settings
  - Debug modes enabled
  - Log levels
  - Debug header settings

### Request Processing

The debug view shows how the request is processed:

- **Original URL**: Shows the URL as received by the worker
- **Transformed URL**: Shows the CDN-CGI URL created for Cloudflare Media Transformation
- **Origin URL**: Shows the URL that would be sent to the origin server
- **Parameter Filtering**: Shows which parameters are filtered from the origin request

### Media Preview

For video transformations, the debug view provides:

- **Thumbnail Preview**: Shows what the transformed media will look like
- **Video Details**: Resolution, format, duration, and other metadata
- **Transformation Applied**: Shows which transformations are being applied

### Performance Metrics

The debug view includes performance information:

- **Processing Time**: Time taken to process the request
- **Component Timing**: Breakdown of time spent in different components
- **Cache Status**: Whether the request hit cache, and which cache level

### Validation Results

If there are validation issues, the debug view will show:

- **Validation Errors**: Any parameter validation errors
- **Parameter Compatibility Issues**: Incompatible parameter combinations
- **Warnings**: Potential issues that don't prevent processing

## Parameter Preservation

When using `debug=view`, the `debug` parameter is preserved through the URL transformation process. This is a special case in the parameter filtering system to ensure the debug view works correctly.

## URL Processing for Debug View

When a request with `debug=view` is received:

1. The service detects the debug parameter
2. The request is processed normally up to the response generation
3. Instead of returning the transformed video, the debug UI HTML is returned
4. The HTML includes embedded diagnostic information
5. The debug UI renders this information in a user-friendly format

## Implementation Details

The debug view mode is implemented in the `debugService.ts` and `debugHeadersUtils.ts` files. The HTML interface is provided by the `/debug-ui` directory, which includes:

- React components for displaying diagnostic information
- Tailwind CSS for styling
- Client-side JavaScript for interactive features

## Configuration

Debug view behavior is controlled by the `debug` section in `worker-config.json`:

```json
"debug": {
  "enabled": true,
  "verbose": false,
  "includeHeaders": true,
  "includePerformance": true,
  "dashboardMode": true,
  "viewMode": true,
  "headerMode": true,
  "debugQueryParam": "debug",
  "debugViewParam": "view",
  "preserveDebugParams": false
}
```

- `enabled`: Master switch for all debug features
- `viewMode`: Enables/disables the debug view mode
- `debugQueryParam`: The query parameter that triggers debug mode
- `debugViewParam`: The value that triggers view mode
- `preserveDebugParams`: Controls whether debug parameters are preserved in origin requests

## Security Considerations

The debug view exposes detailed information about your configuration and request processing. Consider these security recommendations:

1. **Disable in Production**: Set `debug.enabled: false` in production environments
2. **IP Restrictions**: Use `debug.allowedIps` to restrict access to specific IPs
3. **Path Exclusions**: Use `debug.excludedPaths` to prevent debug on sensitive paths

## Troubleshooting Debug View

If debug view isn't working:

1. **Check Configuration**: Ensure `debug.enabled` and `debug.viewMode` are `true`
2. **Check Parameters**: Ensure you're using the correct `debugQueryParam` and `debugViewParam`
3. **Check Assets**: Ensure the debug UI assets are properly deployed
4. **Check Console**: Look for errors in browser console or worker logs

## Use Cases for Debug View

The debug view is particularly useful for:

1. **Development and Testing**: Understanding how URLs are transformed
2. **Configuration Validation**: Verifying configuration is applied correctly
3. **Performance Analysis**: Identifying bottlenecks in the transformation process
4. **Integration Testing**: Verifying correct integration with origin servers
5. **Troubleshooting Errors**: Diagnosing issues with video transformation
# Debug Headers System

The video-resizer project includes a comprehensive debug headers system to help with troubleshooting and performance analysis. This document explains how the debug headers system works and how to use it effectively.

## Overview

The debug headers system allows you to inspect the internal workings of the video-resizer by adding special debug headers to HTTP responses. These headers provide information about:

- Processing times
- Cache configuration
- Video transformation parameters
- Client device detection
- Network quality estimations
- Performance metrics
- Error information
- System breadcrumbs (sequence of operations)

## Enabling Debug Headers

Debug headers can be enabled in several ways:

1. **URL Parameter**: Add `?debug=true` to any video URL
2. **Verbose Mode**: Add `?debug=verbose` for more detailed headers
3. **Configuration**: Set `DEBUG_ENABLED: "true"` in wrangler.jsonc
4. **Per-Environment**: Configure different debug settings for dev/staging/prod

## Standard Debug Headers

When debug is enabled, you'll see the following standard headers:

| Header | Description | Example |
|--------|-------------|---------|
| `X-Video-Resizer-Debug` | Indicates debug mode is active | `true` |
| `X-Video-Resizer-Version` | Version of the video-resizer | `1.0.0` |
| `X-Processing-Time-Ms` | Total processing time in milliseconds | `42` |
| `X-Request-ID` | Unique identifier for the request | `abc123` |
| `X-Transform-Source` | Source of transformation | `cdn-cgi` |
| `X-Device-Type` | Detected client device type | `mobile` |
| `X-Network-Quality` | Estimated network quality | `high` |
| `X-Path-Match` | Matched path pattern name | `videos` |

## Cache-Related Headers

The system provides detailed information about caching:

| Header | Description | Example |
|--------|-------------|---------|
| `X-Cache-Enabled` | Whether caching is enabled | `true` |
| `X-Cache-TTL` | Cache TTL in seconds | `3600` |
| `X-Cache-Method` | Which caching method is used | `cf-object` |
| `X-Cache-Tags` | Cache tags used for purging | `video-path-sample-mp4,video-quality-high` |

## Verbose Debug Headers

When using `?debug=verbose`, additional headers are included:

| Header | Description | Example |
|--------|-------------|---------|
| `X-Transform-Params` | JSON of transformation parameters | `{"width":640,"height":360,...}` |
| `X-Browser-Capabilities` | Browser video capabilities | `{"webpSupport":true,"h264Support":true}` |
| `X-Debug-Errors` | Any errors that occurred | `["Invalid width parameter"]` |
| `X-Debug-Warnings` | Non-fatal warnings | `["Falling back to default quality"]` |
| `X-Responsive-Width` | Width used for responsive sizing | `640` |
| `X-Breadcrumbs` | System operation sequence | `[{"category":"Transform",...}]` |

## Performance Headers

For performance analysis, the system provides:

| Header | Description | Example |
|--------|-------------|---------|
| `X-Total-Duration-Ms` | Total request duration | `185.42` |
| `X-Component-Timing` | JSON with timing breakdown | `{"Transform":85.2,"Cache":22.6}` |
| `X-Component-1-Time` | Top time-consuming component | `Transform=85.2ms` |
| `X-Breadcrumbs-Count` | Number of operations tracked | `24` |

## Using Debug Headers for Troubleshooting

Common troubleshooting patterns:

1. **Performance Issues**:
   - Check `X-Processing-Time-Ms` and `X-Total-Duration-Ms`
   - Look at `X-Component-Timing` to identify slow components
   - Examine breadcrumbs for bottlenecks

2. **Cache Problems**:
   - Check `X-Cache-Enabled` and `X-Cache-Method`
   - Verify `X-Cache-TTL` is expected value
   - Examine `X-Cache-Tags` for purging options

3. **Transformation Errors**:
   - Look for `X-Debug-Errors` and `X-Debug-Warnings`
   - Check `X-Transform-Params` for actual parameters
   - Verify `X-Transform-Source` is correct

4. **Client Detection Issues**:
   - Verify `X-Device-Type` is correct
   - Check `X-Network-Quality` for adaptive quality
   - Look at `X-Browser-Capabilities` for format selection

## Debug HTML Report

For a more comprehensive debug view, use `?debug=view` instead of `?debug=true`. This will return an HTML debug report instead of the video, displaying all diagnostic information in a structured format.

## Implementation Details

### Unified Debug Headers System

As of April 2025, the debug headers system has been consolidated:

- All debug header functionality is in `src/utils/debugHeadersUtils.ts`
- `src/services/debugService.ts` now acts as a compatibility layer
- Helper functions handle chunking large data into multiple headers
- The system works consistently across all code paths

### Key Functions

The main functions in the debug system:

```typescript
// Add debug headers to a response
export function addDebugHeaders(
  response: Response,
  debugInfo: DebugInfo,
  diagnosticsInfo: DiagnosticsInfo
): Response;

// Create a full debug HTML report
export async function createDebugReport(
  diagnosticsInfo: DiagnosticsInfo,
  env?: { ASSETS?: { fetch: (request: Request) => Promise<Response> }},
  isError: boolean = false
): Promise<Response>;

// Extract request headers for debugging
export function extractRequestHeaders(request: Request): Record<string, string>;
```

### Integration in Response Flow

The debug headers are integrated at the end of the request processing flow:

1. Request is received and processed
2. Response is generated (video transformation, etc.)
3. Cache headers are applied
4. Debug headers are added if debug mode is enabled
5. Response is returned to the client

For detailed implementation, see `src/utils/debugHeadersUtils.ts`.

## Best Practices

1. **Use Verbose Mode Sparingly**: Verbose mode adds many headers which can impact performance
2. **Enable Debug in Development**: Set `DEBUG_ENABLED: "true"` in development
3. **Use Debug View**: Use `?debug=view` for complex troubleshooting
4. **Check Breadcrumbs**: Breadcrumbs provide the full history of request processing
5. **Share Debug IDs**: When reporting issues, include the `X-Request-ID` value
# Transformation Error Handling

*Last Updated: May 15, 2025*

## Overview

The transformation error handling system provides a sophisticated fallback mechanism when Cloudflare's transformation service encounters errors. It ensures resilient video delivery through a consolidated approach that leverages the Origins system.

## Key Components

1. **Error Detection**: Identifies specific types of transformation failures
2. **404 Retry Mechanism**: Uses `retryWithAlternativeOrigins` for 404 errors from cdn-cgi/media
3. **Origins System Failover**: Leverages the built-in multi-source failover in the Origins system
4. **Simplified Error Handler**: Handles non-404 errors with appropriate responses

## Error Types

The system handles several types of transformation errors:

1. **File Size Errors**: Videos exceeding the 256MiB transformation limit
2. **Duration Errors**: Videos that exceed duration limits
3. **Server Errors**: 5xx responses from the transformation service
4. **Client Errors**: 4xx responses from the transformation service
5. **Not Found Errors**: 404 responses from the transformation service

### CDN-CGI/Media Proxy Error Handling

When the Cloudflare transformation service (`cdn-cgi/media` proxy) returns an error response, including 404 Not Found, the system automatically triggers the multi-origin fallback mechanism. This ensures that even if the transformation service cannot process or locate the video, the system will attempt to deliver the content through alternative means.

#### Specific 404 Behavior

When a 404 error is returned from the `cdn-cgi/media` proxy endpoint:

1. **Error Detection**: `TransformVideoCommand` identifies the 404 response from the transformation service
2. **Retry Initiation**: Calls `retryWithAlternativeOrigins` instead of the error handler
3. **Source Exclusion**: Excludes the failed source that returned 404
4. **Multi-Origin Retry**: Uses `fetchVideoWithOrigins` to try remaining sources across all matching origins
5. **Transformation**: If an alternative source is found, transforms it and returns the result

This consolidated approach ensures that 404 handling is managed upstream, keeping the error handler focused on non-404 errors.

### Transformation Service vs Origin Errors

It's important to distinguish between two types of errors in the system:

1. **Transformation Service Errors**: Errors returned by Cloudflare's `cdn-cgi/media` proxy
   - These occur when the transformation service itself encounters issues
   - Examples: 404 (source not found), 413 (file too large), 415 (unsupported format)
   - **Always trigger the multi-origin fallback mechanism**

2. **Origin Server Errors**: Errors from the actual storage sources (R2, remote URLs, etc.)
   - These occur when fetching content directly from origins
   - Examples: 404 (object not found in R2), 403 (access denied), 500 (origin server error)
   - **Trigger failover to the next configured source within the Origins system**

The key difference is that transformation service errors trigger the entire fallback chain (pattern origins → direct fetch → storage service), while origin errors only trigger trying the next source within the current origin configuration.

## Consolidated Failover Architecture

The system now uses a single, consolidated approach for handling transformation failures:

### For 404 Errors (Not Found)

1. **Detected in TransformVideoCommand**: 404s from cdn-cgi/media are caught immediately
2. **Handled by retryWithAlternativeOrigins**: A dedicated function manages the retry logic
3. **Uses Origins System**: Leverages `fetchVideoWithOrigins` with source exclusions
4. **Transforms Alternative Source**: If found, transforms the content from the alternative source

### For Other Errors (5xx, 413, etc.)

1. **Handled by handleTransformationError**: Simplified to focus on non-404 errors
2. **Duration Limit Retries**: Still handles duration adjustment for specific errors
3. **File Size Errors**: Returns appropriate headers for 256MiB limit errors
4. **Server Errors**: Returns error responses with retry headers

## Implementation

### 404 Retry with Alternative Origins

```typescript
// In TransformVideoCommand.executeWithOrigins()
if (response.status === 404) {
  const { retryWithAlternativeOrigins } = await import(
    '../../services/transformation/retryWithAlternativeOrigins'
  );
  
  return await retryWithAlternativeOrigins({
    originalRequest: request,
    transformOptions: options,
    failedOrigin: origin,
    failedSource: sourceResolution.source,
    context: this.context,
    env: env,
    requestContext: this.requestContext,
    pathPatterns: this.context.pathPatterns,
    debugInfo: this.context.debugInfo
  });
}
```

### Enhanced fetchVideoWithOrigins

```typescript
// Support for source exclusions
export interface FetchOptions {
  excludeSources?: Array<{
    originName: string;
    sourceType: string;
    sourcePriority?: number;
  }>;
}

// Multi-origin retry implementation
for (const { origin, match: originMatch } of matchingOrigins) {
  // Apply source exclusions
  let sources = [...origin.sources].sort((a, b) => a.priority - b.priority);
  
  if (options?.excludeSources) {
    sources = sources.filter(source => {
      return !options.excludeSources!.some(excluded => 
        excluded.originName === origin.name &&
        excluded.sourceType === source.type
      );
    });
  }
  
  // Try each source in the origin
  for (const source of sources) {
    const result = await fetchFromSource(source);
    if (result) return result;
  }
}
```

### Background Caching

The system still initiates background caching for fallback content in `handleTransformationError` for non-404 errors:

```typescript
// Store fallback video in KV cache in the background (for 5xx and 413 errors)
if (fallbackResponse.body) {
  const responseForCaching = fallbackResponse.clone();
  await initiateBackgroundCaching(context.env, path, responseForCaching, requestContext, {
    isLargeVideo: is256MiBSizeError
  });
}
```

## Failover Triggers

The system has specific triggers that initiate different types of failover:

### Transformation Service Failover Triggers

These errors from the `cdn-cgi/media` proxy trigger the complete multi-origin fallback:

| Error Type | Status Code | Trigger Condition | Fallback Action |
|------------|-------------|-------------------|-----------------|
| Not Found | 404 | Source video not found by transformation service | Handled by retryWithAlternativeOrigins → Multi-origin retry with source exclusion |
| Bad Request | 400 | Invalid transformation parameters | Multi-origin fallback with original parameters |
| Payload Too Large | 413 | Video exceeds 256MiB limit | Direct fetch with range support (bypasses transformation) |
| Unsupported Media | 415 | Format not supported for transformation | Multi-origin fallback for original file |
| Rate Limited | 429 | Too many transformation requests | Multi-origin fallback with exponential backoff |
| Server Error | 5xx | Transformation service internal error | Multi-origin fallback with immediate retry |

### Origin Storage Failover Triggers

These errors from origin sources trigger failover to the next source:

| Error Type | Trigger Condition | Failover Action |
|------------|-------------------|-----------------|
| R2 Not Found | Object doesn't exist in R2 bucket | Try next source (remote/fallback) |
| Remote 404 | Remote URL returns 404 | Try next source in priority order |
| Auth Failure | Authentication fails (non-permissive mode) | Skip to next source |
| Network Error | Connection timeout or DNS failure | Try next source with retry |

### Special Case: Range Requests

When a range request encounters an error:
1. If transformation fails with range headers → Fallback attempts preserve range headers
2. If origin doesn't support ranges → System returns full content with adjusted headers

## Diagnostic Headers

When a fallback is applied, the system adds diagnostic headers:

| Header | Description |
|--------|-------------|
| `X-Fallback-Applied` | Set to "true" when any fallback is applied |
| `X-Pattern-Fallback-Applied` | Set to "true" when a pattern-specific fallback is used |
| `X-Pattern-Name` | The name of the pattern that provided the content |
| `X-Pattern-Fallback-Index` | Which pattern in the sequence was successful (1-based) |
| `X-Pattern-Fallback-Total` | Total number of matching patterns that were considered |
| `X-Fallback-Reason` | Reason for the fallback (e.g., file size limit, transformation error) |

## Special Cases

### Large File Handling (>256MiB)

For files exceeding the 256MiB transformation limit:
1. Direct fetch with range request support
2. Background chunking for KV storage
3. Special headers to indicate the file size issue

### Duration Limit Retries

For duration limit errors:
1. Extract the maximum allowed duration from the error message
2. Retry with adjusted duration parameter
3. Store the limit for future use

## Error Isolation

The system implements thorough error isolation:
1. Pattern-specific fetch errors don't prevent trying other patterns
2. Background storage errors don't affect the user response
3. Detailed error logging for troubleshooting

## Example Error Flows

### Example 1: CDN-CGI/Media Returns 404

```
Request: GET /transform/video.mp4?width=1920
         ↓
[1] Transform via cdn-cgi/media
    → Returns 404 (video not found)
         ↓
[2] retryWithAlternativeOrigins triggered
         ↓
[3] Exclude failed source from origin
    → Origin "videos" had source that returned 404
         ↓
[4] fetchVideoWithOrigins with exclusions
    → Try remaining sources in "videos" origin
    → If all fail, try other matching origins
    → Success: Found in alternative source
         ↓
[5] Transform the alternative source
    → Return transformed video
```

### Example 2: Multiple Origin Failures

```
Request: GET /content/movie.mp4
         ↓
[1] Transform via cdn-cgi/media
    → Returns 404
         ↓
[2] retryWithAlternativeOrigins triggered
         ↓
[3] fetchVideoWithOrigins called
    → Exclude source that caused 404
         ↓
[4] Try remaining sources in order:
    → Origin 1 Source 2 (Remote): Not found
    → Origin 1 Source 3 (Fallback): Not found
    → Origin 2 Source 1 (R2): Success!
         ↓
[5] Transform alternative source
         ↓
[6] Return transformed response
```

### Example 3: Complete Fallback Chain

```
Request: GET /archive/old-video.mp4
         ↓
[1] Transform via cdn-cgi/media
    → Returns 404
         ↓
[2] retryWithAlternativeOrigins
    → No alternative sources found
         ↓
[3] Return 404 error response
    → "Video not found in any configured origin"
         ↓
[4] Headers indicate all origins failed:
    X-All-Origins-Failed: true
    X-Error-Type: not_found
```

## Related Documentation

- [Error Types](./error-types.md) - Types of errors in the system
- [Implementation](./implementation.md) - General error handling implementation
- [Multi-Origin Fallback](../architecture/multi-origin-fallback.md) - Details of the origin fallback architecture
- [Background Fallback Caching](../features/background-fallback-caching.md) - How fallback content is cached
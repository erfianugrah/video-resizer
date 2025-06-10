# Multi-Origin Fallback

*Last Updated: May 15, 2025*

## Overview

Multi-Origin Fallback has been consolidated and enhanced in the video-resizer through two key mechanisms:

1. **404 Handling**: When cdn-cgi/media returns 404, the `retryWithAlternativeOrigins` function excludes the failed source and retries with remaining sources across all matching origins
2. **Origins System Enhancement**: The `fetchVideoWithOrigins` function now supports source exclusions and multi-origin retry, making it the single source of truth for failover logic

## Key Benefits

1. **Improved Resilience**: Instead of failing after the first origin returns a 404, the system tries other origins that might have the content
2. **Graceful Degradation**: Multiple tiers of fallback ensure the system provides the best available video in all cases
3. **Prioritized Matching**: Origins are tried in priority order (best match first) for optimal performance
4. **Enhanced Diagnostics**: Detailed headers and logs provide insight into which origins were attempted and which one succeeded

## How It Works

The consolidated multi-origin fallback now works through a cleaner architecture:

### For 404 Errors from CDN-CGI/Media:

1. **TransformVideoCommand Detection**: When cdn-cgi/media returns 404, it's caught in `executeWithOrigins()`
2. **retryWithAlternativeOrigins Called**: Instead of error handler, a dedicated retry function is invoked
3. **Source Exclusion**: The failed source is excluded from further attempts
4. **Multi-Origin Retry**: `fetchVideoWithOrigins` is called with exclusions, trying:
   - Remaining sources in the same origin
   - All sources in other matching origins
5. **Transformation**: If an alternative source is found, it's transformed and returned

### For Origin Failures:

1. **Built into fetchVideoWithOrigins**: The function now tries all matching origins
2. **Sequential Source Testing**: Within each origin, sources are tried by priority
3. **Automatic Failover**: If one source fails, the next is attempted automatically

### Fallback Priority Order

The consolidated mechanism follows this simplified priority order:

1. **For 404s from transformation**: Use retryWithAlternativeOrigins to try remaining sources
2. **Within Origins system**: Sources are tried in priority order within each matching origin
3. **Across Origins**: All matching origins are tried in the order they appear in configuration
4. **Final Response**: If all sources fail, a 404 error is returned

## Implementation Details

### Source Exclusion in fetchVideoWithOrigins

```typescript
export interface FetchOptions {
  excludeSources?: Array<{
    originName: string;
    sourceType: string;
    sourcePriority?: number;
  }>;
}

// Apply exclusions when processing sources
if (options?.excludeSources && options.excludeSources.length > 0) {
  sources = sources.filter(source => {
    return !options.excludeSources!.some(excluded => 
      excluded.originName === origin.name &&
      excluded.sourceType === source.type
    );
  });
}
```

### Retry Function for 404s

```typescript
export async function retryWithAlternativeOrigins(options: RetryOptions): Promise<Response> {
  // 1. Create exclusion for the failed source
  const excludeSources = [{
    originName: failedOrigin.name,
    sourceType: failedSource.type,
    sourcePriority: failedSource.priority
  }];
  
  // 2. Try to fetch from alternative sources
  const storageResult = await fetchVideoWithOrigins(
    path,
    videoConfig,
    env,
    originalRequest,
    { excludeSources }
  );
  
  // 3. If successful, transform the result
  if (storageResult.sourceType !== 'error') {
    // Transform and return the alternative source
  }
}
```

### Enhanced Diagnostics

The consolidated system provides clear diagnostics through:

1. **Logging in fetchVideoWithOrigins**: Shows which origins and sources were tried
2. **Request Context Breadcrumbs**: Tracks the full retry path
3. **Response Headers**: Indicate when alternative sources were used

```typescript
// Logging example from fetchVideoWithOrigins
logDebug('VideoStorageService', 'Applied source exclusions', {
  originName: origin.name,
  originalSourceCount: originalCount,
  filteredSourceCount: sources.length,
  excludedSources: options.excludeSources.map(e => `${e.originName}:${e.sourceType}`)
});
```

## Fallback Scenarios

The implementation handles different scenarios for fallback:

### 1. File Size Error (>256MiB)

When a video is too large for Cloudflare's transformation service:
- The system directly fetches from the origin
- The response is streamed to the client with appropriate headers
- Content is stored in KV cache in the background
- Headers indicate this was a file size fallback: `X-Video-Exceeds-256MiB: true`

### 2. 404 From CDN-CGI/Media

When the transformation proxy returns a 404 error:
- `retryWithAlternativeOrigins` is triggered immediately
- The failed source is excluded from retry attempts
- All remaining sources across matching origins are tried
- If an alternative is found, it's transformed and returned
- If all alternatives fail, a 404 error response is returned

### 3. Other Origin Errors

For other errors from an origin (5xx, network errors, etc.):
- The system tries the next matching origin in sequence
- Continues through all fallback mechanisms as with 404 errors
- Logs detailed diagnostic information about the error

## Configuration Example

The system works with existing Origins configuration format, but now benefits from trying multiple matching origins. Example configuration with overlapping matchers:

```json
{
  "origins": [
    {
      "name": "premium-videos",
      "matcher": "^/videos/premium/(.*)",
      "captureGroups": ["videoId"],
      "sources": [
        {
          "type": "r2",
          "priority": 1,
          "path": "premium/${videoId}"
        },
        {
          "type": "remote",
          "priority": 2,
          "url": "https://premium-origin.example.com",
          "path": "${videoId}"
        }
      ]
    },
    {
      "name": "standard-videos",
      "matcher": "^/videos/(.*)",
      "captureGroups": ["videoId"],
      "sources": [
        {
          "type": "r2",
          "priority": 1,
          "path": "standard/${videoId}"
        },
        {
          "type": "remote",
          "priority": 2,
          "url": "https://standard-origin.example.com",
          "path": "${videoId}"
        }
      ]
    }
  ]
}
```

With this configuration:
- A request for `/videos/premium/123.mp4` would first try the "premium-videos" origin
- If that fails, it would try the "standard-videos" origin since the pattern also matches
- If both origin fetches fail, it would fall back to direct fetch and then storage service

## Diagnostic Headers

The following headers provide insight into the multi-origin fallback process:

| Header | Description |
|--------|-------------|
| `X-Fallback-Applied` | Set to "true" when any fallback is applied |
| `X-Pattern-Fallback-Applied` | Set to "true" when a pattern-specific fallback is used |
| `X-Pattern-Name` | The name of the pattern that provided the content |
| `X-Pattern-Fallback-Index` | Which pattern in the sequence was successful (1-based) |
| `X-Pattern-Fallback-Total` | Total number of matching patterns that were considered |
| `X-Pattern-Auth-Type` | Authentication type used with the successful pattern |
| `X-Pattern-Origin-Domain` | Domain of the origin used (for security, only domain is exposed) |
| `X-Fallback-Reason` | Reason for the fallback (e.g., file size limit, transformation error) |
| `X-Original-Error-Status` | HTTP status from the original error response |
| `X-Original-Error-Type` | Error type from the original error |

## Best Practices

1. **Pattern Design**: Design patterns with appropriate specificity to enable effective fallback
2. **Overlapping Patterns**: Use intentionally overlapping patterns to create fallback paths
3. **Priority Setting**: Configure source priorities correctly within each origin
4. **Authentication**: Ensure each pattern has proper authentication configuration
5. **Monitoring**: Watch for fallback-related headers in responses to understand fallback behavior

## Error Handling

The consolidated implementation provides cleaner error handling:

1. **404 Separation**: 404 errors from cdn-cgi/media are handled upstream by `retryWithAlternativeOrigins`
2. **Other Errors**: 5xx, 413, and other errors are handled by the simplified `handleTransformationError`
3. **Source-Level Failures**: Individual source failures within an origin don't prevent trying other sources
4. **Clear Error Responses**: When all attempts fail, appropriate error responses are returned with diagnostic headers

## Testing and Verification

The consolidated multi-origin fallback can be tested by:

1. Configuring multiple origins with overlapping matchers
2. Testing 404 responses from cdn-cgi/media to verify `retryWithAlternativeOrigins` works
3. Testing source failures within origins to verify automatic failover
4. Using the test suite: `npm test -- test/integration/404-failover-simple.spec.ts`
5. Examining logs to trace the full retry path

## Related Features

- [Origins System](./origins-system.md) - Core origins configuration architecture
- [Background Fallback Caching](../features/background-fallback-caching.md) - Background caching for fallback content
- [Large Fallback Chunking](../features/large-fallback-chunking.md) - Handling large files that exceed transformation limits
- [Transformation Error Handling](../error-handling/transformation-error-handling.md) - Detailed error handling implementation
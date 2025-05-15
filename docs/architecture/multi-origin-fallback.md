# Multi-Origin Fallback

*Last Updated: May 15, 2025*

## Overview

Multi-Origin Fallback enhances the video-resizer's error handling capabilities by adding support for trying multiple matching origins when one returns a 404 or error. This feature improves resilience by providing a more comprehensive fallback strategy when dealing with transformation errors or missing content.

## Key Benefits

1. **Improved Resilience**: Instead of failing after the first origin returns a 404, the system tries other origins that might have the content
2. **Graceful Degradation**: Multiple tiers of fallback ensure the system provides the best available video in all cases
3. **Prioritized Matching**: Origins are tried in priority order (best match first) for optimal performance
4. **Enhanced Diagnostics**: Detailed headers and logs provide insight into which origins were attempted and which one succeeded

## How It Works

The multi-origin fallback implementation uses a structured approach to try multiple fallback sources when a transformation fails:

1. **Find All Matching Patterns**: When transformation fails, the error handler identifies all matching patterns for the requested path, not just the first one
2. **Try Each Pattern in Sequence**: For each pattern with an origin URL and authentication, the system:
   - Attempts to fetch from the origin with appropriate authentication
   - If successful, returns the content and stores it in KV cache in the background
   - If unsuccessful (404 or error), tries the next matching pattern
3. **Direct Fetch Fallback**: If all pattern-specific fetches fail, fall back to direct fetch from the source URL
4. **Storage Service Fallback**: As a last resort, attempt to fetch from the storage service

### Fallback Priority Order

The fallback mechanism follows this precise priority order:

1. All matching patterns with origins and auth, tried in sequence from best match to least specific match
2. Direct fetch from fallbackOriginUrl or source
3. Storage service as a final fallback

## Implementation Details

### Pattern Collection

The implementation first collects all matching patterns:

```typescript
// First find the primary matching pattern as before
const primaryPattern = findMatchingPathPattern(path, context.pathPatterns ?? []);

if (primaryPattern) {
  matchedPatterns.push(primaryPattern);
  
  // Then find additional patterns that also match but weren't the first match
  // This preserves the priority ordering of the original logic
  for (const pattern of context.pathPatterns ?? []) {
    if (pattern.name !== primaryPattern.name) {
      try {
        const regex = new RegExp(pattern.matcher);
        if (regex.test(path)) {
          matchedPatterns.push(pattern);
        }
      } catch (err) {
        // Skip invalid patterns
      }
    }
  }
}
```

### Sequential Pattern Testing

Each pattern is tried in sequence until one succeeds:

```typescript
// Try each pattern in sequence until one succeeds
for (let i = 0; i < matchedPatterns.length; i++) {
  const matchedPattern = matchedPatterns[i];
  
  // Attempt fetch with this pattern...
  if (fallbackResponse && fallbackResponse.ok) {
    // Success! Return this response
    return finalResponse;
  } else if (fallbackResponse) {
    // Non-OK response, reset and try next pattern
    fallbackResponse = undefined;
  }
}
```

### Enhanced Diagnostics

When a fallback succeeds, the system adds detailed diagnostic headers:

```typescript
// Add multi-pattern debugging information
if (matchedPatterns.length > 1) {
  headers.set('X-Pattern-Fallback-Index', `${i + 1}`);
  headers.set('X-Pattern-Fallback-Total', `${matchedPatterns.length}`);
}
```

## Fallback Scenarios

The implementation handles different scenarios for fallback:

### 1. File Size Error (>256MiB)

When a video is too large for Cloudflare's transformation service:
- The system directly fetches from the origin
- The response is streamed to the client with appropriate headers
- Content is stored in KV cache in the background
- Headers indicate this was a file size fallback: `X-Video-Exceeds-256MiB: true`

### 2. 404 From Origin

When an origin returns a 404 error:
- The system tries the next matching origin in sequence
- If all origins return 404, falls back to direct fetch
- If direct fetch fails, tries the storage service
- Headers indicate which origin was successfully used

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

The implementation includes comprehensive error handling:

1. **Pattern-specific errors**: Errors during pattern-specific fetches are logged and the system continues to the next pattern
2. **Auth failures**: Authentication errors for a specific pattern don't prevent trying other patterns
3. **Comprehensive logging**: Detailed logs show which patterns were tried and why they failed
4. **Graceful degradation**: Even if all patterns fail, the system still attempts direct fetch and storage service fallback

## Testing and Verification

The multi-origin fallback feature can be tested by:

1. Configuring multiple origin patterns that match the same paths
2. Intentionally causing a 404 on the primary origin
3. Verifying that the system correctly fetches from secondary matching origins
4. Examining response headers to confirm which pattern was used

## Related Features

- [Origins System](./origins-system.md) - Core origins configuration architecture
- [Background Fallback Caching](../features/background-fallback-caching.md) - Background caching for fallback content
- [Large Fallback Chunking](../features/large-fallback-chunking.md) - Handling large files that exceed transformation limits
- [Transformation Error Handling](../error-handling/transformation-error-handling.md) - Detailed error handling implementation
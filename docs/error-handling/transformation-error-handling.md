# Transformation Error Handling

*Last Updated: May 15, 2025*

## Overview

The transformation error handling system provides a sophisticated fallback mechanism when Cloudflare's transformation service encounters errors. It ensures resilient video delivery through a multi-tiered approach to error recovery.

## Key Components

1. **Error Detection**: Identifies specific types of transformation failures
2. **Pattern-Based Fallbacks**: Attempts to fetch from pattern-matched origins in sequence
3. **Direct Fetch Fallback**: Falls back to the original source if pattern-based fetches fail
4. **Storage Service Fallback**: Uses the storage service as a final resort

## Error Types

The system handles several types of transformation errors:

1. **File Size Errors**: Videos exceeding the 256MiB transformation limit
2. **Duration Errors**: Videos that exceed duration limits
3. **Server Errors**: 5xx responses from the transformation service
4. **Client Errors**: 4xx responses from the transformation service

## Multi-Origin Fallback

When transformation fails, the system now implements a more resilient fallback strategy:

1. **Find All Matching Patterns**: Identifies all patterns that match the requested path
2. **Try Each Pattern in Sequence**: Attempts to fetch from each matching origin with auth
3. **Direct Fetch**: If all pattern fetches fail, attempts a direct fetch from the source URL
4. **Storage Service**: Falls back to the storage service as a last resort

This enhanced approach ensures maximum resilience by trying all possible sources before giving up.

## Implementation

### Matching Multiple Patterns

```typescript
// Find all matching patterns for the request path
const matchedPatterns = [];

// First find the primary matching pattern
const primaryPattern = findMatchingPathPattern(path, context.pathPatterns ?? []);
if (primaryPattern) {
  matchedPatterns.push(primaryPattern);
  
  // Then find additional patterns that also match but weren't the first match
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

```typescript
// Try each pattern in sequence until one succeeds
for (let i = 0; i < matchedPatterns.length; i++) {
  const matchedPattern = matchedPatterns[i];
  
  // Attempt fetch with this pattern
  try {
    // [Authentication and fetch logic]
    
    // Check if the pattern-specific fetch succeeded
    if (fallbackResponse && fallbackResponse.ok) {
      return finalResponse;
    } else if (fallbackResponse) {
      // Reset and try next pattern
      fallbackResponse = undefined;
    }
  } catch (patternFetchError) {
    // Continue to next pattern
  }
}
```

### Background Caching

The system initiates background caching for fallback content:

```typescript
// Store pattern-specific fallback video in KV cache in the background
if (fallbackResponse.body) {
  await initiateBackgroundCaching(context.env, path, fallbackResponse, requestContext, {
    pattern: matchedPattern?.name
  });
}
```

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

## Related Documentation

- [Error Types](./error-types.md) - Types of errors in the system
- [Implementation](./implementation.md) - General error handling implementation
- [Multi-Origin Fallback](../architecture/multi-origin-fallback.md) - Details of the origin fallback architecture
- [Background Fallback Caching](../features/background-fallback-caching.md) - How fallback content is cached
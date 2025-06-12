# 404 Retry Mechanism

## Overview

The 404 retry mechanism handles "not found" errors from Cloudflare's cdn-cgi/media transformation proxy. When the transformation service returns a 404, the system automatically attempts to find the video from alternative sources.

## Key Components

### retryWithAlternativeOrigins Function

Located in `src/services/transformation/retryWithAlternativeOrigins.ts`, this function:

1. **Finds next available source**: Filters out the failed source and selects the next by priority
2. **Builds alternative origin URL**: Constructs the URL for the alternative source
3. **Creates new CDN-CGI request**: Preserves all original transformation parameters
4. **Attempts single retry**: Makes one attempt with the alternative source
5. **Stores successful responses**: Saves to KV cache if the retry succeeds

### Key Features

- **Comprehensive logging**: Debug logs and breadcrumbs track each retry step
- **Error handling**: Detailed error responses indicate what failed
- **Header information**: Response headers indicate retry status and sources used
- **KV cache integration**: Successful retries are cached for future requests

## How It Works

```
CDN-CGI/Media returns 404
         ↓
TransformVideoCommand detects 404 status
         ↓
Calls retryWithAlternativeOrigins()
         ↓
Finds next source by priority
         ↓
Builds alternative origin URL
         ↓
Creates new CDN-CGI request with all parameters
         ↓
Attempts fetch from alternative source
         ↓
If successful: Cache and return response
If failed: Return error with retry headers
```

## Implementation Example

```typescript
// In TransformVideoCommand
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

## Benefits

1. **Clean Separation**: 404 handling is separate from other error types
2. **Single Responsibility**: Each component has a clear, focused purpose
3. **Leverages Origins**: Uses the existing Origins system instead of duplicating logic
4. **Better Performance**: Avoids unnecessary retries of failed sources
5. **Improved Diagnostics**: Clear logging of what was tried and why

## Configuration

No special configuration is required. The mechanism works automatically with your existing Origins configuration:

```json
{
  "origins": [
    {
      "name": "primary",
      "matcher": "^/videos/(.*)",
      "sources": [
        {
          "type": "r2",
          "priority": 1,
          "path": "videos/${1}"
        },
        {
          "type": "remote",
          "priority": 2,
          "url": "https://backup.example.com",
          "path": "/${1}"
        }
      ]
    }
  ]
}
```

If R2 returns 404 through the transformation proxy, the system will automatically try the remote source.

## Logging and Diagnostics

The retry mechanism provides detailed logging:

```
TransformVideoCommand: Transformation proxy returned 404, attempting retry with alternative origins
retryWithAlternativeOrigins: Starting retry for path: /videos/example.mp4
retryWithAlternativeOrigins: Excluding source: r2 from origin: primary
VideoStorageService: Applied source exclusions (originalCount: 2, filtered: 1)
VideoStorageService: Trying remote source for origin: primary
VideoStorageService: Successfully found video in alternative source
retryWithAlternativeOrigins: Successfully found and transformed alternative source
```

## Error Responses

When all retry attempts fail:

```json
{
  "error": "not_found",
  "message": "Video not found in any configured origin",
  "statusCode": 404,
  "details": {
    "path": "/videos/example.mp4",
    "triedOrigins": ["primary", "secondary"],
    "excludedSources": ["primary:r2"]
  }
}
```

## Testing

Test the 404 retry mechanism:

```bash
# Run the specific test
npm test -- test/integration/404-failover-simple.spec.ts

# Test with a video that doesn't exist in the first source
curl -I https://your-domain.com/videos/only-in-backup.mp4?width=1920
```

## Related Documentation

- [Origins System](../architecture/origins-system.md) - Core Origins configuration
- [Transformation Error Handling](../error-handling/transformation-error-handling.md) - Overall error handling
- [Multi-Origin Fallback](../architecture/multi-origin-fallback.md) - Consolidated failover architecture
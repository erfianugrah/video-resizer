# KV Caching System Testing Guide

This guide will help you verify that the KV caching system is working correctly in your video-resizer deployment.

## Prerequisites

- A deployed video-resizer worker with KV namespace properly configured
- Access to the Cloudflare dashboard to monitor KV operations

## Configuration Check

First, ensure your `wrangler.jsonc` has the correct KV configuration:

1. KV namespace binding:
   ```json
   "kv_namespaces": [
     {
       "binding": "VIDEO_TRANSFORMATIONS_CACHE",
       "id": "your-kv-namespace-id",
       "preview_id": "your-preview-kv-namespace-id"
     }
   ]
   ```

2. Enable KV caching in environment variables:
   ```json
   "CACHE_ENABLE_KV": "true",
   "CACHE_KV_TTL_OK": "86400",
   "CACHE_KV_TTL_REDIRECTS": "3600",
   "CACHE_KV_TTL_CLIENT_ERROR": "60",
   "CACHE_KV_TTL_SERVER_ERROR": "10"
   ```

## Operational Notes

The KV caching system is designed to be configuration-controlled:

1. **Completely Separate from Edge Cache**: KV caching operates independently from client cache headers, Cloudflare edge cache, and debug mode settings.

2. **Configuration Toggle**: The only way to disable KV caching is through `CACHE_ENABLE_KV` setting in wrangler.jsonc.

3. **Diagnostics API**: A diagnostic endpoint at `/api/kv-diagnostics` is available for monitoring cache operations.

## KV Diagnostics API

The system includes a KV diagnostics API endpoint that lists all entries in the KV namespace:

```
https://cdn.example.com/api/kv-diagnostics
```

This endpoint is only accessible when debug mode is enabled.

## Troubleshooting KV Caching Issues

If KV caching isn't working as expected, check:

1. **KV Namespace Binding**:
   - Ensure the KV namespace ID in wrangler.jsonc is correct
   - Verify the binding name matches what's expected in the code (VIDEO_TRANSFORMATIONS_CACHE or VIDEO_TRANSFORMS_KV)

2. **Config Settings**:
   - Check that CACHE_ENABLE_KV is set to "true"
   - Verify TTL settings are appropriate

3. **Cache Key Generation**:
   - The system generates keys based on source path and transformation options
   - If options change between requests, different cache keys are generated

## Common Log Messages

Look for these log messages to understand KV caching behavior:

- `KV cache disabled by configuration` - KV caching is disabled in settings
- `No KV namespace binding found` - The Worker can't find the KV namespace binding
- `KV cache hit` - Successfully retrieved content from KV cache
- `KV cache miss` - Content not found in KV cache
- `Attempting to store in KV cache` - Storing content in KV cache
- `Successfully stored in KV cache` - Content stored successfully in KV cache
- `Error storing in KV cache` - Error occurred while storing in KV cache

## Analyzing KV Storage Performance

The KV diagnostics API provides information to analyze KV performance:

- **Hit Rate**: Percentage of requests served from KV cache vs. total requests
- **Cache Sizes**: Size of items stored in KV
- **Cache Age**: How long items have been in the cache
- **TTL Remaining**: Time until cached items expire

This information can help tune TTL settings and understand memory usage patterns.

## Next Steps

If KV caching is working correctly, you should see:

1. First request to a video shows cache miss in logs
2. Subsequent requests show cache hits from KV
3. KV diagnostics API shows stored entries
4. Response times improve for cached videos

If the system is correctly storing and retrieving from KV, consider adjusting TTL settings based on your traffic patterns to optimize performance and KV storage costs.
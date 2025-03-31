# KV Caching Testing Guide

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

## Debugging and Bypassing Cache

You can bypass the KV cache in various ways:

1. Add `?debug=true` to the URL to bypass all caching layers
2. Add `?no-kv-cache=true` to bypass only the KV cache layer
3. Set the `debugEnabled` flag in the request context

## KV Diagnostics API

The system includes a KV diagnostics API endpoint that lists all entries in the KV namespace:

```
https://your-domain.com/api/kv-diagnostics
```

This endpoint is only accessible when debug mode is enabled.

## Common Log Messages

Look for these log messages to understand KV caching behavior:

- `KV cache disabled by configuration` - KV caching is disabled in settings
- `No KV namespace binding found` - The Worker can't find the KV namespace binding
- `KV cache hit` - Successfully retrieved content from KV cache
- `KV cache miss` - Content not found in KV cache
- `Attempting to store in KV cache` - Storing content in KV cache
- `Successfully stored in KV cache` - Content stored successfully
- `Error storing in KV cache` - Error occurred while storing

## Verification Tests

To confirm your KV caching is working correctly:

1. Make an initial request to a video with specific transformation parameters:
   ```
   https://your-domain.com/videos/sample.mp4?width=640&height=360
   ```

2. Check the logs for "KV cache miss" and "Storing in KV cache" messages

3. Make the same request again and look for "KV cache hit" message

4. Access the KV diagnostics API to see the stored entry:
   ```
   https://your-domain.com/api/kv-diagnostics?debug=true
   ```

5. Verify that the response times improve for the second request

## Analyzing KV Storage Performance

The KV diagnostics API provides information to analyze KV performance:

- **Hit Rate**: Percentage of requests served from KV cache vs. total requests
- **Cache Sizes**: Size of items stored in KV
- **Cache Age**: How long items have been in the cache
- **TTL Remaining**: Time until cached items expire

This information can help tune TTL settings and understand memory usage patterns.

## Troubleshooting

If KV caching isn't working as expected, check:

1. **KV Namespace Binding**:
   - Ensure the KV namespace ID in wrangler.jsonc is correct
   - Verify the binding name matches what's expected in the code

2. **Config Settings**:
   - Check that CACHE_ENABLE_KV is set to "true"
   - Verify TTL settings are appropriate

3. **Cache Key Generation**:
   - The system generates keys based on source path and transformation options
   - If options change between requests, different cache keys are generated

4. **Size Limitations**:
   - KV has a 25MB per-key size limitation
   - Large videos may exceed this limit and won't be cached
# Cloudflare Caching Options for Video Resizer

## Overview

This document explains the caching options for the Video Resizer service, particularly focusing on the different Cloudflare Worker options and their behaviors.

## Cloudflare Caching Options

When using Cloudflare's `fetch()` with the `cf` object, there are several caching-related options:

### 1. `cacheEverything`

- **Type**: `boolean`
- **Default**: `false`
- **Purpose**: Forces caching for all content, including responses that would normally be uncacheable (due to Cache-Control headers, cookies, or other directives).
- **Behavior**: When `false`, normal HTTP caching rules apply. When `true`, the response will be cached regardless of whether it would normally be cacheable.

### 2. `cacheTtl`

- **Type**: `number`
- **Default**: `undefined`
- **Purpose**: Defines a specific TTL (Time To Live) in seconds for the cached resource.
- **Important Behavior**: Setting `cacheTtl` **implicitly** sets `cacheEverything: true`.
- **Example**: `cacheTtl: 3600` would set a cache time of 1 hour AND force the response to be cached regardless of standard HTTP caching rules.

### 3. `cacheTtlByStatus`

- **Type**: `Record<string, number>` (Status code range to TTL in seconds)
- **Default**: `undefined`
- **Purpose**: Allows for setting different TTLs based on the status code of the response.
- **Important Behavior**: Unlike `cacheTtl`, setting `cacheTtlByStatus` does **not** implicitly set `cacheEverything: true`.
- **Example**: 
  ```javascript
  cacheTtlByStatus: {
    "200-299": 86400, // 24 hours for successful responses
    "300-399": 3600,  // 1 hour for redirects
    "400-499": 60,    // 1 minute for client errors
    "500-599": 10     // 10 seconds for server errors
  }
  ```

### 4. `cacheTags`

- **Type**: `string[]`
- **Default**: `undefined`
- **Purpose**: Allows for attaching cache tags to the response for selective purging.
- **Behavior**: Tagged resources can be purged by tag using the Cloudflare API.

## Implementation in Video Resizer

The Video Resizer service uses a combination of these options to implement its caching strategy:

### Previous Implementation Issue

In the previous implementation, the service was using `cacheTtl` based on status codes, which had the side effect of implicitly setting `cacheEverything: true` even when `cacheability` was set to `false`. This led to inconsistent behavior where:

```javascript
// When cacheability: false, we explicitly set:
cfObject.cacheEverything = false;
cfObject.cacheTtl = 0;
```

But setting `cacheTtl` would implicitly override `cacheEverything` to `true`.

### Corrected Implementation

The updated implementation now:

1. Explicitly sets `cacheEverything` based on the `cacheability` setting.
2. Uses `cacheTtlByStatus` instead of `cacheTtl` when `cacheability` is `true` to avoid the implicit override of `cacheEverything`.
3. For backward compatibility, still sets `cacheTtl: 0` when `cacheability` is `false`, though this is redundant since `cacheEverything` is already `false`.

```javascript
// Set cacheEverything based on cacheability
cfObject.cacheEverything = cacheConfig.cacheability || false;

if (cacheConfig.cacheability) {
  // Use cacheTtlByStatus for more granular control
  cfObject.cacheTtlByStatus = {
    "200-299": cacheConfig.ttl.ok,
    "300-399": cacheConfig.ttl.redirects,
    "400-499": cacheConfig.ttl.clientError,
    "500-599": cacheConfig.ttl.serverError
  };
} else {
  // For backward compatibility
  cfObject.cacheTtl = 0;
}
```

## Configuration in `wrangler.jsonc`

The cache behavior is configured in the `wrangler.jsonc` file:

```json
"cache": {
  "default": {
    "cacheability": true,
    "videoCompression": "auto",
    "ttl": {
      "ok": 86400,          // 24 hours for successful responses
      "redirects": 3600,    // 1 hour for redirects
      "clientError": 60,    // 1 minute for client errors
      "serverError": 10     // 10 seconds for server errors
    }
  },
  "highTraffic": {
    "regex": ".*\\/popular\\/.*\\.mp4",
    "cacheability": true,
    "videoCompression": "auto",
    "ttl": {
      "ok": 604800         // 7 days for popular videos
    }
  },
  // Other profiles...
}
```

## Cache Bypassing

The service supports bypassing the cache through several mechanisms:

1. **Query Parameters**: Setting `nocache` or `bypass` in the query string
2. **Headers**: Using `Cache-Control: no-cache` or `Cache-Control: no-store`
3. **Debug Mode**: Adding `?debug=true` to the URL

## Configuring Caching Behavior

The service now supports explicitly choosing between `cacheTtl` or `cacheTtlByStatus` via the new `useTtlByStatus` configuration option. This lets you control the caching behavior more precisely:

1. **Using `cacheTtlByStatus` (default, `useTtlByStatus: true`)**: 
   - Provides more granular control with different TTLs per status code range
   - Explicitly sets `cacheEverything` based on cacheability
   - Recommended for most scenarios

2. **Using `cacheTtl` (`useTtlByStatus: false`)**: 
   - Simpler approach with a single TTL value (selected based on the response status code)
   - Uses the implicit `cacheEverything: true` behavior of `cacheTtl`
   - Useful for simpler caching scenarios

### Configuration Example

```json
"default": {
  "regex": ".*",
  "cacheability": true,
  "useTtlByStatus": true, // Choose between cacheTtlByStatus and cacheTtl
  "videoCompression": "auto",
  "ttl": {
    "ok": 86400,
    "redirects": 3600,
    "clientError": 60, 
    "serverError": 10
  }
}
```

## Best Practices and Recommendations

1. **Make Caching Decisions Clear**: Clearly separate the decision of whether to cache (`cacheability`) from how to cache (TTL configuration).

2. **Document Side Effects**: Always document the behavior and side effects of caching options, especially the relationship between `cacheTtl` and `cacheEverything`.

3. **Regular Testing**: Implement tests that verify cache behavior, especially for edge cases.

4. **Strategy Pattern**: Consider implementing the Strategy pattern for different caching mechanisms to make the code more maintainable.

5. **Prefer TTL By Status**: Prefer using `cacheTtlByStatus` with `useTtlByStatus: true` over `cacheTtl` to maintain explicit control over `cacheEverything` behavior.

6. **Legacy Configuration Support**: Always maintain backward compatibility with legacy `cacheTtl` configurations by automatically converting them to the new TTL structure.

## Recent Improvements

We recently improved the caching implementation with several key changes:

1. **Fixed Caching Override Issue**: Previously, when using `cacheTtl` with `cacheability: false`, the `cacheTtl` would implicitly set `cacheEverything: true`, overriding our explicit setting. We've fixed this by:
   - Using `cacheTtlByStatus` instead when `cacheability` is true
   - Adding a `useTtlByStatus` flag to control which approach is used

2. **Schema Validation**: We've added schema validation of TTL values to ensure configuration is properly structured and type-safe.

3. **Automatic Conversion**: We now automatically convert legacy `cacheTtl` configurations to the more detailed TTL structure with values for each status code range.

4. **Default Values**: We've established reasonable defaults for TTLs by status code range:
   - 200-299 (OK): Uses the original cacheTtl value
   - 300-399 (Redirects): 1/10th of the original cacheTtl
   - 400-499 (Client errors): 60 seconds (fixed)
   - 500-599 (Server errors): 10 seconds (fixed)

## Reference

For more information on Cloudflare Worker caching options, refer to the official Cloudflare documentation at:

- [Cloudflare Workers Runtime APIs: Fetch](https://developers.cloudflare.com/workers/runtime-apis/fetch/)
- [Cloudflare Workers: How Workers Works](https://developers.cloudflare.com/workers/learning/how-workers-works/)
- [Cloudflare Workers: Caching with Workers](https://developers.cloudflare.com/workers/learning/how-the-cache-works/)
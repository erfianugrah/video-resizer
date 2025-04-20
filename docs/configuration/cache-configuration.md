# Cache Configuration

The `CacheConfigurationManager` handles caching behavior and cache profiles. It provides methods to control how content is cached, including cache methods, TTLs, and profiles for different content types.

## Multi-Level Caching Strategy

The video-resizer implements a multi-level caching strategy to optimize performance and reduce costs:

1. **Cloudflare Cache API** (Edge Cache): First level of cache, checked for all requests
2. **KV Storage Cache** (Global Persistent Cache): Second level cache, checked on Cloudflare cache misses
3. **Origin + Transformation**: Only executed if both caches miss

For examples of cache hit logging and a detailed request flow, see [KV Cache Logging Example](./kv-cache-logging-example.md).

## Cache Method Options

| Option | Description | Default |
|--------|-------------|---------|
| `cf` | Use Cloudflare's built-in caching with CF object (recommended) | ✓ |
| `cacheApi` | Use the Cache API directly (alternative) | |

## Cache Profiles

Each profile configures caching behavior for a specific content pattern:

| Option | Type | Description |
|--------|------|-------------|
| `regex` | string | Pattern to match content |
| `cacheability` | boolean | Whether content should be cached |
| `videoCompression` | string | Compression for this profile |
| `ttl` | object | TTL settings (see below) |

## TTL Configuration

TTL (Time To Live) settings based on response status:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `ok` | number | 86400 | TTL for successful responses (200-299) |
| `redirects` | number | 3600 | TTL for redirects (300-399) |
| `clientError` | number | 60 | TTL for client errors (400-499) |
| `serverError` | number | 10 | TTL for server errors (500-599) |

## KV Cache Configuration

The cache system also supports storing transformed video variants in Cloudflare KV for faster retrieval:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enableKVCache` | boolean | true | Enable KV storage for transformed variants |
| `kvTtl.ok` | number | 86400 | TTL for 2xx responses in KV storage |
| `kvTtl.redirects` | number | 3600 | TTL for 3xx responses in KV storage |
| `kvTtl.clientError` | number | 60 | TTL for 4xx responses in KV storage |
| `kvTtl.serverError` | number | 10 | TTL for 5xx responses in KV storage |

The KV cache system requires a KV namespace binding:

```jsonc
"kv_namespaces": [
  {
    "binding": "VIDEO_TRANSFORMATIONS_CACHE",
    "id": "your-kv-namespace-id"
  }
]
```

### KV Cache Enable/Disable Behavior

When `enableKVCache` is set to `false`, the worker will:

1. Not read from KV cache when processing video requests
2. Not write to KV cache when transforming videos
3. Log that KV cache operations were skipped
4. Continue to use the Cloudflare Cache API for regular caching

You can disable KV cache in two ways:

1. Via configuration loaded from KV:
   ```json
   {
     "cache": {
       "enableKVCache": false,
       "method": "cf",
       "enableCacheTags": true,
       ...
     }
   }
   ```

2. Via environment variable:
   ```bash
   CACHE_ENABLE_KV=false
   ```

For detailed documentation on the KV caching system, see [KV Caching Guide](../kv-caching/README.md).

## Default Profiles

| Profile | Description | TTL (OK) |
|---------|-------------|----------|
| `default` | Default pattern for all content | 24 hours |
| `highTraffic` | Popular content pattern | 7 days |
| `shortForm` | Short-form video content | 2 days |
| `dynamic` | Dynamic or live content | 5 minutes |

## Configuration Methods

- `getConfig()`: Get the entire cache configuration
- `getCacheMethod()`: Get the current cache method
- `isDebugEnabled()`: Check if cache debugging is enabled
- `shouldBypassCache(url)`: Check if cache should be bypassed
- `getProfileForPath(path)`: Get cache profile for a URL path
- `addProfile(name, profile)`: Add a new cache profile

## Environment Variables

| Variable | Type | Description | Default |
|----------|------|-------------|---------|
| `CACHE_METHOD` | string | Cache method: 'cf' or 'cacheApi' | 'cf' |
| `CACHE_DEBUG` | boolean | Enable cache debugging | false |
| `CACHE_ENABLE_KV` | boolean | Enable KV storage for transformed variants | false |
| `CACHE_KV_TTL_OK` | number | TTL for 2xx responses in seconds | 86400 |
| `CACHE_KV_TTL_REDIRECTS` | number | TTL for 3xx responses in seconds | 3600 |
| `CACHE_KV_TTL_CLIENT_ERROR` | number | TTL for 4xx responses in seconds | 60 |
| `CACHE_KV_TTL_SERVER_ERROR` | number | TTL for 5xx responses in seconds | 10 |

## Example Usage

```typescript
import { CacheConfigurationManager } from './config';

const cacheConfig = CacheConfigurationManager.getInstance();

// Get the current cache method
const method = cacheConfig.getCacheMethod();
console.log(method); // 'cf' or 'cacheApi'

// Check if cache should be bypassed for a URL
const shouldBypass = cacheConfig.shouldBypassCache('https://example.com/video.mp4?debug=true');
console.log(shouldBypass); // true if cache should be bypassed

// Get cache profile for a specific path
const profile = cacheConfig.getProfileForPath('/videos/example.mp4');
console.log(profile.ttl.ok); // 86400 (24 hours)
```
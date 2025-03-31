# KV Caching Configuration Guide

## Environment Configuration

The KV caching system is configured via the environment configuration:

```typescript
export interface CacheConfig {
  enableKVCache: boolean;      // Enable/disable KV caching
  kvTtl: {
    ok: number;                // TTL for 2xx responses
    redirects: number;         // TTL for 3xx responses
    clientError: number;       // TTL for 4xx responses
    serverError: number;       // TTL for 5xx responses
  };
}
```

## Wrangler Configuration

### Required KV Namespace

The KV namespace is configured in `wrangler.jsonc`:

```jsonc
"kv_namespaces": [
  {
    "binding": "VIDEO_TRANSFORMATIONS_CACHE",
    "id": "your-kv-namespace-id",
    "preview_id": "your-preview-kv-namespace-id" 
  }
]
```

### Environment Variables

Add these to your wrangler.jsonc file:

```jsonc
"vars": {
  "CACHE_ENABLE_KV": "true",
  "CACHE_KV_TTL_OK": "86400",        // 24 hours for successful responses
  "CACHE_KV_TTL_REDIRECTS": "3600",  // 1 hour for redirects
  "CACHE_KV_TTL_CLIENT_ERROR": "60", // 1 minute for client errors
  "CACHE_KV_TTL_SERVER_ERROR": "10"  // 10 seconds for server errors
}
```

## Setup Guide

1. Create the KV namespace:
   ```bash
   wrangler kv:namespace create "VIDEO_TRANSFORMATIONS_CACHE"
   ```

2. For local development, create a preview namespace:
   ```bash
   wrangler kv:namespace create "VIDEO_TRANSFORMATIONS_CACHE" --preview
   ```

3. Add the namespace ID to your wrangler.jsonc file:
   ```jsonc
   "kv_namespaces": [
     {
       "binding": "VIDEO_TRANSFORMATIONS_CACHE",
       "id": "your-kv-namespace-id",
       "preview_id": "your-preview-kv-namespace-id"
     }
   ]
   ```

4. Configure environment variables for KV caching:
   ```jsonc
   "vars": {
     "CACHE_ENABLE_KV": "true",
     "CACHE_KV_TTL_OK": "86400",
     "CACHE_KV_TTL_REDIRECTS": "3600",
     "CACHE_KV_TTL_CLIENT_ERROR": "60",
     "CACHE_KV_TTL_SERVER_ERROR": "10"
   }
   ```

5. Deploy your worker:
   ```bash
   wrangler deploy
   ```

## Alternative Binding Names

The system supports alternative binding names for flexibility:

- `VIDEO_TRANSFORMATIONS_CACHE` (default)
- `VIDEO_TRANSFORMS_KV` (alternative)

If you use a different name, ensure it matches in your code.

## Cache Bypass Configuration

You can configure cache bypass behavior:

```jsonc
"cache": {
  "bypass": {
    "debug": true,           // Bypass cache in debug mode
    "queryParams": [         // Query parameters that trigger bypass
      "no-cache",
      "no-kv-cache"
    ],
    "headers": [             // Headers that trigger bypass
      "x-no-cache",
      "x-bypass-cache"
    ]
  }
}
```
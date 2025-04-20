# enableKVCache Flag Fix

## Issue

There was a bug in the KV caching system where the `enableKVCache` flag was not being fully respected throughout the codebase. Specifically, the direct KV cache operations in `videoHandler.ts` were not checking the `enableKVCache` flag before performing KV operations, resulting in KV cache still being used even when explicitly disabled via configuration.

## Root Cause

The issue existed in two places:

1. In `videoHandler.ts`, there was a direct call to `getFromKVCache()` without checking the `enableKVCache` flag first:
```typescript
// Start KV lookup with request for range handling support
kvPromise = getFromKVCache(env, sourcePath, videoOptions as unknown as TransformOptions, request);
```

2. Similarly, when storing to KV cache, videoHandler.ts was not checking the flag:
```typescript
// Use waitUntil if available to store in KV without blocking response
const envWithCtx = env as unknown as EnvWithExecutionContext;
if (envWithCtx.executionCtx && typeof envWithCtx.executionCtx.waitUntil === 'function') {
  envWithCtx.executionCtx.waitUntil(
    storeInKVCache(env, sourcePath, responseClone, videoOptionsWithIMQuery as unknown as TransformOptions)
    // ...
  );
}
```

While the `getFromKVCache()` and `storeInKVCache()` functions themselves did check the flag internally, the direct calls in `videoHandler.ts` were not being conditioned on the flag, leading to unnecessary KV operations and logging.

## Fix

The fix involved adding explicit checks for the `enableKVCache` flag in `videoHandler.ts` before making any calls to KV cache operations:

1. Before reading from KV cache:
```typescript
// Get KV cache configuration
const { CacheConfigurationManager } = await import('../config/CacheConfigurationManager');
const cacheConfig = CacheConfigurationManager.getInstance();
const kvCacheEnabled = cacheConfig.isKVCacheEnabled();

// Only check KV cache if it's enabled in config
if (kvCacheEnabled) {
  // KV lookup code...
  kvPromise = getFromKVCache(env, sourcePath, videoOptions as unknown as TransformOptions, request);
} else {
  debug(context, logger, 'KVCacheUtils', 'Skipping KV cache (disabled by configuration)', {
    sourcePath: sourcePath,
    enableKVCache: false
  });
}
```

2. Before writing to KV cache:
```typescript
// Get KV cache configuration
const { CacheConfigurationManager } = await import('../config/CacheConfigurationManager');
const cacheConfig = CacheConfigurationManager.getInstance();
const kvCacheEnabled = cacheConfig.isKVCacheEnabled();

// Only proceed with KV cache if it's enabled in config
if (kvCacheEnabled) {
  // KV storage code...
} else {
  // KV cache is disabled in config
  debug(context, logger, 'VideoHandler', 'Skipping KV cache storage (disabled by configuration)', {
    enableKVCache: false
  });
  endTimedOperation(context, 'cache-storage');
}
```

## Verification

After applying these changes, the KV cache is now properly bypassed when:
1. The `enableKVCache` flag is set to `false` in the configuration loaded from KV
2. The `CACHE_ENABLE_KV` environment variable is set to `false`

The worker will log messages indicating that KV cache operations were skipped due to configuration settings, and no KV operations will be attempted.

## Related Configuration

The `enableKVCache` setting can be configured in two ways:

1. Via KV configuration:
```json
{
  "cache": {
    "enableKVCache": false
  }
}
```

2. Via environment variable in wrangler.jsonc:
```json
{
  "vars": {
    "CACHE_ENABLE_KV": "false"
  }
}
```
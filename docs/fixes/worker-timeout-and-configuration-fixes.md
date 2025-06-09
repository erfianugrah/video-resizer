# Worker Timeout and Configuration Fixes

## Issues Fixed

### 1. Worker Timeout Issue (Critical)

**Problem**: The Worker was experiencing timeouts at approximately 1 second (1057-1114ms) with the error:
> "The Workers runtime canceled this request because it detected that your Worker's code had hung and would never generate a response."

**Root Cause**: The code was attempting to:
1. Store video in KV cache (`storeInKVCache`)
2. Immediately retrieve it from KV (`getFromKVCache`)
3. Retry once with 100ms delay if retrieval failed

This synchronous pattern was problematic because:
- KV storage has eventual consistency - data may not be immediately available after writing
- The synchronous wait for KV retrieval blocked the response
- Combined with other processing, this pushed the Worker over the CPU/wall time limit

**Fix Applied**: Modified `videoHandlerWithOrigins.ts` to:
- Return the response immediately to the client
- Store to KV cache asynchronously using `ctx.waitUntil()`
- Remove the immediate retrieval attempt

### 2. Configuration Loading Error (Cosmetic)

**Problem**: The worker was logging "Invalid URL: config/worker-config.json" even though configuration was successfully loading from KV storage.

**Root Cause**: The configuration service had a fallback mechanism that tried to fetch local JSON files, which doesn't work in Cloudflare Workers.

**Fix Applied**: Completely removed the fallback configuration mechanism:
- Removed `applyBaseConfiguration()` method
- Removed `loadBaseConfiguration()` function
- Removed embedded fallback configuration
- Configuration now only loads from KV storage
- Clear error thrown if KV configuration is not available

## Implementation Details

### Worker Timeout Fix

Changed in `src/handlers/videoHandlerWithOrigins.ts`:

```typescript
// OLD: Synchronous store-then-read pattern
storedInKV = await storeInKVCache(env, sourcePath, response, videoOptionsForKV);
if (storedInKV) {
  // Immediately try to retrieve
  kvResponse = await getFromKVCache(env, sourcePath, videoOptionsForKV, request);
  // Retry if failed...
}

// NEW: Asynchronous storage
const responseForKV = response.clone();
ctx.waitUntil(
  (async () => {
    try {
      const storedInKV = await storeInKVCache(env, sourcePath, responseForKV, videoOptionsForKV);
      // Storage happens in background, no retrieval attempt
    } catch (err) {
      // Error handling
    }
  })()
);
```

### Configuration Fix

Changed in `src/services/configuration/service.ts`:
- Removed `applyBaseConfiguration()` call from `initialize()`
- Added error throwing when KV configuration is not found

Changed in `src/services/configuration/loaders.ts`:
- Removed `loadBaseConfiguration()` function entirely
- Removed embedded fallback configuration constant

## Benefits

### Performance Improvements
1. **Faster Response Times**: Responses are sent immediately without waiting for KV operations
2. **No More Timeouts**: Worker completes within time limits
3. **Better Concurrency**: Background KV operations don't block requests

### Configuration Clarity
1. **Single Source of Truth**: Configuration only comes from KV
2. **Clear Failures**: Missing configuration throws explicit errors
3. **No Confusion**: No fallback configuration that might be outdated

## Testing

After applying these fixes:
1. Worker timeout errors should be eliminated
2. Configuration errors in logs should be gone
3. KV caching continues to work for subsequent requests
4. Performance should be improved

## Monitoring

Monitor for:
- CPU time usage per request (should be under limits)
- Wall time usage per request (should be well under 1 second)
- KV storage success in background (check logs for "Successfully stored in KV (background)")
- Configuration loading success
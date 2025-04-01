# IMQuery Caching Fix

## Issue: IMQuery Parameters Prevent Caching

When using IMQuery parameters like `imwidth=800`, URLs were not being cached in KV storage. This was happening despite successfully matching the IMQuery parameters to derivatives like `low` (854x480).

## Investigation

Upon investigation, the logs showed:

```
(debug) RequestContext: Adding breadcrumb {
  category: 'Response',
  message: 'Caching disabled',
  elapsedMs: '226.00',
  durationMs: '0.00'
}
```

Even though our bypass logic was correctly updated to only skip caching for specific parameters (`debug`, `nocache`, `bypass`), not all query parameters, the system was still disabling caching for IMQuery parameters.

## Root Cause

The issue was in the derivative translation process and how cacheability is determined for transformed URLs:

1. When IMQuery parameters are present, they are matched to a derivative (e.g., `imwidth=800` matches to the `low` derivative).
2. The cache configuration determination in `determineCacheConfig` didn't properly handle derivative information.
3. The system incorrectly determined cacheability based on the URL with query parameters rather than recognizing it's using a derivative.

## Fix Implementation

The fix was implemented by adding special handling for IMQuery parameters in the `TransformationService`:

```typescript
// Special handling for IMQuery - ensure it's cacheable
const isIMQuery = url.searchParams.has('imwidth') || url.searchParams.has('imheight');
const hasDerivative = !!options.derivative;

if (isIMQuery && hasDerivative) {
  logDebug('IMQuery with derivative found - checking cache config', {
    url: url.toString(),
    derivative: options.derivative,
    cacheability: cacheConfig.cacheability,
    hasIMQuery: isIMQuery,
    imwidth: url.searchParams.get('imwidth'),
    imheight: url.searchParams.get('imheight')
  });
  
  // Ensure cacheability is set to true for IMQuery derivatives
  if (!cacheConfig.cacheability) {
    logDebug('Forcing cacheability for IMQuery derivative', {
      derivative: options.derivative,
      originalCacheability: cacheConfig.cacheability
    });
    cacheConfig.cacheability = true;
  }
}
```

This ensures that even when a URL contains IMQuery parameters (which are translated to derivatives), the caching system recognizes it as cacheable.

## Related Files Changed

1. `src/services/TransformationService.ts` - Added special handling for IMQuery parameters with derivatives
2. `src/handlers/videoOptionsService.ts` - Added additional logging to understand derivative configuration

## Testing

The fix can be verified by:

1. Making a request with IMQuery parameters (e.g., `GET /erfi.mp4?imwidth=800`)
2. Checking logs to ensure caching is not disabled
3. Making the same request again and verifying a KV cache hit occurs

## Related Documentation

- [IMQuery Support](./imquery-support.md) - Comprehensive document explaining IMQuery parameter handling and caching behavior
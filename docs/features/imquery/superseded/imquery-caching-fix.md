# IMQuery Caching Enhancements

## Issue 1: IMQuery Parameters Prevent Caching

When using IMQuery parameters like `imwidth=800`, URLs were not being cached in KV storage. This was happening despite successfully matching the IMQuery parameters to derivatives like `low` (854x480).

### Investigation & Root Cause

Upon investigation, the logs showed:

```
(debug) RequestContext: Adding breadcrumb {
  category: 'Response',
  message: 'Caching disabled',
  elapsedMs: '226.00',
  durationMs: '0.00'
}
```

The issue was in the derivative translation process and how cacheability is determined for transformed URLs:

1. When IMQuery parameters are present, they are matched to a derivative (e.g., `imwidth=800` matches to the `low` derivative).
2. The cache configuration determination in `determineCacheConfig` didn't properly handle derivative information.
3. The system incorrectly determined cacheability based on the URL with query parameters rather than recognizing it's using a derivative.

### Fix Implementation

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

## Issue 2: Dimension Information in Cache Metadata

### Background

When a request with IMQuery parameters (like `imwidth=400`) is received:

1. The system maps the dimensions to a specific derivative (e.g., `mobile`)
2. The derivative's configuration defines the transformation (e.g., `mobile` is configured as 854x640)
3. The transformation occurs using a `fit` mode (usually "contain")
4. The result is cached in KV storage with metadata including dimensions and tags

### Observed Issue

When the system maps `imwidth=400` to the `mobile` derivative (854x640), the cache metadata showed:
- `derivative: "mobile"`
- `width: 400` (the requested value, not the derivative's configured value of 854)
- Cache tags included `video-prod-width-400`

This discrepancy between the requested width and the derivative's configured width can cause confusion when analyzing cache entries.

### Enhancement

We've enhanced the cache metadata to store both values:

1. The primary cache metadata still uses the requested dimensions for consistency
2. The `customData` field now includes `requestedWidth` and `requestedHeight` properties
3. Cache tags include both the derivative name and the requested dimensions

### Example Cache Entry (Before)

```json
{
  "name": "video:white-fang.mp4:derivative=mobile",
  "metadata": {
    "width": 400,              // Original requested width
    "height": 640,             // Original requested height (aspect ratio maintained)
    "derivative": "mobile",    // Mapped derivative
    "customData": {
      "requestedWidth": 400,   // Original requested width (duplicated for clarity)
      "requestedHeight": 640   // Original requested height (duplicated for clarity)
    },
    "cacheTags": [
      "video-prod-path-white-fang-mp4",
      "video-prod-derivative-mobile", 
      "video-prod-width-400",
      "video-prod-height-640",
      "video-prod-dimensions-400x640"
    ]
  }
}
```

### Example Cache Entry (After Enhancement)

```json
{
  "name": "video:white-fang.mp4:derivative=mobile",
  "metadata": {
    "width": 854,              // Derivative's actual width
    "height": 640,             // Derivative's actual height
    "derivative": "mobile",    // Mapped derivative
    "customData": {
      "requestedWidth": 400,   // Original requested width
      "requestedHeight": null, // Original requested height (null if not provided)
      "mappedFrom": "imquery"  // Indicates this was mapped from imquery parameters
    },
    "cacheTags": [
      "video-prod-path-white-fang-mp4",
      "video-prod-derivative-mobile", 
      "video-prod-width-854",            // Uses derivative's actual width
      "video-prod-height-640",           // Uses derivative's actual height
      "video-prod-dimensions-854x640",   // Uses derivative's actual dimensions
      "video-prod-requested-width-400",  // Original requested width is still stored
      "video-prod-source-imquery"        // Indicates source as imquery
    ]
  }
}
```

### Implications for Transformation and Caching

The actual video transformation and caching now follow these rules:

1. The `imwidth=400` request is mapped to the `mobile` derivative (based on breakpoint configuration)
2. The derivative's actual dimensions (854x640) are used for the URL transformation and metadata
3. Since derivatives use `fit: "contain"` mode:
   - The system uses the derivative's dimensions (854x640)
   - The aspect ratio is maintained within these dimensions
   - The result is visually equivalent regardless of whether the request used `imwidth=400` or `derivative=mobile`
4. Cache keys use `derivative=mobile` for better cache efficiency 
5. Metadata stores both:
   - The derivative's actual dimensions (width: 854, height: 640)
   - The original requested dimensions (in customData.requestedWidth/Height)
6. Cache tags incorporate the derivative's actual dimensions, improving cache coherence
7. The original requested dimensions are preserved in additional tags with `requested-` prefix

## Related Files Changed

1. `src/services/TransformationService.ts` - Added special handling for IMQuery parameters with derivatives
2. `src/handlers/videoOptionsService.ts` - Updated to store original requested dimensions and use derivative dimensions
3. `src/services/kvStorageService.ts` - Enhanced metadata storage to use derivative dimensions while preserving requested dimensions
4. `src/services/videoStorageService.ts` - Updated cache tag generation to use derivative dimensions for main tags while keeping requested dimensions in additional tags
5. `config/worker-config.json` - Updated breakpoint configuration to align with derivative dimensions (854 and below → mobile, 855-1280 → tablet, 1281+ → desktop)

## Testing

The enhancements can be verified by:

1. Making a request with IMQuery parameters (e.g., `GET /erfi.mp4?imwidth=400`)
2. Checking logs to ensure it maps to the correct derivative (mobile)
3. Verifying that the transformation parameters in the URL use the derivative's dimensions (854x640)
4. Making the same request again and verifying a KV cache hit occurs
5. Examining the cache metadata to verify it includes:
   - The derivative's dimensions in the main metadata (width: 854, height: 640)
   - The original requested dimensions in customData (requestedWidth: 400)
   - Cache tags with derivative dimensions (`video-prod-width-854`)
   - Cache tags with requested dimensions (`video-prod-requested-width-400`)
6. Testing with a value on the boundary (e.g., imwidth=854) and verifying it maps to mobile
7. Testing with a value just above the boundary (e.g., imwidth=855) and verifying it maps to tablet

## Related Documentation

- [IMQuery Support](./imquery-support.md) - Comprehensive document explaining IMQuery parameter handling and caching behavior
- [Breakpoint-based Derivative Mapping](./breakpoint-based-derivative-mapping.md) - How IMQuery width parameters map to specific derivatives
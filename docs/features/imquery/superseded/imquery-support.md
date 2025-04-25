# IMQuery Support for Video Resizer

## Overview

IMQuery support enables the video resizer to respond to Akamai-compatible responsive image parameters (`imwidth` and `imheight`), automatically selecting the most appropriate video configuration based on the client's requested dimensions. This allows for responsive video resizing that integrates seamlessly with existing responsive image workflows.

## Features

1. **Derivative Matching**
   - Automatically matches IMQuery dimensions to the closest video derivative
   - Uses Euclidean distance algorithm for optimal matching
   - Applies derivative configuration (quality, format, compression settings)
   - Falls back to exact dimensions when no good match exists

2. **KV Caching Support**
   - Properly caches videos requested with IMQuery parameters
   - Only bypasses cache for specific parameters (`debug`, `nocache`, `bypass`)
   - Improves performance for repeated IMQuery requests

## Derivative Matching

### How It Works

When a request includes IMQuery parameters (`imwidth` or `imheight`):

1. The system filters available derivatives to those with defined dimensions
2. Calculates distance/difference for each derivative:
   - For requests with both width and height: Uses Euclidean distance formula
   - For requests with only width or only height: Uses direct difference
3. Converts distance to percentage difference relative to requested dimensions
4. Selects the derivative with the smallest percentage difference below threshold (default 25%)

### Example

Request: `?imwidth=800&imheight=450`

Available Derivatives:
- mobile: { width: 480, height: 270 }
- medium: { width: 854, height: 480 }
- high: { width: 1280, height: 720 }

Result:
- Matched Derivative: "medium"
- Percent Difference: 9.6%
- Applied: { width: 854, height: 480, quality: "medium" }

## KV Caching Behavior

### Caching Implementation

The system is designed to properly cache videos requested with IMQuery parameters, improving performance for repeated requests:

1. Centralized bypass logic only skips caching for specific parameters:
   - Non-GET requests are not cached
   - Requests with `debug`, `nocache`, or `bypass` query parameters bypass cache
   - Requests with cache-control headers requesting no caching are honored

2. Special handling for IMQuery derivatives:
   - Even though IMQuery parameters are in the URL query string, they are treated differently
   - When IMQuery parameters match to a derivative, cacheability is explicitly enforced
   - This ensures that transformed videos with IMQuery parameters benefit from KV caching

### Cache Bypass Configuration

Bypass query parameters are configured in `CacheConfigurationManager.ts`:

```typescript
bypassQueryParameters: ['nocache', 'bypass'],
```

You can add parameters to this array to trigger cache bypass.

### Cache Key Generation

For IMQuery requests that match to derivatives, the cache key includes the derivative information:

```
video:${sourcePath}:derivative=${matchedDerivative}
```

This ensures efficient caching while still respecting the specific derivative configuration requested via IMQuery parameters.

## Recent Improvements

We recently fixed an issue with IMQuery caching. Previously, the system would sometimes incorrectly disable caching for IMQuery parameters. The fix ensures:

1. IMQuery requests that match to derivatives are always considered cacheable
2. Cache configuration is properly determined even with query parameters
3. Cache keys are consistently generated for efficient lookup

See the [IMQuery Caching Fix](./imquery-caching-fix.md) document for details about this fix.

## Testing Both Features

To verify both features are working correctly:

1. Make a request with IMQuery parameters (e.g., `/videos/test.mp4?imwidth=800`)
2. Check logs to confirm:
   - Derivative matching is selecting the appropriate derivative
   - KV cache storage is not being bypassed
3. Make the same request again to verify a KV cache hit occurs

## Diagnostics Information

When IMQuery matching is used, the system captures:

```typescript
imqueryMatching: {
  requestedWidth: number | null;
  requestedHeight: number | null;
  matchedDerivative: string;
  derivativeWidth: number | null;
  derivativeHeight: number | null;
  percentDifference: string;
}
```

This information is available in debug headers and the Debug UI, helping to understand how IMQuery parameters are processed.

## Configuration Options

- **Derivative Matching Threshold**: Adjust `maxDifferenceThreshold` in `imqueryUtils.findClosestDerivative()` (default: 25%)
- **Cache Bypass Parameters**: Modify `bypassQueryParameters` array in `CacheConfigurationManager`
- **Derivative Configurations**: Define in `videoConfig.derivatives` to provide matching options
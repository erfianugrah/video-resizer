# IMQuery Caching System

## Overview

The IMQuery caching system is a specialized component of Video Resizer's caching infrastructure, designed to efficiently handle and store requests with IMQuery parameters (`imwidth`, `imheight`, etc.). This document provides a comprehensive explanation of how IMQuery caching works, its evolution, and the optimizations implemented to improve performance.

## Caching Challenges with IMQuery

IMQuery parameters present unique caching challenges:

1. **Dimension Variety**: Users can request arbitrary dimensions with `imwidth` and `imheight` parameters
2. **Derivative Mapping**: IMQuery parameters map to predefined derivatives
3. **Cache Key Generation**: Determining how to construct cache keys for optimal hit rates
4. **Metadata Storage**: Balancing accurate metadata with cache efficiency
5. **Forced Cacheability**: Ensuring IMQuery requests are cacheable despite query parameters

## Caching Evolution

### Initial Implementation

The original implementation had several limitations:

1. **Inconsistent Cacheability**: Some IMQuery requests were incorrectly marked as non-cacheable
2. **Dimension-Based Cache Keys**: Different requests for similar dimensions created multiple cache entries
3. **Metadata Inconsistency**: Cached metadata showed requested dimensions rather than derivative dimensions
4. **Cache Tags Discrepancies**: Tags reflected requested dimensions, making cache management difficult
5. **Code Duplication**: Derivative dimension lookup was duplicated across multiple components

### Current Implementation

The enhanced caching system addresses these issues:

1. **Forced Cacheability**: IMQuery requests that map to derivatives are always made cacheable
2. **Derivative-Based Cache Keys**: Uses derivative information for better cache grouping
3. **Dimension Normalization**: Normalizes similar dimensions to improve cache hit rates
4. **Dual Dimension Storage**: Stores both derivative and requested dimensions
5. **Enhanced Cache Tags**: Includes both derivative and requested dimension tags
6. **Centralized Dimension Handling**: Single source of truth for derivative dimensions

## Core Components

### 1. Cacheability Enforcement

The system explicitly ensures that IMQuery requests are cacheable:

```typescript
// Special handling for IMQuery - ensure it's cacheable
const isIMQuery = url.searchParams.has('imwidth') || url.searchParams.has('imheight');
const hasDerivative = !!options.derivative;

if (isIMQuery && hasDerivative) {
  // Ensure cacheability is set to true for IMQuery derivatives
  if (!cacheConfig.cacheability) {
    logger.debug('Forcing cacheability for IMQuery derivative', {
      derivative: options.derivative,
      originalCacheability: cacheConfig.cacheability
    });
    cacheConfig.cacheability = true;
  }
}
```

### 2. Optimized Cache Key Generation

For IMQuery requests, the cache key is based on the derivative rather than specific dimensions:

```typescript
// From videoHandler.ts
if (hasIMQueryParams) {
  if (videoOptions.derivative) {
    debug(context, logger, 'VideoHandler', 'Using derivative-based caching for IMQuery request', {
      imwidth,
      imheight,
      hasIMRef,
      derivative: videoOptions.derivative,
      cacheType: 'derivative-based'
    });
    
    // For IMQuery requests, include only the derivative, width and height in cache key
    // This ensures consistent cache keys regardless of custom parameters
    let optimizedCacheOptions: TransformOptions = {
      derivative: videoOptions.derivative,
      width: videoOptions.width,
      height: videoOptions.height,
      // Keep mode in case this is a video/frame/spritesheet request
      mode: videoOptions.mode
    };
    
    // Use this optimized cache key for better cache consistency
    videoOptionsWithIMQuery = optimizedCacheOptions;
  }
}
```

### 3. Enhanced Metadata Storage

The cache metadata now stores both derivative dimensions and requested dimensions:

```typescript
// Generate cache metadata
const metadata: TransformationMetadata = {
  width: derivativeDimensions?.width || width || null,
  height: derivativeDimensions?.height || height || null,
  derivative: derivative,
  contentType: contentType,
  contentLength: contentLength,
  createdAt: createdAt,
  cacheTags: cacheTags,
  customData: {
    requestedWidth: requestedWidth,
    requestedHeight: requestedHeight,
    mappedFrom: 'imquery'
  }
};
```

### 4. Derivative Dimension Usage in Transformation

The system now uses the derivative's actual dimensions in the CDN-CGI URL:

```typescript
// Get the actual dimensions for the derivative
const derivativeDimensions = getDerivativeDimensions(options.derivative);

if (derivativeDimensions) {
  // Use the derivative's actual dimensions in the transformation
  cdnParams.width = derivativeDimensions.width;
  cdnParams.height = derivativeDimensions.height;
}
```

### 5. Dimension Normalization

For improved cache consistency, similar dimensions are normalized:

```typescript
// Create cache key for width/height combination to normalize similar requests
// Round to nearest 10px to improve cache hit rates for slightly different dimensions
const normalizedWidth = targetWidth ? Math.round(targetWidth / 10) * 10 : null;
const normalizedHeight = targetHeight ? Math.round(targetHeight / 10) * 10 : null;
```

## Cache Flow for IMQuery Requests

### Request Flow

1. **Request Arrival**: Video request with IMQuery parameters (e.g., `imwidth=855`)
2. **Parameter Detection**: System detects IMQuery parameters  
3. **Derivative Mapping**: Matches `imwidth=855` to "tablet" derivative (1280×720)
4. **Cache Key Generation**: Creates key using derivative (`video:file.mp4:derivative=tablet`)
5. **Cache Lookup**: Checks KV storage using this key
6. **Cache Hit Flow**:
   - If content exists in cache, returns it directly
   - Uses metadata from cache for content type, dimensions, etc.
7. **Cache Miss Flow**:
   - Constructs CDN-CGI URL using derivative dimensions (1280×720)
   - Performs the transformation
   - Stores result in KV cache with the derivative-based key
   - Includes both derivative and requested dimensions in metadata

### Caching Logic

```typescript
// Pseudocode for IMQuery caching flow
async function handleIMQueryRequest(request, videoOptions) {
  // Extract IMQuery parameters
  const imwidth = request.searchParams.get('imwidth');
  
  // Map to derivative
  const derivative = mapWidthToDerivative(imwidth);
  
  // Get derivative dimensions
  const derivativeDimensions = getDerivativeDimensions(derivative);
  
  // Generate cache key based on derivative
  const cacheKey = `video:${videoOptions.path}:derivative=${derivative}`;
  
  // Try to get from cache
  const cachedResponse = await getFromKVCache(cacheKey);
  if (cachedResponse) {
    // Cache hit - return cached response
    return cachedResponse;
  }
  
  // Cache miss - perform transformation
  // Use derivative dimensions in transformation URL
  const cdnCgiUrl = constructCdnCgiUrl({
    width: derivativeDimensions.width,
    height: derivativeDimensions.height,
    // Other parameters...
  });
  
  const response = await fetch(cdnCgiUrl);
  
  // Store in cache with enriched metadata
  await putInKVCache(cacheKey, response.clone(), {
    width: derivativeDimensions.width,
    height: derivativeDimensions.height,
    derivative: derivative,
    customData: {
      requestedWidth: imwidth,
      // Other metadata...
    }
  });
  
  return response;
}
```

## Cache Tags and Analysis

### Tag Structure

For an IMQuery request with `imwidth=855` that maps to the "tablet" derivative:

```json
"cacheTags": [
  "video-prod-path-sample-mp4",
  "video-prod-derivative-tablet", 
  "video-prod-width-1280",         // Derivative's width
  "video-prod-height-720",         // Derivative's height
  "video-prod-dimensions-1280x720",
  "video-prod-requested-width-855" // Original requested width
]
```

### Benefits of Enhanced Tags

1. **Cache Analysis**: Easily identify which derivatives are most used
2. **Cache Purging**: Purge by derivative (`video-prod-derivative-tablet`)
3. **Request Pattern Analysis**: Analyze requested dimensions vs. derivative dimensions
4. **Debugging**: Trace from requested dimensions to actual derivative dimensions

## Performance Benefits

The IMQuery caching enhancements provide substantial performance improvements:

1. **Higher Cache Hit Rates**: By grouping similar IMQuery dimensions to the same derivative
2. **Reduced Origin Load**: Fewer transformation operations for similar dimensions
3. **Faster Response Times**: More efficient cache key lookups
4. **Lower Compute Costs**: Fewer redundant transformations of similar dimensions
5. **Consistent User Experience**: Same derivative quality regardless of slight dimension differences

## Debugging IMQuery Caching

When troubleshooting IMQuery caching issues:

1. **Enable Debug Mode**: Add `debug=true` to the URL
2. **Check Derivative Mapping**: Verify which derivative the IMQuery parameters map to
3. **Examine Cache Keys**: Review the cache key generation logic
4. **Inspect Cache Metadata**: Look at both derivative and requested dimensions
5. **Verify Cache Tags**: Ensure tags reflect both the derivative and requested dimensions

Example debug output for `imwidth=855`:

```
Detected IMQuery parameters: imwidth=855
Mapping imwidth=855 to derivative: tablet
Derivative tablet dimensions: 1280x720
Using cache key: video:sample.mp4:derivative=tablet
Cache response: MISS (first request) or HIT (subsequent request)
```

## Common Issues and Solutions

| Issue | Symptoms | Solution |
|-------|----------|----------|
| Unexpected derivative mapping | Video quality doesn't match expectation | Check breakpoint configuration and ensure values align with derivative dimensions |
| Poor cache hit rate | Multiple cache entries for similar dimensions | Verify normalization is working, consider adjusting breakpoint ranges |
| Missing metadata | Incomplete debug information | Ensure the metadata enrichment code is being called for all IMQuery requests |
| Inconsistent caching | Some IMQuery requests not cached | Verify the force cacheability logic is working correctly |

## Configuration

### IMQuery Caching Configuration

The IMQuery caching behavior is configured as part of the general caching configuration:

```json
{
  "cache": {
    "enableKVCache": true,
    "method": "cf",
    "bypassQueryParameters": ["nocache", "bypass"],
    "defaultTTL": 86400,
    "enableCacheTags": true
  }
}
```

Key configuration options:
- `enableKVCache`: Master switch for KV caching (including IMQuery caching)
- `bypassQueryParameters`: Query parameters that bypass caching (should NOT include imwidth/imheight)

## Recent Enhancements

Recent improvements to the IMQuery caching system include:

1. **Centralized Dimension Handling**: Added a `getDerivativeDimensions` utility function that provides a single source of truth
2. **Consistent Transformation URLs**: Now using derivative's actual dimensions in CDN-CGI URLs
3. **Enhanced Metadata Storage**: Storing both derivative dimensions and requested dimensions
4. **Improved Cache Tags**: Adding derivative-specific and request-specific tags
5. **Boundary Optimization**: Updated breakpoint boundaries to align with derivative dimensions
6. **Removed Size Limit Check**: Let KV naturally handle size limits to avoid incorrect content rejection

## Best Practices

1. **Design Clear Breakpoints**: Configure breakpoints that align with your responsive design patterns
2. **Align with Derivatives**: Ensure breakpoint boundaries match derivative dimensions
3. **Monitor Cache Analytics**: Regularly review cache hit rates and usage patterns
4. **Properly Tag Content**: Use meaningful tags to identify content type and source
5. **Test Edge Cases**: Verify caching behavior at breakpoint boundaries
6. **Use Consistent Dimensions**: Standardize on common dimensions in your application to improve cache hit rates

## Last Updated

*April 25, 2025*
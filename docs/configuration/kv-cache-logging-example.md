# KV Cache Logging Example

This document provides an example of the logs generated when a video is successfully served from KV cache, demonstrating the multi-level caching strategy in action.

## Complete Request Flow with KV Cache Hit

```
GET https://cdn.erfi.dev/videos/sample.mp4 - Ok @ 3/31/2025, 5:50:12 PM

(debug) RequestContext: Adding breadcrumb {
  category: 'Request',
  message: 'Request received',
  elapsedMs: '0.00',
  durationMs: '0.00'
}

(debug) RequestContext: Adding breadcrumb {
  category: 'EnvironmentConfig',
  message: 'Environment configuration parsing',
  elapsedMs: '0.00',
  durationMs: '0.00'
}

(debug) RequestContext: Updated breadcrumb config { enabled: true, maxItems: 100 }

(debug) RequestContext: Loaded breadcrumb config asynchronously { enabled: true, maxItems: 100 }

(debug) RequestContext: Adding breadcrumb {
  category: 'VideoHandler',
  message: 'Processing video request with caching',
  elapsedMs: '3.00',
  durationMs: '0.00'
}

(debug) RequestContext: Adding breadcrumb {
  category: 'Request',
  message: 'Started total-request-processing',
  elapsedMs: '3.00',
  durationMs: '0.00'
}

(debug) RequestContext: Adding breadcrumb {
  category: 'Cache',
  message: 'Checking cache',
  elapsedMs: '3.00',
  durationMs: '0.00'
}

(debug) RequestContext: Adding breadcrumb {
  category: 'Cache',
  message: 'Started cache-lookup',
  elapsedMs: '3.00',
  durationMs: '0.00'
}

(debug) RequestContext: Adding breadcrumb {
  category: 'Cache',
  message: 'Checking CF cache',
  elapsedMs: '3.00',
  durationMs: '0.00'
}

(debug) RequestContext: Adding breadcrumb {
  category: 'CacheManagementService',
  message: 'CF cache miss',
  elapsedMs: '23.00',
  durationMs: '20.00'
}

(debug) RequestContext: Adding breadcrumb {
  category: 'VideoHandler',
  message: 'CF cache miss',
  elapsedMs: '23.00',
  durationMs: '0.00'
}

(debug) RequestContext: Adding breadcrumb {
  category: 'Cache',
  message: 'Checking KV cache',
  elapsedMs: '23.00',
  durationMs: '0.00'
}

(debug) RequestContext: Adding breadcrumb {
  category: 'KVCacheUtils',
  message: 'Checking KV cache for video',
  elapsedMs: '23.00',
  durationMs: '0.00'
}

(debug) RequestContext: Adding breadcrumb {
  category: 'KVStorageService',
  message: 'Checking for video in KV',
  elapsedMs: '23.00',
  durationMs: '0.00'
}

(debug) RequestContext: Adding breadcrumb {
  category: 'KVStorageService',
  message: 'Retrieved transformed video from KV',
  elapsedMs: '142.00',
  durationMs: '119.00'
}

(debug) KVStorageService: Retrieved transformed video from KV {
  key: 'video:videos/sample.mp4:derivative=medium',
  size: 1843092,
  age: '3m 42s'
}

(debug) RequestContext: Adding breadcrumb {
  category: 'KVCacheUtils',
  message: 'KV cache hit',
  elapsedMs: '142.00',
  durationMs: '0.00'
}

(debug) KVCacheUtils: KV cache hit {
  sourcePath: '/videos/sample.mp4',
  derivative: 'medium',
  createdAt: '2025-03-31T17:46:30.000Z',
  expiresAt: '2025-04-01T17:46:30.000Z',
  contentLength: 1843092,
  contentType: 'video/mp4'
}

(debug) RequestContext: Adding breadcrumb {
  category: 'VideoHandler',
  message: 'Serving from KV cache',
  elapsedMs: '142.00',
  durationMs: '0.00'
}

(info) {
  time: 1743436212142,
  level: 30,
  requestId: 'b3e9d7a4-f6c2-4d88-9f3c-8a2e11b9f431',
  url: 'https://cdn.erfi.dev/videos/sample.mp4',
  path: '/videos/sample.mp4',
  elapsedMs: 142,
  category: 'VideoHandler',
  breadcrumb: {
    timestamp: 1743436212142,
    category: 'VideoHandler',
    message: 'Serving from KV cache',
    data: {
      url: 'https://cdn.erfi.dev/videos/sample.mp4',
      path: '/videos/sample.mp4'
    },
    elapsedMs: 142,
    durationMs: 0
  },
  breadcrumbsCount: 14,
  msg: 'Serving from KV cache'
}

(debug) RequestContext: Adding breadcrumb {
  category: 'Cache',
  message: 'Completed cache-lookup',
  elapsedMs: '142.00',
  durationMs: '139.00'
}

(debug) RequestContext: Adding breadcrumb {
  category: 'Cache',
  message: 'KV cache hit',
  elapsedMs: '142.00',
  durationMs: '0.00'
}

(debug) RequestContext: Adding breadcrumb {
  category: 'Response',
  message: 'Started response-building',
  elapsedMs: '142.00',
  durationMs: '0.00'
}

(debug) RequestContext: Adding breadcrumb {
  category: 'Response',
  message: 'Processing headers for response',
  elapsedMs: '142.00',
  durationMs: '0.00'
}

(debug) RequestContext: Adding breadcrumb {
  category: 'Response',
  message: 'Building response with enhanced streaming support',
  elapsedMs: '142.00',
  durationMs: '0.00'
}

(debug) RequestContext: Adding breadcrumb {
  category: 'Response',
  message: 'Creating media content response',
  elapsedMs: '142.00',
  durationMs: '0.00'
}

(debug) RequestContext: Adding breadcrumb {
  category: 'Response',
  message: 'Completed response-building',
  elapsedMs: '146.00',
  durationMs: '4.00'
}

(debug) RequestContext: Adding breadcrumb {
  category: 'Request',
  message: 'Completed total-request-processing',
  elapsedMs: '146.00',
  durationMs: '143.00'
}
```

## Request Flow Analysis

This log sequence demonstrates the complete flow when a video is served from KV cache:

1. **Request Initialization**: The request is received and initial context is created
2. **Cache Lookup**: The worker begins checking for cached versions of the video
3. **CF Cache Check**: First, it checks the Cloudflare Cache API and gets a miss
4. **KV Cache Check**: Next, it checks the KV cache and finds a hit
5. **Cached Content Retrieval**: The worker retrieves the transformed video from KV
6. **Response Building**: The KV-cached content is used to build the response
7. **Response Delivery**: The response is returned to the client

## Performance Benefits

The log timestamps show the efficiency of the caching strategy:

1. **Total Request Time**: Only 146ms from start to finish
2. **KV Retrieval Time**: 119ms to retrieve the cached video from KV
3. **Response Building**: Just 4ms to build the final response

Without caching, a typical video transformation could take several seconds:
- Video fetch from origin: 500-1000ms
- Transformation processing: 1000-3000ms
- Response building: 10-50ms

## Cache Management Insights

The KV cache hit provides valuable information:

```
KVCacheUtils: KV cache hit {
  sourcePath: '/videos/sample.mp4',
  derivative: 'medium',
  createdAt: '2025-03-31T17:46:30.000Z',
  expiresAt: '2025-04-01T17:46:30.000Z',
  contentLength: 1843092,
  contentType: 'video/mp4'
}
```

This shows:
- The cache key includes both the path and the derivative
- The cached entry is fresh (created 3m 42s ago)
- The cache TTL is approximately 24 hours (expires tomorrow)
- The content size is about 1.8MB
- The content type is properly preserved

## Multi-Level Caching Strategy

This log sequence demonstrates the worker's multi-level caching strategy:

1. **CF Cache (Edge Cache)**: Checked first for best performance
2. **KV Cache (Global Storage)**: Checked second when CF cache misses
3. **Origin + Transformation**: Only executed if both caches miss

This approach ensures optimized performance and reduced costs while still maintaining flexibility for updates and purges.
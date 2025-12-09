# Video Resizer Performance Tuning Guide

*Last Updated: December 9, 2025*

This guide provides practical advice for optimizing the performance of your Video Resizer implementation. It covers caching strategies, configuration optimizations, network performance, and client-side enhancements.

## Table of Contents

- [Introduction](#introduction)
- [Measuring Performance](#measuring-performance)
- [Caching Optimization](#caching-optimization)
  - [Multi-Layer Caching Strategy](#multi-layer-caching-strategy)
  - [Cache Key Optimization](#cache-key-optimization)
  - [Cache TTL Tuning](#cache-ttl-tuning)
  - [Cache Versioning Strategy](#cache-versioning-strategy)
- [Cold Start Optimization](#cold-start-optimization)
- [Network Performance](#network-performance)
  - [Range Request Optimization](#range-request-optimization)
  - [Origin Request Reduction](#origin-request-reduction)
- [Client-Side Optimization](#client-side-optimization)
  - [Network Quality Detection](#network-quality-detection)
  - [Device Capability Detection](#device-capability-detection)
  - [Responsive Dimension Optimization](#responsive-dimension-optimization)
- [Resource Usage Optimization](#resource-usage-optimization)
- [Configuration Performance](#configuration-performance)
- [Monitoring and Analytics](#monitoring-and-analytics)

## Introduction

The Video Resizer is designed for high performance on Cloudflare's edge network. This guide helps you fine-tune performance for your specific use cases, focusing on the most impactful optimizations.

## Measuring Performance

Before optimizing, establish baseline performance metrics:

1. **Enable Performance Monitoring**:

```json
{
  "debug": {
    "enablePerformanceMonitoring": true,
    "performanceSampleRate": 100
  }
}
```

2. **Collect Performance Data**:

   Access the debug UI to view performance metrics:
   ```
   https://videos.example.com/sample.mp4?debug=view
   ```

   Key metrics to monitor:
   - Origin fetch time
   - Transformation time
   - Cache lookup time
   - Total response time
   - Cache hit rate
   - Cold start duration

3. **Use Headers for Tracking**:

   Set debug headers to capture metrics in your analytics:
   
   ```json
   {
     "debug": {
       "enableHeaders": true,
       "performanceHeaderPrefix": "X-Performance-"
     }
   }
   ```

## Caching Optimization

### KV-First Caching Strategy

Cache API storage is disabled; all caching uses KV (with chunking for large objects).

**Best Practices**:

- Keep KV enabled in `cache` config and versioning on for safe purges.
- Use derivatives wherever possible to maximize hit rates and reduce key cardinality.
- Leave `storeIndefinitely` off unless you have tag-based purge automation.
- Strip cache-busting params upstream if you need consistent keys (`nocache`, `bypass`, `debug` are already bypassed by the worker).

### Cache Key Optimization

Keys are derivative-first and sanitized automatically.

**Best Practices**:

- Use configured derivatives + responsive breakpoints instead of arbitrary widths to keep key cardinality low.
- Avoid adding query params that don’t affect the output; they reduce hit rates.
- `debug`, `bypass`, and `nocache` already bypass caching—don’t rely on them for content variation.

### Cache TTL Tuning

Configure TTLs based on content type and response status:

```json
{
  "cache": {
    "profiles": {
      "highTraffic": {
        "regex": ".*/trending/.*\\.mp4$",
        "ttl": {
          "ok": 604800,        // 7 days
          "redirects": 3600,    // 1 hour
          "clientError": 60,    // 1 minute
          "serverError": 10     // 10 seconds
        }
      },
      "regularContent": {
        "regex": ".*\\.mp4$",
        "ttl": {
          "ok": 86400,         // 24 hours
          "redirects": 3600,    // 1 hour
          "clientError": 60,    // 1 minute
          "serverError": 10     // 10 seconds
        }
      },
      "dynamic": {
        "regex": ".*/live/.*\\.mp4$",
        "ttl": {
          "ok": 300,           // 5 minutes
          "redirects": 60,      // 1 minute
          "clientError": 30,    // 30 seconds
          "serverError": 10     // 10 seconds
        }
      }
    }
  }
}
```

**Best Practices**:

- Use longer TTLs for popular, static content
- Use shorter TTLs for dynamic or frequently updated content
- Set very short TTLs for error responses
- Create content-specific profiles based on update frequency

### Cache Versioning Strategy

Implement efficient cache versioning for controlled invalidation:

```json
{
  "cacheVersioning": {
    "enabled": true,
    "autoIncrement": true,
    "incrementOnError": true,
    "pathSpecificVersions": true
  }
}
```

**Best Practices**:

- Enable `autoIncrement` for specific error types to auto-refresh content
- Use `pathSpecificVersions` to invalidate only specific paths
- Increment versions only when content actually changes
- For busy sites, schedule version increments during low-traffic periods

## Cold Start Optimization

Optimize worker initialization for fast cold starts:

```json
{
  "initialization": {
    "useDefaults": true,
    "deferredConfigLoading": true,
    "configCacheTtl": 300
  }
}
```

**Best Practices**:

- Keep default configuration lightweight and focused on critical settings
- Use deferred configuration loading for non-critical settings
- Cache configuration in memory to reduce KV operations
- Consider warming strategies for critical workers:

```js
// Scheduled warmer
addEventListener('scheduled', event => {
  event.waitUntil(
    fetch('https://videos.example.com/warmup')
  );
});
```

## Network Performance

### Range Request Optimization

Optimize for video seeking and partial content delivery:

```json
{
  "rangeRequests": {
    "enabled": true,
    "cacheFullVideo": true,
    "backgroundFill": true,
    "optimizedRangeSize": 2097152  // 2MB optimal chunk size
  }
}
```

**Best Practices**:

- Enable `cacheFullVideo` to improve seeking performance
- Use `backgroundFill` to fetch full videos in the background
- Optimize range sizes based on your content
- Balance between range size and initial load time

### Origin Request Reduction

Minimize origin requests to improve performance and reduce costs:

```json
{
  "originRequests": {
    "filterQueryParams": true,
    "combineRequests": true,
    "usePresignedUrls": true,
    "presignedUrlTtl": 900,  // 15 minutes
    "maxRetries": 2
  }
}
```

**Best Practices**:

- Filter unnecessary query parameters from origin requests
- Use presigned URLs for S3/R2 origins to reduce authentication overhead
- Cache presigned URLs to reduce signing operations
- Optimize origin selection based on geography and load

## Client-Side Optimization

### Network Quality Detection

Adapt video quality based on client network capabilities:

```json
{
  "clientDetection": {
    "enableNetworkQuality": true,
    "respectSaveData": true,
    "qualityAdjustment": {
      "slow-2g": "low",
      "2g": "low",
      "3g": "medium",
      "4g": "high"
    }
  }
}
```

**Best Practices**:

- Enable network quality detection for mobile users
- Respect Save-Data header for users with data caps
- Create quality presets for different network speeds
- Use progressive enhancement (start low, increase quality if possible)

### Device Capability Detection

Optimize video delivery based on device type:

```json
{
  "clientDetection": {
    "enableDeviceDetection": true,
    "devicePresets": {
      "mobile": {
        "derivative": "mobile",
        "maxWidth": 480
      },
      "tablet": {
        "derivative": "medium",
        "maxWidth": 800
      },
      "desktop": {
        "derivative": "high",
        "maxWidth": 1280
      }
    }
  }
}
```

**Best Practices**:

- Create device-specific presets for common device types
- Use appropriate maximum dimensions for each device category
- Consider battery status for mobile devices (reduce quality for low battery)
- Detect HDR capability and codec support for advanced optimizations

### Responsive Dimension Optimization

Implement dimension normalization to improve cache hit rates:

```json
{
  "dimensions": {
    "normalization": true,
    "roundingFactor": 10,
    "breakpoints": [360, 480, 720, 1080, 1440, 1920],
    "maintainAspectRatio": true
  }
}
```

**Best Practices**:

- Round dimensions to improve cache hit rates
- Use standard breakpoints rather than arbitrary dimensions
- Maintain aspect ratios to preserve video quality
- For responsive sites, integrate with IMQuery for automatic sizing

## Resource Usage Optimization

Optimize resource usage for both the worker and clients:

```json
{
  "resources": {
    "maxVideoDuration": 300,     // 5 minutes
    "maxFileSize": 104857600,    // 100MB
    "optimizeForFirstPlay": true,
    "autoStartPosition": "10%"
  }
}
```

**Best Practices**:

- Set reasonable duration limits for transformed videos
- Configure file size limits with automatic fallback to original
- Optimize startup time with reduced initial quality that improves after load
- Consider thumbnail or poster image optimization for faster perceived loading

## Configuration Performance

Optimize configuration for best performance:

```json
{
  "configuration": {
    "inMemoryCaching": true,
    "cacheTtl": 300,
    "minimalDefaults": true,
    "asyncUpdates": true
  }
}
```

**Best Practices**:

- Use in-memory caching to reduce KV reads
- Keep default configuration minimal and fast to parse
- Use asynchronous updates for non-critical configuration changes
- Structure configuration for fast access to frequently used values

## Monitoring and Analytics

Implement performance monitoring to identify optimization opportunities:

```json
{
  "monitoring": {
    "enableMetrics": true,
    "sampleRate": 10,            // 10% of requests
    "detailedTimings": true,
    "errorTracking": true,
    "cacheAnalytics": true
  }
}
```

**Best Practices**:

- Monitor cache hit rates to identify optimization opportunities
- Track transformation times across different content types
- Analyze patterns in cache misses
- Use performance data to guide TTL and dimension normalization strategies

Example debugging command for performance analysis:

```bash
# Analyze performance metrics from logs
wrangler tail --filter "performance"

# Use the debug tool to analyze cache hit rates
node tools/config-debug.js --analyze-cache-hits
```

---

By applying these optimization strategies, you can significantly improve the performance of your Video Resizer implementation, reducing latency, minimizing origin traffic, and enhancing the user experience across different devices and network conditions.

For more detailed information on the underlying systems, refer to the [Caching Architecture](../caching/caching-architecture.md) and [Configuration Reference](../configuration/configuration-guide.md) documentation.

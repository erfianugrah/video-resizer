# Presigned URL Monitoring Plan

This document outlines the monitoring strategy for the presigned URL system in the video-resizer project, covering metrics collection, alerting thresholds, dashboard implementation, and operational guidelines.

## Core Metrics

### Performance Metrics

1. **Presigned URL Generation Time**
   - Description: Time taken to generate a new presigned URL
   - Measurement: Average, P95, P99 latency in milliseconds
   - Target: <100ms average, <200ms P95, <500ms P99
   - Collection: Log at the end of getOrGeneratePresignedUrlImpl function

2. **Cache Hit Rate**
   - Description: Percentage of presigned URL requests served from cache
   - Measurement: Hits / (Hits + Misses) * 100
   - Target: >90% for production traffic
   - Collection: Increment counters in getPresignedUrl function

3. **URL Refresh Rate**
   - Description: Percentage of cache hits requiring background refresh
   - Measurement: Refreshes / Hits * 100
   - Target: <10% of cache hits
   - Collection: Track in isUrlExpiring and refreshPresignedUrl functions

4. **End-to-End Latency**
   - Description: Total time for URL processing including presigning
   - Measurement: Average, P95, P99 latency in milliseconds
   - Target: <150ms average, <300ms P95, <800ms P99
   - Collection: Measure in buildCdnCgiMediaUrlAsync function

### Reliability Metrics

1. **Presigning Error Rate**
   - Description: Percentage of presigned URL generation attempts that fail
   - Measurement: Errors / (Successes + Errors) * 100
   - Target: <0.1% for production traffic
   - Collection: Track in catch blocks of getOrGeneratePresignedUrlImpl

2. **Fallback Usage Rate**
   - Description: Percentage of requests using fallback mechanisms
   - Measurement: Fallbacks / Total Requests * 100
   - Target: <1% of total requests
   - Collection: Track in error handling service

3. **KV Operation Success Rate**
   - Description: Success rate of KV storage operations
   - Measurement: Successful Operations / Total Operations * 100
   - Target: >99.9% success rate
   - Collection: Track in storePresignedUrl and getPresignedUrl functions

4. **URL Expiration Events**
   - Description: Number of times an expired URL was detected
   - Measurement: Count per hour
   - Target: <1 per hour in production
   - Collection: Track in isUrlExpiring function

### Resource Usage Metrics

1. **KV Storage Size**
   - Description: Total size of cached presigned URLs
   - Measurement: KB or MB of storage used
   - Target: <80% of allocated KV storage
   - Collection: Calculate based on key counts and average entry size

2. **KV Rate Limiting Events**
   - Description: Number of times KV rate limits were hit
   - Measurement: Count per minute
   - Target: 0 in production
   - Collection: Track specific error types in catch blocks

3. **AWS API Call Volume**
   - Description: Number of calls to AWS SDK for presigned URL generation
   - Measurement: Calls per minute
   - Target: <100 per minute in steady state
   - Collection: Count in getOrGeneratePresignedUrlImpl before AWS SDK calls

## Implementation Plan

### Phase 1: Basic Instrumentation

1. **Add Timing Metrics**
   - Instrument key functions with performance timing
   - Create standard logging format for metrics
   - Establish baseline performance

2. **Add Counter Metrics**
   - Implement hit/miss counters
   - Track error rates
   - Measure resource usage

3. **Standardize Error Logging**
   - Create consistent error categories
   - Add correlation IDs for request tracking
   - Implement structured error logging

### Phase 2: Dashboard Implementation

1. **Real-time Metrics Dashboard**
   - Create dashboard showing:
     - Cache hit rates
     - Error rates
     - Latency metrics
     - Resource usage

2. **Historical Trends**
   - Implement time-series data visualization
   - Show daily/weekly/monthly patterns
   - Track performance regression

3. **Anomaly Detection**
   - Add outlier detection for latency spikes
   - Implement error rate anomaly detection
   - Create baseline deviation alerts

### Phase 3: Alerting System

1. **Critical Alerts**
   - High error rates (>1%)
   - Sustained high latency (>300ms for 5 minutes)
   - KV rate limiting events
   - Multiple URL expiration events

2. **Warning Alerts**
   - Cache hit rate drops below 85%
   - Refresh rate exceeds 15%
   - KV storage approaching 80% capacity
   - Unusual traffic patterns

3. **Informational Alerts**
   - Daily performance report
   - Weekly usage statistics
   - Monthly trend analysis

## Dashboard Mockup

```
+----------------------------------+----------------------------------+
|  Cache Performance               |  Error Rate                      |
|                                  |                                  |
|  Hit Rate: 94.3%                 |  URL Generation: 0.02%           |
|  [██████████████████▒▒] +2.1%    |  [▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒] -0.01%   |
|                                  |                                  |
|  Refresh Rate: 7.2%              |  KV Operations: 0.00%            |
|  [███▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒] -1.3%    |  [▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒] +0.00%   |
+----------------------------------+----------------------------------+
|  Latency (ms)                    |  Resource Usage                  |
|                                  |                                  |
|  URL Generation: 42ms            |  KV Storage: 12.4MB              |
|  Avg: 42ms | P95: 87ms | P99:156ms |  KV Rate Limit: 0 hits            |
|                                  |                                  |
|  End-to-End: 104ms               |  AWS Calls: 32/min               |
|  Avg: 104ms | P95: 187ms | P99:326ms |  Active Keys: 1,423             |
+----------------------------------+----------------------------------+
|                                                                     |
|                       Last 24 Hours Trend                           |
|                                                                     |
|  Hit Rate     ︎︎︎︎_______/‾‾‾\________/‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾       |
|  Latency      ‾‾‾‾‾‾‾\___/‾‾‾‾‾‾‾‾‾‾\________________/‾‾‾‾‾       |
|  Errors       ‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾      |
|                                                                     |
+---------------------------------------------------------------------+
```

## Implementation in Code

### Metrics Collection Example

```typescript
// In presignedUrlCacheService.ts

// Metric counters
let cacheHits = 0;
let cacheMisses = 0;
let cacheRefreshes = 0;
let cacheErrors = 0;

export async function getPresignedUrl(
  kv: KVNamespace,
  path: string,
  options: PresignedUrlOptions
): Promise<CachedPresignedUrl | null> {
  const start = performance.now();
  
  try {
    const key = generatePresignedUrlKey(path, options);
    const cachedData = await kv.get(key, 'json');
    
    if (!cachedData) {
      cacheMisses++;
      logMetric('presigned_url_cache_miss', { path: truncatePath(path) });
      return null;
    }
    
    cacheHits++;
    logMetric('presigned_url_cache_hit', { path: truncatePath(path) });
    
    // Check expiration
    if (isUrlExpiring(cachedData)) {
      cacheRefreshes++;
      logMetric('presigned_url_refresh_needed', { path: truncatePath(path) });
      // Trigger background refresh
      refreshPresignedUrl(kv, path, options, cachedData.originalUrl);
    }
    
    return cachedData;
  } catch (err) {
    cacheErrors++;
    logMetric('presigned_url_cache_error', { 
      path: truncatePath(path),
      error: err.message 
    });
    throw err;
  } finally {
    const duration = performance.now() - start;
    logMetric('presigned_url_cache_duration', { 
      duration_ms: Math.round(duration),
      operation: 'get'
    });
  }
}
```

### Metrics Reporting

```typescript
// In metricsService.ts

interface MetricData {
  name: string;
  value: number;
  tags: Record<string, string>;
  timestamp: number;
}

const metrics: MetricData[] = [];

export function logMetric(
  name: string, 
  tags: Record<string, string> = {}, 
  value: number = 1
) {
  metrics.push({
    name,
    value,
    tags,
    timestamp: Date.now()
  });
  
  // If we have enough metrics, flush them
  if (metrics.length >= 50) {
    flushMetrics();
  }
}

function flushMetrics() {
  // In a real implementation, this would send metrics to a storage backend
  // For now, we'll just log them
  if (metrics.length === 0) return;
  
  console.log(`Flushing ${metrics.length} metrics`);
  
  // Clone and clear the metrics array
  const metricsToFlush = [...metrics];
  metrics.length = 0;
  
  // In a production implementation, send to metrics collection service
  // Example: fetch('https://metrics-api.example.com', {
  //   method: 'POST',
  //   body: JSON.stringify(metricsToFlush)
  // });
}

// Ensure metrics are flushed before the worker terminates
addEventListener('unload', () => {
  flushMetrics();
});
```

## Operational Guidelines

### Daily Monitoring Routine

1. **Morning Check (Start of Day)**
   - Review dashboard for overnight issues
   - Check error rates and latency trends
   - Verify KV storage usage
   - Confirm no alerts were triggered

2. **Periodic Checks (Every 4 Hours)**
   - Review real-time performance metrics
   - Check for any warning-level alerts
   - Verify cache hit rates remain healthy

3. **End of Day Review**
   - Analyze daily trends
   - Note any performance degradation
   - Plan any necessary optimizations
   - Document unusual patterns

### Incident Response

1. **High Error Rates**
   - Check AWS credential status
   - Verify KV namespace accessibility
   - Review recent code deployments
   - Consider rolling back recent changes
   - Check for AWS outages

2. **Cache Performance Issues**
   - Analyze hit/miss patterns
   - Check for sudden traffic changes
   - Verify cache key generation
   - Consider cache warming if hit rate is low
   - Check if URLs are expiring too quickly

3. **Latency Spikes**
   - Determine if issue is in URL generation or KV operations
   - Check for AWS API throttling
   - Review worker CPU usage
   - Analyze concurrent request patterns
   - Consider scaling strategies if needed

## Conclusion

This monitoring plan provides a comprehensive approach to ensuring the presigned URL system remains performant, reliable, and efficient. By implementing these metrics and monitoring processes, we can quickly identify and resolve issues, optimize performance, and ensure a high-quality user experience.

The monitoring implementation should be deployed alongside the enhanced presigned URL system to provide immediate visibility into its performance and behavior. Regular reviews of the collected metrics will help guide future optimization efforts and ensure the system continues to meet or exceed its performance targets.
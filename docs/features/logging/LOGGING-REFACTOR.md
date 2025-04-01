# Performance Monitoring Implementation

This document outlines the performance monitoring and breadcrumb timing implementation added to the video-resizer service.

## Overview

We've implemented a comprehensive performance monitoring system to track and diagnose performance issues in the video-resizer service. This system combines detailed breadcrumb timing with explicit operation timing to provide insights into where requests spend their time.

## Key Components

### 1. Timed Operations

The `TimedOperation` interface tracks specific operations within request processing:

```typescript
export interface TimedOperation {
  startTime: number;      // When the operation started
  endTime?: number;       // When the operation ended (if completed)
  duration?: number;      // Duration of the operation
  category?: string;      // Category for breadcrumb grouping
}
```

Operations are managed through two primary functions:

```typescript
// Start timing an operation
startTimedOperation(context, 'operation-name', 'Category');

// End timing and get duration
const duration = endTimedOperation(context, 'operation-name');
```

### 2. Enhanced Breadcrumbs

Breadcrumbs have been enhanced with timing information:

```typescript
export interface Breadcrumb {
  timestamp: number;       // When this event occurred
  category: string;        // Component/category name
  message: string;         // Event description
  data?: Record<string, unknown>; // Additional context data
  durationMs?: number;     // Duration since last breadcrumb
  elapsedMs?: number;      // Time since request start
}
```

The `addBreadcrumb` function automatically calculates:
- `elapsedMs`: Time elapsed since the request started
- `durationMs`: Time elapsed since the previous breadcrumb

### 3. Performance Metrics Collection

Performance metrics are collected and exposed through:

```typescript
// Get consolidated performance metrics
getPerformanceMetrics(context);

// Metrics include:
{
  totalElapsedMs: number;                  // Total time elapsed for request
  componentTiming: Record<string, number>; // Time spent in each component
  operations: Record<string, number>;      // Duration of tracked operations
  breadcrumbCount: number;                 // Total breadcrumbs recorded
}
```

### 4. Debug Headers

Performance metrics are exposed in HTTP response headers when debug mode is enabled:

```
X-Total-Processing-Time: 123.45ms
X-Breadcrumb-Count: 15
X-Component-1-Time: Cache=45.12ms
X-Component-2-Time: Transform=35.67ms
X-Component-3-Time: Response=12.34ms
```

## Configuration

Performance tracking is configured via the `LoggingConfigurationManager`:

```typescript
// In wrangler.jsonc
"LOGGING_CONFIG": {
  // ...other logging settings...
  "enablePerformanceLogging": true,
  "performanceThresholdMs": 100
}
```

- `enablePerformanceLogging`: Enables detailed performance tracking
- `performanceThresholdMs`: Sets threshold for what's considered "slow" (in ms)

## Implementation Details

### In Video Handler

The main request handler uses timed operations for key processing phases:

```typescript
// Start timing the entire request processing
startTimedOperation(context, 'total-request-processing', 'Request');

// Time specific operations
startTimedOperation(context, 'cache-lookup', 'Cache');
const cachedResponse = await getCachedResponse(request);
endTimedOperation(context, 'cache-lookup');

// More operations...

// End the total request timing
endTimedOperation(context, 'total-request-processing');
```

### In Breadcrumb System

Breadcrumbs automatically track component timing:

```typescript
// When a breadcrumb is added with durationMs
if (breadcrumb.durationMs !== undefined) {
  context.componentTiming[category] = 
    (context.componentTiming[category] || 0) + breadcrumb.durationMs;
}
```

### In Debug Service

Performance metrics are exposed in debug headers:

```typescript
// Add total processing time
newHeaders.set('X-Total-Processing-Time', `${performanceMetrics.totalElapsedMs.toFixed(2)}ms`);

// Add timings for top components
const topComponents = Object.entries(componentTimings)
  .sort(([, timeA], [, timeB]) => Number(timeB) - Number(timeA))
  .slice(0, 3);

topComponents.forEach(([component, time], index) => {
  newHeaders.set(`X-Component-${index+1}-Time`, 
    `${component}=${(Number(time)).toFixed(2)}ms`);
});
```

## Best Practices

### 1. Track Key Operations

Time important operations to understand performance bottlenecks:

```typescript
startTimedOperation(context, 'descriptive-operation-name', 'Category');
// Operation code here
endTimedOperation(context, 'descriptive-operation-name');
```

### 2. Use Consistent Categories

Use standardized categories for operations:
- `Request`: Overall request handling
- `Cache`: Cache lookup and storage
- `Transform`: Video transformation
- `Client`: Client capability detection
- `Response`: Response building
- `Error`: Error handling

### 3. Use Detail-Rich Breadcrumbs

Add contextual data to breadcrumbs:

```typescript
addBreadcrumb(context, 'TransformationService', 'Transformed video', {
  quality: options.quality,
  width: options.width,
  height: options.height,
  format: options.format,
  compressionLevel: options.compression,
  durationMs: transformTime,
  originalSize: sourceSize,
  transformedSize: resultSize
});
```

### 4. Analyze Patterns

Look for patterns in performance data:
- Components consuming the most time
- Operations that frequently exceed thresholds
- Correlation between parameters and performance
- Device/network conditions impact on performance

## Future Enhancements

1. **Performance Sampling**: Implement sampling for high-traffic scenarios
2. **Client-Side Timing**: Add server-timing headers for browser DevTools integration
3. **Adaptive Thresholds**: Automatically adjust thresholds based on historical performance
4. **Performance Visualization**: Create a dashboard for viewing performance trends
5. **Correlation Analysis**: Connect performance data with request parameters and client characteristics

## Conclusion

This performance monitoring system provides detailed insights into video-resizer operation timing, enabling identification of bottlenecks and optimization opportunities.
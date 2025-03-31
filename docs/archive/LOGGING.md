# Video Resizer Logging System

## Overview

The Video Resizer service uses a standardized logging system based on Pino with request context tracking and breadcrumb support. This document outlines the logging architecture, usage patterns, and best practices.

## Key Components

### 1. RequestContext

The `RequestContext` object tracks request-scoped information including:

- `requestId`: Unique identifier for the request
- `breadcrumbs`: Chronological events during request processing
- `diagnostics`: Extended debugging information
- `componentTiming`: Performance metrics for components

```typescript
// Access via legacy adapter (automatically initialized in handler)
const requestContext = getCurrentContext();

// Or create a new context directly
const context = createRequestContext(request);
```

### 2. Pino Logger

A structured logger with request context and breadcrumb support.

```typescript
// Get the current request context
const requestContext = getCurrentContext();

// Create a logger for this context
const logger = createLogger(requestContext);

// Log with various levels
pinoDebug(requestContext, logger, 'Component', 'Message', { data: 'value' });
pinoInfo(requestContext, logger, 'Component', 'Message', { data: 'value' });
pinoWarn(requestContext, logger, 'Component', 'Message', { data: 'value' });
pinoError(requestContext, logger, 'Component', 'Message', { data: 'value' });
```

### 3. Legacy Adapter

Provides backward compatibility with existing code using the legacy logging system.

```typescript
// Import from legacy logger adapter
import { debug, info, warn, error } from '../utils/legacyLoggerAdapter';

// Log using component and message
debug('Component', 'Debug message', { data: 'value' });
info('Component', 'Info message', { data: 'value' });
warn('Component', 'Warning message', { data: 'value' });
error('Component', 'Error message', { data: 'value' });
```

## Best Practices

### 1. Use Request Context

Always use the request context when available for proper tracking:

```typescript
const requestContext = getCurrentContext();
if (requestContext) {
  const logger = createLogger(requestContext);
  pinoDebug(requestContext, logger, 'Component', 'Message', { data: 'value' });
} else {
  // Fallback for cases where context isn't available
  console.warn('Component: No request context available');
}
```

### 2. Include Structured Data

Always include relevant structured data with logs:

```typescript
pinoDebug(context, logger, 'CacheService', 'Cache miss', {
  key: 'cache-key',
  ttl: 3600,
  storeType: 'memory'
});
```

### 3. Use Consistent Component Names

Use consistent component names (usually the service or utility name):

- `VideoTransformationService`
- `CacheManagementService`
- `TransformVideoCommand`
- `RequestContext`

### 4. Log Level Guidelines

- **Debug**: Detailed information for debugging
- **Info**: Normal application behavior
- **Warn**: Something unexpected but not an error
- **Error**: Application errors that need attention

## Configuration

Logging is configured via the `LoggingConfigurationManager`:

```typescript
LoggingConfigurationManager.getInstance().updateConfig({
  level: 'debug',          // debug, info, warn, error
  format: 'text',          // text or json
  colorize: true,          // ANSI colors in development
  sampleRate: 1.0          // 0.0 to 1.0 for sampling logs
});
```

This can also be set via environment variables or the wrangler.jsonc file.

## Debug Headers and Breadcrumbs

Breadcrumbs are automatically added to the request context and can be accessed in debug mode via response headers or the debug UI.

Example debug information in response headers:

```
X-Video-Resizer-Debug: true
X-Processing-Time-Ms: 123
X-Breadcrumbs-Count: 15
X-Component-Timing: {"VideoTransformationService":45,"CacheService":12}
```

## Migration Guide

If you're adding a new service or updating an existing one, follow these steps for logging:

1. Import the necessary logging functions:

```typescript
import { getCurrentContext } from '../utils/legacyLoggerAdapter';
import { createLogger, debug as pinoDebug, info as pinoInfo, warn as pinoWarn, error as pinoError } from '../utils/pinoLogger';
```

2. Get the current request context and create a logger:

```typescript
const requestContext = getCurrentContext();
if (requestContext) {
  const logger = createLogger(requestContext);
  pinoDebug(requestContext, logger, 'YourComponent', 'Your message', yourData);
} else {
  // Fallback for when context isn't available
  console.warn('YourComponent: No request context available');
}
```

3. For error handling, include as much context as possible:

```typescript
try {
  // Your code
} catch (err) {
  const errMessage = err instanceof Error ? err.message : String(err);
  const errStack = err instanceof Error ? err.stack : undefined;
  
  if (requestContext) {
    const logger = createLogger(requestContext);
    pinoError(requestContext, logger, 'YourComponent', 'Error message', {
      error: errMessage,
      stack: errStack,
      // Additional context
    });
  } else {
    console.error(`YourComponent: Error: ${errMessage}`);
  }
}
```

## Testing

Inside tests, you can mock the request context and logger:

```typescript
import { createRequestContext } from '../utils/requestContext';
import { createLogger } from '../utils/pinoLogger';

// Mock request
const mockRequest = new Request('https://example.com/test');

// Create context and logger
const context = createRequestContext(mockRequest);
const logger = createLogger(context);

// You can now pass these to your components for testing
const service = new YourService(context, logger);
```

## Logging Guidelines for Developers

### 1. Preferred Approach: Direct Pino Logger

Use this approach for new code and when updating high-priority files:

```typescript
import { getCurrentContext } from '../utils/legacyLoggerAdapter';
import { createLogger, debug, info, warn, error } from '../utils/pinoLogger';

// Get the context
const requestContext = getCurrentContext();
if (requestContext) {
  const logger = createLogger(requestContext);
  info(requestContext, logger, 'ComponentName', 'Message here', { optional: 'data' });
}
```

### 2. For Legacy Code: Use the Legacy Adapter

Use this as an intermediate solution when refactoring is more complex:

```typescript
import { debug, info, warn, error } from '../utils/legacyLoggerAdapter';

info('ComponentName', 'Message here', { optional: 'data' });
```

### 3. Never Use Direct Console Calls

```typescript
// DON'T DO THIS
console.log('Some message');

// Instead, do this
import { info } from '../utils/legacyLoggerAdapter';
info('ComponentName', 'Some message');
```

### 4. Handling Circular Dependencies

If you encounter circular dependencies, use dynamic imports:

```typescript
// Instead of static import
// import { debug } from '../utils/legacyLoggerAdapter';

// Use dynamic import to break the circular dependency
async function logSomething() {
  try {
    const { debug } = await import('../utils/legacyLoggerAdapter');
    debug('ComponentName', 'Message here');
  } catch (err) {
    // Fallback for critical logs only if import fails
    console.debug('[ComponentName] Message here');
  }
}
```

### 5. For Initialization Code: Handle Missing Context

```typescript
try {
  // Initialization code here
} catch (err) {
  // If this is initialization code that runs before context exists:
  const errMessage = err instanceof Error ? err.message : String(err);
  console.error(`Initialization error: ${errMessage}`);
  // Once context is available, log properly
}
```

### 6. Migration Strategy for Files with Many Console Calls

1. First, add correct imports at the top:
   ```typescript
   import { getCurrentContext } from '../utils/legacyLoggerAdapter';
   import { createLogger, debug as pinoDebug, error as pinoError } from '../utils/pinoLogger';
   ```

2. Create a logging helper function for the file (to avoid code duplication):
   ```typescript
   /**
    * Log a debug message
    */
   function logDebug(category: string, message: string, data?: Record<string, unknown>) {
     const requestContext = getCurrentContext();
     if (requestContext) {
       const logger = createLogger(requestContext);
       pinoDebug(requestContext, logger, category, message, data);
     } else {
       // Fall back to console as a last resort
       console.debug(`[${category}] ${message}`, data || {});
     }
   }
   ```

3. Replace console calls systematically:
   ```typescript
   // OLD:
   console.debug(`VideoStorageService: Path transformation for ${path} to ${transformedPath}`);
   
   // NEW:
   logDebug('VideoStorageService', 'Path transformation', { 
     path, 
     transformedPath 
   });
   ```

## Implementation Status

All direct application-level console calls have been replaced with appropriate helper functions. The only remaining console.* calls are:

1. **Helper Function Fallbacks**: Intentional console.* calls in helper functions that provide fallbacks when request context is unavailable
2. **Legacy Logger Adapter**: Intentional console.* calls in legacyLoggerAdapter.ts that serve as fallbacks for the logging system itself
3. **Browser-Side Logging**: Intentional console.log calls for browser-side debugging in injected scripts
4. **Initialization Logging**: Intentional console.error calls in helper functions for initialization-time errors

In total, we have replaced approximately 137 direct console.* calls with consistent logging patterns across all components.

## Enhanced Breadcrumb Logging

### Context-Rich Breadcrumbs

To improve debugging capabilities, breadcrumbs should include comprehensive contextual data. Follow these guidelines for creating rich breadcrumbs:

#### 1. Operation Parameters

Include all relevant operation parameters in breadcrumbs:

```typescript
// GOOD
addBreadcrumb(context, 'VideoTransformationService', 'Transforming video', {
  quality: options.quality,
  format: options.format,
  width: dimensions.width,
  height: dimensions.height,
  originalFormat: detectedFormat,
  compressionLevel: compressionConfig.level
});

// NOT ENOUGH CONTEXT
addBreadcrumb(context, 'VideoTransformationService', 'Transforming video');
```

#### 2. Decision Points

Log reasoning for important decisions:

```typescript
addBreadcrumb(context, 'ClientAdaptivityService', 'Selected quality preset', {
  selectedQuality: 'high',
  reason: 'Network conditions optimal',
  bandwidth: clientHints.downlink,
  connectionType: clientHints.connectionType,
  deviceMemory: clientHints.deviceMemory
});
```

#### 3. Response Metadata

Include response details in fetch operation breadcrumbs:

```typescript
addBreadcrumb(context, 'TransformVideoCommand', 'CDN-CGI response received', {
  status: response.status,
  statusText: response.statusText,
  contentType: response.headers.get('Content-Type'),
  contentLength: response.headers.get('Content-Length'),
  serverTiming: response.headers.get('Server-Timing'),
  cfRay: response.headers.get('CF-Ray'),
  cacheStatus: response.headers.get('CF-Cache-Status')
});
```

#### 4. Timing Information

Add granular timing information for performance-sensitive operations:

```typescript
const startTime = performance.now();
// ... perform operation ...
const duration = performance.now() - startTime;

addBreadcrumb(context, 'CacheManagementService', 'Cache operation completed', {
  operation: 'put',
  key: cacheKey,
  durationMs: duration,
  size: objectSize,
  ttl: cacheTtl,
  success: true
});
```

#### 5. Client Environment

Include client capabilities in detection breadcrumbs:

```typescript
addBreadcrumb(context, 'ClientHints', 'Client Hints Headers', {
  ua: request.headers.get('User-Agent'),
  deviceType: deviceType,
  viewportWidth: clientHints.viewportWidth,
  viewportHeight: clientHints.viewportHeight,
  dpr: clientHints.dpr,
  browserCodecs: detectedCodecs,
  acceptsWebM: supportsWebM,
  acceptsAV1: supportsAV1,
  preferredFormats: preferenceOrder
});
```

#### 6. Cache Details

Add cache keys and status information:

```typescript
addBreadcrumb(context, 'CacheManagementService', 'Cache lookup', {
  key: `video:${pathHash}:${optionsHash}`,
  namespace: cacheNamespace,
  method: 'cfApi',
  result: cacheHit ? 'HIT' : 'MISS',
  age: cacheHit ? cacheAge : undefined,
  staleDuration: isCacheStale ? staleTime : undefined
});
```

#### 7. Error Context

Provide comprehensive error details:

```typescript
try {
  // Code that might fail
} catch (err) {
  const errorMessage = err instanceof Error ? err.message : String(err);
  const errorName = err instanceof Error ? err.name : 'UnknownError';
  const errorStack = err instanceof Error ? err.stack : undefined;
  
  addBreadcrumb(context, 'TransformVideoCommand', 'Error transforming video', {
    error: errorMessage,
    errorType: errorName,
    stack: errorStack,
    inputParams: JSON.stringify(transformParams),
    attemptCount: retryCount,
    lastSuccessfulOperation: lastOperation
  });
  
  throw err;
}
```

#### 8. Environment Context

Include worker environment information in initialization breadcrumbs:

```typescript
addBreadcrumb(context, 'Worker', 'Initialized video-resizer', {
  version: VERSION,
  environment: ENV,
  region: event.request.cf?.colo,
  country: event.request.cf?.country,
  datacenter: event.request.cf?.datacenter,
  cachingMethod: config.cachingMethod,
  loggingLevel: config.loggingLevel,
  debug: config.debugEnabled
});
```

### Implementation Plan

To enhance breadcrumb coverage across the codebase:

1. **Audit Existing Breadcrumbs**:
   - Review all current breadcrumbs for context completeness
   - Identify key decision points that lack detailed breadcrumbs
   - Prioritize high-value breadcrumb additions

2. **Update Core Services**:
   - Enhance breadcrumbs in VideoTransformationService
   - Add detailed breadcrumbs to CacheManagementService
   - Improve context in TransformVideoCommand

3. **Create Testing Utilities**:
   - Implement breadcrumb assertion utilities for testing
   - Add breadcrumb verification to integration tests

4. **Performance Considerations**:
   - Add conditional verbose breadcrumbs that only activate in debug mode
   - Implement sampling for high-volume breadcrumb points

5. **Visualization Improvements**:
   - Enhance debug UI to display breadcrumb data in a structured format
   - Add timeline visualization for breadcrumb sequence
   - Implement filtering capabilities for breadcrumb categories

### Breadcrumb Standardization

To maintain consistency, adopt these standardized breadcrumb categories:

- `Worker`: Worker lifecycle and initialization events
- `Request`: Request handling and routing
- `Client`: Client capability detection
- `Transform`: Transformation operations
- `Cache`: Cache operations and decisions
- `Storage`: Storage-related operations
- `Response`: Response building and delivery
- `Error`: Error conditions and handling
- `Performance`: Performance-specific measurements

### Example Updated Breadcrumb Flow

```
1. [Worker] Initialized configuration from environment
   {breadcrumbsEnabled: true, maxItems: 100}

2. [Worker] Initialized video-resizer v1.0.0
   {loggingLevel: 'info', environment: 'production', cachingMethod: 'cf', region: 'DFW'}

3. [Request] Incoming request
   {method: 'GET', url: 'https://cdn.example.com/video.mp4', search: '?quality=high'}

4. [Cache] Checking cache
   {key: 'video:a1b2c3:high', method: 'cfApi', result: 'MISS'}

5. [Client] Client Hints Headers
   {ua: 'Mozilla/5.0...', deviceType: 'desktop', viewportWidth: 1920, supportedFormats: ['mp4', 'webm']}

6. [Client] Network Quality
   {downlink: 10.2, rtt: 35, connectionType: '4g', effectiveBandwidth: 8.5}

7. [Transform] Selected quality preset
   {quality: 'high', reason: 'explicit parameter and sufficient bandwidth'}

8. [Transform] Preparing transformation
   {source: 'https://origin.example.com/video.mp4', format: 'mp4', dimensions: {width: 1280, height: 720}}

9. [Transform] CDN-CGI request
   {url: 'https://cdn-cgi/video/...', headers: {range: 'bytes=0-'}}

10. [Transform] CDN-CGI response received
    {status: 200, contentType: 'video/mp4', contentLength: 5283654, cacheStatus: 'MISS'}

11. [Cache] Applying cache headers
    {cacheControl: 'public, max-age=3600', cacheTags: ['video', 'mp4', 'high'], staleWhileRevalidate: 600}

12. [Response] Building final response
    {status: 200, enhancedStreaming: true, headers: {count: 12}, transformTime: 245}
```

This enhanced approach provides significantly more context for debugging complex issues, especially those related to client capability detection, quality selection, and caching behaviors.
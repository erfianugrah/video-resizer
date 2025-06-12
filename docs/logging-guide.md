# Video Resizer Logging Guide

## Overview

The video-resizer project uses a centralized, feature-rich logging system built on top of [Pino](https://github.com/pinojs/pino) - a high-performance Node.js logger. This guide covers how to use the logging system effectively in your code.

## Quick Start

### Basic Usage

```typescript
import { createCategoryLogger } from '@/utils/logger';

// Create a logger for your component
const logger = createCategoryLogger('MyService');

// Use it throughout your component
logger.debug('Processing request', { requestId: '123' });
logger.info('Request completed successfully');
logger.warn('Cache miss, fetching from origin');
logger.error('Failed to process request', { error: 'timeout' });
```

### Direct Logging Functions

You can also use the direct logging functions:

```typescript
import { logDebug, logInfo, logWarn, logError } from '@/utils/logger';

logDebug('MyComponent', 'Debug message', { data: 'value' });
logInfo('MyComponent', 'Info message');
logWarn('MyComponent', 'Warning message');
logError('MyComponent', 'Error message');
```

## Features

### 1. Log Levels

The logging system supports four log levels:
- `debug` - Detailed debugging information
- `info` - General informational messages
- `warn` - Warning messages for potentially problematic situations
- `error` - Error messages for failures

Configure the log level in your configuration:

```json
{
  "logging": {
    "level": "info"
  }
}
```

### 2. Component Filtering

Control which components log messages using patterns:

```json
{
  "logging": {
    "enabledComponents": ["Cache*", "Video*"],
    "disabledComponents": ["*Test", "Debug*"]
  }
}
```

Supported patterns:
- `Cache*` - Matches CacheService, CacheUtils, etc.
- `*Utils` - Matches StringUtils, CacheUtils, etc.
- `Video*Service` - Matches VideoTransformService, VideoStorageService

### 3. Log Enrichment

Add additional context to your logs:

```typescript
logger.info('Processing large file', { size: fileSize }, {
  enrich: {
    includeMemoryUsage: true,
    includeRequestMetadata: true,
    includeTiming: true,
    includeEnvironment: true
  }
});
```

This adds:
- **Memory Usage**: Heap used, total, RSS, external
- **Request Metadata**: URL, request ID, breadcrumb count
- **Timing**: Elapsed time, timestamp
- **Environment**: Runtime, platform, Node version

### 4. Performance Monitoring

Track operation performance automatically:

```typescript
import { startPerformanceMeasurement } from '@/utils/logger';

const stopMeasurement = startPerformanceMeasurement('fetchVideo', 'VideoService');

// Do your work...
await fetchVideoFromOrigin();

stopMeasurement(); // Automatically logs if operation is slow
```

Performance metrics are:
- Automatically batched and logged every 5 seconds
- Include statistics: average, min, max, P95
- Warn on operations exceeding threshold
- Track top 5 slowest operations

### 5. Error Logging with Context

Log errors with full stack traces and additional context:

```typescript
try {
  await riskyOperation();
} catch (error) {
  logger.errorWithContext('Operation failed', error, {
    userId: currentUser.id,
    operation: 'riskyOperation'
  });
}
```

### 6. Force Logging

Bypass component filtering when needed:

```typescript
// This will log even if 'DebugComponent' is filtered out
logger.debug('Critical debug info', { data }, { force: true });
```

## Configuration

### Complete Configuration Example

```json
{
  "logging": {
    "level": "info",
    "format": "json",
    "includeTimestamps": true,
    "includeComponentName": true,
    "colorize": false,
    "enabledComponents": [],
    "disabledComponents": ["*Test"],
    "sampleRate": 0.1,
    "enablePerformanceLogging": true,
    "performanceThresholdMs": 1000,
    "breadcrumbs": {
      "enabled": true,
      "maxItems": 100
    }
  }
}
```

### Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `level` | string | `"info"` | Minimum log level to output |
| `format` | string | `"text"` | Output format: "json" or "text" |
| `includeTimestamps` | boolean | `true` | Include timestamps in logs |
| `includeComponentName` | boolean | `true` | Include component names |
| `colorize` | boolean | `true` | Colorize output (text format only) |
| `enabledComponents` | string[] | `[]` | Components to enable (empty = all) |
| `disabledComponents` | string[] | `[]` | Components to disable |
| `sampleRate` | number | `1.0` | Log sampling rate (0.0 - 1.0) |
| `enablePerformanceLogging` | boolean | `true` | Enable performance monitoring |
| `performanceThresholdMs` | number | `1000` | Slow operation threshold (ms) |

## Best Practices

### 1. Use Category Loggers

Create a logger instance for each service/component:

```typescript
// ✅ Good - Create once, use throughout the file
const logger = createCategoryLogger('VideoTransformService');

export class VideoTransformService {
  async transform(options: Options) {
    logger.debug('Starting transformation', { options });
    // ...
  }
}

// ❌ Avoid - Don't create logger in each function
function processVideo() {
  const logger = createCategoryLogger('VideoService'); // Don't do this
}
```

### 2. Choose Appropriate Log Levels

```typescript
// Debug - Detailed information for debugging
logger.debug('Cache lookup', { key, pattern, normalized });

// Info - General flow and important events
logger.info('Video transformation completed', { duration, size });

// Warn - Potentially problematic situations
logger.warn('Fallback to secondary origin', { primary: 'failed' });

// Error - Actual errors and failures
logger.error('Transformation failed', { error: err.message });
```

### 3. Structure Your Log Data

```typescript
// ✅ Good - Structured data
logger.info('User action', {
  action: 'upload',
  userId: user.id,
  fileSize: file.size,
  duration: elapsed
});

// ❌ Avoid - Unstructured strings
logger.info(`User ${user.id} uploaded ${file.size} bytes in ${elapsed}ms`);
```

### 4. Use Performance Monitoring for Critical Paths

```typescript
async function criticalOperation() {
  const stop = startPerformanceMeasurement('criticalOp', 'Service');
  
  try {
    const result = await doWork();
    return result;
  } finally {
    stop(); // Always stop measurement
  }
}
```

### 5. Handle Sensitive Data

Never log sensitive information:

```typescript
// ❌ Bad - Logs sensitive data
logger.info('User login', { password: user.password });

// ✅ Good - Omit sensitive fields
logger.info('User login', { 
  userId: user.id, 
  email: user.email 
});
```

## Migration from Old Logging

If you're updating existing code that uses inline logging functions:

```typescript
// Old pattern
function logDebug(message: string, data?: any) {
  console.debug(`Component: ${message}`, data);
}

// New pattern
const logger = createCategoryLogger('Component');
// Then use: logger.debug(message, data);
```

## Troubleshooting

### Logs Not Appearing

1. Check the log level configuration - debug logs won't show if level is "info"
2. Verify component isn't filtered out by `disabledComponents`
3. Check if sampling is reducing log output (`sampleRate` < 1.0)

### Too Many Logs

1. Increase log level (e.g., from "debug" to "info")
2. Use component filtering to disable verbose components
3. Adjust sampling rate for high-volume components

### Performance Impact

1. Avoid logging in tight loops
2. Use sampling for high-frequency operations
3. Be mindful of enrichment options - they add overhead

## Advanced Usage

### Conditional Logging

```typescript
if (logger.isDebugEnabled()) {
  // Expensive operation only for debug
  const debugData = computeExpensiveDebugInfo();
  logger.debug('Detailed debug info', debugData);
}
```

### Custom Enrichment

```typescript
logger.info('Operation complete', {
  ...baseData,
  custom: computeCustomMetrics()
}, {
  enrich: {
    includeMemoryUsage: isMemoryConstrained,
    includeTiming: true
  }
});
```

### Integration with Error Reporting

```typescript
import { logErrorWithContext } from '@/utils/logger';

// Global error handler
process.on('uncaughtException', (error) => {
  logErrorWithContext('System', 'Uncaught exception', error, {
    fatal: true,
    timestamp: new Date().toISOString()
  });
  process.exit(1);
});
```

## Examples

### Service Implementation

```typescript
import { createCategoryLogger } from '@/utils/logger';
import { startPerformanceMeasurement } from '@/utils/logger';

const logger = createCategoryLogger('VideoService');

export class VideoService {
  async processVideo(id: string): Promise<Video> {
    const stop = startPerformanceMeasurement('processVideo', 'VideoService');
    
    logger.info('Processing video', { id });
    
    try {
      // Check cache
      const cached = await this.checkCache(id);
      if (cached) {
        logger.debug('Cache hit', { id });
        return cached;
      }
      
      logger.debug('Cache miss, fetching from origin', { id });
      
      // Process video
      const video = await this.fetchAndTransform(id);
      
      logger.info('Video processed successfully', {
        id,
        size: video.size,
        duration: video.duration
      }, {
        enrich: { includeTiming: true }
      });
      
      return video;
      
    } catch (error) {
      logger.errorWithContext('Failed to process video', error, { id });
      throw error;
    } finally {
      stop();
    }
  }
}
```

### Request Handler

```typescript
import { createCategoryLogger } from '@/utils/logger';

const logger = createCategoryLogger('RequestHandler');

export async function handleRequest(req: Request): Promise<Response> {
  logger.info('Incoming request', {
    method: req.method,
    url: req.url,
    headers: req.headers.entries()
  }, {
    enrich: {
      includeRequestMetadata: true,
      includeEnvironment: true
    }
  });
  
  try {
    const response = await processRequest(req);
    
    logger.info('Request completed', {
      status: response.status,
      headers: response.headers.entries()
    });
    
    return response;
    
  } catch (error) {
    logger.errorWithContext('Request failed', error, {
      url: req.url,
      method: req.method
    });
    
    return new Response('Internal Server Error', { status: 500 });
  }
}
```

## Summary

The centralized logging system provides:
- 🚀 High performance with Pino
- 🎯 Component-based filtering
- 📊 Automatic performance monitoring
- 🔍 Rich context and enrichment options
- 🛡️ Type-safe logging methods
- 📈 Production-ready features

Use it consistently across your codebase for better observability and debugging capabilities.
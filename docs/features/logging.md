# Logging System

*Last Updated: May 1, 2025*

## Table of Contents

- [Overview](#overview)
- [Logging Architecture](#logging-architecture)
- [Log Levels](#log-levels)
- [Log Formats](#log-formats)
- [Structured Logging](#structured-logging)
- [Component-Based Logging](#component-based-logging)
- [Performance Logging](#performance-logging)
- [Log Sampling](#log-sampling)
- [Configuration Options](#configuration-options)
- [Error Logging](#error-logging)
- [Debug Logging](#debug-logging)
- [Log Breadcrumbs](#log-breadcrumbs)
- [Request Context Tracking](#request-context-tracking)
- [Best Practices](#best-practices)
- [Examples](#examples)

## Overview

The Video Resizer implements a comprehensive logging system that provides structured, configurable logs for monitoring, debugging, and performance analysis. The logging system is built around a centralized logging service with support for different log levels, formats, and component-specific filtering.

The logging system helps developers and operators:
- Monitor system behavior and performance
- Diagnose issues and errors
- Track request processing details
- Analyze performance bottlenecks
- Support debugging efforts

## Logging Architecture

The logging system follows a layered architecture:

```mermaid
flowchart TD
    A[Log Function Call] --> B[LoggingManager]
    B --> C{Log Level Check}
    C -->|Enabled| D{Component Filter}
    C -->|Disabled| X[Discard Log]
    D -->|Enabled| E{Sampling Check}
    D -->|Disabled| X
    E -->|Selected| F[Format Log]
    E -->|Not Selected| X
    F --> G[Add Metadata]
    G --> H[Add Timestamp]
    H --> I[Add Request Context]
    I --> J{Log Format}
    J -->|Text| K[Format as Text]
    J -->|JSON| L[Format as JSON]
    K & L --> M[Output Log]
```

1. **Logger Interface**: Simple, consistently named logging functions
2. **LoggingManager**: Central configuration and log processing
3. **Formatters**: Convert log data to text or JSON
4. **Context Enrichment**: Add metadata like timestamps and request IDs
5. **Output**: Send formatted logs to Cloudflare's standard output

## Log Levels

The logging system supports four standard log levels:

| Level | Priority | Function | Description |
|-------|----------|----------|-------------|
| `debug` | 1 | `debug(context, logger, component, message, data?)` | Detailed debugging information |
| `info` | 2 | `info(context, logger, component, message, data?)` | General informational messages |
| `warn` | 3 | `warn(context, logger, component, message, data?)` | Warning conditions |
| `error` | 4 | `error(context, logger, component, message, error?, data?)` | Error conditions |

The configured log level acts as a threshold—messages with a level below the threshold are not logged. For example, with `level: 'info'`, debug messages are suppressed while info, warn, and error messages are logged.

## Log Formats

The logging system supports two output formats:

### Text Format

Human-readable format ideal for development and debugging:

```
[2023-09-15T12:34:56.789Z] [INFO] [VideoHandler] Processing video request url=https://example.com/video.mp4 options={"width":720,"height":480}
```

### JSON Format

Machine-parsable format ideal for production and log aggregation:

```json
{
  "timestamp": "2023-09-15T12:34:56.789Z",
  "level": "info",
  "component": "VideoHandler",
  "message": "Processing video request",
  "data": {
    "url": "https://example.com/video.mp4",
    "options": {
      "width": 720,
      "height": 480
    }
  },
  "requestId": "01HBZGRPR1DQVT5ZP13VWXNDPZ"
}
```

## Structured Logging

All logs follow a structured format with consistent fields:

| Field | Description | Example |
|-------|-------------|---------|
| `timestamp` | ISO timestamp of the log event | `2023-09-15T12:34:56.789Z` |
| `level` | Log level | `info` |
| `component` | Source component | `VideoHandler` |
| `message` | Primary log message | `Processing video request` |
| `data` | Additional structured data | `{"url": "https://example.com/video.mp4"}` |
| `requestId` | Unique request identifier | `01HBZGRPR1DQVT5ZP13VWXNDPZ` |
| `error` | Error information (for error logs) | `{"name": "ValidationError", "message": "Invalid width"}` |
| `breadcrumbs` | Previous log events in the request | `[{"component": "PathMatcher", "message": "Matched path pattern"}]` |

This structured approach enables easy filtering, searching, and analysis of logs.

## Component-Based Logging

The logging system uses a component-based approach, where each log is associated with a specific component. This enables filtering and organization of logs by system area:

```typescript
// Import the logging utilities
import { debug, info, warn, error } from './utils/loggerUtils';

// Log with component context
info(context, logger, 'VideoHandler', 'Processing video request', { 
  url: request.url,
  options: transformOptions
});
```

Common components include:
- `VideoHandler`: Main request handling
- `PathMatcher`: URL pattern matching
- `TransformationService`: Video transformation
- `CacheService`: Caching operations
- `ConfigManager`: Configuration management
- `DebugService`: Debugging features

## Performance Logging

The logging system includes special support for performance metrics:

```typescript
// Start performance measurement
const startTime = performance.now();

// Record the start time
debug(context, logger, 'VideoHandler', 'Starting video transformation', {
  startTime,
  options: transformOptions
});

// Perform the operation
const result = await transformVideo(options);

// Calculate and log the duration
const duration = performance.now() - startTime;
info(context, logger, 'VideoHandler', 'Completed video transformation', {
  duration,
  options: transformOptions
});

// Emit a warning if the operation was slow
if (duration > 1000) {
  warn(context, logger, 'Performance', 'Slow video transformation', {
    duration,
    options: transformOptions
  });
}
```

When `includePerformance` is enabled, the system also tracks:
- Detailed timing of key operations
- Method execution time
- Cache lookup performance
- Origin fetch duration
- Processing pipeline stages

## Log Sampling

To reduce log volume in high-traffic environments, the logging system supports sampling:

```typescript
// Configure sampling rate
{
  "logging": {
    "sampleRate": 0.1  // Log ~10% of requests
  }
}
```

The sampling is applied consistently across a request—if a request is selected for logging, all log messages for that request are logged.

This is implemented via a deterministic hashing approach:

```typescript
// Simplified sampling implementation
function shouldSampleLog(requestId: string, sampleRate: number): boolean {
  // Hash the request ID to a value between 0-1
  const hash = hashString(requestId) / Number.MAX_SAFE_INTEGER;
  
  // Sample if hash is below the sample rate
  return hash < sampleRate;
}
```

## Configuration Options

Logging behavior is highly configurable:

```json
{
  "logging": {
    "level": "info",
    "format": "json",
    "includeTimestamps": true,
    "includeComponentName": true,
    "colorize": false,
    "enabledComponents": [],
    "disabledComponents": ["PathMatcher"],
    "sampleRate": 1,
    "enablePerformanceLogging": true,
    "performanceThresholdMs": 1000,
    "maxBreadcrumbs": 20,
    "includeBreadcrumbs": true,
    "redactSensitiveData": true,
    "sensitiveFields": ["token", "key", "password", "secret"],
    "logClientInfo": true,
    "prettyPrint": false
  }
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `level` | string | 'info' | Log level: 'debug', 'info', 'warn', 'error' |
| `format` | string | 'text' | Log format: 'json' or 'text' |
| `includeTimestamps` | boolean | true | Include timestamps in logs |
| `includeComponentName` | boolean | true | Include component names in logs |
| `colorize` | boolean | true | Use colors in console output |
| `enabledComponents` | string[] | [] | Components to enable (empty = all) |
| `disabledComponents` | string[] | [] | Components to disable |
| `sampleRate` | number | 1 | Sampling rate for logs (0-1) |
| `enablePerformanceLogging` | boolean | false | Enable performance metrics |
| `performanceThresholdMs` | number | 1000 | Threshold for performance warnings |
| `maxBreadcrumbs` | number | 20 | Maximum breadcrumbs to track |
| `includeBreadcrumbs` | boolean | true | Include breadcrumbs in logs |
| `redactSensitiveData` | boolean | true | Redact sensitive fields |
| `sensitiveFields` | string[] | [...] | Fields to redact |
| `logClientInfo` | boolean | true | Include client information |
| `prettyPrint` | boolean | false | Pretty-print JSON logs |

## Error Logging

Error logging includes additional context:

```typescript
try {
  // Attempt an operation
  const result = await riskyOperation();
  return result;
} catch (err) {
  // Log the error with context
  error(context, logger, 'VideoHandler', 'Error during video processing', err, {
    url: request.url,
    options: transformOptions
  });
  
  // Return an error response
  return createErrorResponse(err);
}
```

The error logging function extracts error details:
- Error name and message
- Stack trace (when available and enabled)
- Error code and status (for custom errors)
- Additional properties from the error object

## Debug Logging

Debug logs provide detailed information for troubleshooting:

```typescript
// Log detailed debugging information
debug(context, logger, 'PathMatcher', 'Pattern matching details', {
  url: request.url,
  pattern: pathPattern.matcher,
  captures: extractedCaptures,
  matched: isMatched
});
```

Debug logs are only emitted when:
1. The log level is set to 'debug' in the configuration, OR
2. Debug mode is enabled for the request (via debug parameter)

## Log Breadcrumbs

The logging system maintains a "breadcrumb trail" of previous log events in a request:

```typescript
// Example breadcrumb implementation
interface LogBreadcrumb {
  timestamp: number;
  level: string;
  component: string;
  message: string;
  data?: Record<string, any>;
}

// Add a breadcrumb
function addBreadcrumb(context: RequestContext, breadcrumb: LogBreadcrumb): void {
  if (!context.breadcrumbs) {
    context.breadcrumbs = [];
  }
  
  // Add breadcrumb, respecting maximum count
  context.breadcrumbs.push(breadcrumb);
  if (context.breadcrumbs.length > maxBreadcrumbs) {
    context.breadcrumbs.shift();
  }
}

// Extract breadcrumbs for error logging
function getBreadcrumbs(context: RequestContext): LogBreadcrumb[] {
  return context.breadcrumbs || [];
}
```

Breadcrumbs provide crucial context for error diagnosis, showing the sequence of events leading up to an error.

## Request Context Tracking

The logging system leverages a request context object to track information across a request:

```typescript
interface RequestContext {
  url: string;
  method: string;
  id: string;
  startTime: number;
  breadcrumbs?: LogBreadcrumb[];
  timers?: Record<string, { start: number; end?: number }>;
  clientInfo?: {
    ip: string;
    userAgent: string;
    device?: string;
    browser?: string;
  };
  // Additional context properties
}
```

This context is passed to all logging functions:

```typescript
// Create request context
const context: RequestContext = {
  url: request.url,
  method: request.method,
  id: generateRequestId(),
  startTime: performance.now()
};

// Log with context
info(context, logger, 'VideoHandler', 'Processing request', {
  url: context.url
});
```

## Best Practices

1. **Use Appropriate Log Levels**:
   - `debug`: Detailed information for developers
   - `info`: General operational information
   - `warn`: Warning conditions that don't cause errors
   - `error`: Error conditions that affect functionality

2. **Structure Data Appropriately**:
   - Use the message for concise, human-readable information
   - Put details in the data object for machine parsing
   - Group related data together in nested objects

3. **Include Relevant Context**:
   - URL and method for request-related logs
   - Input parameters for operations
   - Result summaries for completed operations
   - Timing information for performance-sensitive operations

4. **Component Organization**:
   - Use consistent component naming
   - Keep component names concise but descriptive
   - Use hierarchical naming for related components

5. **Performance Considerations**:
   - Avoid excessive logging in hot paths
   - Use debug level for high-volume diagnostics
   - Consider sampling for high-traffic production environments
   - Avoid logging large objects or binary data

## Examples

### Basic Information Logging

```typescript
// Log basic information
info(context, logger, 'VideoHandler', 'Processing video request', {
  url: request.url,
  width: options.width,
  height: options.height,
  mode: options.mode
});
```

### Debug Logging with Detail

```typescript
// Log detailed debug information
debug(context, logger, 'CacheService', 'Cache key generation details', {
  url: request.url,
  options: transformOptions,
  generatedKey: cacheKey,
  strategy: 'derivative-based'
});
```

### Warning Logging

```typescript
// Log a warning condition
warn(context, logger, 'TransformationService', 'Using fallback transformation', {
  reason: 'Unsupported format',
  requestedFormat: options.format,
  fallingBackTo: 'mp4',
  url: request.url
});
```

### Error Logging with Context

```typescript
try {
  await transformVideo(options);
} catch (err) {
  // Log error with rich context
  error(context, logger, 'TransformationService', 'Video transformation failed', err, {
    url: request.url,
    options: transformOptions,
    originUrl: pathPattern.originUrl,
    duration: performance.now() - startTime
  });
}
```

### Performance Logging

```typescript
// Start performance measurement
const startTransform = performance.now();

// Perform operation
const result = await transformVideo(options);

// Calculate and log duration
const transformDuration = performance.now() - startTransform;
info(context, logger, 'Performance', 'Video transformation completed', {
  duration: transformDuration,
  url: request.url,
  options: {
    width: options.width,
    height: options.height,
    mode: options.mode
  }
});

// Log warning if slow
if (transformDuration > 1000) {
  warn(context, logger, 'Performance', 'Slow video transformation', {
    duration: transformDuration,
    threshold: 1000,
    url: request.url
  });
}
```
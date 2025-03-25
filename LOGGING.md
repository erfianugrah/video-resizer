# Video Resizer Logging Guidelines

## Overview

This document outlines the logging system used in the Video Resizer service, which is based on Pino with request context tracking and breadcrumb support.

## Key Components

### 1. RequestContext

The `RequestContext` object tracks request-scoped information including:

- `requestId`: Unique identifier for the request
- `breadcrumbs`: Chronological events during request processing
- `diagnostics`: Extended debugging information
- `componentTiming`: Performance metrics for components

Example usage:

```typescript
// Access via legacy adapter (automatically initialized in handler)
const requestContext = getCurrentContext();

// Or create a new context directly
const context = createRequestContext(request);
```

### 2. Pino Logger

A structured logger with request context and breadcrumb support.

Example usage:

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

Example usage:

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
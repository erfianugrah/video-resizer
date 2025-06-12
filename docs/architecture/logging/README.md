# Video Resizer Logging System Documentation

## Overview

The video-resizer uses a centralized logging system built on top of Pino for high-performance structured logging. This document consolidates all logging-related documentation.

## Architecture

### Core Components

1. **Centralized Logger** (`src/utils/logger.ts`)
   - Single source of truth for all logging operations
   - Category-based logging with performance tracking
   - Configurable log levels and filtering
   - Rich context enrichment options

2. **Pino Logger** (`src/utils/pinoLogger.ts`)
   - High-performance JSON logger
   - Request-scoped context
   - Structured logging with consistent format
   - Automatic breadcrumb integration

3. **Legacy Adapter** (`src/utils/legacyLoggerAdapter.ts`)
   - Maintains backward compatibility
   - Routes legacy logging calls through Pino
   - Preserves existing API surface

4. **Request Context** (`src/utils/requestContext.ts`)
   - Request-scoped context management
   - Breadcrumb tracking
   - Performance timing
   - Diagnostic information collection

## Usage Guide

### Basic Logging

```typescript
import { logInfo, logDebug, logError, logWarn } from '../utils/logger';

// Simple logging
logInfo('ComponentName', 'Operation completed', { userId: 123 });
logDebug('ComponentName', 'Debug information', { details: 'value' });
logError('ComponentName', 'Operation failed', { error: err.message });
logWarn('ComponentName', 'Warning condition', { threshold: 100 });
```

### Category-Based Logging

```typescript
import { createCategoryLogger } from '../utils/logger';

const logger = createCategoryLogger('VideoProcessor');

logger.info('Processing started', { videoId: 'abc123' });
logger.debug('Frame processed', { frameNumber: 42 });
logger.error('Processing failed', { error: 'Out of memory' });
```

### Advanced Features

#### Log Enrichment
```typescript
logInfo('Component', 'Message', data, {
  enrich: {
    includeMemoryUsage: true,
    includeRequestMetadata: true,
    includeTiming: true,
    includeEnvironment: true
  }
});
```

#### Performance Tracking
```typescript
const logger = createCategoryLogger('API');

logger.startTimer('operation');
// ... perform operation ...
logger.endTimer('operation', 'Operation completed');
```

#### Component Filtering
```typescript
// In configuration
{
  "logging": {
    "disabledComponents": ["NoisyComponent", "VerboseModule"]
  }
}
```

## Configuration

### Environment Variables
- `LOG_LEVEL`: Set the minimum log level (debug, info, warn, error)
- `LOG_FORMAT`: Output format (json, pretty)
- `DEBUG_ENABLED`: Enable debug mode
- `VERBOSE_ENABLED`: Enable verbose logging

### Configuration Manager
The `LoggingConfigurationManager` handles all logging configuration:

```typescript
const config = LoggingConfigurationManager.getInstance();
config.updateFromKV({
  level: 'info',
  enableBreadcrumbs: true,
  maxBreadcrumbs: 50,
  disabledComponents: ['NoisyComponent']
});
```

## Migration Guide

### From Legacy Logging

```typescript
// Old way
import { debug, info, error } from '../utils/loggerUtils';
debug('Component', 'Message', data);

// New way (Option 1 - Direct)
import { logDebug } from '../utils/logger';
logDebug('Component', 'Message', data);

// New way (Option 2 - Category Logger)
import { createCategoryLogger } from '../utils/logger';
const logger = createCategoryLogger('Component');
logger.debug('Message', data);
```

### From Console Logging

```typescript
// Old way
console.log('Processing video:', videoId);
console.error('Failed:', error);

// New way
import { logInfo, logError } from '../utils/logger';
logInfo('VideoProcessor', 'Processing video', { videoId });
logError('VideoProcessor', 'Failed', { error: error.message });
```

## Best Practices

1. **Use Structured Data**
   ```typescript
   // Good
   logInfo('API', 'Request received', { method: 'GET', path: '/video', userId: 123 });
   
   // Avoid
   logInfo('API', `Request received: GET /video for user 123`);
   ```

2. **Choose Appropriate Log Levels**
   - `debug`: Detailed information for debugging
   - `info`: General operational information
   - `warn`: Warning conditions that might need attention
   - `error`: Error conditions that need immediate attention

3. **Use Category Loggers for Components**
   ```typescript
   const logger = createCategoryLogger('VideoTransformation');
   // All logs from this logger will be tagged with the category
   ```

4. **Include Relevant Context**
   ```typescript
   logError('Database', 'Query failed', {
     query: 'SELECT * FROM videos',
     error: err.message,
     stack: err.stack,
     retryCount: 3
   });
   ```

5. **Avoid Logging Sensitive Data**
   - Never log passwords, API keys, or tokens
   - Be careful with personally identifiable information (PII)
   - Sanitize URLs that might contain sensitive query parameters

## Performance Considerations

1. **Pino is Fast**: The underlying Pino logger is one of the fastest Node.js loggers
2. **Async Logging**: Logs are written asynchronously to avoid blocking
3. **Minimal Overhead**: Disabled log levels have near-zero overhead
4. **Efficient Serialization**: JSON serialization is optimized

## Troubleshooting

### Common Issues

1. **Logs Not Appearing**
   - Check if the component is disabled in configuration
   - Verify the log level allows the message type
   - Ensure the logger is properly initialized

2. **Performance Degradation**
   - Reduce verbose logging in production
   - Use appropriate log levels
   - Consider disabling breadcrumbs if not needed

3. **Missing Context**
   - Ensure request context is properly initialized
   - Check that context is not cleared prematurely
   - Verify async operations maintain context

## Future Improvements

1. **Log Aggregation**: Integration with external logging services
2. **Metrics Export**: Export performance metrics to monitoring systems
3. **Dynamic Configuration**: Runtime log level changes
4. **Log Sampling**: Intelligent sampling for high-volume scenarios

## Implementation Status

### Completed
- ✅ Centralized logging system
- ✅ Pino integration
- ✅ Legacy adapter
- ✅ Category-based loggers
- ✅ Performance tracking
- ✅ Configuration management
- ✅ Request context integration

### In Progress
- 🔄 Complete migration from legacy logging
- 🔄 External service integration
- 🔄 Advanced filtering options

### Planned
- 📋 Log aggregation service
- 📋 Metrics dashboard
- 📋 AI-powered log analysis
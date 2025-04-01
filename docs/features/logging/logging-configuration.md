# Logging Configuration

The `LoggingConfigurationManager` handles logging levels, formats, and behavior. It provides methods to control logging output, including log levels, component filtering, and performance logging.

## Logging Options

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

## Log Levels

| Level | Priority | Description |
|-------|----------|-------------|
| `debug` | 1 | Detailed debugging information |
| `info` | 2 | General informational messages |
| `warn` | 3 | Warning conditions |
| `error` | 4 | Error conditions |

Log messages are only shown if their level is >= the configured level.

## Log Formats

| Format | Description | Example |
|--------|-------------|---------|
| `text` | Human-readable text format | `[INFO] [VideoHandler] Processing video request` |
| `json` | JSON structured format | `{"level":"info","component":"VideoHandler","message":"Processing video request","timestamp":"2023-09-15T12:34:56Z"}` |

## Component Filtering

You can filter logs by component name:

1. **Enable specific components**:
   ```typescript
   enabledComponents: ['VideoHandler', 'CacheService']
   ```

2. **Disable specific components**:
   ```typescript
   disabledComponents: ['StorageService']
   ```

If `enabledComponents` is empty, all components are enabled except those in `disabledComponents`.

## Log Sampling

The `sampleRate` option allows you to reduce log volume:

- `sampleRate: 1` - Log every message (default)
- `sampleRate: 0.1` - Log approximately 10% of messages
- `sampleRate: 0.01` - Log approximately 1% of messages

This is useful for high-traffic production environments.

## Performance Logging

When `enablePerformanceLogging` is true:

1. Tracks execution time of key operations
2. Logs warnings when operations exceed `performanceThresholdMs`
3. Provides detailed performance breakdowns

## Configuration Methods

- `getConfig()`: Get the entire logging configuration
- `getLogLevel()`: Get the current log level
- `shouldLogComponent(componentName)`: Check if a component should be logged
- `shouldSampleLog()`: Check if a log should be sampled
- `shouldLogPerformance()`: Check if performance should be logged
- `getPerformanceThreshold()`: Get the performance threshold

## Environment Variables

| Variable | Type | Description |
|----------|------|-------------|
| `LOG_LEVEL` | string | Log level: 'debug', 'info', 'warn', 'error' |
| `LOG_FORMAT` | string | Log format: 'json' or 'text' |
| `LOG_INCLUDE_TIMESTAMPS` | boolean | Include timestamps in logs |
| `LOG_PERFORMANCE` | boolean | Enable performance logging |

## Example Usage

```typescript
import { LoggingConfigurationManager } from './config';
import { logger } from './utils/logger';

const loggingConfig = LoggingConfigurationManager.getInstance();

// Check if we should log for a component
if (loggingConfig.shouldLogComponent('VideoHandler')) {
  logger.info('VideoHandler', 'Processing video request');
}

// Log with sampling
if (loggingConfig.shouldSampleLog()) {
  logger.debug('CacheService', 'Cache hit for key: ' + key);
}

// Performance logging
if (loggingConfig.shouldLogPerformance()) {
  const startTime = Date.now();
  // ... perform operation ...
  const duration = Date.now() - startTime;
  
  if (duration > loggingConfig.getPerformanceThreshold()) {
    logger.warn('Performance', `Slow operation: ${duration}ms`);
  }
}
```
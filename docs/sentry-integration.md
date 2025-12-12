# Sentry Integration Documentation

This document describes the Sentry observability integration in the video-resizer Cloudflare Worker.

## Overview

Sentry is integrated using the `@sentry/cloudflare` package (v10.29.0) to provide:
- **Error Tracking** - Automatic exception capture
- **Logging** - Console logs forwarded to Sentry
- **Tracing** - Request performance monitoring
- **Metrics** - Custom business metrics

## Configuration

Location: `src/index.ts` (lines 94-107)

```typescript
export default Sentry.withSentry<EnvVariables>(
  (env: EnvVariables) => ({
    dsn: env.SENTRY_DSN,
    integrations: [
      Sentry.consoleLoggingIntegration({
        levels: ["log", "warn", "error", "debug", "trace"],
      }),
    ],
    tracesSampleRate: 1.0,
    sendDefaultPii: true,
    enableLogs: true,
    enableMetrics: true,
  }),
  // ... handler object
)
```

### Setting Up the Sentry DSN Secret

The Sentry DSN is stored as a Wrangler secret for security. To set it up for each environment:

```bash
# Development
echo "YOUR_SENTRY_DSN" | wrangler secret put SENTRY_DSN --env development

# Staging
echo "YOUR_SENTRY_DSN" | wrangler secret put SENTRY_DSN --env staging

# Production
echo "YOUR_SENTRY_DSN" | wrangler secret put SENTRY_DSN --env production
```

### Configuration Options

- **dsn**: Sentry project DSN (Data Source Name) - loaded from `SENTRY_DSN` secret
- **integrations**: `consoleLoggingIntegration` captures console.* calls as logs
- **tracesSampleRate**: `1.0` = 100% of transactions are traced
- **sendDefaultPii**: `true` = includes IP addresses and user agents
- **enableLogs**: `true` = logs are sent to Sentry
- **enableMetrics**: `true` = custom metrics are enabled

## Logging Integration

### Pino Logger Configuration

Location: `src/utils/pinoLogger.ts`

The Pino logger is configured to detect the Cloudflare Workers environment and output to console methods:

```typescript
// Cloudflare Workers detection
const isCloudflareWorkers = typeof globalThis !== 'undefined' &&
  typeof (globalThis as any).caches !== 'undefined' &&
  typeof (globalThis as any).window === 'undefined' &&
  typeof process === 'undefined';
```

In Cloudflare Workers, Pino uses browser mode with custom write functions that properly serialize Error objects:

```typescript
browser: {
  asObject: true, // Receive log object so we can serialize it properly
  write: {
    trace: (o: any) => console.debug(serializeForConsole(o)),
    debug: (o: any) => console.debug(serializeForConsole(o)),
    info: (o: any) => console.info(serializeForConsole(o)),
    warn: (o: any) => console.warn(serializeForConsole(o)),
    error: (o: any) => console.error(serializeForConsole(o)),
    fatal: (o: any) => console.error(serializeForConsole(o)),
  }
}
```

With `asObject: true`, Pino passes the log object to our write functions (not a pre-formatted string), allowing our custom serializer to properly handle Error objects and other complex types.

This ensures Pino logs are written to console.* methods, which are then captured by Sentry's `consoleLoggingIntegration`.

### Error Serialization

**Problem:** Error objects in JavaScript have non-enumerable properties (`name`, `message`, `stack`), causing them to serialize as `[object Object]` or `{}` when logged, making debugging difficult.

**Solution:** Custom serializer that extracts error properties:

```typescript
function serializeForConsole(obj: any): string {
  return JSON.stringify(obj, (key, value) => {
    if (value instanceof Error) {
      return {
        name: value.name,
        message: value.message,
        stack: value.stack,
        // Include any additional custom properties
        ...Object.getOwnPropertyNames(value).reduce((acc, prop) => {
          if (!['name', 'message', 'stack'].includes(prop)) {
            acc[prop] = (value as any)[prop];
          }
          return acc;
        }, {} as Record<string, any>)
      };
    }
    return value;
  });
}
```

A general-purpose `serializeError()` utility is also exported from `src/utils/errorHandlingUtils.ts` for use throughout the codebase.

### Structured Logging

All console logs use structured JSON format following Cloudflare Workers Logs best practices:

```typescript
console.error({
  context: 'ComponentName',
  operation: 'operationName',
  error: err instanceof Error ? {
    name: err.name,
    message: err.message,
    stack: err.stack
  } : String(err)
});
```

**Benefits:**
- Direct field filtering (e.g., `context = "PinoLogger"`)
- Operation-specific queries (e.g., `operation = "recreateBaseLogger"`)
- Error type filtering (e.g., `error.name = "TypeError"`)
- Better indexing in Cloudflare Workers Logs
- Readable error messages in Sentry Issues dashboard

## Metrics

All metrics use the `Sentry.metrics` API with the following methods:
- `count()` - Incrementing counters
- `distribution()` - Value distributions (e.g., response times)

### Worker-Level Metrics

Location: `src/index.ts`

#### 1. Total Requests
- **Metric**: `video_worker.requests.total`
- **Type**: Counter
- **Location**: Line 354
- **Attributes**: `method` (GET, POST, etc.)
- **Purpose**: Track all incoming requests to the worker

#### 2. Admin Config Requests
- **Metric**: `video_worker.admin_config.requests`
- **Type**: Counter
- **Location**: Line 371
- **Attributes**: `method`
- **Purpose**: Track configuration API usage at `/admin/config`

#### 3. Passthrough Requests
- **Metric**: `video_worker.passthrough.total`
- **Type**: Counter
- **Location**: Line 498
- **Attributes**: `extension` (file extension like webm, mkv, etc.)
- **Purpose**: Track non-MP4 videos bypassing transformation

#### 4. Worker Errors
- **Metric**: `video_worker.errors.total`
- **Type**: Counter
- **Location**: Line 624
- **Attributes**: `error_type` (error name or "unknown")
- **Purpose**: Track top-level worker errors

### Handler-Level Metrics

Location: `src/handlers/videoHandler.ts`

#### 5. Cache Hits
- **Metric**: `video_handler.cache.hits`
- **Type**: Counter
- **Location**: Line 202
- **Attributes**: `cache_type: 'kv'`
- **Purpose**: Track successful KV cache retrievals

#### 6. Cache Misses
- **Metric**: `video_handler.cache.misses`
- **Type**: Counter
- **Location**: Line 262
- **Attributes**: `cache_type: 'kv'`
- **Purpose**: Track KV cache misses requiring video transformation

#### 7. Response Time
- **Metric**: `video_handler.response_time_ms`
- **Type**: Distribution
- **Location**: Line 783
- **Unit**: millisecond
- **Attributes**:
  - `cache_status`: "hit" or "miss"
  - `has_origins`: "yes" or "no"
- **Purpose**: Track request processing duration for performance monitoring

#### 8. Handler Errors
- **Metric**: `video_handler.errors.total`
- **Type**: Counter
- **Location**: Line 811
- **Attributes**: `error_type` (error name or "unknown")
- **Purpose**: Track video handler errors

## Tracing

Automatic tracing is enabled via `Sentry.withSentry()` wrapper with `tracesSampleRate: 1.0`. This captures:
- Request lifecycle
- Performance timing
- Transaction metadata

The wrapper automatically creates transactions for each request handled by the worker.

## Error Tracking

Errors are captured through multiple mechanisms for comprehensive error monitoring:

### 1. Automatic Error Capture via Wrapper

The `Sentry.withSentry()` wrapper automatically captures unhandled errors with full stack traces.

### 2. Explicit Error Capturing

Location: `src/utils/errorHandlingUtils.ts` (lines 36-94)

All errors logged through `logErrorWithContext()` are automatically captured to Sentry with:

```typescript
function captureErrorToSentry(error: unknown, context: Record<string, unknown>): void {
  // Filters out expected errors (e.g., AbortError for client disconnects)
  // Uses Sentry.withScope() to attach rich context
  // Sets appropriate severity levels based on error type
  Sentry.captureException(error);
}
```

**Features:**
- **Smart Filtering**: Automatically excludes expected errors like client disconnects (AbortError)
- **Rich Context**: Attaches tags and extra data for better debugging
- **Severity Levels**:
  - `info` for 404 errors (RESOURCE_NOT_FOUND, PATTERN_NOT_FOUND, ORIGIN_NOT_FOUND)
  - `warning` for validation errors (INVALID_PARAMETER, INVALID_MODE, INVALID_FORMAT)
  - `error` for server errors and unknown errors
- **Test-Safe**: Gracefully handles test environments where Sentry isn't initialized

### 3. Top-Level Error Capture

Location: `src/index.ts` (lines 622-636)

Worker-level errors are explicitly captured with request context:

```typescript
if (err instanceof Error && err.name !== 'AbortError') {
  Sentry.captureException(err, {
    tags: { handler: 'worker', url: request.url },
    contexts: { request: { url: request.url, method: request.method } }
  });
}
```

### Error Filtering

The integration automatically filters out:
- **AbortError**: Client disconnects and request cancellations
- Other expected operational errors can be added as needed

This ensures the Sentry Issues dashboard shows only actionable errors, not noise from normal operations.

## Environment Detection

The integration correctly handles three environments:

1. **Cloudflare Workers** (production/deployment)
   - Uses Pino browser mode with console output
   - Full Sentry integration active

2. **Node.js** (local testing)
   - Uses pino-pretty for readable terminal logs
   - Sentry integration may be limited

3. **Browser** (if applicable)
   - Uses Pino browser mode with standard console output

## Data Flow

### Logging Flow
```
Application Code (Pino logs)
    ↓
Console.* methods (debug/info/warn/error)
    ↓
Sentry consoleLoggingIntegration
    ↓
Sentry Cloud (Logs Dashboard)
```

### Metrics Flow
```
Application Code (Sentry.metrics.*)
    ↓
Sentry Metrics API
    ↓
Sentry Cloud (Metrics Dashboard)
```

### Tracing Flow
```
Request → Sentry.withSentry wrapper
    ↓
Transaction created
    ↓
Handler execution (timed)
    ↓
Transaction sent to Sentry
```

### Error Capture Flow
```
Error occurs
    ↓
logErrorWithContext() or try/catch
    ↓
captureErrorToSentry() filters expected errors
    ↓
Sentry.withScope() adds context (tags, extras, severity)
    ↓
Sentry.captureException()
    ↓
Sentry Cloud (Issues Dashboard)
```

## Viewing Data in Sentry

After deployment, data will be available in your Sentry project:

- **Errors/Issues**: Issues tab - Shows captured exceptions with stack traces, context, and severity levels
  - Automatically filtered to exclude noise (client disconnects, etc.)
  - Grouped by error type and fingerprint for easy triaging
  - Includes rich context (URL, category, error type, custom data)
- **Logs**: Logs tab - Console output from Pino logger via `consoleLoggingIntegration`
- **Traces**: Performance → Traces - Request lifecycle and timing data
- **Metrics**: Metrics tab - Custom business metrics (cache hits/misses, response times, etc.)

## Notes

- DSN is stored as a Wrangler secret (`SENTRY_DSN`) for better security practices
- PII collection is enabled (`sendDefaultPii: true`)
- 100% of transactions are sampled (`tracesSampleRate: 1.0`) - consider reducing in production for cost management
- Metrics use `attributes` (not `tags`) per Sentry Cloudflare SDK requirements

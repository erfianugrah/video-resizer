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
    dsn: "https://8ae5724deb43d9e85dadf44dfbb16844@o4506353146462208.ingest.us.sentry.io/4510505303670784",
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

### Configuration Options

- **dsn**: Sentry project DSN (Data Source Name)
- **integrations**: `consoleLoggingIntegration` captures console.* calls as logs
- **tracesSampleRate**: `1.0` = 100% of transactions are traced
- **sendDefaultPii**: `true` = includes IP addresses and user agents
- **enableLogs**: `true` = logs are sent to Sentry
- **enableMetrics**: `true` = custom metrics are enabled

## Logging Integration

### Pino Logger Configuration

Location: `src/utils/pinoLogger.ts` (lines 19-94)

The Pino logger is configured to detect the Cloudflare Workers environment and output to console methods:

```typescript
// Cloudflare Workers detection
const isCloudflareWorkers = typeof globalThis !== 'undefined' &&
  typeof (globalThis as any).caches !== 'undefined' &&
  typeof (globalThis as any).window === 'undefined' &&
  typeof process === 'undefined';
```

In Cloudflare Workers, Pino uses browser mode with custom write functions:

```typescript
browser: {
  asObject: false,
  write: {
    trace: (o: any) => console.debug(JSON.stringify(o)),
    debug: (o: any) => console.debug(JSON.stringify(o)),
    info: (o: any) => console.info(JSON.stringify(o)),
    warn: (o: any) => console.warn(JSON.stringify(o)),
    error: (o: any) => console.error(JSON.stringify(o)),
    fatal: (o: any) => console.error(JSON.stringify(o)),
  }
}
```

This ensures Pino logs are written to console.* methods, which are then captured by Sentry's `consoleLoggingIntegration`.

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

Errors are automatically captured by the `Sentry.withSentry()` wrapper. Both caught and uncaught exceptions are sent to Sentry with full stack traces.

### Automatic Error Capture

- **Worker-level errors**: Caught in `src/index.ts` line 602-633
- **Handler-level errors**: Caught in `src/handlers/videoHandler.ts` line 792-840

Both error handlers track metrics alongside error logging.

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

```
Application Code (Pino logs)
    ↓
Console.* methods (debug/info/warn/error)
    ↓
Sentry consoleLoggingIntegration
    ↓
Sentry Cloud (Logs Dashboard)
```

```
Application Code (Sentry.metrics.*)
    ↓
Sentry Metrics API
    ↓
Sentry Cloud (Metrics Dashboard)
```

```
Request → Sentry.withSentry wrapper
    ↓
Transaction created
    ↓
Handler execution (timed)
    ↓
Transaction sent to Sentry
```

## Viewing Data in Sentry

After deployment, data will be available in your Sentry project:

- **Errors**: Issues tab
- **Logs**: Logs tab (requires logs to be sent)
- **Traces**: Performance → Traces
- **Metrics**: Metrics tab

## Notes

- DSN is publicly visible in code (this is normal and safe)
- PII collection is enabled (`sendDefaultPii: true`)
- 100% of transactions are sampled (`tracesSampleRate: 1.0`) - consider reducing in production for cost management
- Metrics use `attributes` (not `tags`) per Sentry Cloudflare SDK requirements

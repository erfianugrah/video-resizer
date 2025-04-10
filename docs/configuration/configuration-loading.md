# Configuration Loading Process

This document explains the configuration loading process in the video-resizer, including how configurations are loaded from KV storage, applied to the application, and managed during runtime.

## Initialization Lifecycle

The video-resizer uses a non-blocking initialization pattern to ensure fast cold starts while still providing access to dynamic configuration. The configuration lifecycle follows these stages:

```
┌───────────────────┐     ┌───────────────────┐     ┌───────────────────┐
│ 1. Fast Bootstrap │ ──► │ 2. Request Serving │ ◄── │ 3. Background     │
│    - Default config   │     │    - Use current     │     │    Update         │
│    - Env variables    │     │      best config     │     │    - KV loading    │
│    - No KV access     │     │    - Non-blocking    │     │    - Schema checks │
└───────────────────┘     └───────────────────┘     └───────────────────┘
          │                        ▲                          │
          │                        │                          │
          └────────────────────────┴──────────────────────────┘
                         Configuration flow
```

## Configuration Sources

The video-resizer loads configuration from several sources, in the following order (later sources override earlier ones):

1. **Default Configuration**: Hardcoded defaults in the codebase (`videoConfig.ts`, etc.)
2. **Worker Environment Variables**: Set in the Cloudflare dashboard or wrangler.toml (`ENVIRONMENT`, `DEBUG_ENABLED`, etc.)
3. **KV Storage**: Dynamic configuration stored in Cloudflare KV (under the `worker-config` key)

## Configuration Loading Process

The configuration loading process is optimized for performance and reliability:

### 1. Fast Bootstrap Phase

When the worker starts, it immediately initializes with defaults:

```typescript
// Fast initialization during cold start
const configService = ConfigurationService.getInstance();
configService.initialize(env);  // Non-blocking call
```

This happens in milliseconds and doesn't block the first request processing.

### 2. KV Configuration Loading

In the background, the worker attempts to load configuration from KV:

```typescript
// Background loading - doesn't block request processing
ctx.waitUntil(configService.triggerKVUpdate(env));
```

This process includes:

* **Memory Caching**: Configurations are cached in memory for 5 minutes
* **Schema Validation**: All configurations are validated with Zod schemas
* **Distribution**: Valid configurations are distributed to the appropriate managers

### 3. Configuration Application

Once loaded and validated, configuration is applied:

```typescript
// Configuration is distributed to appropriate managers
await this.distributeConfiguration(validatedConfig);
```

### KV Configuration Structure

The KV configuration is stored as a JSON object with the following structure:

```json
{
  "version": "1.0.0",
  "lastUpdated": "2025-03-31T16:00:00Z",
  "video": {
    "derivatives": {
      "mobile": {
        "width": 640,
        "height": 360,
        "quality": "medium",
        "compression": "high",
        "audio": true,
        "duration": "5m"
      },
      "desktop": {
        "width": 1280,
        "height": 720,
        "quality": "high",
        "compression": "medium",
        "audio": true,
        "duration": "5m"
      }
    },
    "defaults": {
      "width": null,
      "height": null,
      "mode": "video",
      "fit": "contain",
      "audio": true,
      "duration": "5m",
      "quality": "auto",
      "compression": "auto"
    },
    "pathPatterns": [
      {
        "name": "product-videos",
        "matcher": "^/products/.+\\.mp4$",
        "processPath": true,
        "baseUrl": null,
        "originUrl": null
      }
    ]
  },
  "cache": {
    "method": "cacheApi",
    "debug": false,
    "defaultMaxAge": 86400,
    "profiles": {
      "dynamic": {
        "regex": ".*\\/live\\/.*\\.mp4",
        "ttl": {
          "ok": 300,
          "redirects": 60,
          "clientError": 30,
          "serverError": 10
        }
      }
    }
  },
  "logging": {
    "level": "info",
    "format": "json"
  },
  "debug": {
    "enabled": false,
    "verbose": false
  }
}
```

## Configuration Managers

The configuration is managed through singleton managers, each responsible for a specific domain:

| Manager | Responsibility | Key Configuration |
|---------|----------------|------------------|
| **VideoConfigurationManager** | Video transformation settings | Derivatives, path patterns, format options |
| **CacheConfigurationManager** | Caching behavior and profiles | TTLs, cache method, bypass parameters |
| **LoggingConfigurationManager** | Logging levels and formats | Log level, format, component settings |
| **DebugConfigurationManager** | Debug flags and settings | Debug mode, allowed IPs, headers inclusion |

## Updating Configuration

The video-resizer supports runtime configuration updates through the Configuration API:

```http
POST /admin/config
Content-Type: application/json
Authorization: Bearer YOUR_API_TOKEN

{
  "version": "1.0.1",
  "lastUpdated": "2025-03-31T18:00:00Z",
  "video": {
    "derivatives": {
      "mobile": {
        "width": 480,
        "height": 270,
        "quality": "medium",
        "compression": "high"
      }
    }
  }
}
```

### Update Process

After a successful update:

1. **Validation**: Configuration is validated against Zod schemas
2. **Storage**: Valid configuration is stored in KV storage with a timestamp
3. **Application**: Configuration is immediately applied to the current worker instance
4. **Distribution**: Changes become available to all worker instances in the same colo
5. **Memory Cache**: The in-memory cache is refreshed with the new configuration

## Configuration Caching

For performance optimization, configurations are cached at multiple levels:

1. **In-memory Cache**: The ConfigurationService caches the loaded configuration for 5 minutes
   ```typescript
   // Memory caching example
   this.memoryCache.set(cacheKey, {
     data: parsedData,
     timestamp: now
   });
   ```

2. **KV Cache**: The KV store itself has caching at the edge
3. **Configuration Manager Cache**: Each manager maintains a cached version of its configuration

## Configuration Performance Metrics

The ConfigurationService tracks key performance metrics:

```typescript
// Access configuration performance metrics
const metrics = getConfigurationMetrics();
console.log(`Cold start time: ${metrics.coldStartTimeMs}ms`);
console.log(`KV fetch count: ${metrics.kvFetchCount}`);
console.log(`Cache hit ratio: ${metrics.cacheHitRatio}`);
```

Available metrics include:
- Cold start time
- KV fetch count and duration
- Cache hit/miss ratio
- Update counts and timing

## Troubleshooting Configuration Loading

If you're experiencing issues with configuration not being applied, check the following:

### Logs Analysis

Enable debug mode to see detailed logs about the configuration loading process:

```
https://your-worker.example.com/video.mp4?debug=true
```

Look for logs like:
- `Starting configuration load process`
- `Successfully loaded configuration from KV`
- `Configuration distributed to all managers`
- `Updated video configuration from KV`

### KV Store Access

Verify that the KV namespace binding is correctly set in your wrangler.toml:

```toml
kv_namespaces = [
  { binding = "VIDEO_CONFIGURATION_STORE", id = "your-kv-namespace-id" }
]
```

### Configuration Inspection

You can inspect the current configuration with:

```
GET /admin/config
Authorization: Bearer YOUR_API_TOKEN
```

### Common Issues and Solutions

| Issue | Symptoms | Solution |
|-------|----------|----------|
| **Missing KV Binding** | Error: "No VIDEO_CONFIGURATION_STORE binding found" | Ensure the KV namespace is correctly bound in wrangler.toml |
| **Invalid Configuration** | Error: "Validation errors in configuration" | Check schema validation errors in logs and fix the JSON structure |
| **KV Latency** | Configuration changes don't appear immediately | Wait 5-10 seconds for changes to propagate across edge nodes |
| **Cache Timing** | Changes applied but not visible | Add ?debug=true to bypass cache or wait 5 minutes for cache expiration |
| **Circular Dependencies** | Unexpected configuration behavior | Check logs for dynamic import warnings and ensure correct initialization order |
| **Schema Mismatch** | "Expected string, received number" errors | Ensure all configuration values match expected types in schemas |

## Best Practices

1. **Validate Configuration**: Test configuration changes before applying them in production
2. **Include Version**: Always increment the version when updating configuration
3. **Monitor Logs**: Watch for configuration loading errors after updates
4. **Use Debug Mode**: Enable debug mode when troubleshooting configuration issues
5. **Full Configuration**: When updating, include the complete configuration object
6. **Handle Defaults**: Always provide sensible defaults for all configuration values
7. **Cold Start Testing**: Test your application's cold start performance with fresh workers
8. **Partial Updates**: Use specific configuration sections when updating to minimize impact
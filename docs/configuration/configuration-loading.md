# Configuration Loading Process

This document explains the configuration loading process in the video-resizer, including how configurations are loaded from KV storage, applied to the application, and managed during runtime.

## Configuration Sources

The video-resizer loads configuration from several sources, in the following order (later sources override earlier ones):

1. **Default Configuration**: Hardcoded defaults in the codebase
2. **Worker Environment Variables**: Set in the Cloudflare dashboard or wrangler.toml
3. **KV Storage**: Dynamic configuration stored in Cloudflare KV

## KV Configuration Loading

The KV configuration loading process is a critical part of the video-resizer's operation. It happens as follows:

1. **Initialization**: When the worker starts, it initializes with default configuration values
2. **KV Load Attempt**: On the first request, the worker attempts to load configuration from KV:
   ```javascript
   const kvConfig = await configService.loadConfiguration(env);
   ```
3. **Schema Validation**: Loaded configuration is validated using Zod schemas
4. **Configuration Application**: Valid configuration is applied to the configuration managers

### KV Configuration Structure

The KV configuration is stored as a JSON object with the following structure:

```json
{
  "version": "1.0.0",
  "lastUpdated": "2025-03-31T16:00:00Z",
  "video": {
    // Video configuration
    "derivatives": { ... },
    "defaults": { ... },
    "pathPatterns": [ ... ],
    // ...etc
  },
  "cache": {
    // Cache configuration
    // ...etc
  },
  "logging": {
    // Logging configuration
    // ...etc
  },
  "debug": {
    // Debug configuration
    // ...etc
  }
}
```

### Configuration Managers

The configuration is managed through singleton managers:

- **VideoConfigurationManager**: Video transformation settings and options
- **CacheConfigurationManager**: Caching behavior and profiles
- **LoggingConfigurationManager**: Logging levels and formats
- **DebugConfigurationManager**: Debug flags and settings

## Updating Configuration

The video-resizer supports runtime configuration updates through the Configuration API:

```
POST /admin/config
Content-Type: application/json
Authorization: Bearer YOUR_API_TOKEN

{
  "version": "1.0.1",
  "lastUpdated": "2025-03-31T18:00:00Z",
  "video": {
    // Updated video configuration
  }
}
```

After a successful update, the configuration is:
1. Stored in KV storage
2. Immediately applied to the current worker instance
3. Available to all worker instances in the same colo

## Configuration Caching

For performance reasons, configurations are cached at several levels:

1. **In-memory Cache**: The ConfigurationService caches the loaded configuration for 5 minutes
2. **KV Cache**: The KV store itself has caching at the edge
3. **Configuration Manager Cache**: Each manager maintains a cached version of its configuration

## Troubleshooting Configuration Loading

If you're experiencing issues with configuration not being applied, check the following:

### Logs Analysis

Enable debug mode to see detailed logs about the configuration loading process:

```
https://your-worker.example.com/video.mp4?debug=true
```

Look for logs like:
- `Attempting to load configuration from KV`
- `Successfully loaded configuration from KV`
- `Path patterns after loading from KV`

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

### Common Issues

1. **Missing KV Binding**: Ensure the KV namespace is correctly bound
2. **Invalid Configuration**: Check that your configuration conforms to the expected schema
3. **KV Latency**: Changes may take a few seconds to propagate across all edge nodes
4. **Cache Timing**: In-memory cache may delay configuration updates (up to 5 minutes)

## Best Practices

1. **Validate Configuration**: Test configuration changes before applying them in production
2. **Include Version**: Always increment the version when updating configuration
3. **Monitor Logs**: Watch for configuration loading errors after updates
4. **Use Debug Mode**: Enable debug mode when troubleshooting configuration issues
5. **Full Configuration**: When updating, include the complete configuration object
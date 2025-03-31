# Updating Configuration

This document outlines the process for updating the video-resizer's configuration using the KV-based configuration system.

## Configuration Structure

The configuration is stored as JSON in Cloudflare KV and consists of several main sections:

- `video`: Video transformation settings
- `cache`: Caching behavior configuration
- `debug`: Debug mode settings
- `logging`: Logging configuration
- `storage`: Storage configuration settings

## Configuration File

The main configuration file is located at:
```
./config/worker-config.json
```

This single file contains all configuration for the worker. When editing, you should:
1. Edit the file with your changes
2. Upload it to the appropriate environment

## Uploading Configuration

### Using the CLI Tool

The simplest method is using the provided CLI tool:

```bash
# Upload to development environment
npm run config:upload:dev

# Upload to staging environment
npm run config:upload:staging 

# Upload to production environment
npm run config:upload:prod

# Custom upload with more options
npm run config:upload -- --url https://your-worker.workers.dev --token your-token
```

### Tool Options

The configuration upload tool supports several options:

```
Options:
  -u, --url <url>            Worker URL
  -c, --config <path>        Path to configuration file (default: ./config/worker-config.json)
  -t, --token <token>        Authentication token
  -e, --env <environment>    Environment (development, staging, production)
  --dry-run                  Validate configuration without uploading
  -v, --verbose              Verbose output
  -h, --help                 Display help
```

### Using curl Directly

You can also use curl to update configuration:

```bash
curl -X POST https://your-worker.workers.dev/admin/config \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-token" \
  --data @./config/worker-config.json
```

## Testing Configuration Changes

After updating configuration:

1. Make a test request to the worker
2. Check that the new configuration is applied
3. Review debug headers to confirm configuration source
4. Check logs for any configuration-related errors

## Common Configuration Updates

### Adding a New Video Derivative

To add a new derivative (e.g., "tablet"), edit the `video.derivatives` section:

```json
"derivatives": {
  // ... existing derivatives
  "tablet": {
    "width": 768,
    "height": 432,
    "mode": "video",
    "fit": "contain",
    "audio": true,
    "quality": "medium",
    "compression": "medium"
  }
}
```

### Changing Cache TTL

To update cache TTL values:

```json
"cache": {
  "method": "cacheApi",
  "debug": false,
  "defaultMaxAge": 86400,
  "ttl": {
    "ok": 86400,         // Update this value (in seconds)
    "redirects": 3600,
    "clientError": 60,
    "serverError": 10
  }
}
```

### Adding a New Path Pattern

To add a path pattern for a new route:

```json
"pathPatterns": [
  // ... existing patterns
  {
    "name": "premium-videos",
    "matcher": "^/premium/(.*\\.mp4)",
    "processPath": true,
    "baseUrl": null,
    "originUrl": "https://premium.example.com",
    "ttl": {
      "ok": 86400,
      "redirects": 3600,
      "clientError": 60,
      "serverError": 10
    },
    "useTtlByStatus": true,
    "captureGroups": ["videoId"],
    "quality": "high"
  }
]
```

## Configuration Versioning

Each configuration update should include a version increment:

```json
{
  "version": "1.0.1",  // Increment this
  "lastUpdated": "2025-03-31T16:00:00Z",
  // ... rest of configuration
}
```

## Rollback Procedure

To rollback to a previous version:

1. Locate the backup configuration file
2. Upload it using one of the methods above
3. Confirm the rollback was successful with a test request

## Security Considerations

### Authentication

For secure authentication, store API tokens using Wrangler secrets:

```bash
# Set up secrets for each environment
wrangler secret put CONFIG_API_TOKEN --env development
wrangler secret put CONFIG_API_TOKEN --env staging
wrangler secret put CONFIG_API_TOKEN --env production
```

Then your handler can validate against these secure tokens:

```typescript
// In configHandler.ts
const expectedToken = env.CONFIG_API_TOKEN;
const authHeader = request.headers.get('Authorization');
const token = authHeader?.replace('Bearer ', '');

if (token !== expectedToken) {
  return new Response('Unauthorized', { status: 401 });
}
```

### Best Practices

- Only share authentication tokens with authorized team members
- Use different tokens for each environment
- Consider rotating tokens periodically
- Validate configuration changes in development before applying to production
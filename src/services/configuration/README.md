# Configuration Service

This directory contains the implementation of the Configuration Service, which was refactored from a single monolithic file into smaller, more focused modules.

## Directory Structure

- `schemas.ts` - Configuration schemas and type definitions
- `caching.ts` - In-memory caching utilities for configuration
- `metrics.ts` - Performance metrics tracking for the service
- `loaders.ts` - KV loading and distribution of configuration
- `storage.ts` - Configuration storage operations
- `accessors.ts` - Methods to access specific configuration sections
- `validation.ts` - Configuration validation utilities
- `service.ts` - The main ConfigurationService class implementation
- `index.ts` - Re-exports all functionality to maintain backward compatibility

## Functionality

The Configuration Service is responsible for:

1. Loading configuration from KV storage
2. Validating configuration against schemas
3. Caching configuration in memory for performance
4. Distributing configuration to other services
5. Providing access to specific configuration sections
6. Tracking performance metrics for monitoring
7. Supporting non-blocking initialization for faster cold starts

The service uses a singleton pattern to ensure a single instance throughout the application.

## Configuration Upload and Management

### How to Upload Configuration

Configuration is stored in Cloudflare Workers KV storage. There are several ways to upload or update configuration:

#### 1. Using npm Scripts (Recommended)

The project includes npm scripts for configuration management:

```bash
# Upload configuration
npm run config upload -- --token YOUR_TOKEN --env development

# Check configuration validity
npm run config check -- --config ./config/worker-config.json

# Fix configuration issues
npm run config fix -- --config ./config/worker-config.json --output ./config/fixed-config.json

# Validate without uploading (dry run)
npm run config validate -- --config ./config/worker-config.json

# Examples with different environments
npm run config upload -- --token YOUR_TOKEN --env production --config ./config/prod-config.json
npm run config upload -- --token YOUR_TOKEN --env staging --force
npm run config upload -- --token YOUR_TOKEN --url https://custom.workers.dev --verbose
```

Available options for upload:
- `--url, -u`: Worker URL (alternative to --env)
- `--config, -c`: Path to config file (default: ./config/worker-config.json)
- `--token, -t`: Authentication token (required)
- `--env, -e`: Environment (development, staging, production)
- `--dry-run`: Validate configuration without uploading
- `--force`: Force upload even without base configuration
- `--verbose, -v`: Verbose output

#### 2. Using Wrangler CLI (Direct KV Upload)

For Wrangler 3.60.0+:
```bash
# Upload configuration JSON to KV
wrangler kv key put "video-resizer-config" --namespace-id=<YOUR_NAMESPACE_ID> --text-file=config.json
```

For older Wrangler versions:
```bash
wrangler kv:key put "video-resizer-config" --namespace-id=<YOUR_NAMESPACE_ID> --path=config.json
```

#### 3. Using Cloudflare Dashboard

1. Navigate to Workers & Pages > KV
2. Select your VIDEO_CONFIGURATION_STORE namespace
3. Add/Edit key: `video-resizer-config`
4. Paste your JSON configuration

#### 4. Programmatically

```javascript
await env.VIDEO_CONFIGURATION_STORE.put(
  'video-resizer-config',
  JSON.stringify(config),
  { metadata: { version: '2.0.0' } }
);
```

### Configuration JSON Structure

The configuration JSON must follow this structure:

```json
{
  "version": "2.0.0",
  "lastUpdated": "2025-06-23T00:00:00Z",
  
  "video": {
    // Video transformation settings
    "derivatives": {
      "thumbnail": {
        "width": 320,
        "height": 180,
        "mode": "frame",
        "time": "00:00:05",
        "format": "jpg"
      },
      "preview": {
        "width": 640,
        "height": 360,
        "mode": "video",
        "duration": "30s",
        "quality": "medium"
      }
    },
    
    // Default values for transformations
    "defaults": {
      "mode": "video",
      "audio": true,
      "duration": "5m"
    },
    
    // Origin configuration (required)
    "origins": {
      "enabled": true,
      "items": [{
        "name": "main",
        "matcher": "^/videos/(.+)$",
        "sources": [{
          "type": "r2",
          "priority": 1,
          "bucketBinding": "VIDEO_BUCKET",
          "path": "/${1}"
        }]
      }]
    },
    
    // Storage settings
    "storage": {
      "priority": ["r2", "remote"],
      "r2": {
        "enabled": true,
        "bucketBinding": "VIDEO_BUCKET"
      }
    }
  },
  
  "cache": {
    // Caching configuration
    "enableKVCache": true,
    "defaultMaxAge": 86400,
    "profiles": {
      "videos": {
        "regex": "\\.(mp4|webm)$",
        "ttl": {
          "ok": 604800,
          "clientError": 60,
          "serverError": 0
        }
      }
    }
  },
  
  "logging": {
    // Logging settings
    "level": "info",
    "format": "json",
    "enablePerformanceLogging": true
  },
  
  "debug": {
    // Debug settings
    "enabled": false,
    "debugQueryParam": "debug"
  }
}
```

### Key Configuration Sections

#### 1. Video Configuration
- **derivatives**: Named presets for common transformations
- **origins**: Define where videos are stored (R2, remote URLs)
- **defaults**: Default transformation parameters
- **storage**: Storage backend priorities and settings

#### 2. Cache Configuration
- **profiles**: Different cache strategies based on URL patterns
- **ttl**: Time-to-live settings by HTTP status
- **enableKVCache**: Enable/disable KV caching

#### 3. Logging Configuration
- **level**: Log verbosity (debug, info, warn, error)
- **format**: Output format (json, text)
- **enablePerformanceLogging**: Track performance metrics

#### 4. Debug Configuration
- **enabled**: Enable debug mode
- **debugQueryParam**: Query parameter to trigger debug info

### Configuration Validation

The service validates all configuration against Zod schemas. Invalid configurations will be rejected with detailed error messages. The config tools automatically validate:

1. JSON syntax
2. Required fields (version, lastUpdated)
3. Origins configuration structure
4. Source types and required properties

You can also test your configuration locally:

```javascript
import { WorkerConfigurationSchema } from './schemas';

try {
  const validated = WorkerConfigurationSchema.parse(yourConfig);
  console.log('Configuration is valid');
} catch (error) {
  console.error('Configuration validation failed:', error);
}
```

### Best Practices

1. **Version your configurations** - Always update the version field when making changes
2. **Test before deploying** - Use `npm run config validate` to check without uploading
3. **Use derivatives** - Define common transformation presets to simplify URLs
4. **Configure caching wisely** - Set appropriate TTLs based on content type
5. **Monitor performance** - Enable performance logging to track optimization opportunities
6. **Backup configurations** - Keep copies of working configurations
7. **Use force carefully** - Only use `--force` when necessary for initial setup
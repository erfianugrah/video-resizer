# Wrangler.jsonc vs KV Configuration

This document outlines which configuration elements should remain in `wrangler.jsonc` versus which should be moved to KV-stored JSON configuration.

## Configuration Categories

Configuration can be divided into two broad categories:

1. **Infrastructure Configuration**: Settings that define how your Worker is deployed, where resources are located, and what external services it can access.
2. **Application Configuration**: Settings that control the behavior of your application logic, features, and runtime parameters.

## Elements to Keep in wrangler.jsonc

These elements are core infrastructure settings that define your Worker deployment:

| Element | Description | Reason to Keep |
|---------|-------------|----------------|
| `name` | Worker name | Core identity of the Worker |
| `main` | Entry point file | Defines code structure |
| `compatibility_date` | CF compatibility date | Infrastructure requirement |
| `compatibility_flags` | CF feature flags | Infrastructure requirement |
| `account_id` | Cloudflare account ID | Deployment requirement |
| `observability` | Monitoring settings | Infrastructure service |
| `assets` | Static asset directories | Build-time resource |
| `kv_namespaces` | KV binding definitions | Required resource binding |
| `r2_buckets` | R2 bucket bindings | Required resource binding |
| `routes` | URL routing patterns | Deployment mapping |
| `build` | Build commands | Development workflow |
| `env.*` | Environment definitions | Infrastructure environments |

## Elements to Move to KV Configuration

These elements should be moved to KV-stored JSON configuration:

| Element | Description | Moved to KV Section |
|---------|-------------|---------------------|
| `DEBUG_*` | Debug settings | `debug` object |
| `CACHE_*` | Caching parameters | `cache` object |
| `LOG_*` | Logging configuration | `logging` object |
| `VIDEO_*` | Video processing settings | `video` object |
| `PATH_PATTERNS` | URL pattern matching | `video.pathPatterns` array |
| `STORAGE_CONFIG` | Storage configuration | `storage` object |
| `ENVIRONMENT` | Environment name | Metadata in config |

## Example Simplified wrangler.jsonc

After moving application configuration to KV, your `wrangler.jsonc` should look like:

```jsonc
{
  "$schema": "https://json.schemastore.org/wrangler.json",
  "name": "video-resizer",
  "main": "src/index.ts",
  "compatibility_date": "2025-03-10",
  "compatibility_flags": ["nodejs_compat"],
  "account_id": "25f21f141824546aa72c74451a11b419",
  "observability": {
    "enabled": true
  },
  "assets": {
    "directory": "./public",
    "binding": "ASSETS"
  },
  "kv_namespaces": [
    {
      "binding": "VIDEO_CONFIGURATION_STORE",
      "id": "ddaf6d5142af4f79b39defe745dac556",
      "preview_id": "ddaf6d5142af4f79b39defe745dac556"
    }
  ],
  "r2_buckets": [
    {
      "binding": "VIDEOS_BUCKET",
      "bucket_name": "videos",
      "preview_bucket_name": "videos-dev"
    }
  ],
  "vars": {
    // Only minimal environment indicators for bootstrapping
    "ENVIRONMENT": "development"
  },
  "build": {
    "command": "npm run build"
  },
  "routes": [
    {
      "pattern": "dev.cdn.erfi.dev/*",
      "zone_id": "d6260a9cd0c27db1e9c0a453b2e4761e"
    }
  ],
  "env": {
    "production": {
      "assets": {
        "directory": "./public",
        "binding": "ASSETS"
      },
      "kv_namespaces": [
        {
          "binding": "VIDEO_TRANSFORMATIONS_CACHE",
          "id": "8e790768576242cc98fa3e4aa327f815"
        },
        {
          "binding": "VIDEO_CONFIGURATION_STORE",
          "id": "ddaf6d5142af4f79b39defe745dac556"
        }
      ],
      "r2_buckets": [
        {
          "binding": "VIDEOS_BUCKET",
          "bucket_name": "videos"
        }
      ],
      "vars": {
        "ENVIRONMENT": "production"
      },
      "routes": [
        {
          "pattern": "cdn.erfi.dev/*",
          "zone_id": "d6260a9cd0c27db1e9c0a453b2e4761e"
        }
      ]
    },
    "staging": {
      "assets": {
        "directory": "./public",
        "binding": "ASSETS"
      },
      "kv_namespaces": [
        {
          "binding": "VIDEO_CONFIGURATION_STORE",
          "id": "ddaf6d5142af4f79b39defe745dac556"
        }
      ],
      "r2_buckets": [
        {
          "binding": "VIDEOS_BUCKET",
          "bucket_name": "videos"
        }
      ],
      "vars": {
        "ENVIRONMENT": "staging"
      },
      "routes": [
        {
          "pattern": "staging.cdn.erfi.dev/*",
          "zone_id": "d6260a9cd0c27db1e9c0a453b2e4761e"
        }
      ]
    }
  }
}
```

## Migration Steps

1. **Create KV Configuration**: Extract application settings from wrangler.jsonc into JSON files
2. **Initialize Config Store**: Upload configuration to KV for each environment
3. **Update Code**: Ensure code reads from KV configuration rather than environment variables
4. **Test Changes**: Verify functionality in development environment
5. **Slim Down Wrangler**: Remove redundant configuration from wrangler.jsonc
6. **Deploy Changes**: Roll out to staging and production environments

## Authentication

Consider implementing authentication for the configuration API. Options include:

1. **API Keys**: Simple bearer tokens verified against stored values
2. **IP Restrictions**: Limit configuration updates to specific IPs
3. **Cloudflare Access**: Integrate with CF Access for SSO authentication
4. **JWT Authentication**: Implement JWT validation for more robust auth

## Versioning and Rollbacks

Implement configuration versioning in KV:

1. Store versions with timestamps
2. Maintain a history of configurations
3. Enable rollback to previous versions
4. Track who made changes and when
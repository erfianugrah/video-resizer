# Video Resizer Practical Configuration Guide

*Last Updated: May 10, 2025*

This guide provides practical advice and examples for configuring the Video Resizer for common scenarios. It covers everyday configuration tasks and best practices.

## Table of Contents

- [Introduction](#introduction)
- [Configuration Structure](#configuration-structure)
- [Configuration Files](#configuration-files)
- [Common Configuration Scenarios](#common-configuration-scenarios)
  - [Setting Up Origin Video Sources](#setting-up-origin-video-sources)
  - [Configuring Path Patterns](#configuring-path-patterns)
  - [Creating Video Derivatives](#creating-video-derivatives)
  - [Optimizing Cache Settings](#optimizing-cache-settings)
  - [Setting Up Advanced Authentication](#setting-up-advanced-authentication)
- [Environment-Specific Configuration](#environment-specific-configuration)
- [Working with Configuration Tools](#working-with-configuration-tools)
- [Deployment and Verification](#deployment-and-verification)
- [Monitoring Configuration Changes](#monitoring-configuration-changes)
- [Troubleshooting Configuration Issues](#troubleshooting-configuration-issues)

## Introduction

The Video Resizer uses a modular, centralized configuration system that combines:

1. **Static configuration** in wrangler.jsonc
2. **Dynamic configuration** in Cloudflare KV storage
3. **Environment variables** for environment-specific settings

This guide focuses on practical configuration tasks and assumes you've already completed the [Quickstart Guide](./quickstart.md).

## Configuration Structure

The Video Resizer configuration is organized into modules:

- **Video Configuration**: Transformation settings, derivatives, formats
- **Cache Configuration**: TTLs, profiles, cache behavior
- **Logging Configuration**: Log levels, formats, sampling
- **Debug Configuration**: Debug modes, headers, permissions

Each module is managed by a dedicated Configuration Manager that handles validation, defaults, and access.

## Configuration Files

Key configuration files include:

1. **wrangler.jsonc**: Worker setup, KV bindings, routes, and vars
2. **KV-stored JSON files**: Path patterns, video settings, cache settings
3. **Static default configurations**: Built into the codebase

## Common Configuration Scenarios

### Setting Up Origin Video Sources

To configure where your original videos are stored:

#### HTTP Origin Example

```json
{
  "storage": {
    "primary": {
      "type": "remote",
      "url": "https://videos.example.com"
    },
    "fallback": {
      "type": "remote",
      "url": "https://backup-videos.example.com"
    }
  }
}
```

Save this to `config/storage-http.json` and upload:

```bash
node tools/config-upload.js --env production --config ./config/storage-http.json
```

#### S3 or R2 Origin Example

```json
{
  "storage": {
    "primary": {
      "type": "s3",
      "bucket": "my-video-bucket",
      "region": "us-east-1",
      "authentication": "aws-s3-presigned-url",
      "accessKeyId": "ACCESS_KEY_ENV_VAR",
      "secretAccessKey": "SECRET_KEY_ENV_VAR"
    }
  }
}
```

Upload to KV:

```bash
node tools/config-upload.js --env production --config ./config/storage-s3.json
```

Set environment variables in wrangler.jsonc:

```jsonc
"vars": {
  "ACCESS_KEY_ENV_VAR": "<your access key>",
  "SECRET_KEY_ENV_VAR": "<your secret key>"
}
```

### Configuring Path Patterns

Path patterns define URL matching rules and determine how URLs map to origin storage:

#### Basic Path Pattern

```json
{
  "pathPatterns": [
    {
      "name": "product-videos",
      "matcher": "^/products/(.*\\.mp4)$",
      "processPath": true,
      "baseUrl": null,
      "originUrl": "https://product-videos.example.com/{0}",
      "ttl": {
        "ok": 86400,
        "redirects": 3600,
        "clientError": 60,
        "serverError": 10
      },
      "useTtlByStatus": true
    }
  ]
}
```

#### Multiple Path Patterns with Different Origins

```json
{
  "pathPatterns": [
    {
      "name": "product-videos",
      "matcher": "^/products/(.*\\.mp4)$",
      "processPath": true,
      "baseUrl": null,
      "originUrl": "https://product-videos.example.com/{0}",
      "ttl": {
        "ok": 86400,
        "redirects": 3600,
        "clientError": 60,
        "serverError": 10
      }
    },
    {
      "name": "marketing-videos",
      "matcher": "^/marketing/(.*\\.mp4)$",
      "processPath": true,
      "baseUrl": null,
      "originUrl": "https://marketing-cdn.example.com/videos/{0}",
      "ttl": {
        "ok": 604800,
        "redirects": 3600,
        "clientError": 60,
        "serverError": 10
      }
    },
    {
      "name": "user-generated",
      "matcher": "^/user-content/videos/(.*\\.mp4)$",
      "processPath": true,
      "baseUrl": null,
      "originUrl": "https://ugc-bucket.s3.amazonaws.com/{0}",
      "authentication": "aws-s3-presigned-url",
      "ttl": {
        "ok": 21600,
        "redirects": 3600,
        "clientError": 60,
        "serverError": 10
      }
    }
  ]
}
```

Save this to `config/path-patterns.json` and upload:

```bash
node tools/config-upload.js --env production --config ./config/path-patterns.json
```

### Creating Video Derivatives

Derivatives are preset video configurations for different use cases:

```json
{
  "derivatives": {
    "high": {
      "width": 1920,
      "height": 1080,
      "quality": "high",
      "compression": "low",
      "fileFormat": "mp4"
    },
    "medium": {
      "width": 1280,
      "height": 720,
      "quality": "medium",
      "compression": "medium",
      "fileFormat": "mp4"
    },
    "low": {
      "width": 640,
      "height": 360,
      "quality": "low",
      "compression": "high",
      "fileFormat": "mp4"
    },
    "mobile": {
      "width": 480,
      "height": 270,
      "quality": "low",
      "compression": "high",
      "fileFormat": "mp4"
    },
    "thumbnail": {
      "mode": "frame",
      "width": 320,
      "height": 180,
      "time": "10%",
      "fileFormat": "jpeg"
    },
    "preview": {
      "width": 480,
      "height": 270,
      "duration": "5s",
      "loop": "true",
      "muted": "true",
      "fileFormat": "mp4"
    }
  }
}
```

Save this to `config/video-derivatives.json` and upload:

```bash
node tools/config-upload.js --env production --config ./config/video-derivatives.json
```

### Optimizing Cache Settings

Configure cache profiles for different types of video content:

```json
{
  "cache": {
    "method": "cf",
    "debug": false,
    "enableTags": true,
    "defaultProfile": "default",
    "profiles": {
      "default": {
        "regex": ".*\\.mp4$",
        "cacheability": true,
        "videoCompression": "auto",
        "ttl": {
          "ok": 86400,
          "redirects": 3600,
          "clientError": 60,
          "serverError": 10
        }
      },
      "highTraffic": {
        "regex": ".*/trending/.*\\.mp4$",
        "cacheability": true,
        "videoCompression": "low",
        "ttl": {
          "ok": 604800,
          "redirects": 3600,
          "clientError": 60,
          "serverError": 10
        }
      },
      "dynamic": {
        "regex": ".*/live/.*\\.mp4$",
        "cacheability": true,
        "videoCompression": "auto",
        "ttl": {
          "ok": 300,
          "redirects": 60,
          "clientError": 30,
          "serverError": 10
        }
      },
      "noCache": {
        "regex": ".*/private/.*\\.mp4$",
        "cacheability": false,
        "videoCompression": "none",
        "ttl": {
          "ok": 0,
          "redirects": 0,
          "clientError": 0,
          "serverError": 0
        }
      }
    }
  }
}
```

Save this to `config/cache-profiles.json` and upload:

```bash
node tools/config-upload.js --env production --config ./config/cache-profiles.json
```

### Setting Up Advanced Authentication

For secure origin storage, configure authentication:

#### AWS S3 Presigned URLs

```json
{
  "pathPatterns": [
    {
      "name": "secure-videos",
      "matcher": "^/secure/(.*\\.mp4)$",
      "processPath": true,
      "baseUrl": null,
      "originUrl": "https://secure-videos.s3.amazonaws.com/{0}",
      "authentication": "aws-s3-presigned-url",
      "credentials": {
        "accessKeyId": "ACCESS_KEY_ENV_VAR",
        "secretAccessKey": "SECRET_KEY_ENV_VAR",
        "region": "us-east-1",
        "expiresIn": 300
      },
      "ttl": {
        "ok": 86400,
        "redirects": 3600,
        "clientError": 60,
        "serverError": 10
      }
    }
  ]
}
```

Save this to `config/secure-paths.json` and upload:

```bash
node tools/config-upload.js --env production --config ./config/secure-paths.json
```

Set environment variables in wrangler.jsonc.

#### Token-Based Authentication

For custom token authentication:

```json
{
  "pathPatterns": [
    {
      "name": "token-videos",
      "matcher": "^/token/(.*\\.mp4)$",
      "processPath": true,
      "baseUrl": null,
      "originUrl": "https://token-videos.example.com/{0}",
      "authentication": "token",
      "credentials": {
        "headerName": "Authorization",
        "tokenPrefix": "Bearer ",
        "tokenValue": "TOKEN_ENV_VAR"
      },
      "ttl": {
        "ok": 86400,
        "redirects": 3600,
        "clientError": 60,
        "serverError": 10
      }
    }
  ]
}
```

## Environment-Specific Configuration

Configure different settings for development, staging, and production:

### In wrangler.jsonc

```jsonc
{
  "name": "video-resizer",
  "compatibility_date": "2023-09-01",
  "main": "dist/index.js",
  "kv_namespaces": [
    {
      "binding": "VIDEO_TRANSFORMATIONS_CACHE",
      "id": "<your-kv-namespace-id>"
    },
    {
      "binding": "VIDEO_CACHE_KEY_VERSIONS",
      "id": "<your-versions-kv-id>"
    },
    {
      "binding": "CONFIGURATION",
      "id": "<your-config-kv-id>"
    }
  ],
  "env": {
    "development": {
      "vars": {
        "ENVIRONMENT": "development",
        "LOG_LEVEL": "debug",
        "DEBUG_MODE": "true",
        "CACHE_METHOD": "cf"
      }
    },
    "staging": {
      "vars": {
        "ENVIRONMENT": "staging",
        "LOG_LEVEL": "info",
        "DEBUG_MODE": "true",
        "CACHE_METHOD": "cf"
      }
    },
    "production": {
      "vars": {
        "ENVIRONMENT": "production",
        "LOG_LEVEL": "warn",
        "DEBUG_MODE": "false",
        "CACHE_METHOD": "cf"
      }
    }
  }
}
```

### Specifying Environment During Upload

Use the `--env` flag to target specific environments:

```bash
# Upload development configuration
node tools/config-upload.js --env development --config ./config/development-paths.json

# Upload staging configuration
node tools/config-upload.js --env staging --config ./config/staging-paths.json

# Upload production configuration
node tools/config-upload.js --env production --config ./config/production-paths.json
```

## Working with Configuration Tools

The Video Resizer includes several tools for working with configuration:

### config-upload.js

Uploads configuration to KV storage:

```bash
# Upload a single configuration file
node tools/config-upload.js --env production --config ./config/my-config.json

# Merge with existing configuration
node tools/config-upload.js --env production --config ./config/my-config.json --merge

# Upload multiple configuration files
node tools/config-upload.js --env production --config ./config/paths.json ./config/cache.json
```

### config-debug.js

Debugs and validates configuration:

```bash
# Check all configuration
node tools/config-debug.js --check-all

# Check specific configuration areas
node tools/config-debug.js --check-storage
node tools/config-debug.js --check-paths
node tools/config-debug.js --check-cache

# View current configuration
node tools/config-debug.js --view-config

# Validate configuration file before upload
node tools/config-debug.js --validate ./config/my-config.json
```

## Deployment and Verification

After updating configuration, follow these steps:

1. **Deploy the worker**:
   ```bash
   wrangler deploy
   ```

2. **Verify configuration**:
   ```bash
   # Test with debug mode
   curl -H "Debug-Mode: true" https://videos.example.com/sample.mp4?debug=view
   ```

3. **Monitor logs**:
   ```bash
   wrangler tail
   ```

4. **Verify cache operation**:
   ```bash
   # Initial request
   curl -I https://videos.example.com/sample.mp4
   
   # Verify cache hit on second request (check CF-Cache-Status header)
   curl -I https://videos.example.com/sample.mp4
   ```

## Monitoring Configuration Changes

Monitor configuration changes and versions:

```bash
# View configuration version history
node tools/config-debug.js --history

# Compare configuration versions
node tools/config-debug.js --compare <version1> <version2>

# Rollback to previous version
node tools/config-upload.js --env production --rollback <version>
```

## Troubleshooting Configuration Issues

### Common Configuration Problems

#### 1. Path Patterns Not Matching

**Issue**: URLs aren't matching your path patterns
**Solution**: Test your regex patterns

```bash
# Debug URL matching
node tools/config-debug.js --test-url https://videos.example.com/products/12345.mp4
```

#### 2. Invalid Configuration Format

**Issue**: Configuration upload fails with validation errors
**Solution**: Validate JSON format and schema

```bash
# Validate configuration before upload
node tools/config-debug.js --validate ./config/my-config.json
```

#### 3. Environment Variables Not Available

**Issue**: Environment variables referenced in configuration are undefined
**Solution**: Check wrangler.jsonc env section

```bash
# Check environment variables in KV
node tools/config-debug.js --check-env-vars
```

#### 4. Authentication Failures

**Issue**: Cannot access secured origin content
**Solution**: Verify credentials and authentication configuration

```bash
# Test authentication setup
node tools/config-debug.js --test-auth secure-videos
```

#### 5. Cache Profile Issues

**Issue**: Wrong cache profile being applied
**Solution**: Check regex pattern priority and specificity

```bash
# Test which cache profile applies to a URL
node tools/config-debug.js --test-cache-profile https://videos.example.com/trending/popular.mp4
```

### Debug Options

When troubleshooting, enable debug mode in requests:

```
https://videos.example.com/sample.mp4?debug=view
```

This will display a comprehensive debug UI showing:

- Applied configuration
- Path pattern matching
- Cache status
- Transformation options
- Performance metrics

### Enabling Debug Headers

Configure debug headers for API responses:

```json
{
  "debug": {
    "enableHeaders": true,
    "allowedIPs": ["127.0.0.1", "office.example.com"],
    "headerPrefix": "X-VR-Debug-"
  }
}
```

---

This practical configuration guide covers everyday configuration tasks for the Video Resizer. For more detailed information on specific configuration options, refer to the [Configuration Reference](../configuration/configuration-guide.md).
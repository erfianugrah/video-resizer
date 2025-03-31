# Video Resizer Configuration API Guide

This comprehensive guide details the Configuration API for the Video Resizer service, which allows for programmatic management of service configurations through a RESTful interface.

## Table of Contents

1. [Overview](#overview)
2. [Authentication](#authentication)
3. [API Endpoints](#api-endpoints)
   - [Configuration Management](#configuration-management)
   - [Version Management](#version-management)
   - [Environment Variables](#environment-variables)
   - [Health and Diagnostics](#health-and-diagnostics)
4. [Configuration Structure](#configuration-structure)
5. [Versioning System](#versioning-system)
6. [Utility Scripts](#utility-scripts)
7. [Security Considerations](#security-considerations)
8. [Troubleshooting](#troubleshooting)
9. [Examples](#examples)

## Overview

The Configuration API provides a secure and flexible way to manage service configurations without deploying code changes. It supports:

- **Configuration Versioning**: Track and manage configuration changes over time
- **Environment Awareness**: Apply different settings based on the environment (development, staging, production)
- **Dynamic Resolution**: Use environment variables within configuration values
- **Detailed Diffing**: Compare configurations to understand changes
- **Module-Based Organization**: Manage different aspects of the service independently

## Authentication

All API endpoints except for health checks require authentication using an API key.

### Authentication Header

```
X-API-Key: your-api-key
```

### Setting Up API Keys

For security, API keys should be stored as Cloudflare secrets:

```bash
# Set API key for development environment
npx wrangler secret put CONFIG_API_KEY --env development

# Set API key for production environment 
npx wrangler secret put CONFIG_API_KEY --env production
```

### Authentication Responses

- **200 OK**: Authentication successful
- **401 Unauthorized**: Missing or invalid API key
- **403 Forbidden**: Insufficient permissions

## API Endpoints

### Configuration Management

#### Get Current Configuration

```
GET /api/config
```

Retrieves the current active configuration with all modules.

**Parameters**: None

**Response**:
```json
{
  "id": "config-2025-03-30-123456",
  "version": "1.0.0",
  "modules": {
    "video": { ... },
    "cache": { ... },
    "debug": { ... }
  },
  "activeVersion": true,
  "createdAt": "2025-03-30T12:34:56.789Z"
}
```

#### Create New Configuration

```
POST /api/config
```

Creates a new configuration version.

**Request Body**:
```json
{
  "modules": {
    "video": { ... },
    "cache": { ... },
    "debug": { ... }
  },
  "activate": true,
  "comment": "Updated video quality settings"
}
```

**Response**:
```json
{
  "id": "config-2025-03-30-123456",
  "version": "1.0.0",
  "modules": { ... },
  "activeVersion": true,
  "createdAt": "2025-03-30T12:34:56.789Z"
}
```

#### Update Module Configuration

```
PATCH /api/config/modules/:moduleName
```

Updates a specific module in the configuration.

**URL Parameters**:
- `moduleName`: Name of the module to update (e.g., "video", "cache", "debug")

**Request Body**:
```json
{
  "settings": {
    "setting1": "value1",
    "setting2": "value2"
  },
  "activate": true,
  "comment": "Updated cache TTL values"
}
```

**Response**:
```json
{
  "id": "config-2025-03-30-123456",
  "version": "1.0.0",
  "modules": {
    "moduleName": {
      "setting1": "value1",
      "setting2": "value2"
    }
  },
  "activeVersion": true,
  "createdAt": "2025-03-30T12:34:56.789Z"
}
```

### Version Management

#### List Configuration Versions

```
GET /api/config/versions
```

Returns a list of all configuration versions.

**Query Parameters**:
- `limit` (optional): Maximum number of versions to return (default: 100)

**Response**:
```json
{
  "versions": [
    {
      "id": "config-2025-03-30-123456",
      "version": "1.0.0",
      "activeVersion": true,
      "createdAt": "2025-03-30T12:34:56.789Z",
      "comment": "Updated video quality settings",
      "author": "api-user"
    },
    {
      "id": "config-2025-03-29-654321",
      "version": "0.9.0",
      "activeVersion": false,
      "createdAt": "2025-03-29T09:08:07.654Z",
      "comment": "Initial configuration",
      "author": "api-user"
    }
  ],
  "totalCount": 2
}
```

#### Get Specific Version

```
GET /api/config/version/:id
```

Retrieves a specific configuration version.

**URL Parameters**:
- `id`: The ID of the configuration version

**Response**:
```json
{
  "id": "config-2025-03-29-654321",
  "version": "0.9.0",
  "modules": { ... },
  "activeVersion": false,
  "createdAt": "2025-03-29T09:08:07.654Z",
  "comment": "Initial configuration",
  "author": "api-user"
}
```

#### Activate Configuration Version

```
PUT /api/config/activate/:id
```

Activates a specific configuration version.

**URL Parameters**:
- `id`: The ID of the configuration version to activate

**Response**:
```json
{
  "success": true,
  "id": "config-2025-03-29-654321",
  "activeVersion": true
}
```

#### Compare Configuration Versions

```
GET /api/config/compare
```

Compares two configuration versions and returns the differences.

**Query Parameters**:
- `from`: ID of the first version
- `to`: ID of the second version

**Response**:
```json
{
  "differences": {
    "video": {
      "quality": {
        "from": "high",
        "to": "medium"
      }
    },
    "cache": {
      "ttl": {
        "from": 3600,
        "to": 7200
      }
    }
  }
}
```

### Environment Variables

#### Resolve Environment Variables

```
POST /api/config/resolve
```

Resolves environment variables in a configuration, useful for testing how variable substitution will work.

**Request Body**:
```json
{
  "modules": {
    "video": {
      "quality": "${VIDEO_QUALITY}"
    }
  }
}
```

**Response**:
```json
{
  "modules": {
    "video": {
      "quality": "high"
    }
  }
}
```

### Health and Diagnostics

#### Health Check

```
GET /api/config/health
```

Verifies the API is responding. This endpoint does not require authentication.

**Response**:
```json
{
  "status": "ok",
  "version": "1.0.0",
  "timestamp": "2025-03-30T12:34:56.789Z"
}
```

## Configuration Structure

Configurations are organized into modules, each handling a specific aspect of the service.

### Video Module

Controls video transformation settings:

```json
{
  "video": {
    "derivatives": {
      "preview": {
        "width": 480,
        "height": 270,
        "mode": "video",
        "fit": "contain",
        "audio": false,
        "duration": "3s",
        "quality": "low",
        "compression": "high",
        "preload": "auto"
      },
      "mobile": {
        "width": 640,
        "height": 360,
        "mode": "video",
        "fit": "contain",
        "audio": true,
        "quality": "medium",
        "compression": "high"
      }
    },
    "defaultQuality": "high",
    "defaultCompression": "medium",
    "defaultFit": "contain",
    "defaultFormat": "mp4",
    "allowedFormats": ["mp4", "webm", "mov"],
    "maxDuration": "30m",
    "maxDimension": 1920
  }
}
```

### Cache Module

Controls caching behavior:

```json
{
  "cache": {
    "method": "cf",
    "debug": false,
    "defaultTtl": 3600,
    "cacheEverything": true,
    "enableTags": true,
    "ttl": {
      "ok": 3600,
      "redirects": 360,
      "clientError": 60,
      "serverError": 10
    }
  }
}
```

### Routes Module

Controls URL pattern matching and processing:

```json
{
  "routes": {
    "patterns": [
      {
        "name": "videos",
        "matcher": "^/videos/",
        "processPath": true,
        "baseUrl": null,
        "originUrl": null,
        "ttl": {
          "ok": 3600,
          "redirects": 360,
          "clientError": 60,
          "serverError": 10
        },
        "useTtlByStatus": true,
        "captureGroups": [
          "videoId"
        ],
        "quality": "high"
      }
    ]
  }
}
```

### Debug Module

Controls debugging features:

```json
{
  "debug": {
    "enabled": true,
    "verbose": false,
    "includeHeaders": true,
    "performanceLogging": true,
    "performanceThresholdMs": 100
  }
}
```

## Versioning System

The Configuration API uses a versioning system to track changes:

1. **Version IDs**: Format is `config-YYYY-MM-DD-HHMMSS` (e.g., `config-2025-03-30-123456`)
2. **Active Version**: Only one version can be active at a time
3. **Version History**: All versions are retained for auditing and rollbacks
4. **Version Metadata**: Includes creation timestamp, author, and comments

## Utility Scripts

The repository includes several utility scripts for working with the Configuration API:

### post-config.sh

Posts a new configuration to the API.

```bash
./scripts/post-config.sh [dev|staging|prod] [config.json file]
```

Example:
```bash
./scripts/post-config.sh dev sample-config.json
```

### compare-versions.sh

Compares two configuration versions.

```bash
./scripts/compare-versions.sh [dev|staging|prod] [from-id] [to-id]
```

Example:
```bash
./scripts/compare-versions.sh dev config-2025-03-29-123456 config-2025-03-30-654321
```

### resolve-env-vars.sh

Resolves environment variables in a configuration.

```bash
./scripts/resolve-env-vars.sh [dev|staging|prod] [config.json file]
```

Example:
```bash
./scripts/resolve-env-vars.sh dev sample-config.json
```

## Security Considerations

1. **API Keys**: Store API keys as Cloudflare secrets, not in the wrangler.jsonc file
2. **Access Control**: Limit access to the Configuration API to authorized personnel
3. **Audit Logging**: All configuration changes are logged with timestamps and user information
4. **Secure Communication**: Always use HTTPS for accessing the API
5. **IP Restrictions**: Consider restricting API access to specific IP addresses using Cloudflare Access or WAF

## Troubleshooting

### Common Issues

1. **Authentication Failures**:
   - Ensure the API key is correctly set as a secret
   - Check that the X-API-Key header is included in the request

2. **Validation Errors**:
   - Ensure configuration JSON is well-formed
   - Check that required fields are present
   - Verify values are within expected ranges

3. **KV Storage Issues**:
   - Confirm KV namespace is correctly configured in wrangler.jsonc
   - Check that KV service is available
   - Ensure KV storage limits are not exceeded

### Debug Headers

When debugging is enabled, the response includes the following headers:

- `X-Config-Version`: The active configuration version ID
- `X-Config-Timestamp`: When the configuration was created
- `X-Config-Processing-Time`: Time taken to process the configuration request

## Examples

### Basic Configuration Update

```bash
curl -X POST https://video-resizer.example.com/api/config \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "modules": {
      "video": {
        "quality": "high",
        "compression": "medium"
      },
      "cache": {
        "ttl": 3600,
        "cacheEverything": true
      }
    },
    "activate": true,
    "comment": "Updated video quality and cache settings"
  }'
```

### Module Update

```bash
curl -X PATCH https://video-resizer.example.com/api/config/modules/video \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "settings": {
      "quality": "medium",
      "compression": "high"
    },
    "activate": true,
    "comment": "Optimized for bandwidth"
  }'
```

### Version Activation

```bash
curl -X PUT https://video-resizer.example.com/api/config/activate/config-2025-03-29-123456 \
  -H "X-API-Key: your-api-key"
```

### Environment Variable Resolution

```bash
curl -X POST https://video-resizer.example.com/api/config/resolve \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "modules": {
      "video": {
        "quality": "${VIDEO_QUALITY:-medium}",
        "compression": "${VIDEO_COMPRESSION:-high}"
      }
    }
  }'
```
# Configuration API for Video Resizer

This document describes the Configuration API for the Video Resizer service, allowing for programmatic management of configurations.

## Overview

The Configuration API provides a RESTful interface to manage service configurations, allowing for:

- Retrieving current configuration
- Creating and updating configurations
- Managing configuration versions
- Resolving environment variables in configuration values
- Comparing different configuration versions

## API Endpoints

All API endpoints are under the `/api/config` path prefix.

### Retrieve Configuration

```
GET /api/config
```

Returns the current active configuration with all modules.

**Response:**
```json
{
  "id": "config-2025-03-30-123456",
  "version": "1.0.0",
  "modules": {
    "video": {...},
    "cache": {...},
    "debug": {...}
  },
  "activeVersion": true,
  "createdAt": "2025-03-30T12:34:56.789Z"
}
```

### Update Configuration

```
POST /api/config
```

Creates a new configuration version.

**Request Body:**
```json
{
  "modules": {
    "video": {...},
    "cache": {...},
    "debug": {...}
  },
  "activate": true
}
```

**Response:**
```json
{
  "id": "config-2025-03-30-123456",
  "version": "1.0.0",
  "modules": {
    "video": {...},
    "cache": {...},
    "debug": {...}
  },
  "activeVersion": true,
  "createdAt": "2025-03-30T12:34:56.789Z"
}
```

### Update a Configuration Module

```
PATCH /api/config/modules/:moduleName
```

Updates a specific module in the configuration.

**Request Body:**
```json
{
  "settings": {
    "setting1": "value1",
    "setting2": "value2"
  },
  "activate": true
}
```

**Response:**
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

### List Configuration Versions

```
GET /api/config/versions
```

Returns a list of all configuration versions.

**Response:**
```json
{
  "versions": [
    {
      "id": "config-2025-03-30-123456",
      "version": "1.0.0",
      "activeVersion": true,
      "createdAt": "2025-03-30T12:34:56.789Z"
    },
    {
      "id": "config-2025-03-29-654321",
      "version": "0.9.0",
      "activeVersion": false,
      "createdAt": "2025-03-29T09:08:07.654Z"
    }
  ]
}
```

### Activate a Configuration Version

```
PUT /api/config/activate/:id
```

Activates a specific configuration version.

**Response:**
```json
{
  "success": true,
  "id": "config-2025-03-29-654321",
  "activeVersion": true
}
```

### Compare Configuration Versions

```
GET /api/config/compare?from=:fromId&to=:toId
```

Compares two configuration versions and returns the differences.

**Response:**
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

### Resolve Environment Variables

```
POST /api/config/resolve
```

Resolves environment variables in a configuration.

**Request Body:**
```json
{
  "modules": {
    "video": {
      "quality": "${VIDEO_QUALITY}"
    }
  }
}
```

**Response:**
```json
{
  "modules": {
    "video": {
      "quality": "high"
    }
  }
}
```

## Authentication

All API endpoints require authentication using an API key. The API key must be included in the `X-API-Key` header:

```
X-API-Key: your-api-key
```

## Error Handling

The API returns appropriate HTTP status codes:

- 200 OK: Request succeeded
- 201 Created: Resource created successfully
- 400 Bad Request: Invalid request parameters
- 401 Unauthorized: Missing or invalid API key
- 404 Not Found: Resource not found
- 500 Internal Server Error: Server error

Error responses include a JSON body with error details:

```json
{
  "error": {
    "code": "INVALID_CONFIGURATION",
    "message": "Invalid configuration format"
  }
}
```

## Implementation Details

The Configuration API is implemented using:

1. **ConfigApiHandler**: Handles HTTP requests to the API endpoints
2. **ConfigApiService**: Provides high-level operations for managing configurations
3. **ConfigurationStorageService**: Manages storage and retrieval of configurations using KV storage
4. **ConfigAuthMiddleware**: Handles authentication and authorization for API requests

## Sample Usage

### Setting a Configuration

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
    "activate": true
  }'
```

### Retrieving the Current Configuration

```bash
curl -X GET https://video-resizer.example.com/api/config \
  -H "X-API-Key: your-api-key"
```

### Updating a Module

```bash
curl -X PATCH https://video-resizer.example.com/api/config/modules/video \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "settings": {
      "quality": "medium",
      "compression": "high"
    },
    "activate": true
  }'
```
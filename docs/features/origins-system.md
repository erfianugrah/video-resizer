# Origins System

## Overview

The Origins system is a comprehensive update to the video-resizer architecture that provides a more intuitive and flexible way to configure video sources. It replaces the legacy `pathPatterns` and `pathTransforms` approach with a unified configuration model that simplifies source management and improves maintainability.

## What Changed

### Key Improvements

1. **Unified Configuration**: The Origins system replaces multiple configuration sections (`pathPatterns`, `pathTransforms`, and `storage`) with a single, intuitive `origins` array.

2. **Flexible Source Management**: Each origin can have multiple sources (R2, remote, fallback) with specific priorities, making source fallback explicit and configurable.

3. **Enhanced Path Resolution**: Path resolution now uses named capture groups from the URL matcher pattern, improving readability and maintainability.

4. **Source-Specific Authentication**: Each source can have its own authentication configuration, supporting a wider range of deployment scenarios.

5. **Improved Caching**: Cache TTLs can be configured per origin and status code, allowing for more granular control.

6. **Type Safety**: The implementation includes comprehensive TypeScript interfaces and Zod validation schemas.

### Implementation Changes

1. **New Core Components**:
   - `OriginResolver` service for pattern matching and path resolution
   - Source resolution with explicit prioritization
   - Improved error handling with specialized error types

2. **Updated Flow**:
   - Request paths are matched against origin patterns
   - Capture groups are extracted from the URL
   - Sources are resolved in priority order
   - Authentication and headers are applied per source
   - Transformation and caching use origin-specific settings

3. **Backward Compatibility**:
   - The system supports both Origins and legacy configurations simultaneously
   - Automatic conversion from legacy to Origins format is available
   - Configuration flags control the behavior during migration

## How Origins Works

The Origins system introduces a pattern-based approach to video source configuration:

1. **Pattern Matching**: When a request arrives, the path is matched against each origin's regular expression pattern.

2. **Variable Extraction**: Named capture groups from the regex are extracted and made available for path templates.

3. **Source Selection**: Sources within the matched origin are evaluated in priority order (lower number = higher priority).

4. **Path Resolution**: The path template for each source is processed using the captured variables.

5. **Authentication**: If the source requires authentication, the appropriate auth method is applied.

6. **Fetch and Transform**: The video is fetched and transformed according to the origin's settings.

7. **Caching**: The response is cached according to the origin's TTL settings.

### Component Architecture

The Origins system is built around these key components:

- **OriginResolver**: Core service for matching paths and resolving sources
- **VideoHandlerWithOrigins**: Handler implementation using the Origins approach
- **TransformVideoCommand**: Updated to support Origins-based path resolution
- **Storage Services**: Modified to work with source-specific configurations

## Configuration Guide

### Origins Schema

Origins are configured as an array in the top-level configuration:

```json
{
  "origins": [
    {
      "name": "videos",
      "matcher": "^/videos/([a-zA-Z0-9]+)$",
      "captureGroups": ["videoId"],
      "sources": [
        {
          "type": "r2",
          "priority": 1,
          "bucketBinding": "VIDEOS_BUCKET",
          "path": "videos/${videoId}.mp4"
        },
        {
          "type": "remote",
          "priority": 2,
          "url": "https://example.com",
          "path": "videos/${videoId}"
        }
      ],
      "ttl": {
        "ok": 300,
        "redirects": 300,
        "clientError": 60,
        "serverError": 10
      }
    }
  ]
}
```

### Key Configuration Properties

#### Origin Object

| Property | Description |
|----------|-------------|
| `name` | Unique identifier for the origin |
| `matcher` | Regular expression to match request paths |
| `captureGroups` | Names for the regex capture groups |
| `sources` | Array of source configurations in priority order |
| `ttl` | Cache TTL settings for different response types |
| `transformOptions` | Video transformation options for this origin |

#### Source Object

| Property | Description |
|----------|-------------|
| `type` | Source type: "r2", "remote", or "fallback" |
| `priority` | Priority order (lower = higher priority) |
| `path` | Path template using capture variables |
| `bucketBinding` | (For r2) Environment binding for R2 bucket |
| `url` | (For remote/fallback) Base URL for the source |
| `auth` | Authentication configuration |

#### Path Templating

Path templates can use captured variables:

```
"path": "videos/${videoId}.${extension}"
```

Available variables:
- Named captures: `${name}`
- Numeric captures: `${1}`, `${2}`, etc.
- Special variables: `${request_path}`

## Migration Guide

### Migrating from pathPatterns

Here's how to convert from the legacy configuration to Origins:

1. **Identify Your Current Configuration**:
   - Review your `pathPatterns`, `pathTransforms`, and `storage` settings

2. **Create Origin Definitions**:
   - Create one origin for each `pathPattern`
   - Use the same `name` and `matcher` pattern
   - Convert capture variables to named capture groups

3. **Define Sources**:
   - Add an R2 source if you use R2 storage
   - Add a remote source if you use remote storage
   - Add a fallback source if you use fallback storage
   - Set priorities according to your preference

4. **Configure Path Templates**:
   - Convert path transforms to path templates using variables
   - Use `${name}` format for named variables

5. **Set TTL and Options**:
   - Transfer any TTL settings to the origin's `ttl` object
   - Move transformation options to the origin

### Example Conversion

**Legacy Configuration**:

```json
{
  "pathPatterns": [
    {
      "name": "videos",
      "matcher": "^/videos/([a-zA-Z0-9]+)$"
    }
  ],
  "pathTransforms": {
    "videos": {
      "r2": "$1.mp4",
      "remote": "videos/$1",
      "fallback": "videos/fallback/$1.mp4"
    }
  },
  "storage": {
    "r2": {
      "bucketBinding": "VIDEOS_BUCKET"
    },
    "remote": {
      "url": "https://example.com",
      "auth": {
        "enabled": true,
        "type": "aws-s3",
        "accessKeyVar": "AWS_ACCESS_KEY",
        "secretKeyVar": "AWS_SECRET_KEY"
      }
    },
    "fallback": {
      "url": "https://fallback.example.com"
    }
  }
}
```

**Origins Configuration**:

```json
{
  "origins": [
    {
      "name": "videos",
      "matcher": "^/videos/([a-zA-Z0-9]+)$",
      "captureGroups": ["videoId"],
      "sources": [
        {
          "type": "r2",
          "priority": 1,
          "bucketBinding": "VIDEOS_BUCKET",
          "path": "${videoId}.mp4"
        },
        {
          "type": "remote",
          "priority": 2,
          "url": "https://example.com",
          "path": "videos/${videoId}",
          "auth": {
            "enabled": true,
            "type": "aws-s3",
            "accessKeyVar": "AWS_ACCESS_KEY",
            "secretKeyVar": "AWS_SECRET_KEY"
          }
        },
        {
          "type": "fallback",
          "priority": 3,
          "url": "https://fallback.example.com",
          "path": "videos/fallback/${videoId}.mp4"
        }
      ],
      "ttl": {
        "ok": 300,
        "redirects": 300,
        "clientError": 60,
        "serverError": 10
      }
    }
  ]
}
```

### Compatibility and Fallback Mechanism

The video-resizer system includes a compatibility layer that:

1. **Supports Both Configurations**: Both Origins and legacy configurations can coexist in the same project.

2. **Automatic Detection**: The system automatically detects which configuration style to use.

3. **Feature Flags**: Configuration flags control the behavior:
   ```json
   "video": {
     "origins": {
       "enabled": true,
       "useLegacyPathPatterns": true,
       "convertPathPatternsToOrigins": true
     }
   }
   ```

4. **Automatic Conversion**: With `convertPathPatternsToOrigins` enabled, legacy configurations are automatically converted to the Origins format at runtime.

5. **Fallback Mechanism**: If an Origins-based lookup fails, the system can fall back to legacy path matching.

## Benefits of Origins

1. **Simplified Configuration**: More intuitive and unified configuration approach.

2. **Better Maintainability**: Centralized source definitions with explicit priorities.

3. **More Flexibility**: Fine-grained control over each source's behavior.

4. **Improved Type Safety**: Comprehensive validation reduces configuration errors.

5. **Enhanced Debugging**: Better error reporting and diagnostic information.

6. **Future Extensibility**: The system can be more easily extended with new features.

## Troubleshooting

### Common Issues

1. **Pattern Matching**: If URLs aren't matching as expected, check your regex patterns and test them with sample URLs.

2. **Source Priority**: If the wrong source is being used, verify the priority values (lower = higher priority).

3. **Path Resolution**: If paths aren't resolving correctly, check that capture groups are named and referenced correctly.

4. **Authentication**: For auth issues, verify environment variables and authentication configuration.

### Diagnostic Headers

The Origins system adds informational headers to responses:

- `X-Origin-Name`: The name of the matched origin
- `X-Origin-Matcher`: The pattern that matched
- `X-Source-Type`: The type of source used (r2, remote, fallback)
- `X-Source-Path`: The resolved path for the source
- `X-Handler`: Set to "Origins" for Origins-handled requests

## Conclusion

The Origins system provides a more flexible and maintainable approach to configuring video sources in the video-resizer project. By consolidating the configuration into a single, intuitive model, it simplifies both initial setup and ongoing maintenance.

Whether you're migrating from the legacy configuration or setting up a new project, the Origins system offers a powerful way to manage video sources with explicit prioritization, comprehensive path templating, and source-specific settings.
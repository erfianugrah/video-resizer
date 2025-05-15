# Origins Configuration

The Origins system provides a flexible way to define video sources and their access patterns. It replaces the legacy `pathPatterns` and `pathTransforms` with a more intuitive model.

## Overview

Origins are a key part of the video resizer architecture that define:

1. How incoming URLs are matched (using regex patterns)
2. Where video content should be fetched from (R2, remote servers, fallback locations)
3. How paths are transformed for different storage backends
4. Cache TTL and other behavior settings

## Configuration Structure

Origins are defined in the main configuration file as a top-level array:

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
          "url": "https://videos.example.com",
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

## Configuration Options

### Origin Object

Each origin defines a URL pattern and configuration for handling matching requests.

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `name` | string | Yes | A unique name for this origin |
| `matcher` | string | Yes | Regular expression to match against request paths |
| `captureGroups` | string[] | No | Named capture groups from the regex matcher |
| `sources` | Source[] | Yes | Array of source configurations in priority order |
| `ttl` | TTLConfig | No | Cache TTL settings for this origin |
| `processPath` | boolean | No | Whether to process the path (default: true) |
| `quality` | string | No | Default video quality for this origin |
| `videoCompression` | string | No | Default compression level for videos |
| `cacheability` | boolean | No | Whether responses can be cached |
| `transformOptions` | object | No | Options for transformation (see below) |
| `derivatives` | object | No | Resolution-specific configurations |
| `responsiveSelection` | object | No | Settings for responsive derivative selection |
| `multiResolution` | object | No | Settings for multi-resolution support |
| `accessControl` | object | No | Access control settings |
| `contentModeration` | object | No | Content moderation configuration |
| `cacheTags` | string[] | No | Cache tags for purging |
| `metadata` | object | No | Additional metadata |
| `streaming` | object | No | Streaming settings for HLS/DASH |
| `dimensionRatio` | string | No | Default aspect ratio (e.g. "16:9") |
| `formatMapping` | object | No | Format-specific mappings (e.g. content types) |

### Source Object

Sources define where and how to fetch content matched by an origin.

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `type` | "r2" \| "remote" \| "fallback" | Yes | The type of source |
| `priority` | number | Yes | Priority order (lower = higher priority) |
| `path` | string | Yes | Path template for retrieving content |
| `bucketBinding` | string | Yes (for r2) | Environment binding for R2 bucket |
| `url` | string | Yes (for remote/fallback) | Base URL for remote/fallback sources |
| `auth` | AuthConfig | No | Authentication configuration for this source |
| `headers` | object | No | Custom headers to send with requests |
| `cacheControl` | object | No | Source-specific cache control settings |
| `resolutionPathTemplate` | boolean | No | Whether path is a template that includes resolution variables |

### TTL Config

TTL settings control cache behavior for different response types.

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `ok` | number | No | TTL in seconds for 2xx responses (default: 300) |
| `redirects` | number | No | TTL for 3xx responses (default: 300) |
| `clientError` | number | No | TTL for 4xx responses (default: 60) |
| `serverError` | number | No | TTL for 5xx responses (default: 10) |

### Auth Config

Authentication settings for secure sources.

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `enabled` | boolean | Yes | Whether auth is enabled |
| `type` | string | Yes | Auth type (aws-s3, bearer, basic, token, query, header) |
| `accessKeyVar` | string | Depends on type | Environment variable for access key |
| `secretKeyVar` | string | Depends on type | Environment variable for secret key |
| `region` | string | For aws-s3 | AWS region for S3 authentication |
| `service` | string | For aws-s3 | Service name for AWS signing |
| `tokenVar` | string | For token | Environment variable for token |
| `tokenHeaderName` | string | For token | Header name for token authentication |
| `tokenSecret` | string | For token | Secret for token validation |
| `headerName` | string | For header | Name of the header to use |
| `headers` | object | For header | Custom headers to send |
| `expiresInSeconds` | number | Auth expiration | Token expiration time in seconds |
| `authHeader` | string | For bearer | Name of authorization header |
| `authScheme` | string | For bearer | Authorization scheme |
| `params` | object | For query | Query parameters to include |
| `sessionTokenVar` | string | For aws-s3 | Environment variable for AWS session token |

## Path Templating

When defining paths for sources, you can use variables from the URL matcher. These are identified using capture groups in the regex pattern and referenced in templates:

```json
{
  "matcher": "^/videos/([a-zA-Z0-9]+)\\.([a-z0-9]+)$",
  "captureGroups": ["videoId", "extension"],
  "sources": [
    {
      "path": "videos/${videoId}.${extension}"
    }
  ]
}
```

Available variables:
- Named capture groups: `${name}`
- Numeric capture groups: `${1}`, `${2}`, etc.
- Special variables: `${request_path}` (the full original path)

## Migrating from Legacy Configuration

A migration tool is available to convert legacy `pathPatterns` configuration to the new Origins format:

```bash
node tools/origins-converter.js -c ./config/worker-config.json -o ./config/worker-config-origins.json
```

For backward compatibility, you can also enable automatic conversion in your configuration:

```json
"video": {
  "origins": {
    "enabled": true,
    "useLegacyPathPatterns": true,
    "convertPathPatternsToOrigins": true
  }
}
```

## Advanced Configuration

### Transform Options

The `transformOptions` object provides specific transformation settings for an origin:

```json
"transformOptions": {
  "cacheability": true,
  "videoCompression": "medium",
  "quality": "high",
  "fit": "contain",
  "bypassTransformation": false
}
```

| Property | Type | Description |
|----------|------|-------------|
| `cacheability` | boolean | Whether videos from this origin can be cached |
| `videoCompression` | string | Default compression level (low, medium, high, auto) |
| `quality` | string | Default quality setting (low, medium, high, auto) |
| `fit` | string | Default fit mode (contain, cover, scale-down) |
| `bypassTransformation` | boolean | Whether to bypass transformations entirely |

### Derivatives

The `derivatives` object defines resolution-specific configurations:

```json
"derivatives": {
  "mobile": {
    "width": 640,
    "height": 360,
    "compression": "high"
  },
  "tablet": {
    "width": 1024,
    "height": 576,
    "compression": "medium" 
  },
  "desktop": {
    "width": 1920,
    "height": 1080,
    "compression": "low"
  }
}
```

### Responsive Selection

The `responsiveSelection` object controls how derivatives are selected:

```json
"responsiveSelection": {
  "enabled": true,
  "defaultDerivative": "tablet",
  "queryParam": "derivative"
}
```

### Multi-Resolution Support

The `multiResolution` object configures multi-resolution video support:

```json
"multiResolution": {
  "enabled": true,
  "resolutions": {
    "360p": {
      "width": 640,
      "height": 360,
      "bitrate": 800000
    },
    "480p": {
      "width": 854,
      "height": 480,
      "bitrate": 1400000
    },
    "720p": {
      "width": 1280,
      "height": 720,
      "bitrate": 2800000
    },
    "1080p": {
      "width": 1920,
      "height": 1080,
      "bitrate": 5000000
    }
  },
  "defaultResolution": "720p",
  "queryParam": "resolution"
}
```

### Access Control

The `accessControl` object defines access restrictions:

```json
"accessControl": {
  "enabled": true,
  "allowedIps": ["127.0.0.1", "192.168.1.0/24"],
  "requireAuth": true,
  "authHeader": "Authorization",
  "authScheme": "Bearer"
}
```

### Content Moderation

The `contentModeration` object provides content moderation settings:

```json
"contentModeration": {
  "enabled": true,
  "sensitiveContent": false,
  "ageRestriction": 0
}
```

### Streaming Configuration

The `streaming` object configures streaming behavior for HLS/DASH:

```json
"streaming": {
  "type": "hls",
  "segmentDuration": 10,
  "manifestType": "m3u8",
  "encryption": {
    "enabled": false
  }
}
```

### Format Mapping

The `formatMapping` object defines content type mappings for different formats:

```json
"formatMapping": {
  "mp4": {
    "contentType": "video/mp4",
    "acceptRanges": true
  },
  "webm": {
    "contentType": "video/webm",
    "acceptRanges": true
  }
}
```

## Usage Examples

### Multiple Sources with Fallbacks

Origins can have multiple sources with different priorities. The system will try each source in priority order until content is found:

```json
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
    "url": "https://origin.videos.com",
    "path": "${videoId}"
  },
  {
    "type": "fallback",
    "priority": 3,
    "url": "https://fallback.videos.com",
    "path": "fallback/${videoId}"
  }
]
```

### Authenticated Sources

To use authentication for secure sources:

```json
"sources": [
  {
    "type": "remote",
    "priority": 1,
    "url": "https://private.videos.com",
    "path": "${videoId}",
    "auth": {
      "enabled": true,
      "type": "bearer",
      "accessKeyVar": "API_KEY_VARIABLE"
    }
  }
]
```

### Custom Headers

You can add custom headers to remote sources:

```json
"sources": [
  {
    "type": "remote",
    "priority": 1,
    "url": "https://origin.videos.com",
    "path": "${videoId}",
    "headers": {
      "X-Custom-Header": "custom-value",
      "X-Source": "video-resizer"
    }
  }
]
```

### Source-Specific Cache Control

Configure cache control settings per source:

```json
"sources": [
  {
    "type": "remote", 
    "priority": 1,
    "url": "https://videos.example.com",
    "path": "${videoId}",
    "cacheControl": {
      "maxAge": 86400,
      "staleWhileRevalidate": 3600,
      "staleIfError": 86400
    }
  }
]
```

## Validation and Testing

You can validate your Origins configuration using the check-config tool:

```bash
node tools/check-config.js -c ./config/worker-config-origins.json
```

## Internal Architecture

The Origins system is implemented through several key components:

### OriginResolver Service

The `OriginResolver` service is responsible for:

1. Matching incoming request paths to the appropriate Origin
2. Extracting capture groups from the path
3. Resolving paths for different source types
4. Managing source priority and fallback behavior

Example usage:

```typescript
// Create resolver with configuration
const resolver = new OriginResolver(config);

// Match a path to an origin
const origin = resolver.findMatchingOrigin('/videos/sample.mp4');

// Extract capture groups from a path
const match = resolver.matchOriginWithCaptures('/videos/sample.mp4');
// -> { origin, matched: true, captures: { videoId: 'sample', extension: 'mp4' } }

// Resolve a path to a specific source
const resolved = resolver.resolvePathToSource('/videos/sample.mp4');
// -> { source, resolvedPath: 'videos/sample.mp4', originType: 'r2' }
```

### Error Handling

The Origins system includes specialized error classes:

- `OriginError`: Base class for all Origins-related errors
- `OriginResolutionError`: Thrown when an origin cannot be found for a path
- `SourceResolutionError`: Thrown when a source cannot be resolved within an origin

These errors provide detailed context about the failure, including:
- The original path
- The matched origin (if any)
- The source type being accessed
- Specific error reasons

### Response Building

The `ResponseBuilder` has been enhanced to work with Origins:

```typescript
// Create response builder
const responseBuilder = new ResponseBuilder(response, context);

// Add origin information to headers
responseBuilder.withOriginInfo(
  { name: 'videos', matcher: '...' },  // Origin info
  { type: 'r2', resolvedPath: '...' }  // Source info
);
```

This adds diagnostic headers to help with debugging and tracing, such as:
- `X-Origin-Name`
- `X-Origin-Matcher`
- `X-Source-Type`
- `X-Source-Path`
- `X-Handler: Origins`
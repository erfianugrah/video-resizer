# Video Resizer Configuration Guide

*Last Updated: May 10, 2025*

## Table of Contents

- [Introduction](#introduction)
- [Configuration Layers](#configuration-layers)
- [Video Configuration](#video-configuration)
  - [Video Derivatives](#video-derivatives)
  - [Transformation Modes](#transformation-modes)
  - [Default Options](#default-options)
  - [Passthrough Settings](#passthrough-settings)
- [Path Pattern Configuration](#path-pattern-configuration)
  - [Pattern Syntax](#pattern-syntax)
  - [Capture Groups](#capture-groups)
  - [Examples](#pattern-examples)
- [Cache Configuration](#cache-configuration)
  - [Cache Method](#cache-method)
  - [TTL Settings](#ttl-settings)
  - [Cache Profiles](#cache-profiles)
  - [KV Cache Settings](#kv-cache-settings)
- [Debug Configuration](#debug-configuration)
  - [Debug Options](#debug-options)
  - [Debug Headers](#debug-headers)
  - [Debug UI](#debug-ui)
- [Logging Configuration](#logging-configuration)
  - [Log Levels](#log-levels)
  - [Log Formats](#log-formats)
  - [Component Filtering](#component-filtering)
  - [Performance Logging](#performance-logging)
- [Environment Variables](#environment-variables)
- [Dynamic Configuration](#dynamic-configuration)
- [Storage Configuration](#storage-configuration)
- [Configuration via Wrangler](#configuration-via-wrangler)

## Introduction

The Video Resizer uses a comprehensive configuration system to control its behavior. This guide provides a complete reference for all configuration options and how to use them effectively.

## Configuration Layers

Configuration is loaded from multiple sources with clear precedence:

1. **Default Values**: Hardcoded in manager classes
2. **Wrangler Config**: From `wrangler.jsonc` 
3. **Environment Variables**: Override during runtime
4. **KV Storage**: Dynamic updates without redeployment

This layered approach allows for flexible configuration management:
- Default values ensure the system works out-of-the-box
- Wrangler configuration provides environment-specific settings
- Environment variables allow for quick adjustments without redeployment
- KV storage enables dynamic configuration updates without code changes

## Video Configuration

The `VideoConfigurationManager` handles all video transformation settings and options.

### Video Derivatives

Preset configurations for different use cases:

| Derivative | Description | Example Use Case |
|------------|-------------|------------------|
| `high`     | High quality video | Desktop viewing, high-bandwidth connections |
| `medium`   | Medium quality video | Default for most devices |
| `low`      | Low quality video | Mobile devices, low-bandwidth connections |
| `mobile`   | Mobile-optimized | Small screens, potentially low bandwidth |
| `thumbnail`| Static thumbnail | Video preview/thumbnail images |
| `preview`  | Short preview clip | Hover previews, loading animations |
| `animation`| GIF-like animation | Short animated preview |

Example usage:
```
https://cdn.example.com/videos/sample.mp4?derivative=mobile
```

### Transformation Modes

The `mode` parameter specifies what type of output to generate:

#### 1. Video Mode (`mode=video`)
- Default mode when not specified
- Outputs an optimized MP4 video file with H.264 video and AAC audio
- Preserves motion and audio from the original video
- Allows control over playback parameters (loop, autoplay, muted, preload)
- Example: `https://cdn.example.com/videos/sample.mp4?mode=video&width=640&height=360`

#### 2. Frame Mode (`mode=frame`)
- Outputs a single still image from the video at the specified time
- Useful for generating video thumbnails or previews
- Requires the `time` parameter to specify which frame to extract
- Supports different output formats (jpg, png, webp) using the `format` parameter
- Example: `https://cdn.example.com/videos/sample.mp4?mode=frame&time=30s&format=jpg&width=640`

#### 3. Spritesheet Mode (`mode=spritesheet`)
- Outputs a JPEG image containing a grid of thumbnails from the video
- Each thumbnail represents a frame from the video at regular intervals
- Useful for video scrubbing interfaces, preview thumbnails, and video navigation
- Can specify a time range using `time` (start) and `duration` parameters
- Example: `https://cdn.example.com/videos/sample.mp4?mode=spritesheet&width=640&height=480&duration=10s`

**Spritesheet-specific Parameters:**

| Parameter | Description | Default | Example |
|-----------|-------------|---------|---------|
| `time` | Starting time for the spritesheet range | `0s` | `time=30s` |
| `duration` | Duration of video to include in spritesheet | `10s` | `duration=60s` |
| `width` | Width of the entire spritesheet | Required | `width=800` |
| `height` | Height of the entire spritesheet | Required | `height=600` |
| `fit` | How to fit thumbnails within the grid | `contain` | `fit=cover` |

**Technical Notes:**
- Cloudflare will automatically determine the grid size based on the video length
- The maximum input video size is 40MB
- For best results, use videos with uniform motion or scene changes
- Playback parameters will cause validation errors if explicitly set
- Spritesheet mode is best for short to medium-length videos (up to a few minutes)

### Default Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `width` | number | null | Width in pixels |
| `height` | number | null | Height in pixels |
| `mode` | string | 'video' | Transformation mode: 'video', 'frame', or 'spritesheet' |
| `fit` | string | 'contain' | Resize behavior: 'contain', 'scale-down', or 'cover' |
| `audio` | boolean | true | Whether to include audio |
| `format` | string | null | Output format, e.g., 'mp4', 'webm' |
| `time` | string | null | Timestamp for frame extraction, e.g., '5s' |
| `duration` | string | null | Duration for clips, e.g., '10s' |
| `quality` | string | null | Quality level: 'low', 'medium', 'high', 'auto' |
| `compression` | string | null | Compression level: 'low', 'medium', 'high', 'auto' |
| `loop` | boolean | null | Whether video should loop |
| `preload` | string | null | Preload behavior: 'none', 'metadata', 'auto' |
| `autoplay` | boolean | null | Whether video should autoplay |
| `muted` | boolean | null | Whether video should be muted |

> Note: Playback parameters (`loop`, `autoplay`, `muted`, `preload`) are only applicable to `mode=video` and will cause validation errors if used with other modes.

### Passthrough Settings

The video-resizer includes a configurable passthrough capability for non-MP4 video files:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `passthrough.enabled` | boolean | true | Enable passthrough for non-MP4 files |
| `passthrough.whitelistedFormats` | string[] | [] | File extensions to process even if not MP4 |

Example configuration:

```json
{
  "passthrough": {
    "enabled": true,
    "whitelistedFormats": [".webm"]
  }
}
```

When a request is received for a non-MP4 file (e.g., `.webm`, `.mov`, `.avi`), and passthrough is enabled, the request will be passed directly to the origin server without any transformation. This prevents timeouts and errors when processing unsupported formats.

## Path Pattern Configuration

Path patterns define how URLs are matched and processed.

### Pattern Syntax

| Option | Type | Description |
|--------|------|-------------|
| `name` | string | Identifier for the pattern |
| `matcher` | string | Regular expression pattern for matching URLs |
| `processPath` | boolean | Whether to process matched paths |
| `baseUrl` | string | Base URL for transformations |
| `originUrl` | string | Origin URL for fetching content |
| `quality` | string | Quality preset for this pattern |
| `ttl` | object | TTL settings object (replaces deprecated `cacheTtl`) |
| `useTtlByStatus` | boolean | Whether to use status-specific TTL values |
| `priority` | number | Processing priority (higher values are evaluated first) |
| `captureGroups` | string[] | Named capture groups in the matcher |
| `transformationOverrides` | object | Override default transformation parameters |

### Capture Groups

Capture groups in the regular expression pattern can be named and used in the URL transformation process:

```json
{
  "matcher": "^/videos/([a-z0-9-]+)/([a-z0-9-]+)$",
  "captureGroups": ["category", "videoId"]
}
```

This allows the captured values to be used in the origin URL:

```json
{
  "originUrl": "https://videos-{category}.example.com/{videoId}.mp4"
}
```

### Pattern Examples

Standard pattern to match all MP4 files at the root:

```json
{
  "name": "standard",
  "matcher": "^/(.*\\.mp4)",
  "processPath": true,
  "baseUrl": null,
  "originUrl": "https://videos.example.com",
  "ttl": {
    "ok": 86400,
    "redirects": 3600,
    "clientError": 60,
    "serverError": 10
  },
  "useTtlByStatus": true
}
```

Pattern with path prefix and named capture groups:

```json
{
  "name": "videos",
  "matcher": "^/videos/([a-z0-9-]+)",
  "processPath": true,
  "baseUrl": null,
  "originUrl": "https://media.example.com",
  "ttl": {
    "ok": 3600,
    "redirects": 300,
    "clientError": 60,
    "serverError": 10
  },
  "captureGroups": ["videoId"],
  "quality": "high",
  "transformationOverrides": {
    "fit": "cover",
    "compression": "low"
  }
}
```

## Cache Configuration

The `CacheConfigurationManager` handles caching behavior and cache profiles.

### Cache Method

| Option | Description | Default |
|--------|-------------|---------|
| `cf` | Use Cloudflare's built-in caching with CF object | ✓ |
| `cacheApi` | Use the Cache API directly | |

### TTL Settings

TTL (Time To Live) settings based on response status:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `ok` | number | 86400 | TTL for successful responses (200-299) |
| `redirects` | number | 3600 | TTL for redirects (300-399) |
| `clientError` | number | 60 | TTL for client errors (400-499) |
| `serverError` | number | 10 | TTL for server errors (500-599) |

### Cache Profiles

Each profile configures caching behavior for a specific content pattern:

| Option | Type | Description |
|--------|------|-------------|
| `regex` | string | Pattern to match content |
| `cacheability` | boolean | Whether content should be cached |
| `videoCompression` | string | Compression for this profile |
| `ttl` | object | TTL settings (see above) |

Default profiles:

| Profile | Description | TTL (OK) |
|---------|-------------|----------|
| `default` | Default pattern for all content | 24 hours |
| `highTraffic` | Popular content pattern | 7 days |
| `shortForm` | Short-form video content | 2 days |
| `dynamic` | Dynamic or live content | 5 minutes |

### KV Cache Settings

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enableKVCache` | boolean | true | Enable KV storage for transformed variants |
| `kvTtl.ok` | number | 86400 | TTL for 2xx responses in KV storage |
| `kvTtl.redirects` | number | 3600 | TTL for 3xx responses in KV storage |
| `kvTtl.clientError` | number | 60 | TTL for 4xx responses in KV storage |
| `kvTtl.serverError` | number | 10 | TTL for 5xx responses in KV storage |

The KV cache system requires a KV namespace binding:

```jsonc
"kv_namespaces": [
  {
    "binding": "VIDEO_TRANSFORMATIONS_CACHE",
    "id": "your-kv-namespace-id"
  }
]
```

## Debug Configuration

The `DebugConfigurationManager` handles debugging capabilities and settings.

### Debug Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | boolean | false | Enable debug mode globally |
| `verbose` | boolean | false | Enable verbose debug output |
| `includeHeaders` | boolean | false | Include headers in debug info |
| `includePerformance` | boolean | false | Include performance metrics |
| `dashboardMode` | boolean | true | Enable debug dashboard |
| `viewMode` | boolean | true | Enable debug view |
| `headerMode` | boolean | true | Enable debug headers |
| `debugQueryParam` | string | 'debug' | Query parameter to enable debug |
| `debugViewParam` | string | 'view' | Value for debug view parameter |
| `preserveDebugParams` | boolean | false | Whether to preserve debug parameters in transformed URLs |
| `renderStaticHtml` | boolean | true | Render static HTML for debug views |
| `includeStackTrace` | boolean | false | Include stack traces in debug info |
| `maxContentLength` | number | 50000 | Maximum debug content length |
| `allowedIps` | string[] | [] | IPs allowed to see debug info |
| `excludedPaths` | string[] | [] | Paths excluded from debugging |

### Debug Headers

When header mode is enabled, the service adds detailed debug headers to the response:

- `X-Video-Resizer-Debug`: Indicates debug mode is enabled
- `X-Processing-Time-Ms`: Time taken to process the request
- `X-Transform-Source`: Source of the transformation
- `X-Device-Type`: Detected device type
- `X-Network-Quality`: Estimated network quality
- `X-Cache-Enabled`: Cache status
- `X-Cache-TTL`: Cache time-to-live

### Debug UI

The debug UI provides a comprehensive HTML interface for analyzing video transformations, activated by adding `?debug=view` to any video URL:

```
https://your-domain.com/videos/sample.mp4?width=720&height=480&debug=view
```

The debug UI includes:
1. **Performance Metrics**: Processing time and cache status
2. **Video Transformation Details**: Applied parameters and settings
3. **Client Information**: Device type and capabilities
4. **Interactive Features**: Live preview and expandable diagnostics

## Logging Configuration

The `LoggingConfigurationManager` handles logging levels, formats, and behavior.

### Log Levels

| Level | Priority | Description |
|-------|----------|-------------|
| `debug` | 1 | Detailed debugging information |
| `info` | 2 | General informational messages |
| `warn` | 3 | Warning conditions |
| `error` | 4 | Error conditions |

Log messages are only shown if their level is >= the configured level.

### Log Formats

| Format | Description | Example |
|--------|-------------|---------|
| `text` | Human-readable text format | `[INFO] [VideoHandler] Processing video request` |
| `json` | JSON structured format | `{"level":"info","component":"VideoHandler","message":"Processing video request","timestamp":"2023-09-15T12:34:56Z"}` |

### Component Filtering

You can filter logs by component name:

1. **Enable specific components**:
   ```typescript
   enabledComponents: ['VideoHandler', 'CacheService']
   ```

2. **Disable specific components**:
   ```typescript
   disabledComponents: ['StorageService']
   ```

### Performance Logging

When `enablePerformanceLogging` is true:

1. Tracks execution time of key operations
2. Logs warnings when operations exceed `performanceThresholdMs`
3. Provides detailed performance breakdowns

## Environment Variables

| Variable | Type | Description |
|----------|------|-------------|
| `PATH_PATTERNS` | JSON | JSON array of path patterns |
| `VIDEO_DEFAULT_QUALITY` | string | Default video quality |
| `VIDEO_DEFAULT_COMPRESSION` | string | Default compression level |
| `CACHE_METHOD` | string | Cache method: 'cf' or 'cacheApi' |
| `CACHE_DEBUG` | boolean | Enable cache debugging |
| `CACHE_ENABLE_KV` | boolean | Enable KV storage for transformed variants |
| `LOG_LEVEL` | string | Log level: 'debug', 'info', 'warn', 'error' |
| `LOG_FORMAT` | string | Log format: 'json' or 'text' |
| `DEBUG_ENABLED` | boolean | Enable debug mode |
| `DEBUG_VERBOSE` | boolean | Enable verbose debug output |

## Dynamic Configuration

The video-resizer supports dynamic configuration using Cloudflare KV storage. This allows configuration updates without requiring redeployment.

To update configuration:

1. Create a JSON file with the configuration to update:
   ```json
   {
     "video": {
       "derivatives": {
         "mobile": {
           "width": 360,
           "height": 640,
           "quality": "medium",
           "compression": "high"
         }
       }
     },
     "cache": {
       "enableKVCache": true,
       "method": "cf"
     }
   }
   ```

2. Use the configuration upload tool:
   ```bash
   node tools/config-upload.js --env production --config ./my-config.json
   ```

3. The configuration is immediately applied to all workers in the environment

## Storage Configuration

The video-resizer supports multiple storage backends for video content:

```json
{
  "storage": {
    "primary": {
      "type": "r2",
      "bucket": "videos",
      "region": "auto"
    },
    "secondary": {
      "type": "remote",
      "url": "https://videos.example.com",
      "headers": {
        "Authorization": "Bearer {token}"
      }
    },
    "fallback": {
      "type": "s3",
      "bucket": "fallback-videos",
      "region": "us-east-1"
    }
  }
}
```

The storage service will check each configured storage option in order until the content is found.

## Configuration via Wrangler

The core configuration is defined in `wrangler.jsonc`:

```jsonc
{
  "name": "video-resizer",
  "compatibility_date": "2023-09-01",
  "main": "dist/index.js",
  "kv_namespaces": [
    {
      "binding": "VIDEO_TRANSFORMATIONS_CACHE",
      "id": "your-kv-namespace-id"
    },
    {
      "binding": "VIDEO_CACHE_KEY_VERSIONS",
      "id": "your-versions-kv-id"
    },
    {
      "binding": "CONFIGURATION",
      "id": "your-config-kv-id"
    }
  ],
  "vars": {
    "CACHE_METHOD": "cf",
    "LOG_LEVEL": "info",
    "DEBUG_ENABLED": "false"
  },
  "r2_buckets": [
    {
      "binding": "VIDEOS",
      "bucket_name": "videos"
    }
  ],
  "routes": [
    {
      "pattern": "videos.example.com/*",
      "zone_name": "example.com"
    }
  ]
}
```

Environment-specific configurations can be defined in the `env` section:

```jsonc
"env": {
  "production": {
    "vars": {
      "LOG_LEVEL": "warn",
      "DEBUG_ENABLED": "false"
    }
  },
  "staging": {
    "vars": {
      "LOG_LEVEL": "info",
      "DEBUG_ENABLED": "true"
    }
  }
}
```
# Video Resizer Configuration Schema Reference

*Last Updated: May 1, 2025*

This document provides a comprehensive reference of the configuration schema used in the Video Resizer. It covers all available configuration options, their types, default values, and validation rules.

## Table of Contents

- [Configuration Overview](#configuration-overview)
- [Configuration Sources](#configuration-sources)
- [Video Configuration](#video-configuration)
  - [Derivatives](#derivatives)
  - [Path Patterns](#path-patterns)
  - [Default Options](#default-options)
- [Cache Configuration](#cache-configuration)
  - [Cache Profiles](#cache-profiles)
  - [TTL Settings](#ttl-settings)
- [Debug Configuration](#debug-configuration)
- [Logging Configuration](#logging-configuration)
- [Storage Configuration](#storage-configuration)
- [Environment Variables](#environment-variables)
- [Configuration Example](#configuration-example)

## Configuration Overview

The Video Resizer uses a modular configuration system organized into these main sections:

1. **Video Configuration**: Controls video transformation settings, derivatives, and patterns
2. **Cache Configuration**: Manages caching behavior, TTLs, and profiles
3. **Debug Configuration**: Controls debugging features and diagnostic output
4. **Logging Configuration**: Defines logging behavior, levels, and formats
5. **Storage Configuration**: Configures origin storage settings and authentication

All configuration is validated using [Zod](https://github.com/colinhacks/zod) schemas to ensure type safety and consistency.

## Configuration Sources

Configuration is loaded from multiple sources, in order of precedence:

1. **Environment Variables**: For critical settings (override all other sources)
2. **KV Store**: For dynamic configuration (updated via configuration API)
3. **worker-config.json**: For base configuration
4. **Hard-coded Defaults**: As fallback for any unspecified settings

## Video Configuration

The video configuration controls how videos are transformed and processed.

### Schema Structure

```typescript
interface VideoConfig {
  derivatives: Record<string, VideoDerivative>;
  defaults: {
    quality: string;
    compression: string;
    audio: boolean;
    fit: string;
    format: string;
  };
  validOptions: {
    modes: string[];
    formats: string[];
    fitOptions: string[];
    qualityLevels: string[];
    compressionLevels: string[];
    preloadOptions: string[];
  };
  responsive: {
    enabled: boolean;
    preserveAspectRatio: boolean;
    defaultScreenWidths: number[];
    deviceBreakpoints: Record<string, number>;
  };
  paramMapping: Record<string, string>;
  cdnCgi: {
    basePath: string;
  };
  passthrough: {
    enabled: boolean;
    formats: string[];
    maxSizeBytes: number;
  };
  pathPatterns: PathPattern[];
  storage?: StorageConfig;
}
```

### Derivatives

Derivatives are preset configurations for different use cases:

```typescript
interface VideoDerivative {
  width?: number | null;
  height?: number | null;
  mode?: 'video' | 'frame' | 'spritesheet';
  fit?: 'contain' | 'scale-down' | 'cover';
  audio?: boolean;
  format?: string | null;
  time?: string | null;
  duration?: string | null;
  quality?: 'low' | 'medium' | 'high' | 'auto' | null;
  compression?: 'low' | 'medium' | 'high' | 'auto' | null;
  loop?: boolean | null;
  preload?: 'none' | 'metadata' | 'auto' | null;
  autoplay?: boolean | null;
  muted?: boolean | null;
  [key: string]: unknown;
}
```

**Default Derivatives:**

- `high`: 1920x1080, high quality, low compression
- `medium`: 1280x720, medium quality, medium compression
- `low`: 640x360, low quality, high compression
- `mobile`: 480x270, low quality, high compression
- `thumbnail`: 320x180 frame at 10% mark
- `preview`: 480x270, 5-second loop, muted, autoplay
- `animation`: 480x270, loop enabled, muted, autoplay

### Path Patterns

Path patterns define URL matching rules and origin mapping:

```typescript
interface PathPattern {
  name: string;               // Unique identifier for the pattern
  matcher: string;            // Regex pattern for URL matching
  processPath: boolean;       // Whether to transform this path
  baseUrl?: string | null;    // Base URL for transformations
  originUrl?: string | null;  // Origin URL for video source
  quality?: string;           // Default quality for this pattern
  ttl?: {                     // Status-based TTLs
    ok: number;
    redirects: number;
    clientError: number;
    serverError: number;
  };
  useTtlByStatus?: boolean;   // Use status-based TTLs
  priority?: number;          // Pattern matching priority
  captureGroups?: string[];   // Named regex capture groups
  transformationOverrides?: Record<string, any>; // Override params
  auth?: AuthConfig;          // Authentication settings
}
```

**Validation Rules:**

- `matcher` must be a valid regex pattern
- `ttl` values must be positive numbers
- `priority` determines pattern precedence (higher values have higher priority)
- Pattern ordering matters for patterns with the same priority

### Default Options

Default options applied when specific values aren't provided:

```typescript
const defaultOptions = {
  quality: 'auto',            // Default video quality
  compression: 'auto',        // Default compression level
  audio: true,                // Include audio by default
  fit: 'contain',             // Default fit mode
  format: 'mp4'               // Default video format
};

const validOptions = {
  modes: ['video', 'frame', 'spritesheet'],
  formats: ['mp4', 'webm', 'gif', 'jpg', 'webp', 'png'],
  fitOptions: ['contain', 'scale-down', 'cover'],
  qualityLevels: ['low', 'medium', 'high', 'auto'],
  compressionLevels: ['low', 'medium', 'high', 'auto'],
  preloadOptions: ['none', 'metadata', 'auto']
};
```

## Cache Configuration

The cache configuration controls how videos are cached.

### Schema Structure

```typescript
interface CacheConfig {
  enableKVCache: boolean;     // Enable KV cache storage
  debug: boolean;             // Enable cache debug logging
  defaultMaxAge: number;      // Default Cache-Control max-age
  respectOriginHeaders: boolean; // Respect origin Cache-Control
  cacheEverything: boolean;   // Cache all status codes
  enableCacheTags: boolean;   // Enable Cache-Tag headers
  cacheTagPrefix: string;     // Prefix for cache tags
  purgeOnUpdate: boolean;     // Purge cache on config update
  bypassQueryParameters: string[]; // Parameters that bypass cache
  bypassHeaderValue: string;  // Header value to bypass cache
  maxSizeBytes: number;       // Max size for cached items
  mimeTypes?: {               // MIME type settings
    video: string[];
    image: string[];
  };
  profiles: Record<string, CacheProfile>; // Cache profiles
}
```

**Default Values:**

- `enableKVCache`: `true`
- `debug`: `false`
- `defaultMaxAge`: `300` (5 minutes)
- `respectOriginHeaders`: `true`
- `cacheEverything`: `false`
- `enableCacheTags`: `true`
- `cacheTagPrefix`: `'video-'`
- `purgeOnUpdate`: `false`
- `bypassQueryParameters`: `['nocache', 'bypass']`
- `bypassHeaderValue`: `'no-cache'`
- `maxSizeBytes`: `25 * 1024 * 1024` (25MB)

### Cache Profiles

Cache profiles define caching behavior for different content types:

```typescript
interface CacheProfile {
  regex: string;              // Pattern to match against URL
  cacheability: boolean;      // Whether to cache this content
  videoCompression?: string;  // Compression for this profile
  ttl: {                      // TTL settings by status
    ok: number;
    redirects: number;
    clientError: number;
    serverError: number;
  };
}
```

**Default Profile:**

```json
{
  "default": {
    "regex": ".*",
    "cacheability": true,
    "videoCompression": "auto",
    "ttl": {
      "ok": 300,
      "redirects": 300,
      "clientError": 60,
      "serverError": 10
    }
  }
}
```

### TTL Settings

TTL settings control cache duration based on response status:

```typescript
interface CacheTTL {
  ok: number;               // 2xx responses (success)
  redirects: number;        // 3xx responses (redirects)
  clientError: number;      // 4xx responses (client errors)
  serverError: number;      // 5xx responses (server errors)
}
```

**Default Values:**

- `ok`: `300` (5 minutes)
- `redirects`: `300` (5 minutes)
- `clientError`: `60` (1 minute)
- `serverError`: `10` (10 seconds)

## Debug Configuration

The debug configuration controls debugging features and diagnostic output.

### Schema Structure

```typescript
interface DebugConfig {
  enabled: boolean;            // Master debug switch
  verbose: boolean;            // Enable verbose output
  includeHeaders: boolean;     // Include headers in debug output
  includePerformance: boolean; // Include performance metrics
  dashboardMode: boolean;      // Enable debug dashboard
  viewMode: boolean;           // Enable debug view
  headerMode: boolean;         // Enable debug headers
  debugQueryParam: string;     // Query param to enable debug
  debugViewParam: string;      // Value for debug view
  preserveDebugParams: boolean; // Keep debug params in URLs
  debugHeaders: string[];      // Headers that enable debug
  renderStaticHtml: boolean;   // Render static HTML debug
  includeStackTrace: boolean;  // Include stack traces
  maxContentLength: number;    // Max debug content length
  truncationMessage: string;   // Message when content truncated
  allowedIps: string[];        // IPs allowed to see debug
  excludedPaths: string[];     // Paths excluded from debug
}
```

**Default Values:**

- `enabled`: `false`
- `verbose`: `false`
- `includeHeaders`: `false`
- `includePerformance`: `false`
- `dashboardMode`: `true`
- `viewMode`: `true`
- `headerMode`: `true`
- `debugQueryParam`: `'debug'`
- `debugViewParam`: `'view'`
- `preserveDebugParams`: `false`
- `debugHeaders`: `['X-Debug', 'X-Debug-Enabled', 'Debug']`
- `renderStaticHtml`: `true`
- `includeStackTrace`: `false`
- `maxContentLength`: `50000`
- `truncationMessage`: `'... [content truncated]'`
- `allowedIps`: `[]`
- `excludedPaths`: `[]`

## Logging Configuration

The logging configuration controls logging behavior, levels, and formats.

### Schema Structure

```typescript
interface LoggingConfig {
  level: 'debug' | 'info' | 'warn' | 'error'; // Logging level
  includeTimestamps: boolean;    // Include timestamps in logs
  includeComponentName: boolean; // Include component names
  format: 'json' | 'text';       // Log format
  colorize: boolean;             // Colorize log output
  enabledComponents: string[];   // Components to enable
  disabledComponents: string[];  // Components to disable
  sampleRate: number;            // Sampling rate (0-1)
  enablePerformanceLogging: boolean; // Log performance metrics
  performanceThresholdMs: number; // Performance threshold
  breadcrumbs: {                 // Breadcrumb settings
    enabled: boolean;
    maxItems: number;
  };
  pino: {                        // Pino logger settings
    level: 'debug' | 'info' | 'warn' | 'error';
    browser?: {
      asObject: boolean;
    };
    base?: {
      service: string;
      env: string;
    };
    transport?: any;
  };
}
```

**Default Values:**

- `level`: `'info'` in production, `'debug'` in development
- `includeTimestamps`: `true`
- `includeComponentName`: `true`
- `format`: `'text'`
- `colorize`: `true`
- `enabledComponents`: `[]`
- `disabledComponents`: `[]`
- `sampleRate`: `1`
- `enablePerformanceLogging`: `false`
- `performanceThresholdMs`: `1000`
- `breadcrumbs.enabled`: `true`
- `breadcrumbs.maxItems`: `100`
- `pino.level`: `'info'`
- `pino.browser.asObject`: `true`
- `pino.base.service`: `'video-resizer'`
- `pino.base.env`: `'development'`

## Storage Configuration

The storage configuration controls origin storage settings and authentication.

### Schema Structure

```typescript
interface StorageConfig {
  // Storage priority order
  priority: Array<'r2' | 'remote' | 'fallback'>;
  
  // R2 storage configuration
  r2: {
    enabled: boolean;
    bucketBinding: string;
  };
  
  // Remote storage configuration
  remoteUrl?: string;
  remoteAuth?: AuthConfig;
  
  // Fallback storage configuration
  fallbackUrl?: string;
  fallbackAuth?: AuthConfig;
  
  // General storage auth configuration
  auth?: {
    useOriginAuth: boolean;
    securityLevel: 'strict' | 'permissive';
    cacheTtl?: number;
  };
  
  // Fetch options for remote requests
  fetchOptions: {
    userAgent: string;
    headers?: Record<string, string>;
  };
  
  // Path transformations
  pathTransforms?: Record<string, any>;
}
```

**Default Values:**

- `priority`: `['r2', 'remote', 'fallback']`
- `r2.enabled`: `false`
- `r2.bucketBinding`: `'VIDEOS_BUCKET'`
- `auth.useOriginAuth`: `false`
- `auth.securityLevel`: `'strict'`
- `fetchOptions.userAgent`: `'Cloudflare-Video-Resizer/1.0'`

### Authentication Configuration

Authentication settings for secure origins:

```typescript
interface AuthConfig {
  type: 'none' | 'token' | 'aws-s3' | 'aws-s3-presigned-url';
  credentials?: {
    accessKeyId?: string;
    secretAccessKey?: string;
    region?: string;
    expiresIn?: number;
    headerName?: string;
    tokenPrefix?: string;
    tokenValue?: string;
  };
}
```

## Environment Variables

Environment variables provide a way to override configuration settings:

| Variable | Type | Description |
|----------|------|-------------|
| `ENVIRONMENT` | string | Environment name (development, staging, production) |
| `VERSION` | string | Application version |
| `DEBUG_ENABLED` | boolean | Enable debug mode |
| `DEBUG_VERBOSE` | boolean | Enable verbose debug output |
| `DEBUG_INCLUDE_HEADERS` | boolean | Include headers in debug output |
| `DEBUG_PERFORMANCE` | boolean | Include performance metrics in debug |
| `DEBUG_ALLOWED_IPS` | string | Comma-separated list of IPs allowed to see debug |
| `DEBUG_EXCLUDED_PATHS` | string | Comma-separated list of paths excluded from debug |
| `CACHE_DEBUG` | boolean | Enable cache debug logging |
| `CACHE_DEFAULT_TTL` | number | Default TTL for cached content |
| `CACHE_RESPECT_ORIGIN` | boolean | Respect origin Cache-Control headers |
| `CACHE_EVERYTHING` | boolean | Cache all status codes |
| `CACHE_ENABLE_TAGS` | boolean | Enable Cache-Tag headers |
| `CACHE_PURGE_ON_UPDATE` | boolean | Purge cache on config update |
| `CACHE_BYPASS_PARAMS` | string | Comma-separated list of cache bypass parameters |
| `CACHE_ENABLE_KV` | boolean | Enable KV cache storage |
| `CACHE_KV_TTL_OK` | number | TTL for successful responses |
| `CACHE_KV_TTL_REDIRECTS` | number | TTL for redirect responses |
| `CACHE_KV_TTL_CLIENT_ERROR` | number | TTL for client error responses |
| `CACHE_KV_TTL_SERVER_ERROR` | number | TTL for server error responses |
| `LOG_LEVEL` | string | Logging level (debug, info, warn, error) |
| `LOG_FORMAT` | string | Log format (json, text) |
| `LOG_INCLUDE_TIMESTAMPS` | boolean | Include timestamps in logs |
| `LOG_INCLUDE_COMPONENT` | boolean | Include component names in logs |
| `LOG_COLORIZE` | boolean | Colorize log output |
| `LOG_ENABLED_COMPONENTS` | string | Comma-separated list of enabled components |
| `LOG_DISABLED_COMPONENTS` | string | Comma-separated list of disabled components |
| `LOG_SAMPLE_RATE` | number | Logging sample rate (0-1) |
| `LOG_PERFORMANCE` | boolean | Enable performance logging |
| `LOG_PERFORMANCE_THRESHOLD` | number | Performance threshold in ms |
| `VIDEO_DEFAULT_QUALITY` | string | Default video quality |
| `VIDEO_DEFAULT_COMPRESSION` | string | Default compression level |
| `VIDEO_DEFAULT_AUDIO` | boolean | Include audio by default |
| `VIDEO_DEFAULT_FIT` | string | Default fit mode |
| `PATH_PATTERNS` | string | JSON string of path patterns |
| `CDN_CGI_BASE_PATH` | string | Base path for Cloudflare Media |
| `WORKER_CONCURRENCY` | number | Worker concurrency level |
| `REQUEST_TIMEOUT` | number | Request timeout in ms |
| `MAX_VIDEO_SIZE` | number | Maximum video size in bytes |

## Configuration Example

Here's a comprehensive configuration example:

```json
{
  "video": {
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
        "loop": true,
        "muted": true,
        "fileFormat": "mp4"
      }
    },
    "defaults": {
      "quality": "auto",
      "compression": "auto",
      "audio": true,
      "fit": "contain",
      "format": "mp4"
    },
    "cdnCgi": {
      "basePath": "/cdn-cgi/media"
    },
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
        "auth": {
          "type": "aws-s3-presigned-url",
          "credentials": {
            "accessKeyId": "${AWS_ACCESS_KEY}",
            "secretAccessKey": "${AWS_SECRET_KEY}",
            "region": "us-east-1",
            "expiresIn": 300
          }
        },
        "ttl": {
          "ok": 21600,
          "redirects": 3600,
          "clientError": 60,
          "serverError": 10
        }
      }
    ]
  },
  "cache": {
    "enableKVCache": true,
    "debug": false,
    "defaultMaxAge": 300,
    "respectOriginHeaders": true,
    "cacheEverything": false,
    "enableCacheTags": true,
    "cacheTagPrefix": "video-",
    "purgeOnUpdate": false,
    "bypassQueryParameters": ["nocache", "bypass"],
    "bypassHeaderValue": "no-cache",
    "maxSizeBytes": 26214400,
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
  },
  "debug": {
    "enabled": false,
    "verbose": false,
    "includeHeaders": false,
    "includePerformance": true,
    "dashboardMode": true,
    "viewMode": true,
    "headerMode": true,
    "debugQueryParam": "debug",
    "debugViewParam": "view",
    "preserveDebugParams": false,
    "debugHeaders": ["X-Debug", "X-Debug-Enabled", "Debug"],
    "renderStaticHtml": true,
    "includeStackTrace": false,
    "maxContentLength": 50000,
    "truncationMessage": "... [content truncated]",
    "allowedIps": ["127.0.0.1", "192.168.1.1"],
    "excludedPaths": ["/health", "/metrics"]
  },
  "logging": {
    "level": "info",
    "includeTimestamps": true,
    "includeComponentName": true,
    "format": "json",
    "colorize": false,
    "enabledComponents": ["cache", "transform", "storage"],
    "disabledComponents": [],
    "sampleRate": 0.1,
    "enablePerformanceLogging": true,
    "performanceThresholdMs": 1000,
    "breadcrumbs": {
      "enabled": true,
      "maxItems": 100
    },
    "pino": {
      "level": "info",
      "browser": {
        "asObject": true
      },
      "base": {
        "service": "video-resizer",
        "env": "production"
      }
    }
  },
  "storage": {
    "priority": ["r2", "remote", "fallback"],
    "r2": {
      "enabled": true,
      "bucketBinding": "VIDEOS_BUCKET"
    },
    "remoteUrl": "https://videos.example.com",
    "fallbackUrl": "https://backup-videos.example.com",
    "auth": {
      "useOriginAuth": false,
      "securityLevel": "strict",
      "cacheTtl": 300
    },
    "fetchOptions": {
      "userAgent": "Cloudflare-Video-Resizer/1.0",
      "headers": {
        "X-Custom-Header": "Example"
      }
    }
  }
}
```

---

This schema reference provides a comprehensive overview of all available configuration options in the Video Resizer. For practical configuration examples and guides, see the [Configuration Guide](../guides/configuration.md).
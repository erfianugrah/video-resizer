# Video Resizer Configuration Schema Reference (Updated)

*Last Updated: May 1, 2025*

This document provides a comprehensive reference of the updated configuration schema used in the Video Resizer. It covers all available configuration options with a streamlined approach that eliminates redundancy between path patterns and cache profiles.

## Table of Contents

- [Configuration Overview](#configuration-overview)
- [Key Changes](#key-changes)
- [Video Configuration](#video-configuration)
  - [Derivatives](#derivatives)
  - [Path Patterns](#path-patterns)
  - [Default Options](#default-options)
- [Cache Configuration](#cache-configuration)
  - [TTL Settings](#ttl-settings)
- [Debug Configuration](#debug-configuration)
- [Logging Configuration](#logging-configuration)
- [Storage Configuration](#storage-configuration)
- [Environment Variables](#environment-variables)
- [Configuration Example](#configuration-example)

## Configuration Overview

The Video Resizer uses a modular configuration system organized into these main sections:

1. **Video Configuration**: Controls video transformation settings, derivatives, and patterns
2. **Cache Configuration**: Manages caching behavior and TTLs
3. **Debug Configuration**: Controls debugging features and diagnostic output
4. **Logging Configuration**: Defines logging behavior, levels, and formats
5. **Storage Configuration**: Configures origin storage settings and authentication

All configuration is validated using [Zod](https://github.com/colinhacks/zod) schemas to ensure type safety and consistency.

## Key Changes

This update streamlines the configuration by **eliminating the redundant "cache profiles" section** and consolidating caching properties directly into path patterns. Key changes include:

1. **Removed `cache.profiles` section**: All caching configuration is now defined in path patterns
2. **Enhanced path patterns**: Added caching properties directly to path patterns
3. **Default path pattern**: Added a catch-all default pattern for unmatched URLs
4. **Simplified TTL determination**: TTL is now determined directly from matching path pattern

These changes ensure that:
- There's a single source of truth for TTL configuration
- Path pattern TTLs are consistently used for matching URLs
- The system is more intuitive and easier to maintain

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

Path patterns define URL matching rules, transformation settings, and caching behavior:

```typescript
interface PathPattern {
  name: string;               // Unique identifier for the pattern
  matcher: string;            // Regex pattern for URL matching
  processPath: boolean;       // Whether to transform this path
  baseUrl?: string | null;    // Base URL for transformations
  originUrl?: string | null;  // Origin URL for video source
  quality?: string;           // Default quality for this pattern
  ttl: {                      // Status-based TTLs
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
  // Caching properties (moved from cache profiles)
  cacheability?: boolean;     // Whether to cache this content
  videoCompression?: string;  // Compression for this pattern
}
```

**Validation Rules:**

- `matcher` must be a valid regex pattern
- `ttl` values must be positive numbers
- `priority` determines pattern precedence (higher values have higher priority)
- Pattern ordering matters for patterns with the same priority
- The `default` pattern is used as a fallback for unmatched URLs

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

The cache configuration controls global caching settings.

### Schema Structure

```typescript
interface CacheConfig {
  enableKVCache: boolean;     // Enable KV cache storage
  storeIndefinitely: boolean; // Store KV items indefinitely without TTL expiration
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
  ttl: {                      // Global fallback TTLs
    ok: number;
    redirects: number;
    clientError: number;
    serverError: number;
  };
}
```

**Default Values:**

- `enableKVCache`: `true`
- `storeIndefinitely`: `false`
- `debug`: `false`
- `defaultMaxAge`: `300` (5 minutes)
- `respectOriginHeaders`: `true`
- `cacheEverything`: `false`
- `enableCacheTags`: `true`
- `cacheTagPrefix`: `'video-'`
- `purgeOnUpdate`: `false`
- `bypassQueryParameters`: `['nocache', 'bypass', 'debug']`
- `bypassHeaderValue`: `'no-cache'`
- `maxSizeBytes`: `25 * 1024 * 1024` (25MB)

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

**Default Global Values:**

- `ok`: `86400` (24 hours)
- `redirects`: `300` (5 minutes)
- `clientError`: `60` (1 minute)
- `serverError`: `10` (10 seconds)

**Default Path Pattern Values:**

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

## Environment Variables

Environment variables provide a way to override configuration settings. Key variables related to caching:

| Variable | Type | Description |
|----------|------|-------------|
| `CACHE_DEBUG` | boolean | Enable cache debug logging |
| `CACHE_DEFAULT_TTL` | number | Default TTL for cached content |
| `CACHE_RESPECT_ORIGIN` | boolean | Respect origin Cache-Control headers |
| `CACHE_EVERYTHING` | boolean | Cache all status codes |
| `CACHE_ENABLE_TAGS` | boolean | Enable Cache-Tag headers |
| `CACHE_PURGE_ON_UPDATE` | boolean | Purge cache on config update |
| `CACHE_BYPASS_PARAMS` | string | Comma-separated list of cache bypass parameters |
| `CACHE_ENABLE_KV` | boolean | Enable KV cache storage |
| `CACHE_STORE_INDEFINITELY` | boolean | Store KV items without expiration |
| `CACHE_KV_TTL_OK` | number | TTL for successful responses |
| `CACHE_KV_TTL_REDIRECTS` | number | TTL for redirect responses |
| `CACHE_KV_TTL_CLIENT_ERROR` | number | TTL for client error responses |
| `CACHE_KV_TTL_SERVER_ERROR` | number | TTL for server error responses |

## Configuration Example

Here's a streamlined configuration example without cache profiles:

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
      }
    },
    "defaults": {
      "quality": "auto",
      "compression": "auto",
      "audio": true,
      "fit": "contain",
      "format": "mp4"
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
        "useTtlByStatus": true,
        "cacheability": true,
        "videoCompression": "auto"
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
        },
        "cacheability": true,
        "videoCompression": "low"
      },
      {
        "name": "dynamic-videos",
        "matcher": "^/live/(.*\\.mp4)$",
        "processPath": true,
        "baseUrl": null,
        "originUrl": "https://live-videos.example.com/{0}",
        "ttl": {
          "ok": 300,
          "redirects": 60,
          "clientError": 30,
          "serverError": 10
        },
        "cacheability": true,
        "videoCompression": "auto"
      },
      {
        "name": "private-videos",
        "matcher": "^/private/(.*\\.mp4)$",
        "processPath": true,
        "baseUrl": null,
        "originUrl": "https://private-videos.example.com/{0}",
        "ttl": {
          "ok": 0,
          "redirects": 0,
          "clientError": 0,
          "serverError": 0
        },
        "cacheability": false,
        "videoCompression": "none"
      },
      {
        "name": "default",
        "matcher": ".*",
        "processPath": false,
        "ttl": {
          "ok": 300,
          "redirects": 300,
          "clientError": 60,
          "serverError": 10
        },
        "cacheability": true,
        "useTtlByStatus": true
      }
    ]
  },
  "cache": {
    "enableKVCache": true,
    "storeIndefinitely": false,
    "debug": false,
    "defaultMaxAge": 300,
    "respectOriginHeaders": true,
    "cacheEverything": false,
    "enableCacheTags": true,
    "cacheTagPrefix": "video-",
    "purgeOnUpdate": false,
    "bypassQueryParameters": ["nocache", "bypass", "debug"],
    "bypassHeaderValue": "no-cache",
    "maxSizeBytes": 26214400,
    "ttl": {
      "ok": 86400,
      "redirects": 300,
      "clientError": 60,
      "serverError": 10
    }
  },
  "debug": {
    "enabled": false,
    "verbose": false,
    "includeHeaders": true,
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
    "allowedIps": [],
    "excludedPaths": ["/favicon.ico", "/robots.txt"]
  },
  "logging": {
    "level": "debug",
    "format": "json",
    "includeTimestamps": true,
    "includeComponentName": true,
    "colorize": true,
    "enabledComponents": [],
    "disabledComponents": [],
    "sampleRate": 1.0,
    "enablePerformanceLogging": true,
    "performanceThresholdMs": 1000,
    "breadcrumbs": {
      "enabled": true,
      "maxItems": 25
    },
    "pino": {
      "level": "debug",
      "browser": {
        "asObject": true
      },
      "base": {
        "service": "video-resizer",
        "env": "production"
      }
    }
  }
}
```

---

This schema reference provides a comprehensive overview of the updated configuration options in the Video Resizer. For practical configuration examples and guides, see the [Configuration Guide](../guides/configuration.md).
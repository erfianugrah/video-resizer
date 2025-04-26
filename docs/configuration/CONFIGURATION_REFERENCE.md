# Configuration Reference

> This is the comprehensive reference guide for all configuration options in the video-resizer project.
> This document was created by consolidating multiple configuration documentation files.

## Table of Contents

- [Video Configuration](#video-configuration)
- [Cache Configuration](#cache-configuration)
- [Debug Configuration](#debug-configuration)
- [Logging Configuration](#logging-configuration)
- [Path Pattern Matching](#path-pattern-matching)
- [S3 Authentication](#s3-authentication)

\n## Video Configuration\n
# Video Configuration

The `VideoConfigurationManager` handles all video transformation settings and options. It manages video derivatives, default options, and path patterns for URL matching.

## Video Derivatives

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

## Non-MP4 File Passthrough

The video-resizer includes a configurable passthrough capability for non-MP4 video files. This is important because Cloudflare Media Transformation primarily supports MP4 files with H.264 encoded video and AAC or MP3 encoded audio. Attempting to process other formats may result in errors (such as 522 timeout errors).

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

All static assets (`.png`, `.jpg`, `.svg`, `.css`, `.js`, `.ico`, etc.) are also automatically handled by this passthrough mechanism, as they are identified as non-MP4 files. This provides an efficient fast-path for all non-video content.

If you want to allow certain non-MP4 formats to be processed despite the risks, you can add them to the `whitelistedFormats` array.

## Transformation Modes

The `mode` parameter specifies what type of output the Cloudflare Media Transformation service will generate:

1. **Video Mode (`mode=video`)**
   - Default mode when not specified
   - Outputs an optimized MP4 video file with H.264 video and AAC audio
   - Preserves motion and audio from the original video
   - Allows control over playback parameters (loop, autoplay, muted, preload)
   - Example: `https://cdn.erfi.dev/white-fang.mp4?mode=video&width=640&height=360`

2. **Frame Mode (`mode=frame`)**
   - Outputs a single still image from the video at the specified time
   - Useful for generating video thumbnails or previews
   - Requires the `time` parameter to specify which frame to extract
   - Supports different output formats (jpg, png, webp) using the `format` parameter
   - Example: `https://cdn.erfi.dev/white-fang.mp4?mode=frame&time=30s&format=jpg&width=640`

3. **Spritesheet Mode (`mode=spritesheet`)**
   - Outputs a JPEG image containing a grid of thumbnails from the video
   - Each thumbnail represents a frame from the video at regular intervals
   - Useful for video scrubbing interfaces, preview thumbnails, and video navigation
   - Can specify a time range using `time` (start) and `duration` parameters
   - Playback parameters (loop, autoplay, muted, preload) are incompatible with this mode
   - Example: `https://cdn.erfi.dev/white-fang.mp4?mode=spritesheet&width=640&height=480&duration=10s`
   
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
   
   **Example URLs:**
   ```
   # Basic spritesheet for first 10 seconds
   https://cdn.erfi.dev/video.mp4?mode=spritesheet&width=800&height=600
   
   # Custom time range spritesheet (30s to 90s)
   https://cdn.erfi.dev/video.mp4?mode=spritesheet&width=800&height=600&time=30s&duration=60s
   
   # Spritesheet with cover fit (crops to fill cells completely)
   https://cdn.erfi.dev/video.mp4?mode=spritesheet&width=800&height=600&fit=cover
   ```

### Technical Requirements

According to Cloudflare's documentation:
- Input videos must be less than 40MB in size
- Input videos should preferably be in MP4 format
- Input videos should use H.264 video encoding and AAC/MP3 audio encoding
- Width and height parameters must be between 10-2000 pixels

## Video Default Options

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

## Path Patterns

Configuration for URL path matching and processing:

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

### Example Path Patterns

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

> **Important:** When writing path patterns, ensure that regular expressions in the `matcher` property are properly escaped. For example, to match a literal period in a file extension, use `\\.` in the pattern string. For example, `^/(.*\\.mp4)` will match paths like `/example.mp4`.

### Pattern Matching Behavior

Path patterns are evaluated in order of their `priority` value (highest first). If no priority is specified, patterns are evaluated in the order they appear in the configuration. The first pattern that matches the request path will be used.

If the matching pattern has `processPath: true`, the video will be transformed according to the pattern and derivative settings. If `processPath: false` or no matching pattern is found, the request will be passed through to the origin without transformation.

## Configuration Methods

The `VideoConfigurationManager` provides the following methods:

- `getConfig()`: Get the entire configuration
- `getDerivative(name)`: Get a derivative configuration
- `getPathPatterns()`: Get all path patterns
- `getValidOptions(param)`: Get valid options for a parameter
- `isValidOption(param, value)`: Check if a value is valid for a parameter
- `getDefaultOption(option)`: Get a default option value
- `getDefaults()`: Get all default options
- `getCdnCgiConfig()`: Get CDN-CGI configuration
- `getCacheConfig()`: Get cache configuration
- `getResponsiveConfig()`: Get responsive design configuration
- `addPathPattern(pattern)`: Add a new path pattern

## Environment Variables

| Variable | Type | Description |
|----------|------|-------------|
| `PATH_PATTERNS` | JSON | JSON array of path patterns |
| `VIDEO_DEFAULT_QUALITY` | string | Default video quality |
| `VIDEO_DEFAULT_COMPRESSION` | string | Default compression level |

## Query Parameter Handling

The video-resizer service processes transformation-specific query parameters and excludes them from the origin request to ensure clean URLs when fetching from the origin server.

### Transformation Parameters

The following query parameters are recognized by the service and excluded from origin requests:

#### Basic Dimension and Quality Parameters
- `width` - Video width in pixels
- `height` - Video height in pixels
- `bitrate` - Target bitrate for the video
- `quality` - Quality level (low, medium, high)
- `format` - Output format (mp4, webm, etc.)
- `segment` - Video segment identifier
- `time` - Timestamp for frame extraction
- `derivative` - Predefined transformation profile
- `duration` - Duration for clip extraction
- `compression` - Compression level

#### Video Transformation Method Parameters
- `mode` - Transformation mode (video, frame, spritesheet)
- `fit` - Scaling method (contain, cover, scale-down)
- `crop` - Crop dimensions
- `rotate` - Rotation angle
- `imref` - Image reference identifier

#### Playback Control Parameters
- `loop` - Enable video looping
- `preload` - Preload behavior (none, metadata, auto)
- `autoplay` - Enable autoplay
- `muted` - Mute audio

#### Additional Cloudflare Parameters
- `speed` - Playback speed
- `audio` - Audio configuration
- `fps` - Frames per second
- `keyframe` - Keyframe interval
- `codec` - Video codec selection

#### IMQuery Parameters
- `imwidth` - Requested image width
- `imheight` - Requested image height
- `im-viewwidth` - Viewport width
- `im-viewheight` - Viewport height
- `im-density` - Device pixel density
- `imref` - IMQuery reference parameter

### Example

For a request like:
```
https://example.com/videos/sample.mp4?width=640&height=480&quality=high&tracking=abc123
```

The URL sent to the origin server will be:
```
https://example.com/videos/sample.mp4?tracking=abc123
```

This ensures that only parameters not related to video transformation are passed to the origin server.

## Example Usage

```typescript
import { VideoConfigurationManager } from './config';

const videoConfig = VideoConfigurationManager.getInstance();

// Get a derivative configuration
const mobileConfig = videoConfig.getDerivative('mobile');
console.log(mobileConfig); // { width: 360, height: 640, ... }

// Check if an option is valid
if (videoConfig.isValidOption('fit', 'cover')) {
  // Use the option
}

// Get path patterns matching a URL
const patterns = videoConfig.getPathPatterns();
const matchingPattern = patterns.find(pattern => 
  new RegExp(pattern.matcher).test('/videos/example.mp4')
);
```\n## Cache Configuration\n
# Cache Configuration

The `CacheConfigurationManager` handles caching behavior and cache profiles. It provides methods to control how content is cached, including cache methods, TTLs, and profiles for different content types.

## Multi-Level Caching Strategy

The video-resizer implements a multi-level caching strategy to optimize performance and reduce costs:

1. **Cloudflare Cache API** (Edge Cache): First level of cache, checked for all requests
2. **KV Storage Cache** (Global Persistent Cache): Second level cache, checked on Cloudflare cache misses
3. **Origin + Transformation**: Only executed if both caches miss

For examples of cache hit logging and a detailed request flow, see [KV Cache Logging Example](./kv-cache-logging-example.md).

## Cache Method Options

| Option | Description | Default |
|--------|-------------|---------|
| `cf` | Use Cloudflare's built-in caching with CF object (recommended) | ✓ |
| `cacheApi` | Use the Cache API directly (alternative) | |

## Cache Profiles

Each profile configures caching behavior for a specific content pattern:

| Option | Type | Description |
|--------|------|-------------|
| `regex` | string | Pattern to match content |
| `cacheability` | boolean | Whether content should be cached |
| `videoCompression` | string | Compression for this profile |
| `ttl` | object | TTL settings (see below) |

## TTL Configuration

TTL (Time To Live) settings based on response status:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `ok` | number | 86400 | TTL for successful responses (200-299) |
| `redirects` | number | 3600 | TTL for redirects (300-399) |
| `clientError` | number | 60 | TTL for client errors (400-499) |
| `serverError` | number | 10 | TTL for server errors (500-599) |

## KV Cache Configuration

The cache system also supports storing transformed video variants in Cloudflare KV for faster retrieval:

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

### KV Cache Enable/Disable Behavior

When `enableKVCache` is set to `false`, the worker will:

1. Not read from KV cache when processing video requests
2. Not write to KV cache when transforming videos
3. Log that KV cache operations were skipped
4. Continue to use the Cloudflare Cache API for regular caching

You can disable KV cache in two ways:

1. Via configuration loaded from KV:
   ```json
   {
     "cache": {
       "enableKVCache": false,
       "method": "cf",
       "enableCacheTags": true,
       ...
     }
   }
   ```

2. Via environment variable:
   ```bash
   CACHE_ENABLE_KV=false
   ```

For detailed documentation on the KV caching system, see [KV Caching Guide](../kv-caching/README.md).

## Default Profiles

| Profile | Description | TTL (OK) |
|---------|-------------|----------|
| `default` | Default pattern for all content | 24 hours |
| `highTraffic` | Popular content pattern | 7 days |
| `shortForm` | Short-form video content | 2 days |
| `dynamic` | Dynamic or live content | 5 minutes |

## Configuration Methods

- `getConfig()`: Get the entire cache configuration
- `getCacheMethod()`: Get the current cache method
- `isDebugEnabled()`: Check if cache debugging is enabled
- `shouldBypassCache(url)`: Check if cache should be bypassed
- `getProfileForPath(path)`: Get cache profile for a URL path
- `addProfile(name, profile)`: Add a new cache profile

## Environment Variables

| Variable | Type | Description | Default |
|----------|------|-------------|---------|
| `CACHE_METHOD` | string | Cache method: 'cf' or 'cacheApi' | 'cf' |
| `CACHE_DEBUG` | boolean | Enable cache debugging | false |
| `CACHE_ENABLE_KV` | boolean | Enable KV storage for transformed variants | false |
| `CACHE_KV_TTL_OK` | number | TTL for 2xx responses in seconds | 86400 |
| `CACHE_KV_TTL_REDIRECTS` | number | TTL for 3xx responses in seconds | 3600 |
| `CACHE_KV_TTL_CLIENT_ERROR` | number | TTL for 4xx responses in seconds | 60 |
| `CACHE_KV_TTL_SERVER_ERROR` | number | TTL for 5xx responses in seconds | 10 |

## Example Usage

```typescript
import { CacheConfigurationManager } from './config';

const cacheConfig = CacheConfigurationManager.getInstance();

// Get the current cache method
const method = cacheConfig.getCacheMethod();
console.log(method); // 'cf' or 'cacheApi'

// Check if cache should be bypassed for a URL
const shouldBypass = cacheConfig.shouldBypassCache('https://example.com/video.mp4?debug=true');
console.log(shouldBypass); // true if cache should be bypassed

// Get cache profile for a specific path
const profile = cacheConfig.getProfileForPath('/videos/example.mp4');
console.log(profile.ttl.ok); // 86400 (24 hours)
```\n## Debug Configuration\n
# Debug Configuration

The `DebugConfigurationManager` handles debugging capabilities and settings. It provides methods to control debugging features, including debug views, headers, and diagnostic information.

## Debug Options

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
| `debugHeaders` | string[] | [...] | Headers that enable debugging |
| `renderStaticHtml` | boolean | true | Render static HTML for debug views |
| `includeStackTrace` | boolean | false | Include stack traces in debug info |
| `maxContentLength` | number | 50000 | Maximum debug content length |
| `allowedIps` | string[] | [] | IPs allowed to see debug info |
| `excludedPaths` | string[] | [] | Paths excluded from debugging |

## Debug View

When enabled, the debug view provides a comprehensive HTML interface for analyzing video transformations:

1. **Performance Metrics**:
   - Processing time in milliseconds
   - Cache status indication
   - Device detection information

2. **Video Transformation Details**:
   - All applied parameters and their values
   - Source video information
   - Path pattern matching details
   - Transformation mode and settings

3. **Client Information**:
   - Device type detection (mobile, tablet, desktop)
   - Client hints support status
   - Network quality estimation
   - Browser video capabilities

4. **Interactive Features**:
   - Live preview of the transformed video
   - Expandable/collapsible JSON data
   - Copyable diagnostic information
   - Visual indicators for important settings

## Debug Headers

When header mode is enabled, the service adds detailed debug headers to the response:

- `X-Video-Resizer-Debug`: Indicates debug mode is enabled
- `X-Processing-Time-Ms`: Time taken to process the request
- `X-Transform-Source`: Source of the transformation
- `X-Device-Type`: Detected device type
- `X-Network-Quality`: Estimated network quality
- `X-Cache-Enabled`: Cache status
- `X-Cache-TTL`: Cache time-to-live

## Configuration Methods

- `getConfig()`: Get the entire debug configuration
- `isEnabled()`: Check if debugging is enabled
- `isVerbose()`: Check if verbose debugging is enabled
- `shouldPreserveDebugParams()`: Check if debug parameters should be preserved in URLs
- `shouldIncludeHeaders()`: Check if headers should be included
- `shouldIncludePerformance()`: Check if performance metrics should be included
- `shouldEnableForRequest(request)`: Check if debug should be enabled for a request
- `isDebugViewRequested(request)`: Check if debug view is requested
- `addAllowedIp(ip)`: Add an allowed IP address
- `addExcludedPath(path)`: Add an excluded path

## Environment Variables

| Variable | Type | Description |
|----------|------|-------------|
| `DEBUG_ENABLED` | boolean | Enable debug mode |
| `DEBUG_VERBOSE` | boolean | Enable verbose debug output |
| `DEBUG_INCLUDE_HEADERS` | boolean | Include headers in debug info |
| `DEBUG_PERFORMANCE` | boolean | Include performance metrics |

## Example Usage

```typescript
import { DebugConfigurationManager } from './config';

const debugConfig = DebugConfigurationManager.getInstance();

// Check if debugging is enabled
if (debugConfig.isEnabled()) {
  console.log('Debug mode is enabled');
}

// Check if debug should be enabled for a specific request
const shouldEnableDebug = debugConfig.shouldEnableForRequest(request);
if (shouldEnableDebug) {
  // Enable debugging for this request
}

// Check if debug view was requested
const isDebugView = debugConfig.isDebugViewRequested(request);
if (isDebugView) {
  // Return debug view HTML instead of processed video
}

// Check if debug parameters should be preserved in transformed URLs
const preserveDebugParams = debugConfig.shouldPreserveDebugParams();
if (preserveDebugParams) {
  // Keep debug parameters in transformed URLs
  // This is useful for maintaining debug=view in CDN-CGI URLs
}
```

## Accessing the Debug Interface

Add `?debug=view` to any video URL to access the debug interface:
```
https://your-domain.com/videos/sample.mp4?width=720&height=480&debug=view
```

## Security Considerations

For production environments, it's recommended to:

1. Restrict debug access to specific IP addresses:
   ```typescript
   debugConfig.addAllowedIp('192.168.1.100');
   ```

2. Exclude sensitive paths from debugging:
   ```typescript
   debugConfig.addExcludedPath('^/admin/.*');
   ```

3. Disable stack traces in production:
   ```typescript
   debugConfig.setIncludeStackTrace(false);
   ```\n## Logging Configuration\n
# Logging Configuration

The `LoggingConfigurationManager` handles logging levels, formats, and behavior. It provides methods to control logging output, including log levels, component filtering, and performance logging.

## Logging Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `level` | string | 'info' | Log level: 'debug', 'info', 'warn', 'error' |
| `format` | string | 'text' | Log format: 'json' or 'text' |
| `includeTimestamps` | boolean | true | Include timestamps in logs |
| `includeComponentName` | boolean | true | Include component names in logs |
| `colorize` | boolean | true | Use colors in console output |
| `enabledComponents` | string[] | [] | Components to enable (empty = all) |
| `disabledComponents` | string[] | [] | Components to disable |
| `sampleRate` | number | 1 | Sampling rate for logs (0-1) |
| `enablePerformanceLogging` | boolean | false | Enable performance metrics |
| `performanceThresholdMs` | number | 1000 | Threshold for performance warnings |

## Log Levels

| Level | Priority | Description |
|-------|----------|-------------|
| `debug` | 1 | Detailed debugging information |
| `info` | 2 | General informational messages |
| `warn` | 3 | Warning conditions |
| `error` | 4 | Error conditions |

Log messages are only shown if their level is >= the configured level.

## Log Formats

| Format | Description | Example |
|--------|-------------|---------|
| `text` | Human-readable text format | `[INFO] [VideoHandler] Processing video request` |
| `json` | JSON structured format | `{"level":"info","component":"VideoHandler","message":"Processing video request","timestamp":"2023-09-15T12:34:56Z"}` |

## Component Filtering

You can filter logs by component name:

1. **Enable specific components**:
   ```typescript
   enabledComponents: ['VideoHandler', 'CacheService']
   ```

2. **Disable specific components**:
   ```typescript
   disabledComponents: ['StorageService']
   ```

If `enabledComponents` is empty, all components are enabled except those in `disabledComponents`.

## Log Sampling

The `sampleRate` option allows you to reduce log volume:

- `sampleRate: 1` - Log every message (default)
- `sampleRate: 0.1` - Log approximately 10% of messages
- `sampleRate: 0.01` - Log approximately 1% of messages

This is useful for high-traffic production environments.

## Performance Logging

When `enablePerformanceLogging` is true:

1. Tracks execution time of key operations
2. Logs warnings when operations exceed `performanceThresholdMs`
3. Provides detailed performance breakdowns

## Configuration Methods

- `getConfig()`: Get the entire logging configuration
- `getLogLevel()`: Get the current log level
- `shouldLogComponent(componentName)`: Check if a component should be logged
- `shouldSampleLog()`: Check if a log should be sampled
- `shouldLogPerformance()`: Check if performance should be logged
- `getPerformanceThreshold()`: Get the performance threshold

## Environment Variables

| Variable | Type | Description |
|----------|------|-------------|
| `LOG_LEVEL` | string | Log level: 'debug', 'info', 'warn', 'error' |
| `LOG_FORMAT` | string | Log format: 'json' or 'text' |
| `LOG_INCLUDE_TIMESTAMPS` | boolean | Include timestamps in logs |
| `LOG_PERFORMANCE` | boolean | Enable performance logging |

## Example Usage

```typescript
import { LoggingConfigurationManager } from './config';
import { logger } from './utils/logger';

const loggingConfig = LoggingConfigurationManager.getInstance();

// Check if we should log for a component
if (loggingConfig.shouldLogComponent('VideoHandler')) {
  logger.info('VideoHandler', 'Processing video request');
}

// Log with sampling
if (loggingConfig.shouldSampleLog()) {
  logger.debug('CacheService', 'Cache hit for key: ' + key);
}

// Performance logging
if (loggingConfig.shouldLogPerformance()) {
  const startTime = Date.now();
  // ... perform operation ...
  const duration = Date.now() - startTime;
  
  if (duration > loggingConfig.getPerformanceThreshold()) {
    logger.warn('Performance', `Slow operation: ${duration}ms`);
  }
}
```
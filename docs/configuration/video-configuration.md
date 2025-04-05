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
```

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
```
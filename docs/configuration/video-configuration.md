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
| `cacheTtl` | number | Cache TTL in seconds |
| `priority` | number | Processing priority |
| `captureGroups` | string[] | Named capture groups in the matcher |

### Example Path Pattern

```json
{
  "name": "videos",
  "matcher": "^/videos/([a-z0-9-]+)",
  "processPath": true,
  "baseUrl": null,
  "originUrl": "https://media.example.com",
  "cacheTtl": 3600,
  "captureGroups": ["videoId"],
  "quality": "high",
  "transformationOverrides": {
    "fit": "cover",
    "compression": "low"
  }
}
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
# Video Resizer

A Cloudflare Worker for performing on-the-fly video transformations by transparently rewriting requests to use Cloudflare's Media Transformation API.

## Features

### Core Functionality
- Automatically transforms requests to video files to use Cloudflare's Media Transformation capabilities
- **Completely transparent to end users** - no URL changes visible to clients
- Configurable URL path matching patterns via JSON configuration
- Support for transforming video dimensions, quality, format and more
- Extract thumbnails from videos
- Generate spritesheets from videos
- **Compatibility with Akamai parameters** - automatically translates Akamai-style parameters to Cloudflare format

### Advanced Features
- **Device Detection** - Adapts video quality based on device capabilities
- **Responsive Video** - Automatically adjusts dimensions based on client device
- **Network Awareness** - Optimizes bitrate based on connection quality
- **Content Negotiation** - Selects best video format based on browser support
- **Advanced Cache Control** - Uses Cloudflare Cache API with path-specific TTLs and cache tags
- **Debug Tooling** - Provides detailed debug headers and HTML reports
- **Video Derivatives** - Pre-configured transformation presets for common use cases

### Architecture
- **Service-Oriented Design** - Modular services with separation of concerns
- **Command Pattern** - Simplified business logic flow
- **Comprehensive Testing** - Unit, parametrized, and integration tests

## How It Works

The worker sits between clients and your video files, transparently applying transformations to videos:

1. User requests a video from its normal URL with transformation parameters
2. Worker intercepts the request and checks if it matches any configured path patterns
3. If it matches, worker transforms the request to use Cloudflare's CDN-CGI media paths
4. Worker forwards the transformed request to Cloudflare's Media Transformation service
5. The transformed video is returned to the user, with the original URL preserved

## Configuration

The worker is completely configurable via environment variables or wrangler.jsonc:

```jsonc
// Example PATH_PATTERNS configuration
[vars]
PATH_PATTERNS = [
  {
    "name": "videos",
    "matcher": "^/videos/", 
    "processPath": true,
    "baseUrl": null,
    "originUrl": null,
    "cacheTtl": 3600,
    "captureGroups": ["videoId"],
    "quality": "high"
  },
  {
    "name": "popular",
    "matcher": "^/popular/(.*\\.mp4)",
    "processPath": true,
    "baseUrl": null,
    "originUrl": "https://videos.example.com",
    "cacheTtl": 86400,
    "captureGroups": ["videoId"]
  },
  {
    "name": "shorts",
    "matcher": "^/shorts/(.*\\.mp4)",
    "processPath": true,
    "baseUrl": null,
    "originUrl": "https://videos.example.com",
    "cacheTtl": 43200,
    "captureGroups": ["videoId"],
    "quality": "medium"
  }
]
```

### Configuration Options:

- **`name`**: Identifier for the pattern (for debugging)
- **`matcher`**: Regular expression to match URL paths
- **`processPath`**: Whether to process matching paths (set to false to disable)
- **`baseUrl`**: Optional base URL for the video source
- **`originUrl`**: Optional origin URL for rewriting requests
- **`cacheTtl`**: Time to live in seconds for the cache (overrides default)
- **`captureGroups`**: Names for regex capture groups in the matcher (helps with path extraction)
- **`quality`**: Optional quality preset to apply to all videos matching this pattern
- **`transformationOverrides`**: Optional parameters to override default transformations

## Usage Examples

### Basic Usage

Original client request:
```
GET /videos/sample.mp4?width=640&height=360&mode=video&fit=contain HTTP/1.1
Host: example.com
```

The worker transforms this to:
```
GET /cdn-cgi/media/width=640,height=360,mode=video,fit=contain/https://example.com/videos/sample.mp4 HTTP/1.1
Host: example.com
```

But the client never sees this - they just get back the transformed video with the original URL.

### Custom Path Structure

For a custom path structure like `/custom/path/videos/sample.mp4`:

```jsonc
{
  "name": "custom-path",
  "matcher": "^/custom/path/",
  "processPath": true,
  "originUrl": "https://videos.example.com"
}
```

This would transform:
```
/custom/path/videos/sample.mp4?width=640
```

To:
```
/cdn-cgi/media/width=640/https://videos.example.com/custom/path/videos/sample.mp4
```

## Caching Strategy

The service implements a comprehensive caching strategy using the Cloudflare Cache API with cache tags for purging.

### Cache Configuration

Caching behavior is configurable by path pattern, allowing you to set different caching rules for different types of videos. For example:

```jsonc
{
  "name": "high-traffic-videos",
  "matcher": "^/popular/.*\\.mp4$",
  "processPath": true,
  "cacheTtl": 86400 // 24 hours
}
```

Default cache times are configured by response type:
- **200-299 (Success)**: 24 hours
- **300-399 (Redirects)**: 1 hour
- **400-499 (Client errors)**: 1 minute
- **500-599 (Server errors)**: 10 seconds

### Cache Implementation

The service uses the Cloudflare Cache API for optimal performance:

1. **Cache Headers**: Sets appropriate `Cache-Control` headers based on configuration
2. **Cache Tags**: Adds `Cache-Tag` headers with video source and derivative information for granular purging
3. **Direct Cache Access**: Uses `caches.default.match()` to check for cached responses
4. **Proactive Caching**: Stores responses with `caches.default.put()` for guaranteed caching
5. **Cache Bypass**: Respects client cache control headers and debug parameters

### Cache Purging

Videos can be purged by tag using the Cloudflare API:

```sh
# Purge all videos
curl -X POST "https://api.cloudflare.com/client/v4/zones/{zone_id}/purge_cache" \
  -H "Authorization: Bearer {api_token}" \
  -H "Content-Type: application/json" \
  --data '{"tags":["video-resizer"]}'

# Purge specific derivative
curl -X POST "https://api.cloudflare.com/client/v4/zones/{zone_id}/purge_cache" \
  -H "Authorization: Bearer {api_token}" \
  -H "Content-Type: application/json" \
  --data '{"tags":["derivative:mobile"]}'

# Purge specific source
curl -X POST "https://api.cloudflare.com/client/v4/zones/{zone_id}/purge_cache" \
  -H "Authorization: Bearer {api_token}" \
  -H "Content-Type: application/json" \
  --data '{"tags":["source:videos"]}'
```

## Supported Parameters

| Parameter | Description | Values | Akamai Equivalent | Notes |
|-----------|-------------|--------|-------------------|-------|
| `width` | Video width in pixels | 10-2000 | `w` | Required for best results |
| `height` | Video height in pixels | 10-2000 | `h` | Required for best results |
| `mode` | Output type | `video`, `frame`, `spritesheet` | - | |
| `fit` | Resize method | `contain`, `scale-down`, `cover` | `obj-fit` | Affects aspect ratio handling |
| `time` | Start timestamp | e.g., `5s` (0-30s range) | `start` | For frames or video clips |
| `duration` | Video duration | e.g., `30s` (positive values) | `dur` | Limited by video length |
| `audio` | Include audio | `true`, `false` | `mute` (inverted) | |
| `format` | Image format (for frames) | `jpg`, `png` | `f` | Only for mode=frame |
| `quality` | Video quality preset | `low`, `medium`, `high`, `auto` | `q` | Affects bitrate |
| `compression` | Compression level | `low`, `medium`, `high`, `auto` | - | Affects file size |
| `loop` | Enable video looping | `true`, `false` | - | Only for mode=video |
| `preload` | Browser preload behavior | `none`, `metadata`, `auto` | - | Affects loading behavior |
| `autoplay` | Enable autoplay | `true`, `false` | - | May require muted=true |
| `muted` | Mute audio | `true`, `false` | - | |
| `derivative` | Preset configuration | See derivatives below | - | Overrides individual parameters |

### Video Derivatives

Derivatives are preset configurations for common use cases:

| Derivative | Description | Settings |
|------------|-------------|----------|
| `high` | High quality video | 1080p, high quality, low compression |
| `medium` | Medium quality video | 720p, medium quality, medium compression |
| `low` | Low quality video | 480p, low quality, high compression |
| `mobile` | Mobile-optimized video | 360p, low quality, high compression, preload=metadata |
| `thumbnail` | Static thumbnail | frame mode, 320x180, jpg format |
| `animation` | Looping video clip | 480x270, no audio, loop=true, preload=auto |
| `preview` | Short preview | 480x270, 5s duration, no audio, low quality |

### Parameter Limitations and Requirements

- **Width/Height**: Must be between 10-2000 pixels. Larger dimensions will be rejected.
- **Time**: Limited to 0-30s range for frame extraction. Outside this range may not work.
- **Format**: Only applies when `mode=frame`. Using with video mode has no effect.
- **Loop/Autoplay/Muted**: Only apply to `mode=video`. Using with frame mode has no effect.
- **Autoplay**: Most browsers require `muted=true` for autoplay to work properly.
- **Quality/Compression**: These are estimates and may be adjusted based on video content.
- **File Size**: Input videos must be less than 40MB (Cloudflare limit).
- **Spritesheet**: May have limited support for very long videos.

### Features in Beta or Development

Some features implemented in the code may have limited support in the Cloudflare Media Transformation API:

- **`quality` parameter**: While implemented in our code, this is currently in beta in the Cloudflare API. You may see inconsistent behavior.
- **`compression` parameter**: This is implemented as a custom parameter but not officially supported by the Cloudflare API.
- **Derivatives**: These are implemented as convenience presets but are handled by the worker, not natively by Cloudflare.
- **Client Hints Detection**: Depends on browser support and may not work in all browsers.
- **Content Negotiation**: Format selection based on Accept headers is still experimental.
- **Auto Quality**: Will fall back to medium quality if client detection fails.

### Akamai Parameter Translation

The service automatically detects and translates Akamai-style parameters to Cloudflare's format:

```
# Akamai format
/videos/sample.mp4?w=640&h=360&obj-fit=crop&mute=true

# Translated to Cloudflare format internally
/cdn-cgi/media/width=640,height=360,fit=cover,audio=false/https://example.com/videos/sample.mp4
```

Supported Akamai parameter translations:
- `w` → `width`
- `h` → `height`
- `obj-fit` → `fit` (with value mapping: `crop` → `cover`, `fill` → `contain`)
- `start` → `time`
- `dur` → `duration`
- `mute` → `audio` (with value inversion: `mute=true` → `audio=false`)
- `f` → `format`

## Live Demos

Here are some live demonstrations of the video transformation capabilities using a sample video:

### Basic Transformations

- **Original Video**: [cdn.erfi.dev/rocky.mp4](https://cdn.erfi.dev/rocky.mp4)
- **Resized Video (480p)**: [cdn.erfi.dev/rocky.mp4?width=854&height=480&fit=contain](https://cdn.erfi.dev/rocky.mp4?width=854&height=480&fit=contain)
- **Mobile-Optimized Video (360p)**: [cdn.erfi.dev/rocky.mp4?width=640&height=360&fit=contain](https://cdn.erfi.dev/rocky.mp4?width=640&height=360&fit=contain)
- **Video Clip (5s to 10s)**: [cdn.erfi.dev/rocky.mp4?time=5s&duration=5s](https://cdn.erfi.dev/rocky.mp4?time=5s&duration=5s)
- **Video Thumbnail**: [cdn.erfi.dev/rocky.mp4?mode=frame&time=5s&width=640&height=360](https://cdn.erfi.dev/rocky.mp4?mode=frame&time=5s&width=640&height=360)
- **Video with Cropping**: [cdn.erfi.dev/rocky.mp4?width=640&height=360&fit=cover](https://cdn.erfi.dev/rocky.mp4?width=640&height=360&fit=cover)
- **Muted Video**: [cdn.erfi.dev/rocky.mp4?audio=false](https://cdn.erfi.dev/rocky.mp4?audio=false)

### Advanced Transformations

- **With Akamai-Style Parameters**: [cdn.erfi.dev/rocky.mp4?w=640&h=360&obj-fit=crop&mute=true](https://cdn.erfi.dev/rocky.mp4?w=640&h=360&obj-fit=crop&mute=true)
- **Using a Derivative (mobile)**: [cdn.erfi.dev/rocky.mp4?derivative=mobile](https://cdn.erfi.dev/rocky.mp4?derivative=mobile)
- **Generating a Sprite Sheet**: [cdn.erfi.dev/rocky.mp4?mode=spritesheet&time=0s&duration=10s&width=160&height=90](https://cdn.erfi.dev/rocky.mp4?mode=spritesheet&time=0s&duration=10s&width=160&height=90)
- **High Quality with Low Compression**: [cdn.erfi.dev/rocky.mp4?quality=high&compression=low](https://cdn.erfi.dev/rocky.mp4?quality=high&compression=low)
- **Low Quality with High Compression**: [cdn.erfi.dev/rocky.mp4?quality=low&compression=high](https://cdn.erfi.dev/rocky.mp4?quality=low&compression=high)
- **Looping Video Animation**: [cdn.erfi.dev/rocky.mp4?derivative=animation](https://cdn.erfi.dev/rocky.mp4?derivative=animation)
- **Quick Preview (5s, Low Quality)**: [cdn.erfi.dev/rocky.mp4?derivative=preview](https://cdn.erfi.dev/rocky.mp4?derivative=preview)

### Video Playback Controls

- **Autoplay Video (Muted)**: [cdn.erfi.dev/rocky.mp4?autoplay=true&muted=true&width=640&height=360](https://cdn.erfi.dev/rocky.mp4?autoplay=true&muted=true&width=640&height=360)
- **Looping Video**: [cdn.erfi.dev/rocky.mp4?loop=true&width=640&height=360](https://cdn.erfi.dev/rocky.mp4?loop=true&width=640&height=360)
- **Pre-loaded Video**: [cdn.erfi.dev/rocky.mp4?preload=auto&width=640&height=360](https://cdn.erfi.dev/rocky.mp4?preload=auto&width=640&height=360)

### Debugging & Optimization

- **Debug View**: [cdn.erfi.dev/rocky.mp4?width=720&height=480&debug=view](https://cdn.erfi.dev/rocky.mp4?width=720&height=480&debug=view)
- **Auto Quality Based on Client**: [cdn.erfi.dev/rocky.mp4?quality=auto](https://cdn.erfi.dev/rocky.mp4?quality=auto)
- **Client Detection Test**: [cdn.erfi.dev/rocky.mp4?debug=view](https://cdn.erfi.dev/rocky.mp4?debug=view)

### Special Path Patterns

- **Popular Videos (Longer Cache TTL)**: [cdn.erfi.dev/popular/rocky.mp4](https://cdn.erfi.dev/popular/rocky.mp4)
- **Short-Form Videos (Medium Cache TTL)**: [cdn.erfi.dev/shorts/rocky.mp4](https://cdn.erfi.dev/shorts/rocky.mp4)
- **Standard Videos (Regular Cache TTL)**: [cdn.erfi.dev/rocky.mp4](https://cdn.erfi.dev/rocky.mp4)

## Visual Examples

Here are some visual examples of the transformations:

### Original vs. Thumbnail
The original video and a thumbnail extracted at 5 seconds:

| Original Video | Thumbnail at 5s |
|----------------|-----------------|
| <video src="https://cdn.erfi.dev/rocky.mp4" width="320" controls></video> | <img src="https://cdn.erfi.dev/rocky.mp4?mode=frame&time=5s&width=320&height=180" alt="Thumbnail at 5s"> |

### Different Fit Modes
Comparison of different fit modes at 640x360:

| Contain | Cover | Scale-Down |
|---------|-------|------------|
| <img src="https://cdn.erfi.dev/rocky.mp4?mode=frame&time=5s&width=640&height=360&fit=contain" alt="Contain mode"> | <img src="https://cdn.erfi.dev/rocky.mp4?mode=frame&time=5s&width=640&height=360&fit=cover" alt="Cover mode"> | <img src="https://cdn.erfi.dev/rocky.mp4?mode=frame&time=5s&width=640&height=360&fit=scale-down" alt="Scale-down mode"> |

### Sprite Sheet
A sprite sheet generated from the first 10 seconds:

<img src="https://cdn.erfi.dev/rocky.mp4?mode=spritesheet&time=0s&duration=10s&width=160&height=90" alt="Sprite sheet" width="800">

## Deployment

Deploy with Wrangler:

```bash
npm run deploy
```

## Development

Start local development server:

```bash
npm run dev
```

## Architecture

The project follows domain-driven design with command pattern and service-oriented architecture for maintainability:

### Service Architecture

The system uses a layered architecture with the following components:

```
┌───────────────────┐
│   VideoHandler    │
└─────────┬─────────┘
          │
          ▼
┌───────────────────┐     ┌───────────────────┐
│ VideoOptionsService│────►│VideoTransformation│
└─────────┬─────────┘     │      Service      │
          │               └──────────┬────────┘
          ▼                          │
┌───────────────────┐                │
│TransformVideoCommand◄──────────────┘
└─────────┬─────────┘
          │
          ▼
┌───────────────────┐     ┌───────────────────┐
│CacheManagement    │     │     Debug         │
│     Service       │     │     Service       │
└───────────────────┘     └───────────────────┘
```

### Components

1. **Domain Layer**: Core video transformation business logic
   - `TransformVideoCommand`: Implements the command pattern for video URL transformation

2. **Application Layer**: Request handlers and services
   - `VideoHandler`: Main entry point that handles HTTP requests
   - `VideoOptionsService`: Determines video processing options from request parameters
   - `VideoTransformationService`: Manages video transformation operations
   - `CacheManagementService`: Handles cache behavior for responses
   - `DebugService`: Provides debug information and reporting

3. **Configuration Layer**: JSON-based configuration system
   - Environment and video configuration
   - Path pattern matching

4. **Utils Layer**: Helper functions and tools
   - Client detection (device, browser capabilities, network)
   - Path and URL handling
   - Responsive sizing
   - Cache control

## Advanced Configuration

### Debug Configuration

The service includes a comprehensive debug system that can be enabled through environment variables:

```jsonc
"vars": {
  "DEBUG_ENABLED": "true",  // Enable debug mode
  "DEBUG_VERBOSE": "true",  // Include verbose debug information
  "DEBUG_INCLUDE_HEADERS": "true"  // Include request/response headers in debug output
}
```

### Extended Path Pattern Options

Path patterns support advanced options:

```jsonc
{
  "name": "videos",
  "matcher": "^/videos/([a-z0-9-]+)",  // Regex with capture group
  "processPath": true,
  "baseUrl": null,
  "originUrl": "https://media.example.com",
  "cacheTtl": 3600,  // 1 hour TTL
  "captureGroups": ["videoId"],  // Names the regex capture group
  "quality": "high",  // Force high quality for all videos
  "transformationOverrides": {  // Override specific parameters
    "fit": "cover",
    "compression": "low"
  }
}
```

### Path-Specific Transformations

You can apply different transformations based on path patterns:

- **High-traffic videos**: Set longer cache TTLs
- **Preview videos**: Force lower quality/resolution
- **Premium content**: Apply higher quality settings
- **Mobile paths**: Apply mobile-optimized settings

## Limitations & Compatibility Notes

### Technical Limitations

- **Input Size**: Videos must be less than 40MB (Cloudflare limit)
- **Dimensions**: Maximum width/height is 2000px
- **Processing Time**: First-time transformations may take longer
- **Frame Extraction**: Time parameter limited to 0-30s range
- **Browsers**: Some parameters (autoplay, preload) have browser-specific behavior

### Compatibility Notes

- **IE11**: Limited support for modern video features
- **Safari**: May require additional parameters for autoplay
- **Mobile Browsers**: Often restrict autoplay even with muted=true
- **Content Policy**: Some sites require additional headers for video embedding

### Optimization Tips

- **Mobile Devices**: Use `derivative=mobile` or `quality=low` with `compression=high`
- **Large Videos**: Set appropriate dimensions to reduce bandwidth
- **Thumbnails**: Use `mode=frame` with `format=jpg` for optimal performance
- **Autoplay**: Always use `muted=true` with `autoplay=true` for best browser compatibility
- **Performance**: Set appropriate cache TTLs based on content update frequency
# Video Resizer

A Cloudflare Worker for performing on-the-fly video transformations by transparently rewriting requests to use Cloudflare's Media Transformation API.

## Features

- Automatically transforms requests to video files to use Cloudflare's Media Transformation capabilities
- **Completely transparent to end users** - no URL changes visible to clients
- Configurable URL path matching patterns via JSON configuration
- Support for transforming video dimensions, quality, format and more
- Extract thumbnails from videos
- Generate spritesheets from videos
- **Compatibility with Akamai parameters** - automatically translates Akamai-style parameters to Cloudflare format
- Domain-driven design with command pattern architecture

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
    "originUrl": null
  },
  {
    "name": "mp4-files",
    "matcher": "^/(.*\\.mp4)",
    "processPath": true,
    "baseUrl": null,
    "originUrl": "https://videos.example.com"
  }
]
```

### Configuration Options:

- **`name`**: Identifier for the pattern (for debugging)
- **`matcher`**: Regular expression to match URL paths
- **`processPath`**: Whether to process matching paths (set to false to disable)
- **`baseUrl`**: Optional base URL for the video source
- **`originUrl`**: Optional origin URL for rewriting requests

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

## Supported Parameters

| Parameter | Description | Values | Akamai Equivalent |
|-----------|-------------|--------|-------------------|
| `width` | Video width in pixels | 10-2000 | `w` |
| `height` | Video height in pixels | 10-2000 | `h` |
| `mode` | Output type | `video`, `frame`, `spritesheet` | - |
| `fit` | Resize method | `contain`, `scale-down`, `cover` | `obj-fit` |
| `time` | Start timestamp | e.g., `5s` (0-30s range) | `start` |
| `duration` | Video duration | e.g., `30s` (positive values) | `dur` |
| `audio` | Include audio | `true`, `false` | `mute` (inverted) |
| `format` | Image format (for frames) | `jpg`, `png` | `f` |

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

### Original Video
[https://videos.erfi.dev/rocky.mp4](https://videos.erfi.dev/rocky.mp4)

### Resized Video (480p)
[https://videos.erfi.dev/rocky.mp4?width=854&height=480&fit=contain](https://videos.erfi.dev/rocky.mp4?width=854&height=480&fit=contain)

### Mobile-Optimized Video (360p)
[https://videos.erfi.dev/rocky.mp4?width=640&height=360&fit=contain](https://videos.erfi.dev/rocky.mp4?width=640&height=360&fit=contain)

### Video Clip (5s to 10s)
[https://videos.erfi.dev/rocky.mp4?time=5s&duration=5s](https://videos.erfi.dev/rocky.mp4?time=5s&duration=5s)

### Video Thumbnail
[https://videos.erfi.dev/rocky.mp4?mode=frame&time=5s&width=640&height=360](https://videos.erfi.dev/rocky.mp4?mode=frame&time=5s&width=640&height=360)

### Video with Cropping
[https://videos.erfi.dev/rocky.mp4?width=640&height=360&fit=cover](https://videos.erfi.dev/rocky.mp4?width=640&height=360&fit=cover)

### Muted Video
[https://videos.erfi.dev/rocky.mp4?audio=false](https://videos.erfi.dev/rocky.mp4?audio=false)

### With Akamai-Style Parameters
[https://videos.erfi.dev/rocky.mp4?w=640&h=360&obj-fit=crop&mute=true](https://videos.erfi.dev/rocky.mp4?w=640&h=360&obj-fit=crop&mute=true)

### Using a Derivative
[https://videos.erfi.dev/rocky.mp4?derivative=mobile](https://videos.erfi.dev/rocky.mp4?derivative=mobile)

### Generating a Sprite Sheet
[https://videos.erfi.dev/rocky.mp4?mode=spritesheet&time=0s&duration=10s&width=160&height=90](https://videos.erfi.dev/rocky.mp4?mode=spritesheet&time=0s&duration=10s&width=160&height=90)

## Visual Examples

Here are some visual examples of the transformations:

### Original vs. Thumbnail
The original video and a thumbnail extracted at 5 seconds:

| Original Video | Thumbnail at 5s |
|----------------|-----------------|
| <video src="https://videos.erfi.dev/rocky.mp4" width="320" controls></video> | <img src="https://videos.erfi.dev/rocky.mp4?mode=frame&time=5s&width=320&height=180" alt="Thumbnail at 5s"> |

### Different Fit Modes
Comparison of different fit modes at 640x360:

| Contain | Cover | Scale-Down |
|---------|-------|------------|
| <img src="https://videos.erfi.dev/rocky.mp4?mode=frame&time=5s&width=640&height=360&fit=contain" alt="Contain mode"> | <img src="https://videos.erfi.dev/rocky.mp4?mode=frame&time=5s&width=640&height=360&fit=cover" alt="Cover mode"> | <img src="https://videos.erfi.dev/rocky.mp4?mode=frame&time=5s&width=640&height=360&fit=scale-down" alt="Scale-down mode"> |

### Sprite Sheet
A sprite sheet generated from the first 10 seconds:

<img src="https://videos.erfi.dev/rocky.mp4?mode=spritesheet&time=0s&duration=10s&width=160&height=90" alt="Sprite sheet" width="800">

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

The project follows domain-driven design with command pattern for maintainability:

- **Domain Layer**: Core video transformation business logic
- **Application Layer**: Request handlers and services
- **Configuration Layer**: JSON-based configuration system
- **Utils Layer**: Helper functions and tools

## Limitations

- Input videos must be less than 40MB
- Max width/height: 2000px
- Max duration depends on Cloudflare plan limits
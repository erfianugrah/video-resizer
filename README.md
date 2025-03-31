# Video Resizer

A Cloudflare Worker for performing on-the-fly video transformations by transparently rewriting requests to use Cloudflare's Media Transformation API. Now with KV caching for transformed variants!

> **⚠️ Important Note on Parameter Support:** While this documentation lists many parameters, only those officially supported by Cloudflare (`mode`, `width`, `height`, `fit`, `audio`, `format`, `time`, `duration`) are directly passed to Cloudflare's cdn-cgi service. Parameters like `quality`, `compression`, `loop`, `preload`, `autoplay`, `muted`, and `derivative` are implemented as convenience features through our worker but may not be fully supported by the underlying Cloudflare API.

> **⚠️ Video Transformation Limitations:**
> 1. The `time` parameter in Cloudflare's Media Transformation API is restricted to 0-30 seconds, limiting where you can start video playback or frame extraction.
> 2. Some users have reported that videos longer than approximately 30 seconds may be truncated when processed through the transformation service. This appears to be a platform behavior rather than a configuration issue.

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
- **Multi-Layered Caching** - Cloudflare Cache API, KV storage for variants, and cf fetch() object options
- **KV Caching** - Store transformed variants in KV with metadata for faster serving
- **Advanced Cache Control** - Path-specific TTLs and cache tags for granular control
- **Debug Tooling** - Provides detailed debug headers and HTML reports
- **Video Derivatives** - Pre-configured transformation presets for common use cases
- **Multi-Source Storage** - Fetch videos from R2 buckets, remote URLs, or fallback sources
- **Authentication Support** - Configure auth for remote video sources with multiple auth methods
- **Dynamic Configuration** - Update configuration without redeploying using KV storage

### Architecture
- **Service-Oriented Design** - Modular services with separation of concerns
- **Command Pattern** - Simplified business logic flow
- **Comprehensive Testing** - Unit, parametrized, and integration tests
- **Circular Dependency Prevention** - Dynamic imports to avoid circular dependencies

## Documentation

- [Documentation Home](./docs/README.md)
- [Configuration Reference](./docs/configuration/README.md)
- [Dynamic Configuration](./docs/configuration/dynamic-configuration.md)
- [Deployment Guide](./docs/deployment/README.md)
- [KV Caching System](./docs/kv-caching/README.md)
- [Storage System](./docs/storage/README.md)

## Quick Start

1. **Clone the repository:**
   ```bash
   git clone https://github.com/erfianugrah/video-resizer.git
   cd video-resizer
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Create a local development configuration:**
   Create a `wrangler.jsonc` file with your local development settings:
   ```jsonc
   {
     "name": "video-resizer",
     "main": "src/index.ts",
     "compatibility_date": "2023-09-04",
     "compatibility_flags": ["nodejs_compat"],

     "assets": {
       "directory": "./public",
       "binding": "ASSETS"
     },

     "vars": {
       "ENVIRONMENT": "development",
       "DEBUG_ENABLED": "true",
       "PATH_PATTERNS": [{"name":"videos","matcher":"^/videos/","processPath":true}]
     },

     "dev": {
       "port": 8787
     }
   }
   ```

4. **Start local development server:**
   ```bash
   npm run dev
   ```

   This starts a local server at `http://localhost:8787`.

5. **Testing locally:**
   You can test your worker locally using curl or your browser:
   ```bash
   curl "http://localhost:8787/videos/sample.mp4?width=640&height=360"
   ```

## Deployment

Deploy with Wrangler:

```bash
# Deploy to default environment
npm run deploy

# Deploy to production with debug UI
npm run deploy:prod

# Full deployment with type checking and linting
npm run deploy:full:prod
```

For detailed deployment instructions, see the [Deployment Guide](./docs/deployment/README.md).

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

### Common Transformations

- **Resized Video**: `/videos/sample.mp4?width=854&height=480&fit=contain`
- **Video Clip**: `/videos/sample.mp4?time=5s&duration=5s`
- **Video Thumbnail**: `/videos/sample.mp4?mode=frame&time=5s&width=640&height=360`
- **Using a Derivative**: `/videos/sample.mp4?derivative=mobile`
- **Debug View**: `/videos/sample.mp4?width=720&height=480&debug=view`

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

## License

MIT License - see the [LICENSE](LICENSE) file for details.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
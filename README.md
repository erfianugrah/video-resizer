# Video Resizer

A Cloudflare Worker for performing on-the-fly video transformations by transparently rewriting requests to use Cloudflare's Media Transformation API. Now with KV caching for transformed variants!

> **⚠️ Important Note on Parameter Support:** While this documentation lists many parameters, only those officially supported by Cloudflare (`mode`, `width`, `height`, `fit`, `audio`, `format`, `time`, `duration`) are directly passed to Cloudflare's cdn-cgi service. Parameters like `quality`, `compression`, `loop`, `preload`, `autoplay`, `muted`, and `derivative` are implemented as convenience features through our worker but may not be fully supported by the underlying Cloudflare API.

> **⚠️ Video Transformation Requirements:**
> - For optimal performance, always specify both `width` and `height` parameters
> - When using derivatives, the pre-configured settings will override any individually specified parameters
> - For best IMQuery integration, add breakpoint configuration in `worker-config.json`
> - Check official Cloudflare documentation for the latest supported parameters

## Features

### Core Functionality
- Automatically transforms requests to video files to use Cloudflare's Media Transformation capabilities
- **Completely transparent to end users** - no URL changes visible to clients
- Configurable URL path matching patterns via JSON configuration
- Support for transforming video dimensions, quality, format and more
- Extract thumbnails from videos
- Generate spritesheets from videos
- **Akamai Compatibility**:
  - Automatically translates Akamai-style parameters to Cloudflare format
  - Support for IMQuery responsive image parameters with breakpoint-based derivative mapping
  - Client hints generation from IMQuery metadata

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
- [Architecture Overview](./docs/architecture/ARCHITECTURE_OVERVIEW.md) - High-level architecture and design patterns
- [Architecture Roadmap](./ARCHITECTURE_ROADMAP.md) - Current progress and future architectural improvements
- [Configuration Reference](./docs/configuration/CONFIGURATION_REFERENCE.md)
- [Configuration Guide](./docs/configuration/README.md)
- [Deployment Guide](./docs/deployment/README.md)
- [Error Handling](./docs/ERROR_HANDLING.md) - Error handling system and best practices
- [KV Caching System](./docs/kv-caching/README.md)
- [Storage System](./docs/storage/README.md)
- [IMQuery Support](./docs/features/imquery/README.md)
- [Breakpoint-Based Mapping](./docs/features/imquery/breakpoint-based-derivative-mapping.md)

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
- **Using IMQuery**: `/videos/sample.mp4?imwidth=800` (maps to tablet derivative via breakpoint)
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

### IMQuery Parameters

These parameters are specific to Akamai's IMQuery system and are automatically translated:

| Parameter | Description | Translated To | Notes |
|-----------|-------------|---------------|-------|
| `imwidth` | Requested image width | Matched to closest derivative | Used for derivative matching |
| `imheight` | Requested image height | Matched to closest derivative | Used for derivative matching |
| `imref` | Reference parameters | Parsed for additional options | Key-value pairs format |
| `im-viewwidth` | Client viewport width | Sec-CH-Viewport-Width client hint | Used for responsive sizing |
| `im-viewheight` | Client viewport height | Viewport-Height client hint | Used for responsive sizing |
| `im-density` | Device pixel ratio | Sec-CH-DPR client hint | Used for responsive sizing |

### Video Derivatives

Derivatives are preset configurations for common use cases:

| Derivative | Description | Settings |
|------------|-------------|----------|
| `desktop` | High quality video | 1920x1080, high quality, low compression |
| `tablet` | Medium quality video | 1280x720, medium quality, medium compression |
| `mobile` | Low quality video | 854x640, low quality, high compression |
| `thumbnail` | Static thumbnail | frame mode, 320x180, jpg format |
| `animation` | Looping video clip | 480x270, no audio, loop=true, preload=auto |
| `preview` | Short preview | 480x270, 5s duration, no audio, low quality |

### Responsive Breakpoints

When using IMQuery with `imwidth` parameters, widths automatically map to derivatives:

| Width Range | Maps To | Resolution | Quality |
|------------|---------|------------|---------|
| ≤ 640px    | mobile  | 854x640    | low     |
| 641-1024px | tablet  | 1280x720   | medium  |
| 1025-1440px| tablet  | 1280x720   | medium  |
| ≥ 1441px   | desktop | 1920x1080  | high    |

## License

MIT License - see the [LICENSE](LICENSE) file for details.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
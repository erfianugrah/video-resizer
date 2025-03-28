# Video Resizer

A Cloudflare Worker for performing on-the-fly video transformations by transparently rewriting requests to use Cloudflare's Media Transformation API.

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
- **Flexible Caching** - Configurable caching using either Cloudflare Cache API or cf fetch() object
- **Advanced Cache Control** - Path-specific TTLs and cache tags for granular control
- **Debug Tooling** - Provides detailed debug headers and HTML reports
- **Video Derivatives** - Pre-configured transformation presets for common use cases
- **Multi-Source Storage** - Fetch videos from R2 buckets, remote URLs, or fallback sources
- **Authentication Support** - Configure auth for remote video sources with multiple auth methods

### Architecture
- **Service-Oriented Design** - Modular services with separation of concerns
- **Command Pattern** - Simplified business logic flow
- **Comprehensive Testing** - Unit, parametrized, and integration tests
- **Circular Dependency Prevention** - Dynamic imports to avoid circular dependencies

## How It Works

The worker sits between clients and your video files, transparently applying transformations to videos:

1. User requests a video from its normal URL with transformation parameters
2. Worker intercepts the request and checks if it matches any configured path patterns
3. If it matches, worker transforms the request to use Cloudflare's CDN-CGI media paths
4. Worker forwards the transformed request to Cloudflare's Media Transformation service
5. The transformed video is returned to the user, with the original URL preserved

```mermaid
%%{init: {'theme': 'dark', 'themeVariables': { 'primaryColor': '#5D8AA8', 'primaryTextColor': '#fff', 'primaryBorderColor': '#5D8AA8', 'lineColor': '#F8B229', 'secondaryColor': '#006400', 'tertiaryColor': '#3E3E3E' }}}%%
sequenceDiagram
    autonumber
    participant Client
    participant VR as Video Resizer Worker
    participant CT as Cloudflare Transformation
    participant Cache as Cloudflare Cache
    participant Origin as Origin Server
    
    Client->>VR: GET /videos/sample.mp4?width=640&height=360
    VR->>VR: Match path against patterns
    VR->>Cache: Check cache (if cacheApi method)
    alt Cache hit
        Cache-->>VR: Return cached response
        VR-->>Client: Return transformed video
    else Cache miss
        VR->>VR: Build CDN-CGI transformation URL
        VR->>CT: Request with CDN-CGI parameters
        CT->>Origin: Fetch original video
        Origin-->>CT: Return original video
        CT->>CT: Apply transformations
        CT-->>VR: Return transformed video
        VR->>VR: Apply cache headers & ttl
        VR->>Cache: Store in cache (if enabled)
        VR-->>Client: Return transformed video
    end
```

## Configuration

Video Resizer now uses a centralized configuration management system that simplifies configuration and improves type safety. The system validates all configuration at runtime and provides a consistent interface for accessing configuration values.

### Environment Configuration

The easiest way to configure Video Resizer is through environment variables. You can set these in your `.env` file for local development or in your `wrangler.jsonc` file for deployment.

1. **Create a Local Configuration**
   
   Copy the template file to create your local configuration:
   ```bash
   cp .env.template .env
   ```

2. **Configure Your Environment**
   
   Edit the `.env` file to customize your settings:
   ```
   # Application Settings
   ENVIRONMENT=development
   VERSION=1.0.0

   # Debug Configuration
   DEBUG_ENABLED=true
   DEBUG_VERBOSE=true
   DEBUG_INCLUDE_HEADERS=true

   # Cache Configuration
   CACHE_METHOD=cf
   CACHE_DEBUG=true

   # Video Configuration
   VIDEO_DEFAULT_QUALITY=auto
   VIDEO_DEFAULT_COMPRESSION=auto
   ```

3. **Configure Wrangler Settings**
   
   Create or edit your `wrangler.jsonc` file with your Cloudflare account details:
   ```jsonc
   {
     "$schema": "https://json.schemastore.org/wrangler.json",
     "name": "video-resizer",
     "main": "src/index.ts",
     "compatibility_date": "2023-09-04",
     "compatibility_flags": ["nodejs_compat"],
     "account_id": "your-account-id",

     "assets": {
       "directory": "./public",
       "binding": "ASSETS"
     },

     "vars": {
       "ENVIRONMENT": "development",
       "DEBUG_ENABLED": "true",
       "DEBUG_VERBOSE": "true",
       "DEBUG_INCLUDE_HEADERS": "true",
       "PATH_PATTERNS": []
     }
   }
   ```

4. **Define Path Patterns**
   
   Configure which URL patterns should be processed by adding the `PATH_PATTERNS` array to your `wrangler.jsonc` file:
   ```jsonc
   "PATH_PATTERNS": [
     {
       "name": "videos",
       "matcher": "^/videos/",
       "processPath": true,
       "originUrl": null,
       "cacheTtl": 3600,
       "captureGroups": ["videoId"]
     }
   ]
   ```

5. **Deploy Your Worker**
   ```bash
   npm run deploy
   ```

6. **Test Your Configuration**
   After deployment, test your worker with a video URL:
   ```
   https://your-domain.com/videos/sample.mp4?width=640&height=360
   ```

### Configuration Managers

The configuration system is built around configuration managers that handle different aspects of the application:

1. **VideoConfigurationManager**: Handles video transformation settings
2. **CacheConfigurationManager**: Manages caching behavior
3. **LoggingConfigurationManager**: Controls logging settings
4. **DebugConfigurationManager**: Manages debug functionality

These managers provide methods for accessing and updating configuration values, ensuring type safety and validation.

For detailed documentation of all configuration options, see [CONFIGURATION_REFERENCE.md](CONFIGURATION_REFERENCE.md).

### Environment Variables Reference

For a complete list of supported environment variables, see the `.env.template` file or [CONFIGURATION_REFERENCE.md](CONFIGURATION_REFERENCE.md).

### Multi-Environment Configuration

Video-resizer supports multiple environment configurations (development, staging, production) using Wrangler's environment feature:

```jsonc
"env": {
  "production": {
    "assets": {
      "directory": "./public",
      "binding": "ASSETS"
    },
    "vars": {
      "ENVIRONMENT": "production",
      "DEBUG_ENABLED": "false",
      "DEBUG_VERBOSE": "false",
      "DEBUG_INCLUDE_HEADERS": "false",
      "PATH_PATTERNS": [
        {
          "name": "videos",
          "matcher": "^/videos/",
          "processPath": true,
          "cacheTtl": 86400
        }
      ]
    }
  },
  "staging": {
    "assets": {
      "directory": "./public",
      "binding": "ASSETS"
    },
    "vars": {
      "ENVIRONMENT": "staging",
      "DEBUG_ENABLED": "true"
    }
  }
}
```

To deploy to specific environments:
```bash
npm run deploy:prod   # Deploy to production
npm run deploy:staging  # Deploy to staging
```

### Detailed Configuration Options

The worker configuration is stored in `PATH_PATTERNS`, which is an array of objects defining which URL paths should be processed and how:

```jsonc
// Example PATH_PATTERNS configuration
[vars]
PATH_PATTERNS = [
  {
    "name": "videos",           // Give this pattern a name for logging/debugging
    "matcher": "^/videos/",     // Regex pattern to match against URLs
    "processPath": true,        // Set to true to enable processing matching paths
    "baseUrl": null,            // Optional base URL to prepend to video paths
    "originUrl": null,          // Optional origin URL for rewriting requests
    "cacheTtl": 3600,           // Cache time in seconds (1 hour)
    "captureGroups": ["videoId"], // Names for regex capture groups (optional)
    "quality": "high"           // Default quality for all videos matching this pattern
  },
  {
    "name": "popular",
    "matcher": "^/popular/(.*\\.mp4)",  // Match URLs like /popular/video.mp4
    "processPath": true,
    "baseUrl": null,
    "originUrl": "https://videos.example.com",  // Rewrites to this origin
    "cacheTtl": 86400,          // 24 hour cache time
    "captureGroups": ["videoId"]
  },
  {
    "name": "shorts",
    "matcher": "^/shorts/(.*\\.mp4)",
    "processPath": true,
    "baseUrl": null,
    "originUrl": "https://videos.example.com",
    "cacheTtl": 43200,          // 12 hour cache time
    "captureGroups": ["videoId"],
    "quality": "medium"         // Force medium quality for /shorts/ paths
  }
]
```

### Configuration Options Explained:

#### Path Pattern Options

| Option | Required | Default | Description |
|--------|----------|---------|-------------|
| **`name`** | Yes | - | Identifier for the pattern (for logging and debugging) |
| **`matcher`** | Yes | - | Regular expression to match URL paths. Example: `^/videos/` will match all URLs starting with "/videos/" |
| **`processPath`** | No | `true` | Whether to process matching paths. Set to `false` to temporarily disable a pattern without removing it |
| **`baseUrl`** | No | `null` | Optional base URL for the video source. Set this when your videos have a specific base URL |
| **`originUrl`** | No | `null` | Optional origin URL for rewriting requests. Use this to fetch videos from a different origin than the request |
| **`cacheTtl`** | No | `86400` | Time to live in seconds for the cache (overrides default). Common values: 3600 (1 hour), 86400 (24 hours) |
| **`captureGroups`** | No | `[]` | Names for regex capture groups in the matcher. This helps with path extraction in complex URLs |
| **`quality`** | No | - | Optional quality preset to apply to all videos matching this pattern (`low`, `medium`, `high`, `auto`) |
| **`transformationOverrides`** | No | `{}` | Optional parameters to override default transformations for all videos matching this pattern |

#### Environment Configuration Options

| Option | Required | Default | Description |
|--------|----------|---------|-------------|
| **`ENVIRONMENT`** | No | `development` | Environment mode (`development`, `staging`, `production`) |
| **`DEBUG_ENABLED`** | No | `true` | Enable debug features |
| **`DEBUG_VERBOSE`** | No | `false` | Enable verbose debug output |
| **`DEBUG_INCLUDE_HEADERS`** | No | `false` | Include headers in debug output |
| **`CACHE_METHOD`** | No | `cacheApi` | Caching method to use (`cacheApi` or `cf`) |
| **`CACHE_DEBUG`** | No | `false` | Enable cache operation debugging |
| **`PATH_PATTERNS`** | No | `[]` | Array of path patterns to process |
| **`STORAGE_CONFIG`** | No | - | Configuration for multiple storage backends (R2, remote URLs, fallback) |

#### Storage Configuration Options

| Option | Required | Default | Description |
|--------|----------|---------|-------------|
| **`priority`** | No | `["r2", "remote", "fallback"]` | Order in which storage locations are tried |
| **`r2.enabled`** | No | `false` | Whether to use R2 storage |
| **`r2.bucketBinding`** | No | `VIDEOS_BUCKET` | Name of the R2 bucket binding |
| **`remoteUrl`** | No | - | URL for remote video storage |
| **`remoteAuth`** | No | - | Authentication configuration for remote storage |
| **`fallbackUrl`** | No | - | Fallback URL if primary sources fail |
| **`fallbackAuth`** | No | - | Authentication configuration for fallback storage |
| **`pathTransforms`** | No | - | Path transformations for different storage types |

### AWS S3 Authentication

The video-resizer supports AWS S3 compatible authentication for accessing storage providers that use the S3 API, including Cloudflare R2, AWS S3, and Google Cloud Storage (with S3 compatibility):

```jsonc
"remoteAuth": {
  "enabled": true,
  "type": "aws-s3",
  "accessKeyVar": "AWS_ACCESS_KEY_ID",     // Name of environment variable for access key
  "secretKeyVar": "AWS_SECRET_ACCESS_KEY", // Name of environment variable for secret key
  "region": "us-east-1",                   // AWS region or "auto" for R2
  "service": "s3"                          // Always use "s3" for S3-compatible APIs
}
```

#### Security Best Practices

For production use, always store your AWS credentials as Cloudflare Worker secrets instead of directly in wrangler.jsonc:

```bash
# Set your AWS credentials as Worker secrets
wrangler secret put AWS_ACCESS_KEY_ID     # You'll be prompted to enter the value securely
wrangler secret put AWS_SECRET_ACCESS_KEY # You'll be prompted to enter the value securely
```

#### Provider-Specific Configuration

1. **Cloudflare R2**
   ```jsonc
   "remoteAuth": {
     "enabled": true,
     "type": "aws-s3",
     "accessKeyVar": "R2_ACCESS_KEY_ID",
     "secretKeyVar": "R2_SECRET_ACCESS_KEY",
     "region": "auto",
     "service": "s3"
   }
   ```

2. **AWS S3**
   ```jsonc
   "remoteAuth": {
     "enabled": true,
     "type": "aws-s3",
     "accessKeyVar": "AWS_ACCESS_KEY_ID",
     "secretKeyVar": "AWS_SECRET_ACCESS_KEY",
     "region": "us-east-1",  // Replace with your bucket's region
     "service": "s3"
   }
   ```

3. **Google Cloud Storage with S3 API**
   ```jsonc
   "remoteAuth": {
     "enabled": true,
     "type": "aws-s3",
     "accessKeyVar": "GCS_ACCESS_KEY_ID",
     "secretKeyVar": "GCS_SECRET_ACCESS_KEY",
     "region": "us-central1",  // Match your GCS location
     "service": "s3"
   }
   ```

### Common Configuration Examples

1. **Basic Video Path Processing**
   ```json
   {
     "name": "videos",
     "matcher": "^/videos/",
     "processPath": true
   }
   ```

2. **Process Videos from External Origin**
   ```json
   {
     "name": "external",
     "matcher": "^/external/",
     "originUrl": "https://external-videos.example.com"
   }
   ```

3. **Specific File Type Processing**
   ```json
   {
     "name": "mp4-files",
     "matcher": ".*\\.mp4$",
     "quality": "high"
   }
   ```

4. **Path with Variable Extraction**
   ```json
   {
     "name": "user-videos",
     "matcher": "^/users/([^/]+)/videos/([^/]+)",
     "captureGroups": ["userId", "videoId"]
   }
   ```

5. **Temporary Disable Processing**
   ```json
   {
     "name": "disabled-section",
     "matcher": "^/temp/",
     "processPath": false
   }
   ```

### Debug Configuration

The service includes comprehensive debugging capabilities that can be enabled through environment variables:

```jsonc
"vars": {
  "DEBUG_ENABLED": "true",      // Enable debug mode
  "DEBUG_VERBOSE": "true",      // Include verbose debug information
  "DEBUG_INCLUDE_HEADERS": "true", // Include request/response headers in debug output
  "CACHE_METHOD": "cacheApi",   // Use "cf" or "cacheApi" caching method
  "CACHE_DEBUG": "true"         // Enable cache operation debugging
}
```

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

## Enhanced Debug Interface

Video-resizer includes a comprehensive HTML debug interface for easier troubleshooting and visualization of transformations.

### Accessing the Debug Interface

Add `?debug=view` to any video URL to access the debug interface:
```
https://your-domain.com/videos/sample.mp4?width=720&height=480&debug=view
```

### Debug Interface Features

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

5. **Error Reporting**:
   - Detailed error messages
   - Warning indicators for potential issues
   - Troubleshooting suggestions

### Debugging via Headers

You can also enable debugging information in response headers without the visual interface:

```
https://your-domain.com/videos/sample.mp4?width=720&debug=true
```

This will add detailed debug headers to the response:
- `X-Video-Resizer-Debug`: Indicates debug mode is enabled
- `X-Processing-Time-Ms`: Time taken to process the request
- `X-Transform-Source`: Source of the transformation
- `X-Device-Type`: Detected device type
- `X-Network-Quality`: Estimated network quality
- `X-Cache-Enabled`: Cache status
- `X-Cache-TTL`: Cache time-to-live

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

The service supports two caching methods that can be configured through environment variables:

```mermaid
%%{init: {'theme': 'dark', 'themeVariables': { 'primaryColor': '#5D8AA8', 'primaryTextColor': '#fff', 'primaryBorderColor': '#5D8AA8', 'lineColor': '#F8B229', 'secondaryColor': '#006400', 'tertiaryColor': '#3E3E3E' }}}%%
flowchart TD
    A[Cache Configuration] -->|method=cf| B[CF Object Method]
    A -->|method=cacheApi| C[Cache API Method]
    
    B -->|fetch with cf object| D{Cacheability Check}
    C -->|explicit cache operations| E{Cacheability Check}
    
    D -->|true| F[cf.cacheEverything=true]
    D -->|false| G[cf.cacheEverything=false]
    
    E -->|true| H[cache.put operations]
    E -->|false| I[skip cache.put]
    
    F --> J[Set cf.cacheTtl & cf.cacheTags]
    G --> K[Set cf.cacheTtl=0]
    
    J --> L[Fetch with cf object]
    K --> L
    
    H --> M[Apply Cache-Control headers]
    I --> M
    
    L --> N[Apply Cache-Control headers]
    M --> O[Add Cache-Tag headers]
    N --> O
    
    style A fill:#5D8AA8,stroke:#333,stroke-width:2px
    style B fill:#006400,stroke:#333,stroke-width:2px
    style C fill:#7B68EE,stroke:#333,stroke-width:2px
    style D fill:#F8B229,stroke:#333,stroke-width:2px
    style E fill:#F8B229,stroke:#333,stroke-width:2px
    style L fill:#5D8AA8,stroke:#333,stroke-width:2px
    style M fill:#5D8AA8,stroke:#333,stroke-width:2px
```

1. **CF Object method** (default, recommended):
   - Uses Cloudflare's `fetch()` with the `cf` object
   - Simplifies caching by delegating to Cloudflare's built-in mechanisms
   - Sets `cacheEverything`, `cacheTtl`, and `cacheTags` properties
   - Reduces code complexity and relies on Cloudflare's optimizations
   - Ideal for most caching scenarios and provides better performance

2. **Cache API method** (alternative):
   - Uses direct access to Cloudflare's Cache API via `caches.default`
   - Implements explicit `cache.match()` and `cache.put()` operations
   - Provides maximum control over caching behavior
   - Ideal for complex caching scenarios with custom logic that requires granular control

Both methods implement:
1. **Cache Headers**: Sets appropriate `Cache-Control` headers based on configuration
2. **Cache Tags**: Adds `Cache-Tag` headers with video source and derivative information for granular purging
3. **Cache Bypass**: Respects client cache control headers and debug parameters

The caching method can be configured in `wrangler.jsonc` using the `CACHE_METHOD` environment variable:
```jsonc
"vars": {
  "CACHE_METHOD": "cf", // Use "cf" for CF object method or "cacheApi" for Cache API method
  "CACHE_DEBUG": "true" // Enable debug logging for cache operations
}
```

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
- **Time Parameter**: The `time` parameter (starting point) must be between 0-30 seconds. This is a documented limitation of the Cloudflare Media Transformation API.
- **Duration & Video Length**: Some users have reported that videos longer than approximately 30 seconds may be truncated when processed, although this is not explicitly documented as a hard limit in Cloudflare's API.
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

### Officially Supported Transformations

- **Original Video**: [cdn.erfi.dev/rocky.mp4](https://cdn.erfi.dev/rocky.mp4)
- **Resized Video (480p)**: [cdn.erfi.dev/rocky.mp4?width=854&height=480&fit=contain](https://cdn.erfi.dev/rocky.mp4?width=854&height=480&fit=contain)
- **Mobile-Optimized Video (360p)**: [cdn.erfi.dev/rocky.mp4?width=640&height=360&fit=contain](https://cdn.erfi.dev/rocky.mp4?width=640&height=360&fit=contain)
- **Video Clip (5s to 10s)**: [cdn.erfi.dev/rocky.mp4?time=5s&duration=5s](https://cdn.erfi.dev/rocky.mp4?time=5s&duration=5s)
- **Video Thumbnail**: [cdn.erfi.dev/rocky.mp4?mode=frame&time=5s&width=640&height=360](https://cdn.erfi.dev/rocky.mp4?mode=frame&time=5s&width=640&height=360)
- **Video with Cropping**: [cdn.erfi.dev/rocky.mp4?width=640&height=360&fit=cover](https://cdn.erfi.dev/rocky.mp4?width=640&height=360&fit=cover)
- **Muted Video**: [cdn.erfi.dev/rocky.mp4?audio=false](https://cdn.erfi.dev/rocky.mp4?audio=false)
- **Generating a Sprite Sheet**: [cdn.erfi.dev/rocky.mp4?mode=spritesheet&time=0s&duration=10s&width=160&height=90](https://cdn.erfi.dev/rocky.mp4?mode=spritesheet&time=0s&duration=10s&width=160&height=90)

### Extended Features (Worker-Enhanced)

These features leverage our worker's custom logic and may have varying levels of support:

- **With Akamai-Style Parameters**: [cdn.erfi.dev/rocky.mp4?w=640&h=360&obj-fit=crop&mute=true](https://cdn.erfi.dev/rocky.mp4?w=640&h=360&obj-fit=crop&mute=true)
- **Using a Derivative (mobile)**: [cdn.erfi.dev/rocky.mp4?derivative=mobile](https://cdn.erfi.dev/rocky.mp4?derivative=mobile)
- **High Quality with Low Compression**: [cdn.erfi.dev/rocky.mp4?quality=high&compression=low](https://cdn.erfi.dev/rocky.mp4?quality=high&compression=low)
- **Low Quality with High Compression**: [cdn.erfi.dev/rocky.mp4?quality=low&compression=high](https://cdn.erfi.dev/rocky.mp4?quality=low&compression=high)
- **Looping Video Animation**: [cdn.erfi.dev/rocky.mp4?loop=true&width=640&height=360](https://cdn.erfi.dev/rocky.mp4?loop=true&width=640&height=360)
- **Quick Preview (5s, Low Quality)**: [cdn.erfi.dev/rocky.mp4?derivative=preview](https://cdn.erfi.dev/rocky.mp4?derivative=preview)
- **Autoplay Video (Muted)**: [cdn.erfi.dev/rocky.mp4?autoplay=true&muted=true&width=640&height=360](https://cdn.erfi.dev/rocky.mp4?autoplay=true&muted=true&width=640&height=360)
- **Pre-loaded Video**: [cdn.erfi.dev/rocky.mp4?preload=auto&width=640&height=360](https://cdn.erfi.dev/rocky.mp4?preload=auto&width=640&height=360)

### Debugging & Optimization

- **Debug View**: [cdn.erfi.dev/rocky.mp4?width=720&height=480&debug=view](https://cdn.erfi.dev/rocky.mp4?width=720&height=480&debug=view)
- **Auto Quality Based on Client**: [cdn.erfi.dev/rocky.mp4?quality=auto](https://cdn.erfi.dev/rocky.mp4?quality=auto)
- **Client Detection Test**: [cdn.erfi.dev/rocky.mp4?debug=view](https://cdn.erfi.dev/rocky.mp4?debug=view)

### Special Path Patterns

- **Popular Videos (Longer Cache TTL)**: [cdn.erfi.dev/popular/rocky.mp4](https://cdn.erfi.dev/popular/rocky.mp4)
- **Short-Form Videos (Medium Cache TTL)**: [cdn.erfi.dev/shorts/rocky.mp4](https://cdn.erfi.dev/shorts/rocky.mp4)
- **Standard Videos (Regular Cache TTL)**: [cdn.erfi.dev/rocky.mp4](https://cdn.erfi.dev/rocky.mp4)

## Deployment

### Quick Deployment

Deploy with Wrangler:

```bash
npm run deploy
```

### Deploying with Static Assets

The project uses Cloudflare's Assets functionality to serve the debug interface and other static assets. Make sure your `wrangler.jsonc` file includes the proper assets configuration:

```json
{
  "assets": {
    "directory": "./public",
    "binding": "ASSETS"
  }
}
```

For production deployments:

```bash
npm run deploy:prod
```

For staging deployments:

```bash
npm run deploy:staging
```

### Deployment Options

For full deployment documentation, see [DEPLOY.md](DEPLOY.md).

#### Quick Deployment Commands

```bash
# Deploy to production with debug UI
npm run deploy:prod

# Deploy to staging with debug UI
npm run deploy:staging

# Full deployment with type checking and linting
npm run deploy:full:prod
```

#### Deployment Notes

1. Make sure your compatibility date is set correctly
2. Verify that the assets directory exists and contains all necessary files
3. The ASSETS binding is required for the debug interface to function correctly
4. You can customize environmental variables in your deployment configuration

## Development

### Local Development Setup

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

### Running Tests

Run the test suite:

```bash
npm test
```

Run specific tests:

```bash
npm test -- -t "test name"
```

### Requirements

- **Node.js**: v16 or higher
- **Cloudflare Account**: With access to Media Transformations feature
- **Wrangler CLI**: Latest version (`npm install -g wrangler`)

## Static Assets Support

The video-resizer includes integrated static asset hosting through Cloudflare Workers Assets:

1. **Static Web Interface**:
   - Landing page for service documentation
   - Interactive examples and demos
   - Visual formatting for easier usage

2. **Enhanced Debug UI**:
   - Pretty-printed JSON viewer with copy and expand/collapse functionality
   - Media preview section showing the actual transformed video or image
   - Syntax highlighting with Prism.js for JSON data
   - Responsive design that works on all device sizes
   - Controls to view and copy the full diagnostic information
   - Improved display of video transformation parameters
   - Browser capabilities section showing supported formats and features
   - Enhanced CSS styling for the media preview and JSON viewer

3. **Implementation Details**:
   - Configured via `assets` property in wrangler.jsonc
   - Assets served from ./public directory
   - Includes HTML, CSS, and JavaScript files
   - Seamlessly integrated with the API functionality
   - Proper binding setup for worker code to access static assets

### Debug Interface Features

When you add `?debug=view` to any video URL, the worker will display an enhanced debug interface that includes:

```mermaid
%%{init: {'theme': 'dark', 'themeVariables': { 'primaryColor': '#5D8AA8', 'primaryTextColor': '#fff', 'primaryBorderColor': '#5D8AA8', 'lineColor': '#F8B229', 'secondaryColor': '#006400', 'tertiaryColor': '#3E3E3E' }}}%%
flowchart TD
    A[Client Request with ?debug=view] --> B[Video Resizer Worker]
    B --> C{Debug Enabled?}
    
    C -->|Yes| D[Collect Diagnostic Data]
    C -->|No| E[Normal Processing]
    
    D --> F[Collect Request Headers]
    D --> G[Record Device Info]
    D --> H[Track Processing Time]
    D --> I[Gather Transformation Details]
    D --> J[Add Configuration Data]
    
    F --> K[Generate Debug HTML]
    G --> K
    H --> K
    I --> K
    J --> K
    
    K --> L[Inject Diagnostic Data as JSON]
    L --> M[Return Debug UI HTML]
    
    M --> N{Client Browser}
    
    N --> O[Video Preview]
    N --> P[Diagnostic JSON Viewer]
    N --> Q[Configuration Tabs]
    N --> R[Error & Warning Display]
    
    style A fill:#5D8AA8,stroke:#333,stroke-width:2px
    style B fill:#5D8AA8,stroke:#333,stroke-width:2px
    style C fill:#F8B229,stroke:#333,stroke-width:2px
    style D fill:#7B68EE,stroke:#333,stroke-width:2px
    style E fill:#006400,stroke:#333,stroke-width:2px
    style K fill:#7B68EE,stroke:#333,stroke-width:2px
    style M fill:#5D8AA8,stroke:#333,stroke-width:2px
    style N fill:#F8B229,stroke:#333,stroke-width:2px
    style O fill:#006400,stroke:#333,stroke-width:2px
    style P fill:#006400,stroke:#333,stroke-width:2px
    style Q fill:#006400,stroke:#333,stroke-width:2px
    style R fill:#006400,stroke:#333,stroke-width:2px
```

The debug interface includes:

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

5. **Error Reporting**:
   - Detailed error messages
   - Warning indicators for potential issues
   - Troubleshooting suggestions

The debug interface is served through Cloudflare's Assets functionality, ensuring fast loading times and reliable delivery.

## Troubleshooting

### Common Issues

| Issue | Possible Cause | Solution |
|-------|---------------|----------|
| **Videos not transforming** | Media Transformations not enabled | Verify that Transformations are enabled in Cloudflare dashboard under Stream > Transformations |
| **"Invalid Parameter" error** | Parameter value out of bounds | Check that width/height are between 10-2000px and time is between 0-30s |
| **Origin URL errors** | Incorrect configuration | Verify that your origin URL is accessible and that the video exists |
| **Empty or corrupt video** | Source format issues | Ensure source video is H.264 MP4 with AAC/MP3 audio and under 40MB |
| **Black video output** | DRM protected content | Media Transformations cannot process DRM protected content |
| **Autoplay not working** | Browser restrictions | Set both `autoplay=true` and `muted=true` for most reliable autoplay behavior |
| **High latency on first transform** | Cold cache | First transformation may take longer; subsequent requests will be faster from cache |
| **Parameters not working** | Unsupported parameter | Remember that only `mode`, `width`, `height`, `fit`, `audio`, `format`, `time`, and `duration` are officially supported by Cloudflare |
| **Videos being truncated** | Cloudflare 30s limitation | Videos longer than ~30s may be truncated due to Cloudflare Media Transformation limitations |
| **Debug interface not working** | ASSETS binding missing | Ensure the `assets` configuration is properly set in wrangler.jsonc |

### Error Responses

The service returns different HTTP status codes for different errors:

- **400**: Invalid parameters or invalid request format
- **404**: Video not found at origin URL
- **413**: Video file too large (over 40MB)
- **415**: Unsupported video format
- **500**: Internal server error or Cloudflare service error

When errors occur and fallback is enabled, the service provides detailed error headers to help diagnose issues:

- **X-Fallback-Applied**: Set to 'true' when fallback is applied
- **X-Fallback-Reason**: Detailed reason for the fallback, based on the specific error
- **X-Original-Error-Type**: The internal error type classification
- **X-Original-Status-Code**: The original HTTP status code before fallback
- **X-Error-Type**: Specific error category (e.g., 'duration_limit', 'file_size_limit')
- **X-Invalid-Parameter**: Which parameter failed validation

For example, if a video exceeds Cloudflare's duration limits, you might see:
```
X-Fallback-Reason: Duration must be between 100ms and 46.066933s
X-Error-Type: duration_limit
X-Invalid-Parameter: duration
```

For duration limit errors that were automatically adjusted and successfully retried, you'll see:
```
X-Duration-Adjusted: true
X-Original-Duration: 100s
X-Adjusted-Duration: 46s
X-Duration-Limit-Applied: true
```

For file size limitations:
```
X-Fallback-Reason: Video file size must be less than 256MB
X-Error-Type: file_size_limit
X-Invalid-Parameter: fileSize
```

These specific error headers help quickly identify and resolve transformation issues and show when parameters were automatically adjusted to ensure successful transformation.

### Debugging

1. **Enable debug mode:**
   Add `debug=true` to your URL query string or set `DEBUG_ENABLED=true` in your Wrangler config.

2. **View detailed debug information:**
   Add `debug=view` to see an HTML report with all transformation details.

3. **Check request/response headers:**
   Look for `cf-media-transformations-*` headers which indicate if transformations were applied.

4. **Verify path patterns:**
   Ensure your URL path is matching one of your configured path patterns.

5. **Check service logs:**
   If errors persist, check Cloudflare Workers logs in the dashboard.

## Performance Optimization

### Best Practices

1. **Set Appropriate Dimensions:**
   Always specify width and height to avoid serving unnecessarily large videos.

2. **Use Derivatives for Common Cases:**
   Utilize the built-in derivatives (`high`, `medium`, `low`, `mobile`) for consistent quality settings.

3. **Cache TTL Optimization:**
   Set longer cache TTLs for static content and shorter TTLs for frequently updated content.

4. **Client Hints:**
   Enable client hints in your HTML:
   ```html
   <meta http-equiv="Accept-CH" content="DPR, Viewport-Width, Width">
   ```

5. **Mobile Optimization:**
   For mobile-first sites, use the `mobile` derivative or set up specific path patterns for mobile clients.

6. **Video Preloading:**
   For critical videos, use `preload=auto`. For less important videos, use `preload=metadata`.

7. **Advanced Caching Strategies:**
   Implement surrogate-key based cache purging using the Cache Tags provided by the service.

## Advanced Configuration

### Storage Configuration

Configure multiple sources for video content with authentication:

```jsonc
"STORAGE_CONFIG": {
  // Priority determines which storage is tried first
  "priority": ["r2", "remote", "fallback"],
  
  // R2 bucket configuration
  "r2": {
    "enabled": true,
    "bucketBinding": "VIDEOS_BUCKET"
  },
  
  // Remote URL configuration with authentication (using headers)
  "remoteUrl": "https://videos.example.com",
  "remoteAuth": {
    "enabled": true,
    "type": "header", // Options: "header", "bearer", "aws-s3", "query"
    "headers": {
      "Authorization": "Bearer YOUR-TOKEN",
      "X-Api-Key": "YOUR-API-KEY"
    }
  },
  
  // Fallback URL with AWS S3 authentication
  "fallbackUrl": "https://your-bucket.s3.amazonaws.com",
  "fallbackAuth": {
    "enabled": true,
    "type": "aws-s3",
    "accessKeyVar": "AWS_ACCESS_KEY_ID",     // Name of environment variable storing the access key
    "secretKeyVar": "AWS_SECRET_ACCESS_KEY", // Name of environment variable storing the secret key
    "region": "us-east-1",                   // AWS region (use "auto" for R2)
    "service": "s3"                          // Service name (use "s3" for all S3-compatible APIs)
  },
  
  // Path transformations for different storage types
  "pathTransforms": {
    "videos": {
      "r2": {
        "removePrefix": true,
        "prefix": ""
      },
      "remote": {
        "removePrefix": true,
        "prefix": "videos/"
      }
    }
  }
}
```

These storage settings enable seamless multi-source fetching with proper authentication. Configure your R2 bucket binding in wrangler.jsonc:

```jsonc
"r2_buckets": [
  {
    "binding": "VIDEOS_BUCKET",
    "bucket_name": "videos",
    "preview_bucket_name": "videos-dev"
  }
]
```

For secure authentication with S3-compatible storage (R2, AWS S3, GCS), store your credentials as Cloudflare Worker secrets:

```bash
# Set your AWS/S3 credentials as secrets
wrangler secret put AWS_ACCESS_KEY_ID     # You'll be prompted to enter the value securely
wrangler secret put AWS_SECRET_ACCESS_KEY # You'll be prompted to enter the value securely
```

This approach keeps sensitive credentials out of your codebase and configuration files.

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

### Dynamic Quality Selection

The service can dynamically select quality settings based on:

1. **Client Hints**: If the browser provides Client Hints headers
2. **Device Type**: Based on User-Agent (mobile, tablet, desktop)
3. **Network Quality**: Estimated from Client Hints or User-Agent
4. **Screen Size**: Determined from Client Hints or default sizes

To enable Client Hints on your site, add:

```html
<meta http-equiv="Accept-CH" content="Sec-CH-DPR, Sec-CH-Width, Sec-CH-Viewport-Width, ECT, Downlink">
```

### Custom Error Responses

You can configure custom error responses for different error cases:

```jsonc
"ERROR_RESPONSES": {
  "400": {
    "message": "Invalid video request parameters",
    "cacheTtl": 60
  },
  "404": {
    "message": "Video not found",
    "cacheTtl": 30
  },
  "500": {
    "message": "Server error processing video",
    "cacheTtl": 10
  }
}
```

## Integration Examples

### HTML Video Element

```html
<!-- Basic video with transformation -->
<video
  src="https://example.com/videos/sample.mp4?width=640&height=360&quality=medium"
  controls>
</video>

<!-- Advanced video with playback controls -->
<video
  src="https://example.com/videos/sample.mp4?width=854&height=480&quality=high&compression=low"
  controls
  preload="metadata"
  poster="https://example.com/videos/sample.mp4?mode=frame&time=0s&width=854&height=480">
</video>

<!-- Mobile-optimized video with autoplay -->
<video
  src="https://example.com/videos/sample.mp4?derivative=mobile"
  autoplay
  muted
  loop
  playsinline>
</video>
```

### React Component Example

```jsx
function ResponsiveVideo({ src, aspectRatio = "16:9" }) {
  // Determine best quality based on screen size
  const getQuality = () => {
    if (window.innerWidth <= 640) return "low";
    if (window.innerWidth <= 1280) return "medium";
    return "high";
  };

  // Calculate dimensions based on aspect ratio
  const dimensions = () => {
    if (aspectRatio === "16:9") {
      return { width: 640, height: 360 };
    } else if (aspectRatio === "4:3") {
      return { width: 640, height: 480 };
    }
    return { width: 640, height: 360 };
  };

  // Build video URL with parameters
  const videoUrl = () => {
    const { width, height } = dimensions();
    return `${src}?width=${width}&height=${height}&quality=${getQuality()}&fit=contain`;
  };

  return (
    <video
      src={videoUrl()}
      controls
      preload="metadata"
      className="responsive-video"
      poster={`${src}?mode=frame&time=0s&width=${dimensions().width}&height=${dimensions().height}`}
    />
  );
}
```

## Graceful Error Handling with Fallback

The video-resizer implements a configurable fallback mechanism that returns the original, untransformed content when a transformation fails with a 400 Bad Request error. This provides graceful degradation and ensures users always get content, even if the optimal transformation isn't possible.

### Intelligent Auto-Adjustment

When video transformations fail due to parameter limits (like duration), the system automatically adjusts parameters and retries the transformation:

1. For duration limits: When a duration exceeds the maximum allowed (approximately 46 seconds), the system automatically:
   - Detects the specific duration limit error from Cloudflare's API response
   - Extracts the exact minimum and maximum duration limits from the error message
   - Stores these discovered limits for future validation
   - Adjusts the duration to the integer floor of the maximum value (e.g., 46s from 46.066933s)
   - Retries the transformation with the adjusted value
   - Adds headers to indicate the adjustment was applied
   
For example, if you request a duration of "100s" but Cloudflare's API only supports up to ~46s:
1. The initial request fails with a specific duration limit error
2. The system extracts the exact limit from the error (e.g., "duration: attribute must be between 100ms and 46.066933s")
3. The system adjusts the duration to "46s" (the integer floor of the maximum value)
4. The transformation is retried with the adjusted duration
5. If successful, the response includes headers showing the adjustment:
   ```
   X-Duration-Adjusted: true
   X-Original-Duration: 100s
   X-Adjusted-Duration: 46s
   X-Duration-Limit-Applied: true
   ```

This ensures you get successfully transformed content even when parameters exceed limits, rather than falling back to the original content. The system is also self-learning, storing discovered limits for future use.

### Fallback Configuration

The fallback mechanism can be configured in your environment settings:

```jsonc
"caching": {
  "method": "cacheApi",
  "debug": false,
  "fallback": {
    "enabled": true,               // Enable/disable the fallback mechanism
    "badRequestOnly": true,        // Only apply fallback for 400 errors
    "preserveHeaders": [           // Headers to preserve from original response
      "Content-Type", 
      "Content-Length", 
      "Content-Range", 
      "Accept-Ranges"
    ]
  }
}
```

### How Auto-Adjustment and Fallback Work

1. When a transformation error occurs, the system analyzes the error type
2. For duration limit errors, it:
   - Adjusts the duration to the integer floor of the maximum allowed value
   - Retries the transformation with the adjusted value
   - Adds headers indicating the adjustment:
     - `X-Duration-Adjusted: true`
     - `X-Original-Duration: [original value]`
     - `X-Adjusted-Duration: [new value]`
     - `X-Duration-Limit-Applied: true`
3. For other 400 errors (or if retry fails), the fallback mechanism activates:
   - The worker fetches the original, untransformed content directly from the origin
   - Specified headers from the original response are preserved
   - Custom headers are added to indicate fallback was applied:
     - `X-Fallback-Applied: true`
     - `X-Fallback-Reason: [specific error message]`
     - `X-Original-Error-Type: [error type]`
     - `X-Original-Status-Code: [status code]`
     - `X-Error-Type: [specific error category]` (e.g., 'duration_limit', 'file_size_limit')
     - `X-Invalid-Parameter: [parameter name]` (which parameter failed validation)
4. The response (adjusted or original) is returned to the client

This approach ensures users always get the best possible response, with either automatically adjusted parameters or original content as a last resort.

### Common Fallback Scenarios

- Width/height values outside the supported 10-2000px range
- Time parameter outside the supported 0-30s range
- Unsupported format requested
- Invalid combination of parameters
- Features requested that aren't available in the underlying Cloudflare API

### Debugging Fallback

When debugging is enabled, the fallback information is included in debug headers and the debug view. You can see when fallback was applied and why, helping you optimize your transformation parameters.

## Architecture

The project follows domain-driven design with command pattern and service-oriented architecture for maintainability:

### Service Architecture

The system uses a layered architecture with the following components:

```mermaid
%%{init: {'theme': 'dark', 'themeVariables': { 'primaryColor': '#5D8AA8', 'primaryTextColor': '#fff', 'primaryBorderColor': '#5D8AA8', 'lineColor': '#F8B229', 'secondaryColor': '#006400', 'tertiaryColor': '#3E3E3E' }}}%%
flowchart TD
    A[VideoHandler] --> B[VideoOptionsService]
    B --> C[TransformVideoCommand]
    D[VideoTransformationService] --> C
    C --> E[CacheManagementService]
    C --> F[DebugService]
    
    subgraph Configuration Layer
        G[VideoConfiguration]
        H[CacheConfiguration]
        I[DebugConfiguration]
        J[LoggingConfiguration]
        K[EnvironmentConfig]
    end
    
    C -.-> G
    C -.-> H
    C -.-> I
    E -.-> H
    F -.-> I
    
    style A fill:#5D8AA8,stroke:#333,stroke-width:2px
    style B fill:#5D8AA8,stroke:#333,stroke-width:2px
    style C fill:#006400,stroke:#333,stroke-width:2px
    style D fill:#5D8AA8,stroke:#333,stroke-width:2px
    style E fill:#7B68EE,stroke:#333,stroke-width:2px
    style F fill:#7B68EE,stroke:#333,stroke-width:2px
    style Configuration fill:#3E3E3E,stroke:#333,stroke-width:1px
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

## Recent Enhancements

### 1. Multi-Source Storage System
- Added support for fetching videos from multiple storage sources
- Implemented R2 bucket integration for cloud-native storage
- Added remote URL support with authentication options
- Created fallback URL system for high-availability
- Path transformations for different storage sources
- Priority-based storage resolution for optimal performance

### 2. Authentication and Origins
- Added authentication support for remote video sources
- Implemented multiple auth methods (header, bearer, AWS S3)
- Configurable security levels and cache TTLs for auth
- Origin authorization support with customizable headers
- Added auth origins with proper security handling

### 3. Enhanced Debug Interface
- Added a pretty-printed JSON viewer with copy and expand/collapse functionality
- Added media preview section showing the actual transformed video or image
- Integrated Prism.js for syntax highlighting of JSON data
- Improved layout with proper responsive design
- Added controls to view and copy the full diagnostic information
- Improved display of video transformation parameters
- Added browser capabilities section showing supported formats and features
- Enhanced CSS styling for the media preview and JSON viewer

### 4. Client Adaptivity Improvements
- Enhanced device detection with more accurate device categorization
- Improved network quality estimation for better adaptive streaming
- Added content negotiation based on Accept headers
- Enhanced responsive dimension adjustments based on device characteristics

### 5. Service Architecture Restructuring
- Implemented proper service-oriented architecture
- Resolved circular dependency issues through dynamic imports
- Improved type safety throughout the codebase
- Enhanced error handling with proper propagation

### 6. Cache Management Upgrades
- Improved cache tag structure for more granular purging
- Enhanced TTL controls based on response type
- Added automatic cache invalidation for debug requests
- Implemented cache bypass mechanisms for development

### 7. Error Handling Improvements
- Added fallback mechanism to return original content when transformations fail
- Configurable fallback behavior for specific error types
- Graceful degradation with original content when transformations encounter 400 errors
- Detailed error logging and debugging for fallback scenarios
- Preserved headers option for maintaining important response metadata
- Smart error detection with specific, detailed error headers based on the actual error type
- Automatic extraction of API limitations from error messages (duration limits, file size limits)
- Improved error headers with specific information about validation failures
- Self-learning system that tracks discovered API limitations for future validation
- Intelligent duration auto-adjustment that retries with adjusted values when limits are exceeded
- Transparent parameter adjustment with detailed headers explaining what was changed

### 8. Logging Standardization
- Implemented consistent logging pattern across all components
- Replaced all direct console.* calls with structured logging
- Enhanced breadcrumb tracking for improved request tracing
- Added context-aware logging with proper fallbacks
- Improved error reporting with standardized error and stack trace handling
- Centralized logging configuration for unified control
- Added structured data objects instead of string concatenation for better analysis
- Enhanced debugging capabilities with consistent log format

## Limitations & Compatibility Notes

### Technical Limitations

- **Input Size**: Videos must be less than 40MB (Cloudflare limit)
- **Dimensions**: Maximum width/height is 2000px
- **Time Parameter**: Limited to 0-30s range (documented Cloudflare API limitation)
- **Video Processing**: Some users report videos longer than ~30 seconds may be truncated, though this is not explicitly documented
- **Processing Time**: First-time transformations may take longer
- **Browser Compatibility**: Some parameters (autoplay, preload) have browser-specific behavior

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

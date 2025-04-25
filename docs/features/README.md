# Video Resizer Features

This document provides a comprehensive overview of the features available in the Video Resizer service, organized by category for easy reference.

## Core Transformation Features

The video-resizer provides three primary transformation modes, each designed for specific use cases:

| Feature | Description | Documentation |
|---------|-------------|---------------|
| **Video Mode** | Transform, resize, and optimize video files with playback controls | [Video Mode Documentation](./video-mode.md) |
| **Frame Extraction** | Extract still images from specific timestamps in videos | [Frame Mode Documentation](./frame/README.md) |
| **Spritesheet Generation** | Create grids of thumbnails showing video progression | [Spritesheet Mode Documentation](./spritesheet/README.md) |

For a comprehensive comparison of these modes, see the [Transformation Modes Overview](./transformation-modes.md).

## Compatibility & Integration

| Feature | Description | Status | Documentation |
|---------|-------------|--------|---------------|
| **Akamai Integration** | Translation of Akamai-style parameters to Cloudflare format | ✅ Production | [Akamai Integration](./akamai/README.md) |
| **IMQuery Support** | Support for responsive image query parameters with dimension mapping | ✅ Production | [IMQuery Documentation](./imquery/README.md) |
| **Client Detection** | Device capability detection for adaptive video delivery | ✅ Production | [Client Detection](./client-detection/README.md) |

## Performance Features

| Feature | Description | Documentation |
|---------|-------------|---------------|
| **Responsive Sizing** | Automatic adaptation to device screen dimensions | [Video Mode: Responsive Behavior](./video-mode.md#responsive-behavior) |
| **Derivatives** | Preset optimization configurations for common use cases | [Video Mode: Derivatives](./video-mode.md#video-derivatives) |
| **Compression Controls** | Fine-grained control over video compression levels | [Parameter Compatibility](../configuration/parameter-compatibility.md) |
| **Cache Management** | Multi-layered caching with KV storage for variants | [KV Caching System](../kv-caching/README.md) |

## Developer Experience 

| Feature | Description | Documentation |
|---------|-------------|---------------|
| **Debug UI** | Interactive interface for debugging transformations | [Debug UI Documentation](./debug-ui/README.md) |
| **Debug Headers** | Diagnostic HTTP headers with transformation details | [Debug Headers](./debug-ui/DEBUG_HEADERS.md) |
| **Debug View Mode** | HTML visualization of transformation process | [Debug View Mode](./debug-ui/DEBUG_VIEW_MODE.md) |
| **Logging System** | Structured logging with configurable levels | [Logging System](./logging/README.md) |

## Feature Compatibility Matrix

This matrix shows which features can be used with each transformation mode:

| Feature | Video Mode | Frame Mode | Spritesheet Mode |
|---------|------------|------------|------------------|
| **Loop/Autoplay** | ✅ | ❌ | ❌ |
| **Quality Settings** | ✅ | ✅ | ❌ |
| **Format Selection** | ✅ | ✅ | ❌ (JPEG only) |
| **Compression** | ✅ | ✅ | ❌ |
| **Responsive Sizing** | ✅ | ✅ | ✅ |
| **IMQuery** | ✅ | ✅ | ❌ |
| **Client Detection** | ✅ | ✅ | ❌ |
| **KV Caching** | ✅ | ✅ | ✅ |
| **Akamai Compatibility** | ✅ | ✅ | ❌ |
| **Debug UI Support** | ✅ | ✅ | ✅ |
| **Derivatives** | ✅ | ✅ | ❌ |

## Feature Documentation

### Transformation Modes
- [Transformation Modes Overview](./transformation-modes.md) - Comprehensive comparison of all modes
- [Video Mode Documentation](./video-mode.md) - Standard video transformation
- [Frame Extraction Documentation](./frame/README.md) - Still image extraction
- [Spritesheet Generation Documentation](./spritesheet/README.md) - Thumbnail grid creation

### Integration Features
- [Akamai Integration](./akamai/README.md) - Akamai-compatible URL and parameter translation
- [IMQuery Support](./imquery/README.md) - Responsive image parameter support
- [Client Detection](./client-detection/README.md) - Device capability detection

### Developer Tools
- [Debug UI Overview](./debug-ui/README.md) - Debugging interface documentation
- [Debug Headers](./debug-ui/DEBUG_HEADERS.md) - HTTP header diagnostics
- [Debug View Mode](./debug-ui/DEBUG_VIEW_MODE.md) - HTML visualization
- [Logging Configuration](./logging/README.md) - Logging system documentation

## Recent Feature Updates

| Feature | Update | Date | Status |
|---------|--------|------|--------|
| **Video Playback** | Added loop parameter support | April 2025 | ✅ Production |
| **KV Caching** | Implemented cache versioning system | April 2025 | ✅ Production |
| **Storage Configuration** | Fixed storage integration in ConfigManager | April 2025 | ✅ Production |
| **Debug UI** | Enhanced diagnostics with version information | April 2025 | ✅ Production |

## Implementation Details

For technical implementation details about these features, see the [Architecture Documentation](../architecture/ARCHITECTURE_OVERVIEW.md) and [Transformation Strategies](../architecture/TRANSFORMATION_STRATEGIES.md).

## Last Updated

*April 25, 2025*
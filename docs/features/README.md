# Video Resizer Features

*Last Updated: May 1, 2025*

This section provides comprehensive documentation on the features available in the Video Resizer service.

## Core Transformation Features

- [Video Mode](./video-mode.md) - Complete video transformation
- [Frame Mode](./frame-mode.md) - Single frame extraction
- [Spritesheet Mode](./spritesheet-mode.md) - Thumbnail grid generation
- [Transformation Modes Overview](./transformation-modes.md) - Comparison of all modes

## Integration Features

- [IMQuery Integration](./imquery.md) - Responsive transformation
- [Client Detection](./client-detection.md) - Device capability detection
- [Range Request Support](./range-request-support.md) - Video seeking and streaming

## Developer Experience

- [Debug UI](./debug-ui.md) - Debugging interface
- [Logging System](./logging.md) - Logging configuration

## Feature Compatibility Matrix

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
| **Debug UI Support** | ✅ | ✅ | ✅ |
| **Derivatives** | ✅ | ✅ | ❌ |
| **Range Requests** | ✅ | ❌ | ❌ |

See the specific feature documentation for detailed information on usage and configuration.
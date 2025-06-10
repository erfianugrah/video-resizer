# Video Resizer Features

*Last Updated: May 15, 2025*

This section provides comprehensive documentation on the features available in the Video Resizer service.

## Core Transformation Features

- [Video Mode](./video-mode.md) - Complete video transformation
- [Frame Mode](./frame-mode.md) - Single frame extraction
- [Spritesheet Mode](./spritesheet-mode.md) - Thumbnail grid generation

## Integration Features

- [IMQuery Integration](./imquery.md) - Responsive transformation
- [Client Detection](./client-detection.md) - Device capability detection
- [Range Request Support](./range-request-support.md) - Video seeking and streaming

## Storage and Caching

- [KV Chunking](./kv-chunking.md) - Large video storage in KV
- [Non-Blocking KV Operations](../caching/performance-optimizations.md) - Performance optimizations

## Architecture Improvements

- [Service Separation Pattern](../architecture/service-separation.md) - Modular service architecture
- [Origins System](../architecture/origins-system.md) - Origins-based architecture
- [Multi-Origin Fallback](../architecture/multi-origin-fallback.md) - Consolidated failover architecture
- [404 Retry Mechanism](./404-retry-mechanism.md) - Clean 404 handling from transformation proxy
- [Error Handling](../error-handling/implementation.md) - Robust error handling

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
| **KV Chunking** | ✅ | ❌ | ❌ |
| **Debug UI Support** | ✅ | ✅ | ✅ |
| **Derivatives** | ✅ | ✅ | ❌ |
| **Range Requests** | ✅ | ❌ | ❌ |
| **Non-Blocking Cache** | ✅ | ✅ | ✅ |
| **Multi-Origin Fallback** | ✅ | ✅ | ✅ |

See the specific feature documentation for detailed information on usage and configuration.
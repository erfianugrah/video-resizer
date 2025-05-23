# Video Resizer Documentation

*Last Updated: January 21, 2025*

Welcome to the Video Resizer documentation. This comprehensive guide provides detailed information about the video-resizer project, its architecture, configuration, features, and usage.

## Documentation Structure

Our documentation is organized into two main sections:

### User Documentation

Documentation for users of the video-resizer system:

- [**Guides**](./guides/README.md) - Step-by-step tutorials and practical guides
  - [Quickstart Guide](./guides/quickstart.md)
  - [Configuration Guide](./guides/configuration.md)
  - [Troubleshooting Guide](./guides/troubleshooting.md)
  - [Performance Tuning Guide](./guides/performance-tuning.md)

- [**Features**](./features/README.md) - Detailed feature documentation
  - [Video Mode](./features/video-mode.md)
  - [Frame Mode](./features/frame-mode.md)
  - [Spritesheet Mode](./features/spritesheet-mode.md)
  - [Range Request Support](./features/range-request-support.md)
  - [Client Detection](./features/client-detection.md)
  - [Origins System](./architecture/origins-system.md)
  - [Multi-Origin Fallback](./architecture/multi-origin-fallback.md)
  - [Debug UI](./features/debug-ui.md)
  - [IMQuery Support](./features/imquery.md)

- [**Reference**](./reference/README.md) - Reference documentation
  - [API Reference](./reference/api-reference.md)
  - [Configuration Schema](./reference/configuration-schema.md)
  - [Glossary](./reference/glossary.md)

### Technical Documentation

Documentation for developers working on the video-resizer codebase:

- [**Architecture**](./architecture/README.md) - System design and components
  - [Architecture Overview](./architecture/architecture-overview.md)
  - [Design Patterns](./architecture/design-patterns.md)
  - [Service Separation](./architecture/service-separation.md)
  - [Origins System](./architecture/origins-system.md)
  - [Origins Migration](./architecture/origins-migration.md)
  - [Multi-Origin Fallback](./architecture/multi-origin-fallback.md)

- [**Caching System**](./caching/README.md) - Caching implementation details
  - [Caching Architecture](./caching/caching-architecture.md)
  - [KV Implementation](./caching/kv-implementation.md)
  - [KV Chunking Implementation](./caching/kv-chunking-implementation.md)
  - [TTL Configuration](./caching/ttl-configuration.md)
  - [TTL Refresh](./caching/ttl-refresh.md)
  - [Cache Versioning](./caching/versioning.md)
  - [Performance Optimizations](./caching/performance-optimizations.md)

- [**Advanced Features**](./features/README.md) - Technical implementation details
  - [Background Fallback Caching](./features/background-fallback-caching.md)
  - [Large Fallback Chunking](./features/large-fallback-chunking.md)
  - [Large File Streaming](./features/large-file-streaming.md)
  - [Request Coalescing](./features/request-coalescing.md)
  - [KV Chunking](./features/kv-chunking.md)
  - [Logging System](./features/logging.md)

- [**Error Handling**](./error-handling/README.md) - Error handling patterns
  - [Error Types](./error-handling/error-types.md)
  - [Implementation](./error-handling/implementation.md)
  - [Transformation Error Handling](./error-handling/transformation-error-handling.md)

- [**Configuration**](./configuration/README.md) - Configuration system details
  - [Config Management](./configuration/config-management.md)
  - [Path Patterns](./configuration/path-patterns.md)
  - [Origins Configuration](./configuration/origins-configuration.md)

- [**Deployment**](./deployment/README.md) - Deployment instructions

## Overview

The Video Resizer is a Cloudflare Worker for transforming and resizing video content on the edge. It provides:

- Video transformation and optimization
- Multiple transformation strategies (video, frame, spritesheet)
- Advanced caching with KV store integration and chunking for large videos
- Enhanced range request support for seeking and streaming
- Client-aware responsive transformations
- Multi-origin fallback for better resilience
- Automatic device and bandwidth detection
- Debug UI for monitoring and troubleshooting
- Modular architecture with separated service components

## Getting Started

New to the Video Resizer? Start here:

1. Read the [Quickstart Guide](./guides/quickstart.md) to set up your environment
2. Explore the [Feature Documentation](./features/README.md) to understand capabilities
3. Review the [Configuration Guide](./guides/configuration.md) to configure the system
4. Check the [Architecture Overview](./architecture/README.md) to understand the design

## Recent Updates

| Date | Update |
|------|--------|
| January 21, 2025 | Fixed chunk size mismatch errors with concurrency-safe chunk locking |
| January 21, 2025 | Added chunk size tolerance for high-concurrency scenarios |
| May 15, 2025 | Added Multi-Origin Fallback for improved resilience |
| May 15, 2025 | Reorganized documentation structure for better usability |
| May 10, 2025 | Added KV Chunking implementation for large videos |
| May 10, 2025 | Added Service Separation Pattern documentation |
| May 10, 2025 | Added Non-blocking cache version writes |
| May 10, 2025 | Added Performance Optimizations documentation |
| May 1, 2025 | Completed reference documentation (API reference, configuration schema) |
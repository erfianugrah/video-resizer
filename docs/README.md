# Video Resizer Documentation

_Last Updated: February 18, 2026_

Welcome to the Video Resizer documentation. This comprehensive guide provides detailed information about the video-resizer project, its architecture, configuration, features, and usage.

## Documentation Structure

The docs are organized into two main sections:

### User Documentation

Documentation for users of the video-resizer system:

- [**Guides**](./guides/README.md)
  - [Quickstart](./guides/quickstart.md)
  - [Configuration](./guides/configuration.md)
  - [Troubleshooting](./guides/troubleshooting.md)
  - [Performance Tuning](./guides/performance-tuning.md)

- [**Features**](./features/README.md)
  - [Video Mode](./features/video-mode.md)
  - [Frame Mode](./features/frame-mode.md)
  - [Spritesheet Mode](./features/spritesheet-mode.md)
  - [Audio Mode](./features/audio-mode.md)
  - [Range Request Support](./features/range-request-support.md)
  - [Client Detection](./features/client-detection.md)
  - [Origins System](./architecture/origins-system.md)
  - [Multi-Origin Fallback](./architecture/multi-origin-fallback.md)
  - [Debug UI](./features/debug-ui.md)
  - [IMQuery Support](./features/imquery.md)

- [**Reference**](./reference/README.md)
  - [API Reference](./reference/api-reference.md)
  - [Configuration Schema](./reference/configuration-schema.md)
  - [Glossary](./reference/glossary.md)

### Technical Documentation

Documentation for developers working on the codebase:

- [**Architecture**](./architecture/README.md)
  - [Architecture Overview](./architecture/architecture-overview.md)
  - [Design Patterns](./architecture/design-patterns.md)
  - [Service Separation](./architecture/service-separation.md)
  - [Origins System](./architecture/origins-system.md)
  - [Multi-Origin Fallback](./architecture/multi-origin-fallback.md)
  - [Logging Architecture](./architecture/logging/README.md)

- [**Caching System**](./caching/README.md)
  - [Caching Architecture](./caching/caching-architecture.md)
  - [KV Implementation](./caching/kv-implementation.md)
  - [TTL Configuration](./caching/ttl-configuration.md)
  - [TTL Refresh](./caching/ttl-refresh.md)
  - [Cache Versioning](./caching/versioning.md)
  - [Performance Optimizations](./caching/performance-optimizations.md)

- [**Advanced Features**](./features/README.md)
  - [Background Fallback Caching](./features/background-fallback-caching.md)
  - [Large Fallback Chunking](./features/large-fallback-chunking.md)
  - [Large File Streaming](./features/large-file-streaming.md)
  - [Request Coalescing](./features/request-coalescing.md)
  - [KV Chunking](./features/kv-chunking.md)
  - [Logging System](./features/logging.md)

- [**Error Handling**](./error-handling/README.md)
  - [Error Types](./error-handling/error-types.md)
  - [Implementation](./error-handling/implementation.md)
  - [Transformation Error Handling](./error-handling/transformation-error-handling.md)

- [**Configuration**](./configuration/README.md)
  - [Config Management](./configuration/config-management.md)
  - [Path Patterns](./configuration/path-patterns.md)
  - [Origins Configuration](./configuration/origins-configuration.md)

- [**Deployment**](./deployment/README.md)

## Overview

The Video Resizer is a Cloudflare Worker for transforming and resizing video content on the edge. It provides:

- Video, frame, spritesheet, and audio transformations via Cloudflare Media endpoints
- KV-backed caching with chunking for large objects (5 MiB chunks; 20 MiB single-entry threshold)
- Range request handling that reconstructs responses from KV chunks
- Origins-based storage resolution with multi-origin fallback and optional legacy path patterns
- Request coalescing to collapse duplicate fetches
- Debug UI and rich diagnostics breadcrumbs
- Modular services for storage, transformation, configuration, and logging

## Getting Started

New to the Video Resizer? Start here:

1. Read the [Quickstart Guide](./guides/quickstart.md) to set up your environment
2. Explore the [Feature Documentation](./features/README.md) to understand capabilities
3. Review the [Configuration Guide](./guides/configuration.md) to configure the system
4. Check the [Architecture Overview](./architecture/README.md) to understand the design

## Recent Updates

| Date              | Update                                                                                         |
| ----------------- | ---------------------------------------------------------------------------------------------- |
| February 18, 2026 | Phase 6-8 refactoring: unified logging, decomposed god classes, CF error codes, static imports |
| December 9, 2025  | Cleaned and aligned docs with current code (KV-only caching, origin system)                    |
| May 15, 2025      | Multi-origin fallback enabled by default in `worker-config.json`                               |
| January 21, 2025  | Chunk locking added to prevent KV chunk size mismatches                                        |

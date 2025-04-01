# Video Resizer Documentation

Welcome to the Video Resizer documentation. This document serves as a central hub for all the documentation related to the Video Resizer project.

## Core Documentation

- **[Configuration Guide](./configuration/README.md)**: Overview of the configuration system
  - [Video Configuration](./configuration/video-configuration.md)
  - [Cache Configuration](./configuration/cache-configuration.md)
  - [Debug Configuration](./configuration/debug-configuration.md)
  - [Configuration Loading](./configuration/configuration-loading.md)
  - [Dynamic Configuration](./configuration/dynamic-configuration.md)
  - [Path Pattern Troubleshooting](./configuration/path-pattern-troubleshooting.md)
  - [Updating Configuration](./configuration/updating-configuration.md)

- **[Deployment Guide](./deployment/README.md)**: How to deploy Video Resizer to Cloudflare Workers
  - [Authentication Setup](./deployment/auth-setup.md)

- **[KV Caching System](./kv-caching/README.md)**: Documentation on the KV caching implementation
  - [Implementation Details](./kv-caching/implementation.md)
  - [Configuration Guide](./kv-caching/configuration.md)
  - [Testing Guide](./kv-caching/testing.md)
  - [Performance Considerations](./kv-caching/performance.md)

- **[Storage System](./storage/README.md)**: Documentation on storage backends and origins
  - [Origin Consolidation](./storage/origin-consolidation.md)

## Features Documentation

- **[Features Overview](./features/README.md)**: Documentation for specific features
  - **Akamai Integration**: Compatibility with Akamai image format
  - **Client Detection**: Improved client device and capability detection
  - **Debug UI**: Debugging interface for troubleshooting
  - **IMQuery Support**: Support for IMQuery responsive image parameters
  - **Logging**: Advanced logging and monitoring capabilities

## Architecture Documentation

- **[Architecture Patterns](./architecture/ARCHITECTURE_PATTERNS.md)**: Architectural patterns used in the project
- **[Refactoring Guide](./architecture/REFACTORING.md)**: Notes on refactoring approaches
- **[Unified Origins Migration](./architecture/MIGRATING_TO_UNIFIED_ORIGINS.md)**: Guide to migrating to unified origins

## Additional Resources

- **[Archive](./archive/)**: Older or superseded documentation kept for reference
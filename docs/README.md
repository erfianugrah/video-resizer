# Video Resizer Documentation

*Last Updated: May 1, 2025* (All documentation sections completed)

Welcome to the Video Resizer documentation. This comprehensive guide provides detailed information about the video-resizer project, its architecture, configuration, features, and usage.

## Quick Links

- [Architecture Overview](./architecture/README.md) - System design and components
- [Configuration Guide](./configuration/README.md) - Configuration options and setup
- [Feature Documentation](./features/README.md) - Available features and capabilities
- [Caching System](./caching/README.md) - Caching implementation details
- [Deployment Guide](./deployment/README.md) - Deployment instructions
- [Error Handling](./error-handling/README.md) - Error handling patterns
- [Guides](./guides/README.md) - Practical guides and tutorials
- [Reference](./reference/README.md) - Reference documentation and glossary

## Overview

The Video Resizer is a Cloudflare Worker for transforming and resizing video content on the edge. It provides:

- Video transformation and optimization
- Multiple transformation strategies (video, frame, spritesheet)
- Caching with KV store integration
- Enhanced range request support for seeking and streaming
- Client-aware responsive transformations
- Automatic device and bandwidth detection
- Debug UI for monitoring and troubleshooting

## Getting Started

New to the Video Resizer? Start here:

1. Read the [Quickstart Guide](./guides/quickstart.md) to set up your environment
2. Explore the [Feature Documentation](./features/README.md) to understand capabilities
3. Review the [Configuration Guide](./configuration/README.md) to configure the system
4. Check the [Architecture Overview](./architecture/README.md) to understand the design

## Recent Updates

| Date | Update |
|------|--------|
| May 1, 2025 | Completed reference documentation (API reference, configuration schema) |
| May 1, 2025 | Completed all practical guides (configuration, troubleshooting, performance-tuning) |
| May 1, 2025 | Completed core technical documentation (architecture, caching, error handling) |
| May 1, 2025 | Added comprehensive error handling documentation |
| May 1, 2025 | Added detailed cache versioning documentation |
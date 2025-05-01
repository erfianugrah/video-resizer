# Video Resizer Caching System

*Last Updated: May 1, 2025*

This section provides comprehensive documentation on the caching system used in the Video Resizer.

## Core Caching Documents

- [Caching Architecture](./caching-architecture.md) - Overview of the caching system
- [KV Implementation](./kv-implementation.md) - KV cache implementation details
- [Cache API](./cache-api.md) - Cache API implementation details
- [Versioning](./versioning.md) - Cache versioning system

## Caching Overview

The video-resizer implements a multi-level caching strategy to optimize performance and reduce costs:

1. **Cloudflare Cache API** (Edge Cache): First level of cache, checked for all requests
2. **KV Storage Cache** (Global Persistent Cache): Second level cache, checked on Cloudflare cache misses
3. **Origin + Transformation**: Only executed if both caches miss

Key caching features include:

- **TTL Management**: Different TTLs based on response status
- **Cache Versioning**: Version-based cache invalidation
- **Range Request Support**: Efficient video seeking
- **Cache Tags**: Grouped cache invalidation
- **Bypass Mechanisms**: For debugging and special cases

See the [Caching Architecture](./caching-architecture.md) document for a comprehensive overview of the caching system.
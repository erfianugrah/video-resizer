# Video Resizer Caching System

*Last Updated: December 9, 2025*

This section documents the current caching behaviour (KV-only).

## Core Caching Documents

- [Caching Architecture](./caching-architecture.md) – overall flow
- [KV Implementation](./kv-implementation.md) – storage, chunking, manifests
- [Cache API](./cache-api.md) – current no-op state and range helpers
- [Versioning](./versioning.md) – cache-key version metadata
- [Performance Optimizations](./performance-optimizations.md)

## Caching Overview

- **KV Storage Cache** (global, persistent): primary cache for all variants. Uses 20 MiB single-entry limit and 5 MiB chunking, with background writes via `waitUntil`.
- **Origin + Transformation**: executed on KV misses; request coalescing prevents duplicate origin fetches.
- **Range Support**: handled directly from KV via chunk manifests.
- **Cache Tags**: short `vp-*` tags applied to manifests and chunks to allow tag-based purging.
- **Bypass Controls**: `nocache`, `bypass`, or `debug` query params skip KV.

See the [Caching Architecture](./caching-architecture.md) document for the end-to-end flow.

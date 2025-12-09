# Caching Architecture

*Last Updated: December 9, 2025*

## Overview

Caching is KV-first. Cache API storage is disabled; its helpers remain only for range handling and compatibility. The flow is:

1. **KV lookup** (manifest + chunks or single entry).
2. **Origin fetch + transform** (coalesced) on KV miss.
3. **Background KV store** with retries via `waitUntil`.
4. **Serve response** with range support; KV chunks are used on subsequent requests.

```mermaid
flowchart TD
    A[Client Request] --> B{KV hit?}
    B -->|Yes| C[Return from KV]
    B -->|No| D[Single origin fetch (coalesced)]
    D --> E[Transform + build response]
    E --> F[Return to client]
    E --> G[Background KV store (waitUntil)]
```

## Key pieces
- **Key generation**: `{mode}:{path}:derivative=...` (fallback to params). See `services/kvStorage/keyUtils.ts`.
- **Chunking**: 20 MiB single-entry limit; 5 MiB chunks with manifest and chunk locks.
- **Versioning**: `CacheVersionService` stores version metadata alongside keys.
- **TTL & tags**: TTLs from `CacheConfigurationManager`; `vp-*` cache tags attached to manifests and chunks.
- **Range handling**: `streamingHelpers` fetches only needed chunks; unsatisfiable ranges return full content instead of 416.

## Cache bypass
Requests with `nocache`, `bypass`, or `debug` query parameters skip KV entirely. Debug mode adds breadcrumbs (`X-Breadcrumbs-*`) showing cache decisions.

## What is not used
- **Cloudflare Cache API storage**: intentionally disabled; `cacheRetrievalUtils` returns `null` to force KV.
- **Browser cache control tuning**: left to application defaults; adjust in `cacheHeaderUtils` if required.

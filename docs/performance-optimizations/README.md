# Performance Optimizations

*Last Updated: December 9, 2025*

This page summarizes the performance features that are actually implemented in the current codebase. The detailed “working notes” documents were removed because they were outdated.

## What’s implemented today

- **Request coalescing** (`src/utils/cacheOrchestrator.ts`): identical GETs share a single origin fetch with reference counting and retry-aware background KV writes.
- **KV chunk locking** (`src/services/kvStorage/chunkLockManager.ts`): prevents concurrent writes from producing mismatched chunk sizes.
- **Streaming KV writes for large fallbacks** (`src/services/videoStorage/fallbackStorage.ts`): streams data into 10 MB chunks with a hard 128 MB skip threshold for KV storage.
- **Chunked retrieval with range support** (`src/services/kvStorage/getVideo.ts`, `streamingHelpers.ts`): reconstructs responses from 5 MiB chunks and handles range requests, including recovery for unsatisfiable ranges.
- **TTL refresh + non‑blocking writes** (`src/utils/kvTtlRefreshUtils.ts`, `src/utils/cacheOrchestrator.ts`): uses `waitUntil` to refresh TTLs and store versions without blocking responses.
- **Bounded concurrency** (`src/utils/cacheOrchestrator.ts`, `src/services/kvStorage/streamStorage.ts`): limits parallel origin fetches and KV uploads to avoid memory spikes.

## Operational checks

- Monitor KV error logs for chunk size mismatches (should be rare due to locking).
- Watch `inFlightOriginFetches` size in debug logs when load-testing coalescing.
- Track `X-Breadcrumbs-*` headers in debug mode to see cache and range handling decisions.

## When to revisit

- If we re-enable Cache API storage (currently disabled), update `docs/caching/cache-api.md`.
- If chunk size limits change (currently 20 MiB single entry / 5 MiB chunks / 128 MB fallback cap), update this page and the caching docs.

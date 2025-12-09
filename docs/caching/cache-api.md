# Cache API (Current State)

*Last Updated: December 9, 2025*

Cache API storage is **disabled**. All persistent caching uses KV (with chunking for large objects). The Cache API helpers remain only for compatibility and range handling.

## Key components
- `src/utils/cacheRetrievalUtils.ts` – always returns `null` to force KV lookups; logs breadcrumbs like “Cache API not used - using KV only”.
- `src/utils/cacheResponseUtils.ts` – prepares responses for range handling but does not write to Cache API.
- `src/utils/cacheStorageUtils.ts` – header sanitation/normalization used by the KV path.
- `src/services/cacheManagementService.ts` – re-exports the helpers above to keep imports stable.

## Current caching flow
1. KV lookup (manifest + chunks or single entry).
2. On miss: single origin fetch (coalesced) -> response returned to client.
3. Background KV store via `waitUntil` (5 MiB chunks above 20 MiB).
4. Range requests served from KV chunks.

## Range behaviour
- `cacheResponse` adds `Accept-Ranges: bytes` when needed and slices bodies if an origin ignores the Range header.
- Existing 206 responses pass through untouched.

## Debugging
- Enable `?debug` (or `DEBUG_ENABLED`) to see breadcrumbs indicating Cache API was bypassed.
- `X-Breadcrumbs-*` headers expose cache and range decisions.

## If Cache API storage returns
- Re-enable lookup/store in `cacheRetrievalUtils`/`cacheResponseUtils` and update this page with the new flow and key formats.

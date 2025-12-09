# Caching Performance Optimizations

*Last Updated: December 9, 2025*

This page lists the optimizations that are **implemented** in the current codebase. Older working notes were removed to avoid drift.

## Non-blocking KV writes
- Cache version writes and transformed-video storage run via `waitUntil` when available (`cacheOrchestrator`).
- Storage retries up to 3 times with fresh clones to avoid body reuse errors.
- Falls back to synchronous writes when no execution context is present (tests).

```typescript
// cacheOrchestrator.ts (waitUntil retry)
ctx.waitUntil((async () => {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const clone = attempt === 1 ? responseForKV : responseForClient.clone();
    const ok = await storeInKVCache(env, sourcePath, clone, optionsWithIMQuery);
    if (ok) break;
  }
})());
```

## KV read caching
- KV reads use `cacheTtl: 3600` seconds (`DEFAULT_KV_READ_CACHE_TTL`) to let Cloudflare edge-cache KV responses and reduce namespace traffic.

## TTL refresh
- `kvTtlRefreshUtils` refreshes TTLs in the background when entries are near expiry, triggered for hot objects during reads.

## Range-aware chunk retrieval
- `streamingHelpers` pre-computes the minimal set of chunks for a requested range and streams only the required byte slices.
- Unsatisfiable ranges fall back to returning the full response to keep players working instead of emitting 416.
- Segmented writes (512 KB–1 MB slices) limit memory pressure during streaming.

```typescript
// streamingHelpers.ts (segment writes)
const SEGMENT_SIZE = 512 * 1024;
for (let i = 0; i < Math.ceil(slice.byteLength / SEGMENT_SIZE); i++) {
  const segment = slice.subarray(i * SEGMENT_SIZE, (i + 1) * SEGMENT_SIZE);
  await writer.write(segment);
}
```

## Cache key design
- Keys are derivative-first (`{mode}:{path}:derivative=mobile`), falling back to parameterized keys when no derivative is present.
- Paths are sanitized (leading slashes removed, invalid characters replaced with `-`) to keep KV keys valid.

## Cache tags & purging
- Short tags (`vp-*`) are generated once per store and applied to all chunks and manifests, enabling tag-based purges that remove every piece of a variant.

## Memory safeguards
- Single-entry limit: 20 MiB; above that, data is chunked at 5 MiB.
- Fallback storage skips KV entirely above 128 MB to avoid Worker memory exhaustion.
- Chunk locks prevent concurrent writers from producing mismatched sizes.

## Usage tips
- Prefer derivatives to maximize cache hits.
- Keep `storeIndefinitely` disabled unless you have automated purge tooling.
- In debug mode, inspect `X-Breadcrumbs-*` headers to confirm cache decisions, chunk counts, and TTL refresh actions.

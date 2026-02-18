# KV Cache Implementation

_Last Updated: February 18, 2026_

## Overview

KV is the only persistent cache layer. Videos are stored as a single entry (≤20 MiB) or as 5 MiB chunks with a manifest. Chunk locks and manifest validation protect against size mismatches. Range requests are served directly from KV, reconstructing responses from stored chunks.

## Components

```
src/services/kvStorage/
├── constants.ts            # Size thresholds (20 MiB single entry, 5 MiB chunks)
├── interfaces.ts           # Manifest + metadata types
├── keyUtils.ts             # KV key generation + chunk key helpers
├── chunkLockManager.ts     # Prevents concurrent writes to the same chunk
├── storageHelpers.ts       # Shared put/get helpers, metadata creation
├── streamStorage.ts        # Streams ReadableStreams into KV chunks
├── streamChunkProcessor.ts # TransformStream that emits fixed-size chunks
├── streamingHelpers.ts     # Range + full-response streaming from chunks
├── getVideo.ts             # Reads single/chunked entries, handles ranges
├── storeVideo.ts           # Stores responses (single or chunked)
├── listVariants.ts         # Lists stored variants for a source
└── logging.ts              # Structured logging helpers for KV ops
```

Related orchestration:

- `utils/cacheOrchestrator.ts` – triggers background KV writes (with retries) and request coalescing.
- `services/cacheVersionService.ts` – stores version metadata in KV.

## Cache keys

- Format: `{mode}:{path}:derivative=...` (derivative-first). If no derivative, appends params for width/height/format/quality/compression (video/audio) or time/duration/cols/rows/interval (frame/spritesheet).
- Leading slashes removed; invalid characters replaced with `-` (`keyUtils.generateKVKey`).
- Chunk keys use suffix `_<base>_chunk_{n}`.

```typescript
// keyUtils.ts (simplified)
export function generateKVKey(sourcePath: string, options: TransformOptions): string {
  const normalized = sourcePath.replace(/^\/+/, '');
  const mode = options.mode || 'video';
  if (options.derivative) return `${mode}:${normalized}:derivative=${options.derivative}`;
  const parts: string[] = [];
  if (options.width) parts.push(`w=${options.width}`);
  if (options.height) parts.push(`h=${options.height}`);
  if (options.format) parts.push(`f=${options.format}`);
  if (options.quality) parts.push(`q=${options.quality}`);
  return `${mode}:${normalized}${parts.length ? ':' + parts.join(':') : ''}`.replace(
    /[^\w:/.=*-]/g,
    '-'
  );
}
```

## Storage

- `storeVideo.ts` buffers the response once to measure size, then:
  - stores as a single KV entry when ≤20 MiB, or
  - splits into 5 MiB chunks, writing a manifest with `chunkCount`, `actualChunkSizes`, `totalSize`.
- Chunk writes are serialized per key via `chunkLockManager`; cache tags are applied to every chunk.
- Background writes are kicked off from `cacheOrchestrator` via `waitUntil` with up to 3 retries.

```typescript
// storeVideo.ts (decision)
const totalBytes = videoArrayBuffer.byteLength;
if (totalBytes <= MAX_VIDEO_SIZE_FOR_SINGLE_KV_ENTRY) {
  await namespace.put(key, videoArrayBuffer, { metadata });
} else {
  for (let i = 0; i < chunkCount; i++) {
    const chunkKey = `${key}_chunk_${i}`;
    const chunk = videoArrayBuffer.slice(i * STANDARD_CHUNK_SIZE, (i + 1) * STANDARD_CHUNK_SIZE);
    await namespace.put(chunkKey, chunk, { metadata: { ...metadata, chunkIndex: i } });
  }
  await namespace.put(key, manifestJson, {
    metadata: { ...metadata, chunkCount, actualChunkSizes },
  });
}
```

## Retrieval

- `getVideo.ts` fetches the base key to determine if content is single or chunked.
- Range requests use `streamingHelpers.ts` to fetch only required chunks and stream byte slices.
- Unsatisfiable ranges fall back to a full response instead of returning 416 to keep players working.

```typescript
// streamingHelpers.ts (range slice selection)
for (let i = 0; i < manifest.chunkCount; i++) {
  const chunkSize = manifest.actualChunkSizes[i];
  const chunkStart = currentPos;
  const chunkEnd = chunkStart + chunkSize - 1;
  if (range.end >= chunkStart && range.start <= chunkEnd) {
    neededChunks.push({
      index: i,
      start: Math.max(range.start - chunkStart, 0),
      end: Math.min(range.end - chunkStart, chunkSize - 1),
    });
  }
  currentPos += chunkSize;
}
```

## Metadata, TTLs, and versions

- Metadata includes content type, cache version, cache tags, size, and chunk manifest details.
- TTLs come from `CacheConfigurationManager`; `storeIndefinitely` can be enabled but should be paired with purge tooling.
- Version metadata is stored alongside the key (`CacheVersionService`).

## Cache tags & purging

- Short tags (`vp-*`) generated in `services/videoStorage/cacheTags.ts` are attached to manifests and chunks so a tag purge removes all related entries.

## Safety & bypass

- `nocache`, `bypass`, or `debug` query params skip KV.
- Fallback storage skips KV entirely above 128 MB to avoid Worker memory pressure.
- Chunk locks and manifest validation guard against size mismatches; monitor logs for rare `CHUNK SIZE MISMATCH` warnings.

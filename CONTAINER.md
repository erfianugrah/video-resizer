# Container FFmpeg Fallback — Implementation Plan

## Problem Statement

Videos exceeding the `cdn-cgi/media` transformation limit (currently **100 MB** per
Cloudflare docs, though the codebase uses a 256 MiB constant) are served **untransformed**
to the client. The Worker detects the oversize condition, bypasses `cdn-cgi/media`, and
streams the raw source directly (`X-Video-Size-Bypass: true`).

Some source files reach **6 GiB**. These videos still need resizing / transcoding.

## Solution

Add a **Cloudflare Container** running **ffmpeg** as a fallback transformation path.
When the input exceeds `cdn-cgi/media`'s limit the Worker delegates to the container,
which fetches the source, runs ffmpeg, and streams the result back. The Worker stores
the output in **KV** using the existing streaming chunk pipeline and returns it to the
client.

```
Request
  │
  ├─ ≤ 100 MB ──► cdn-cgi/media (existing path, unchanged)
  │                 └─► KV cache ──► Client
  │
  └─ > 100 MB ──► KV cache check
                    ├─ HIT  ──► stream from KV ──► Client
                    └─ MISS ──► Container (ffmpeg)
                                  │  1. Container fetches source directly
                                  │  2. ffmpeg resizes/transcodes on disk
                                  │  3. Streams output back to Worker
                                  └─► Worker stores in KV (streaming chunks)
                                      └─► Client
```

---

## 1. Cloudflare Containers Primer

Containers extend Durable Objects. Each `Container` class maps to a Docker image
deployed alongside the Worker. Instances are addressable by name, start on first
request, sleep after a configurable idle timeout, and resume on the next request.

```ts
import { Container, getContainer } from '@cloudflare/containers';

export class FFmpegContainer extends Container {
  defaultPort = 8080;
  sleepAfter = '5m';
}

// In the Worker:
const instance = getContainer(env.FFMPEG_CONTAINER, instanceKey);
const response = await instance.fetch(transformRequest);
```

### Instance Types

| Type       | vCPU | Memory  | Disk  |
| ---------- | ---- | ------- | ----- |
| lite       | 1/16 | 256 MiB | 2 GB  |
| basic      | 1/4  | 1 GiB   | 4 GB  |
| standard-1 | 1/2  | 4 GiB   | 8 GB  |
| standard-2 | 1    | 6 GiB   | 12 GB |
| standard-3 | 2    | 8 GiB   | 16 GB |
| standard-4 | 4    | 12 GiB  | 20 GB |

For a 6 GiB source file ffmpeg needs: input on disk + output on disk + working
memory. **`standard-3`** (2 vCPU / 8 GiB RAM / 16 GB disk) is the minimum viable
option. **`standard-4`** (4 vCPU / 12 GiB RAM / 20 GB disk) gives comfortable
headroom and faster transcoding. Recommendation: **start with `standard-4`**, drop
to `standard-3` once real-world output sizes are measured.

### Cost Model (pay-per-use)

- Memory: $0.0000025 / GiB-second (25 GiB-hours/month included)
- CPU: $0.000020 / vCPU-second (375 vCPU-minutes/month included)
- Disk: $0.00000007 / GB-second (200 GB-hours/month included)
- Egress: $0.025/GB (NA/EU), 1 TB/month included

Charges start when a request reaches the container, stop when `sleepAfter` elapses.
A `standard-4` instance awake for 5 minutes costs roughly:

- Memory: 12 GiB × 300s × $0.0000025 = $0.009
- CPU: 4 vCPU × 300s × $0.000020 = $0.024
- Disk: 20 GB × 300s × $0.00000007 = $0.0004

~$0.034 per 5-minute transcoding job. After the included free tiers this becomes
meaningful only with high volume.

---

## 2. Container Image (Dockerfile)

The container runs a lightweight HTTP server that accepts transform requests, fetches
the source, runs ffmpeg, and streams the output back.

### Directory Structure

```
container/
├── Dockerfile
├── package.json
└── src/
    └── server.ts        # HTTP server
```

### Dockerfile

```dockerfile
FROM node:22-alpine

# Install ffmpeg (Alpine package is ~80 MB)
RUN apk add --no-cache ffmpeg

WORKDIR /app
COPY package.json ./
RUN npm install --production
COPY src/ ./src/

# Temp directory for transcoding
RUN mkdir -p /tmp/transcode

EXPOSE 8080
CMD ["node", "src/server.js"]
```

### HTTP Server API

```
POST /transform
Content-Type: application/json

{
  "sourceUrl":   "https://...",       // presigned R2 URL or remote origin
  "width":       1280,                // target width (optional)
  "height":      720,                 // target height (optional)
  "mode":        "video",             // video | audio
  "quality":     "high",              // maps to CRF
  "fit":         "contain",           // contain | cover | scale-down
  "duration":    "60s",               // max output duration (optional)
  "time":        "0s",                // start offset (optional)
  "format":      "mp4"                // output format
}
```

**Response:** streams the transformed video as `application/octet-stream` with
`Content-Type`, `Content-Length`, `X-FFmpeg-Duration`, `X-FFmpeg-Width`,
`X-FFmpeg-Height` headers.

### FFmpeg Command Construction

The server maps the incoming params to an ffmpeg invocation:

```bash
ffmpeg -i /tmp/transcode/{jobId}/input.mp4 \
  -vf "scale={width}:{height}:force_original_aspect_ratio=decrease" \
  -c:v libx264 -preset medium -crf {crf} \
  -c:a aac -b:a 128k \
  -movflags +faststart \
  -t {duration} \
  -ss {time} \
  -y /tmp/transcode/{jobId}/output.mp4
```

Quality → CRF mapping:
| Quality | CRF |
|---------|-----|
| low | 28 |
| medium | 23 |
| high | 18 |

Fit modes:

- `contain`: `scale={w}:{h}:force_original_aspect_ratio=decrease`
- `cover`: `scale={w}:{h}:force_original_aspect_ratio=increase,crop={w}:{h}`
- `scale-down`: same as contain but only if input is larger

### Cleanup

After streaming the output back, the server deletes
`/tmp/transcode/{jobId}/` to free disk for the next job.

### Concurrency

Each `standard-4` instance can realistically handle **1 job at a time** for 6 GiB
inputs (disk constraint). The server should reject concurrent requests with `429`
or queue them internally. The Worker-side routing handles this by assigning stable
instance keys (see section 4).

### Health Check

```
GET /health → 200 OK { "status": "ok", "ffmpegVersion": "...", "diskFreeBytes": ... }
```

The Worker can call this before routing to verify the container is ready.

---

## 3. Wrangler Configuration Changes

### `wrangler.jsonc` additions

```jsonc
{
  // Top-level (shared across environments)
  "containers": [
    {
      "class_name": "FFmpegContainer",
      "image": "./container/Dockerfile",
      "max_instances": 5,
      "instance_type": "standard-4",
    },
  ],

  // Add to each environment's durable_objects section:
  "durable_objects": {
    "bindings": [
      {
        "class_name": "FFmpegContainer",
        "name": "FFMPEG_CONTAINER",
      },
    ],
  },

  // Add migration for the new DO class:
  "migrations": [
    {
      "new_sqlite_classes": ["FFmpegContainer"],
      "tag": "v1",
    },
  ],
}
```

### Environment Variables for the Container

The container needs to fetch from R2. Two options:

**Option A — Presigned URLs (preferred):** The Worker generates a presigned R2
GET URL and passes it in the `sourceUrl` field. The container just `fetch()`es
it. No credentials needed in the container. This reuses the existing
`PRESIGNED_URLS` KV + `aws4fetch` signing already in the codebase.

**Option B — R2 S3 API credentials:** Pass `R2_ACCESS_KEY_ID` and
`R2_SECRET_ACCESS_KEY` as secrets to the container via `envVars`. The container
uses the S3-compatible API to fetch objects. More complex, but allows the
container to also write directly to R2 if needed.

**Recommendation:** Option A for the initial implementation. The Worker already
has presigned URL generation; the container stays credential-free.

### Type Additions (`src/types/cloudflare.ts`)

```ts
// Add to the Env / EnvVariables type
FFMPEG_CONTAINER: DurableObjectNamespace;
```

---

## 4. Worker Integration

### 4a. Where to Intercept — `videoHandler.ts:453-607`

The current bypass block at `videoHandler.ts:453-607` is the integration point.
Today it does:

```
HEAD → Content-Length > CDN_CGI_SIZE_LIMIT?
  yes → fetch raw source directly → X-Video-Size-Bypass headers → return
  no  → continue to cdn-cgi/media transformation
```

The new flow replaces the "fetch raw source directly" branch:

```
HEAD → Content-Length > CDN_CGI_SIZE_LIMIT?
  yes → check KV cache for this transform variant
        ├─ HIT  → return from KV (existing streaming read path)
        └─ MISS → has FFMPEG_CONTAINER binding?
                    ├─ yes → route to container → stream response back
                    │         └─ store in KV via streaming (waitUntil)
                    └─ no  → fall back to current direct-stream behavior
  no  → continue to cdn-cgi/media transformation (unchanged)
```

### 4b. Container Routing Key

```ts
// Stable key so repeated requests for the same source hit the same container
// (leverages container's local disk cache of the source)
const containerInstanceKey = `ffmpeg:${originMatch.origin.name}:${sourceResolution.resolvedPath}`;
const container = getContainer(env.FFMPEG_CONTAINER, containerInstanceKey);
```

For **load balancing** across multiple large files, each unique source path gets
its own container instance (up to `max_instances`). If instances are exhausted
Cloudflare returns an error; the Worker falls back to direct streaming.

### 4c. Building the Container Request

```ts
// Generate presigned URL for the source
const presignedSourceUrl = await generatePresignedUrl(
  sourceResolution.sourceUrl,
  sourceResolution.bucketBinding,
  env
);

const containerRequest = new Request('http://container/transform', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    sourceUrl: presignedSourceUrl || sourceResolution.sourceUrl,
    width: videoOptions.width,
    height: videoOptions.height,
    mode: videoOptions.mode || 'video',
    quality: videoOptions.quality || 'medium',
    fit: videoOptions.fit || 'contain',
    duration: videoOptions.duration,
    time: videoOptions.time || '0s',
    format: 'mp4',
  }),
});

const containerResponse = await container.fetch(containerRequest);
```

### 4d. Handling the Container Response

The container response is a standard HTTP `Response` with a `ReadableStream`
body. The Worker:

1. **Tees the stream** — one leg goes to the client, one goes to KV storage
2. **Streams to client immediately** — no buffering the whole output
3. **Stores in KV via `waitUntil`** — using the existing streaming chunk path

```ts
if (containerResponse.ok) {
  // Tee: one for the client, one for KV storage
  const [clientStream, cacheStream] = containerResponse.body.tee();

  // Build client response
  const headers = new Headers(containerResponse.headers);
  headers.set('X-Transform-Source', 'container-ffmpeg');
  headers.set('X-Container-Instance', containerInstanceKey);
  headers.set('X-Handler', 'Origins');
  headers.set('X-Origin', originMatch.origin.name);

  const clientResponse = new Response(clientStream, {
    status: 200,
    headers,
  });

  // Store in KV asynchronously (streaming path)
  const cacheResponse = new Response(cacheStream, {
    headers: containerResponse.headers,
  });

  ctx.waitUntil(
    storeTransformedVideoWithStreaming(
      kvNamespace,
      sourcePath,
      cacheResponse,
      {
        ...videoOptions,
        env,
        version: videoOptions.version || 1,
      },
      ttl
    )
  );

  return clientResponse;
}
```

### 4e. Error / Timeout Handling

| Scenario                      | Behavior                                                   |
| ----------------------------- | ---------------------------------------------------------- |
| Container returns non-200     | Fall back to direct stream (current bypass)                |
| Container boot timeout (>30s) | Fall back to direct stream                                 |
| Container returns 429 (busy)  | Fall back to direct stream                                 |
| ffmpeg fails (non-zero exit)  | Container returns 500 with error detail; Worker falls back |
| Network error to container    | catch → fall back to direct stream                         |

The existing direct-stream path (`videoHandler.ts:535-591`) becomes the
**ultimate fallback** — always available, never removed. The container is
an optimistic upgrade.

### 4f. Request Coalescing

Extend the existing `inFlightTransformations` BoundedLRUMap
(`videoHandler.ts:57-60`) to cover container transforms:

```ts
const transformKey = `container:${originMatch.origin.name}:${sourceResolution.resolvedPath}:${JSON.stringify(
  {
    width: videoOptions.width,
    height: videoOptions.height,
    mode: videoOptions.mode,
    quality: videoOptions.quality,
  }
)}`;

const existing = inFlightTransformations.get(transformKey);
if (existing) {
  // Join existing container transform
  const response = await existing;
  return response.clone();
}
```

This prevents duplicate ffmpeg jobs for the same resize of the same file.

---

## 5. KV Storage Changes

### 5a. Lift the 128 MiB Gate

**File:** `src/services/kvStorage/storeVideo.ts:526`

The current guard:

```ts
if (contentLength > 128 * 1024 * 1024) {
  // Skip storing
  return false;
}
```

This exists because the **buffer-based** path (`storeTransformedVideoImpl`)
loads the entire response into memory. But the **streaming path**
(`storeTransformedVideoWithStreaming`) reads via `StreamingChunkProcessor` in
5 MiB chunks — its memory usage is bounded by chunk size, not file size.

**Change:** Gate the 128 MiB limit to only the buffer path; always allow the
streaming path:

```ts
// Check content length
const contentLengthHeader = response.headers.get('Content-Length');
const contentLength = contentLengthHeader ? parseInt(contentLengthHeader, 10) : 0;

// Determine streaming vs buffer
const shouldUseStreaming =
  useStreaming === true ||
  contentLength > MAX_VIDEO_SIZE_FOR_SINGLE_KV_ENTRY * 2;  // > 40 MiB

if (!shouldUseStreaming && contentLength > 128 * 1024 * 1024) {
  // Only block the buffer path for very large files
  logDebug('Skipping KV storage for large file (buffer mode)', { ... });
  return false;
}

if (shouldUseStreaming) {
  // Streaming path handles arbitrary sizes — no upper limit
  return await storeTransformedVideoWithStreaming(namespace, sourcePath, response, options, ttl);
} else {
  return await storeTransformedVideoImpl(namespace, sourcePath, response, options, ttl);
}
```

### 5b. Practical Limits for Streaming KV Storage

Even with streaming, very large outputs mean many chunks:

| Output Size | Chunks (5 MiB each) | KV Writes | Approx Write Cost |
| ----------- | ------------------- | --------- | ----------------- |
| 100 MB      | 20                  | 20        | ~$0.0001          |
| 500 MB      | 100                 | 100       | ~$0.0005          |
| 1 GB        | 200                 | 200       | ~$0.001           |
| 2 GB        | 400                 | 400       | ~$0.002           |

KV write limit: 1000 writes/second/namespace — no issue for sequential chunk
writes with concurrency 2 (current setting in `streamStorage.ts:200`).

Read performance on cache hit: streaming read with prefetching (already
implemented in `streamingHelpers.ts`) reassembles chunks efficiently.

### 5c. KV Is the Only Storage Backend

KV is the only viable option for serving transformed videos globally,
including China network users. R2 does not have the required edge
presence. This means:

- **Every** container-produced output goes into KV via the streaming
  chunk pipeline — there is no R2 fallback for large outputs.
- The streaming path's memory footprint is bounded by chunk size
  (~5 MiB buffer + ~5 MiB upload = ~10 MiB), regardless of total
  output size. This is safe within Worker memory limits.
- For very large outputs, the trade-off is KV write cost and read
  reassembly latency vs re-running the container on every request.

### 5d. Configurable Upper Bound

Add a **configurable maximum** for container-path KV storage to prevent
runaway costs:

```ts
// New constant in constants.ts
export const MAX_CONTAINER_OUTPUT_FOR_KV = 2 * 1024 * 1024 * 1024; // 2 GiB
```

If the container response's `Content-Length` exceeds this, the Worker
**still serves the transform** to the current client but skips KV
storage. The next request will re-trigger the container. This is a
cost safety valve — a 2 GiB output would be 400 chunks.

However, because KV is the only backend, this threshold should be set
generously. In practice, a 6 GiB source resized to 1280x720 at CRF 23
typically produces an output well under 500 MB. The 2 GiB cap is for
pathological cases only.

### 5e. Output Size Estimation

The container should return `Content-Length` in its response headers
(ffmpeg writes to disk first, so the output size is known before
streaming begins). If `Content-Length` is missing, the streaming KV
path still works — `StreamingChunkProcessor` counts bytes as it goes
and builds the manifest from actual chunk sizes. But having
`Content-Length` enables the `maxOutputForKV` check before starting
the KV write.

### 5f. Cache Key Consistency

Container-transformed outputs use the **same KV key scheme** as
`cdn-cgi/media` outputs:

```
{mode}:{normalizedPath}:w={width}:h={height}:f={format}:q={quality}:c={compression}
```

This means a cache hit doesn't know or care which path produced the
content — subsequent requests served from KV regardless of whether
the original was transformed by cdn-cgi or the container.

---

## 6. Configuration Manager Changes

### 6a. New Config Section

Add a `container` section to the video configuration
(in `config/worker-config.json` and `VideoConfigurationManager`):

```json
{
  "container": {
    "enabled": true,
    "maxInputSize": 6442450944,
    "maxOutputForKV": 2147483648,
    "timeoutMs": 600000,
    "instanceType": "standard-4",
    "quality": {
      "low": { "crf": 28, "preset": "fast" },
      "medium": { "crf": 23, "preset": "medium" },
      "high": { "crf": 18, "preset": "medium" }
    },
    "sleepAfter": "5m",
    "maxInstances": 5,
    "fallbackToDirectStream": true
  }
}
```

| Field                    | Purpose                                          |
| ------------------------ | ------------------------------------------------ |
| `enabled`                | Feature flag — disable without redeployment      |
| `maxInputSize`           | Reject sources larger than this (default 6 GiB)  |
| `maxOutputForKV`         | Skip KV caching above this (cost safety valve)   |
| `timeoutMs`              | Max time to wait for container response (10 min) |
| `quality`                | Map quality names to ffmpeg CRF + preset         |
| `sleepAfter`             | Container idle timeout before sleeping           |
| `maxInstances`           | Wrangler `max_instances` (deploy-time only)      |
| `fallbackToDirectStream` | If container fails, fall back to raw source      |

### 6b. Update `CDN_CGI_SIZE_LIMIT`

**File:** `src/utils/httpUtils.ts:126`

The constant is currently 256 MiB (268435456) but Cloudflare's actual limit
is **100 MB** (104857600) as of the June 2025 increase. Update:

```ts
export const CDN_CGI_SIZE_LIMIT = 104857600; // 100 MB — Cloudflare Media Transformations limit
```

This ensures the container path activates for the correct range of files.

---

## 7. New Strategy: `ContainerVideoStrategy`

Add a new strategy to the existing Strategy pattern:

```
src/domain/strategies/
├── ContainerVideoStrategy.ts   ◄── NEW
├── VideoStrategy.ts
├── FrameStrategy.ts
├── SpritesheetStrategy.ts
├── AudioStrategy.ts
├── StrategyFactory.ts
└── TransformationStrategy.ts
```

### Purpose

`ContainerVideoStrategy` implements `TransformationStrategy` to produce
params suitable for the container API (rather than cdn-cgi URL params).

```ts
export class ContainerVideoStrategy implements TransformationStrategy {
  prepareTransformParams(context: TransformationContext): ContainerTransformParams {
    // Maps VideoTransformOptions → container JSON body
    return {
      width: context.options.width,
      height: context.options.height,
      mode: context.options.mode || 'video',
      quality: context.options.quality || 'medium',
      fit: context.options.fit || 'contain',
      duration: context.options.duration,
      time: context.options.time || '0s',
      format: 'mp4',
    };
  }

  validateOptions(options: VideoTransformOptions): void {
    // Same validation as VideoStrategy (width 10-2000, etc.)
    // But relaxed duration limit — no 60s cdn-cgi cap
  }

  updateDiagnostics(context: TransformationContext): void {
    context.diagnostics.transformationType = 'container-ffmpeg';
    context.diagnostics.transformSource = 'container';
  }
}
```

### Factory Update (`StrategyFactory.ts`)

Add a `containerOversize` flag or a separate factory method:

```ts
static createStrategy(mode: string, isOversized: boolean): TransformationStrategy {
  if (isOversized && (mode === "video" || mode === undefined)) {
    return new ContainerVideoStrategy();
  }
  // ... existing switch
}
```

---

## 8. Diagnostics & Observability

### Response Headers

| Header                    | Value               | When                               |
| ------------------------- | ------------------- | ---------------------------------- |
| `X-Transform-Source`      | `container-ffmpeg`  | Container produced the output      |
| `X-Transform-Source`      | `cdn-cgi-media`     | cdn-cgi/media produced the output  |
| `X-Transform-Source`      | `kv-cache`          | Served from KV cache               |
| `X-Container-Instance`    | Instance key string | Container path                     |
| `X-Container-Duration-Ms` | Transcoding time    | Container path                     |
| `X-Video-Size-Bypass`     | `true`              | Direct stream fallback (unchanged) |

### Sentry Metrics

```ts
Sentry.metrics.count('container.transform.started', 1, {
  attributes: { origin: originMatch.origin.name, quality: videoOptions.quality },
});

Sentry.metrics.distribution('container.transform.duration_ms', durationMs, {
  unit: 'millisecond',
  attributes: { input_size_bucket: sizeBucket },
});

Sentry.metrics.count('container.transform.fallback_to_direct', 1);
```

### Breadcrumbs

```ts
addBreadcrumb(context, 'Container', 'Routing to FFmpeg container', {
  sourceUrl,
  width,
  height,
  quality,
  inputSizeMB,
});

addBreadcrumb(context, 'Container', 'Container transform complete', {
  outputSizeMB,
  durationMs,
  cached: true,
});
```

### Debug UI

Add a "Container" section to the debug diagnostics showing:

- Whether container path was used
- Container instance key
- ffmpeg params sent
- Transcoding duration
- Output size vs input size

---

## 9. Implementation Phases

### Phase 1: Foundation (no container yet)

**Goal:** Prepare the Worker codebase for the container path without deploying
any container.

1. **Update `CDN_CGI_SIZE_LIMIT`** to 100 MB (`httpUtils.ts`)
2. **Restructure the 128 MiB KV gate** in `storeVideo.ts` — streaming path
   gets no upper limit; buffer path keeps the guard
3. **Add `ContainerVideoStrategy`** and factory update
4. **Add container config section** to configuration managers (default `enabled: false`)
5. **Add `FFMPEG_CONTAINER` binding type** to env types
6. **Add container routing skeleton** in `videoHandler.ts:453-607` — behind
   `containerConfig.enabled && env.FFMPEG_CONTAINER` check, falls back to
   existing direct-stream if disabled/missing
7. **Write tests** for the new strategy, config parsing, and routing logic
   (mock the container binding)

### Phase 2: Container Image

**Goal:** Build and test the Docker image locally.

1. **Create `container/` directory** with Dockerfile, server code
2. **Implement the HTTP transform endpoint** — source fetch, ffmpeg spawn,
   output streaming
3. **Implement health check endpoint**
4. **Test locally** with `wrangler dev` (Containers support local dev via
   Wrangler and Vite plugin)
5. **Test with sample large files** — verify disk usage, memory, and output
   quality

### Phase 3: Integration

**Goal:** Deploy end-to-end to staging.

1. **Add container config to `wrangler.jsonc`** (staging environment only)
2. **Deploy container + Worker** to staging
3. **Test with real oversized videos** on `staging.cdn.erfi.dev`
4. **Verify KV storage** — check manifest, chunks, retrieval
5. **Verify fallback** — disable container, confirm direct-stream still works
6. **Tune `sleepAfter`** and `max_instances` based on usage patterns
7. **Monitor costs** via Cloudflare dashboard

### Phase 4: Production

1. **Enable in production config** (`container.enabled: true`)
2. **Deploy container config to `wrangler.jsonc`** production environment
3. **Progressive rollout** — enable for specific origins first via config
4. **Monitor** — Sentry metrics, container logs, KV storage volume
5. **Iterate** — adjust CRF, preset, instance type based on quality/cost

---

## 10. File Change Summary

### New Files

| File                                                    | Purpose                                                |
| ------------------------------------------------------- | ------------------------------------------------------ |
| `container/Dockerfile`                                  | FFmpeg container image                                 |
| `container/package.json`                                | Container dependencies                                 |
| `container/src/server.ts`                               | HTTP server with ffmpeg transform endpoint             |
| `src/domain/strategies/ContainerVideoStrategy.ts`       | Strategy for container transforms                      |
| `src/services/containerTransformService.ts`             | Service to build container requests & handle responses |
| `test/domain/strategies/ContainerVideoStrategy.spec.ts` | Tests                                                  |
| `test/services/containerTransformService.spec.ts`       | Tests                                                  |

### Modified Files

| File                                       | Change                                                     |
| ------------------------------------------ | ---------------------------------------------------------- |
| `wrangler.jsonc`                           | Add `containers`, `durable_objects`, `migrations` sections |
| `src/index.ts`                             | Export `FFmpegContainer` class                             |
| `src/types/cloudflare.ts`                  | Add `FFMPEG_CONTAINER` to env types                        |
| `src/utils/httpUtils.ts:126`               | Update `CDN_CGI_SIZE_LIMIT` to 100 MB                      |
| `src/services/kvStorage/storeVideo.ts:526` | Restructure 128 MiB gate for streaming path                |
| `src/services/kvStorage/constants.ts`      | Add `MAX_CONTAINER_OUTPUT_FOR_KV`                          |
| `src/domain/strategies/StrategyFactory.ts` | Add container strategy creation                            |
| `src/domain/strategies/index.ts`           | Export new strategy                                        |
| `src/handlers/videoHandler.ts:453-607`     | Replace direct-stream with container routing               |
| `src/config/VideoConfigurationManager.ts`  | Add container config section                               |
| `config/worker-config.json`                | Add container config defaults                              |
| `src/handlers/videoHandlerHelpers.ts`      | Update `storeInKVCacheAsync` to support streaming flag     |

---

## 11. Why KV Only — No R2 for Outputs

Some users access the CDN via Cloudflare's China network. **KV is
globally replicated including China PoPs; R2 is not.** This makes KV
the only viable storage backend for transformed video outputs.

Consequences:

- All container outputs go to KV, no exceptions.
- The streaming chunk pipeline (`streamStorage.ts` →
  `StreamingChunkProcessor`) is the critical path. It already handles
  arbitrary sizes with bounded memory (~10 MiB working set).
- The 128 MiB gate in `storeVideo.ts:526` must be restructured (see
  section 5a) so the streaming path has no upper size limit.
- KV read performance for large chunked files depends on the prefetching
  logic in `streamingHelpers.ts`, which is already implemented.
- Cost scales linearly with output size: $5 per million KV writes,
  $0.50 per million KV reads. A 500 MB cached output (100 chunks)
  costs $0.0005 to write and $0.00005 per full read — negligible.

---

## 12. Risks & Mitigations

| Risk                                      | Impact                                 | Mitigation                                                                                                                                                                |
| ----------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Container cold start (5-15s)              | First request for a new source is slow | `sleepAfter: "5m"` keeps warm between requests; stable instance keys reuse warm containers                                                                                |
| ffmpeg OOM on 6 GiB input                 | Container crashes, 500 to client       | Use `standard-4` (12 GiB RAM); ffmpeg memory usage is modest even for large files — it streams I/O                                                                        |
| Disk full (20 GB limit)                   | ffmpeg write fails                     | Cleanup after each job; reject concurrent jobs per instance; limit max input size via config                                                                              |
| KV write volume for large outputs         | Cost, write latency                    | Configurable `maxOutputForKV` cap (default 2 GiB); resized outputs are typically well under 500 MB; uncached outliers still served but re-trigger the container next time |
| Container unavailable / Cloudflare outage | No transformation                      | Graceful fallback to direct stream (existing behavior) — never a hard failure                                                                                             |
| Inconsistent output quality vs cdn-cgi    | Visual difference between paths        | Tune CRF + preset to match cdn-cgi/media output quality; document the difference                                                                                          |
| Long transcode time (minutes)             | Client timeout, Worker CPU time limit  | Worker streams response as it arrives from container — the Worker's wall-clock time is just the stream duration, not the transcode time. Container has no CPU time limit. |

---

## 13. Open Questions

1. **Output duration limit:** cdn-cgi/media limits output to 1 minute. Should the
   container have the same limit, or is this an opportunity to allow longer outputs
   for large files? Longer outputs = more KV chunks = higher cost but the streaming
   KV path handles it.

2. **Audio-only / frame extraction for oversized files:** Should the container
   also support `mode=audio` and `mode=frame` for oversized inputs, or just
   `mode=video`? Audio extraction from a 6 GiB file via ffmpeg is fast and
   produces a small output. Frame extraction is a single image — trivial.

3. **Progressive response:** Should the Worker start streaming the container
   response to the client before the full transcode is done? ffmpeg with
   `-movflags +faststart` writes the moov atom at the start, but this
   requires a full transcode pass first. For truly progressive streaming,
   fragmented MP4 (`-movflags frag_keyframe+empty_moov`) could be used,
   but this changes the output format and may break players expecting
   regular MP4.

4. **Webhook / async pattern:** For very large files where transcoding takes
   5-15 minutes, should the Worker return a `202 Accepted` with a status
   URL instead of holding the connection open? The client would poll for
   completion. This is more complex but avoids HTTP timeout issues.

5. **KV chunk size tuning for large outputs:** The current 5 MiB chunk size
   means a 500 MB output = 100 chunks = 100 KV reads on cache hit. Would a
   larger chunk size (e.g., 10 or 20 MiB, staying under the 25 MiB KV limit)
   reduce read overhead for container-produced outputs? Trade-off: larger
   chunks = more memory per read on the retrieval side. The current streaming
   read in `streamingHelpers.ts` uses 1 MiB segments for writes to the
   client, so 20 MiB chunks would still be manageable.

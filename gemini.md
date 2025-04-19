Okay, let's consolidate everything into a complete step-by-step guide to rework the necessary parts of your codebase for proper HTTP Range request handling. This covers creating the utility, modifying cache hit logic (KV and Cache API), ensuring the request object is passed down, and diagnosing the cache miss scenario.

**Step 1: Create Range Parsing Utility (`src/utils/httpUtils.ts`)**

This file is essential for parsing the `Range` header correctly. If it doesn't exist, create `src/utils/httpUtils.ts` with the following content:

```typescript
// src/utils/httpUtils.ts
/**
 * Parses the HTTP Range header.
 * Spec: https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Range
 *
 * @param rangeHeader The value of the Range header (e.g., "bytes=0-1023").
 * @param totalSize The total size of the resource.
 * @returns An object with start, end, and total size, or null if the header is invalid/absent or unsatisfiable.
 */
export function parseRangeHeader(
  rangeHeader: string | null,
  totalSize: number,
): { start: number; end: number; total: number } | null {
  if (!rangeHeader || !rangeHeader.startsWith('bytes=') || totalSize <= 0) {
    return null;
  }

  const range = rangeHeader.substring(6); // Remove "bytes="
  const parts = range.split('-');
  if (parts.length !== 2) {
    return null; // Invalid format
  }

  const startStr = parts[0].trim();
  const endStr = parts[1].trim();

  let start: number;
  let end: number;

  if (startStr === '' && endStr !== '') {
    // Suffix range: bytes=-N (last N bytes)
    const suffixLength = parseInt(endStr, 10);
    if (isNaN(suffixLength) || suffixLength <= 0) {
      return null;
    }
    start = Math.max(0, totalSize - suffixLength);
    end = totalSize - 1;
  } else if (startStr !== '' && endStr === '') {
    // Open range: bytes=N- (from N to end)
    start = parseInt(startStr, 10);
    if (isNaN(start) || start >= totalSize) {
      return null; // Start is out of bounds
    }
    end = totalSize - 1;
  } else if (startStr !== '' && endStr !== '') {
    // Closed range: bytes=N-M
    start = parseInt(startStr, 10);
    end = parseInt(endStr, 10);
    if (isNaN(start) || isNaN(end) || start > end || start >= totalSize) {
      // Invalid numbers, start > end, or start is out of bounds
      return null;
    }
    // Clamp end to the actual size
    end = Math.min(end, totalSize - 1);
  } else {
    // Invalid format (e.g., "bytes=-")
    return null;
  }

   // Final check: Ensure the range is valid after calculations and clamping
   // Handle edge case where totalSize=1, start=0, end=0
  if (start > end || start < 0 || end < 0 || start >= totalSize) {
     // Check if the range is unsatisfiable (start is beyond the end, or start is beyond total size)
     return null; // Unsatisfiable range
  }


  return { start, end, total: totalSize };
}

/**
 * Creates a Response for an unsatisfiable range request (416).
 * @param totalSize The total size of the resource.
 * @returns A Response object with status 416.
 */
export function createUnsatisfiableRangeResponse(totalSize: number): Response {
    const headers = new Headers({
      'Content-Range': `bytes */${totalSize}`,
      'Accept-Ranges': 'bytes', // Good practice to include even on error
    });
    return new Response('Range Not Satisfiable', { status: 416, headers });
}
```

**Step 2: Modify KV Cache Handling**

This involves changes in multiple files to ensure the `request` object reaches the KV service and the service handles the range.

**2a. Update `kvCacheUtils.ts`:** Modify `getFromKVCache` to accept and pass the `request` object.

```typescript
// src/utils/kvCacheUtils.ts
import { EnvVariables } from '../config/environmentConfig';
// ... other imports ...
import { getTransformedVideo } from '../services/kvStorageService'; // Ensure this is imported
import { addBreadcrumb, getCurrentContext } from '../utils/requestContext'; // Ensure these are imported

// ... existing TransformOptions interface ...

export async function getFromKVCache(
  env: EnvVariables,
  sourcePath: string,
  options: TransformOptions,
  request: Request // <-- Add request parameter
): Promise<Response | null> {
  // ... (existing config/namespace checks) ...

  // Check bypass using existing logic (which uses context, assuming context is set)
  const shouldBypass = await shouldBypassKVCache(sourcePath);
  if (shouldBypass) {
    logDebug('Bypassing KV cache by configuration', { sourcePath });
    return null;
  }

  try {
    if (!kvNamespace) { // kvNamespace should be defined from checks above
      return null;
    }

    // Pass the request object to getTransformedVideo
    const result = await getTransformedVideo(
      kvNamespace,
      sourcePath,
      options,
      request // <-- Pass request here
    );

    // The rest of the function remains largely the same, as getTransformedVideo
    // will now return the appropriately sliced 206 response if needed.
    if (result) {
      // Add breadcrumb for KV cache hit
      const requestContext = getCurrentContext();
      if (requestContext) {
        // Log status from the actual response now
        addBreadcrumb(requestContext, 'KVCache', 'KV cache hit', {
          sourcePath,
          derivative: options.derivative,
          status: result.response.status, // Log the actual status (200 or 206)
          size: result.metadata.contentLength, // Log full original size from metadata
          servedLength: result.response.headers.get('Content-Length'), // Log served length
          cacheTime: new Date(result.metadata.createdAt).toISOString(),
          ttl: result.metadata.expiresAt ? Math.floor((result.metadata.expiresAt - Date.now()) / 1000) : 'unknown'
        });
      }

      logDebug('KV cache hit', {
        sourcePath,
        derivative: options.derivative,
        status: result.response.status,
        servedLength: result.response.headers.get('Content-Length'),
        createdAt: new Date(result.metadata.createdAt).toISOString(),
        expiresAt: result.metadata.expiresAt ? new Date(result.metadata.expiresAt).toISOString() : 'unknown',
        contentLength: result.metadata.contentLength,
        contentType: result.metadata.contentType
      });

      return result.response;
    }

    // ... (existing cache miss logging) ...
    return null;
  } catch (err) {
    // ... (existing error logging) ...
    return null;
  }
}

// ... rest of kvCacheUtils.ts, including shouldBypassKVCache ...
```

**2b. Update `kvStorageService.ts`:** Modify `getTransformedVideo` and `getTransformedVideoImpl` to accept the `request` object and implement the range logic.

```typescript
// src/services/kvStorageService.ts
// ... other imports ...
import { parseRangeHeader, createUnsatisfiableRangeResponse } from '../utils/httpUtils'; // Import the new utils
import { addBreadcrumb, getCurrentContext } from '../utils/requestContext'; // Ensure these are imported

// ... TransformationMetadata interface ...

// Update getTransformedVideoImpl signature
async function getTransformedVideoImpl(
  namespace: KVNamespace,
  sourcePath: string,
  options: { /* ... existing options keys ... */ },
  request: Request // <-- Add request parameter
): Promise<{ response: Response; metadata: TransformationMetadata } | null> {
  const key = generateKVKey(sourcePath, options);
  logDebug('Looking up KV cache with key', { key /* ... */ });

  const { value, metadata } = await namespace.getWithMetadata<TransformationMetadata>(key, 'arrayBuffer');

  if (!value || !metadata) {
    logDebug('Transformed video not found in KV', { key });
    return null;
  }

  const totalSize = value.byteLength; // Get size directly from buffer

  // ---> START Range Handling Logic <---
  const rangeHeader = request.headers.get('Range');
  const range = parseRangeHeader(rangeHeader, totalSize);

  const baseHeaders = new Headers();
  baseHeaders.set('Content-Type', metadata.contentType);
  baseHeaders.set('Accept-Ranges', 'bytes'); // Always indicate range support
  // Copy other relevant headers from metadata if needed (e.g., ETag if stored)
  // Example: if (metadata.etag) headers.set('ETag', metadata.etag);

  // Add Cache-Control header based on expiresAt or default TTL
  const now = Date.now();
  let cacheTtlSeconds: number;
  if (metadata.expiresAt) {
      cacheTtlSeconds = Math.max(0, Math.floor((metadata.expiresAt - now) / 1000));
  } else {
      // Fallback to a default TTL if expiresAt isn't set (e.g., from CacheConfig)
      // Import CacheConfigurationManager safely or have a default value
      try {
         const { CacheConfigurationManager } = await import('../config');
         cacheTtlSeconds = CacheConfigurationManager.getInstance().getConfig().ttl?.ok ?? 86400;
      } catch {
         cacheTtlSeconds = 86400; // Default fallback
      }
  }
  baseHeaders.set('Cache-Control', `public, max-age=${cacheTtlSeconds}`);


  // Add Cache-Tag header if present in metadata
  if (metadata.cacheTags && metadata.cacheTags.length > 0) {
    baseHeaders.set('Cache-Tag', metadata.cacheTags.join(','));
  }

  // Add common diagnostic headers (these apply to both 200 and 206)
  const cacheAge = Math.floor((now - metadata.createdAt) / 1000);
  baseHeaders.set('X-KV-Cache-Age', `${cacheAge}s`);
  baseHeaders.set('X-KV-Cache-TTL', `${cacheTtlSeconds}s`);
  baseHeaders.set('X-KV-Cache-Key', key);
  baseHeaders.set('X-Cache-Status', 'HIT');
  baseHeaders.set('X-Cache-Source', 'KV');
  if (options.derivative) {
    baseHeaders.set('X-Video-Derivative', options.derivative);
  }
  if (options.quality) {
    baseHeaders.set('X-Video-Quality', options.quality);
  }


  let response: Response;
  if (range) {
      // Valid Range request
      const body = value.slice(range.start, range.end + 1);
      const rangeSpecificHeaders = new Headers(baseHeaders); // Copy base headers
      rangeSpecificHeaders.set('Content-Range', `bytes ${range.start}-${range.end}/${range.total}`);
      rangeSpecificHeaders.set('Content-Length', body.byteLength.toString());

      logDebug('Serving ranged response from KV cache', {
        key, range: rangeHeader, start: range.start, end: range.end, total: range.total
      });

      response = new Response(body, { status: 206, headers: rangeSpecificHeaders });

  } else if (rangeHeader) {
       // Invalid or unsatisfiable Range header was present
       logDebug('Unsatisfiable range requested for KV cached item', {
         key, range: rangeHeader, totalSize
       });
       // Create and return the 416 response directly
       return { response: createUnsatisfiableRangeResponse(totalSize), metadata };
  } else {
      // No Range header - serve the full content
      const fullHeaders = new Headers(baseHeaders); // Copy base headers
      fullHeaders.set('Content-Length', totalSize.toString());
      logDebug('Serving full response from KV cache', { key });
      response = new Response(value, { status: 200, headers: fullHeaders });
  }
  // ---> END Range Handling Logic <---

  // Add breadcrumb (applies to both 200 and 206 results from KV)
  const requestContext = getCurrentContext();
  if (requestContext) {
    addBreadcrumb(requestContext, 'KV', 'Retrieved transformed video from KV', {
      key,
      status: response.status, // Log actual status
      contentType: metadata.contentType,
      contentLength: metadata.contentLength, // Original length
      servedLength: response.headers.get('Content-Length'), // Served length
      age: `${cacheAge}s`
    });
  }

  return { response, metadata }; // Return the constructed response and metadata
}

// Update getTransformedVideo wrapper signature
export const getTransformedVideo = withErrorHandling<
  [
    KVNamespace,
    string,
    { /* ... existing options keys ... */ },
    Request // <-- Add request parameter
  ],
  Promise<{ response: Response; metadata: TransformationMetadata } | null>
>(
  async function getTransformedVideoWrapper(
    namespace,
    sourcePath,
    options,
    request // <-- Add request parameter
  ): Promise<{ response: Response; metadata: TransformationMetadata } | null> {
    try {
      // Pass request to the implementation
      return await getTransformedVideoImpl(namespace, sourcePath, options, request);
    } catch (err) {
      // ... existing error logging ...
      return null;
    }
  },
  { /* ... existing error handling config ... */ },
  { /* ... */ }
);

// ... rest of kvStorageService.ts ...
```

**2c. Update `cacheOrchestrator.ts`:** Ensure `withCaching` passes the `request` object to `getFromKVCache`.

```typescript
// src/utils/cacheOrchestrator.ts
// ... imports ...
import { getFromKVCache } from './kvCacheUtils'; // Ensure this is imported

export async function withCaching(
  request: Request, // Keep request parameter
  env: EnvVariables,
  handler: () => Promise<Response>,
  options?: Record<string, unknown>
): Promise<Response> {
  // ... existing setup ...

  try {
    if (!skipCache) {
      // ... existing breadcrumb ...

      const cfCachePromise = getCachedResponse(request).catch(/* ... */);

      let kvCachePromise: Promise<Response | null> = Promise.resolve(null);
      if (options && env) {
        const sourcePath = url.pathname;
        // ... existing IMQuery/lookupOptions logic ...

        // ---> Pass request to getFromKVCache <---
        kvCachePromise = getFromKVCache(env, sourcePath, lookupOptions, request).catch(err => {
          logDebug('Error checking KV cache', {
            error: err instanceof Error ? err.message : String(err)
          });
          return null;
        });
      }

      // ... rest of parallel cache checking logic ...
       const [cfResponse, kvResponse] = await Promise.all([cfCachePromise, kvCachePromise]);

       // Prefer CF cache
       if (cfResponse) {
           // ... existing cfResponse handling ...
           return cfResponse;
       }

       // Use KV response if found
       if (kvResponse) {
           // ... existing kvResponse logging ...
           return kvResponse;
       }

       // ... cache miss logic ...

    } else {
       // ... skipped cache checks logic ...
    }

    // ... execute handler logic ...
    // ... store response in KV logic (ensure optionsWithIMQuery includes request if needed by storage function)...
    const response = await handler();
    // ... store response logic ...
    return response;

  } catch (err) {
     // ... error handling ...
     return handler(); // Fallback
  }
}
```

**Step 3: Modify Cache API Handling (`src/services/cacheManagementService.ts`)**

Update `getCachedResponse` (or its implementation) to handle range requests *after* a cache hit.

```typescript
// src/services/cacheManagementService.ts
// ... imports ...
import { parseRangeHeader, createUnsatisfiableRangeResponse } from '../utils/httpUtils'; // Import utils
import { addBreadcrumb, getCurrentContext } from '../utils/requestContext'; // Ensure imports

// Modify getCachedResponseImpl (or equivalent)
async function getCachedResponseImpl(request: Request): Promise<Response | null> {
    if (request.method !== 'GET') return null;

    const url = new URL(request.url);
    // ... existing shouldBypass logic ...
    if (shouldBypass) return null;

    // ... existing cacheMethod check (skip if 'cf') ...

    // Cache API implementation
    const cache = caches.default;
    const cachedResponse = await cache.match(request);

    if (!cachedResponse) {
      // ... cache miss logging ...
      return null;
    }

    // ---> START Cache API Range Handling Logic <---
    const rangeHeader = request.headers.get('Range');
    const requestContext = getCurrentContext();

    // Only apply range logic if a range is requested AND the cached item is a 200 OK response
    if (rangeHeader && cachedResponse.status === 200 && cachedResponse.body) {
        const responseClone = cachedResponse.clone(); // Clone BEFORE reading body
        const arrayBuffer = await responseClone.arrayBuffer(); // Read body from clone
        const totalSize = arrayBuffer.byteLength;

        const range = parseRangeHeader(rangeHeader, totalSize);

        if (range) {
            // Valid range requested - create a new 206 response
            const body = arrayBuffer.slice(range.start, range.end + 1);

            // Start with original headers, then override range/length
            const rangeHeaders = new Headers(cachedResponse.headers);
            rangeHeaders.set('Content-Range', `bytes ${range.start}-${range.end}/${range.total}`);
            rangeHeaders.set('Content-Length', body.byteLength.toString());
            rangeHeaders.set('Accept-Ranges', 'bytes'); // Ensure this is present

            logDebug('Serving ranged response from Cache API cache', {
              url: request.url, range: rangeHeader, start: range.start, end: range.end, total: range.total
            });

             if (requestContext) {
                addBreadcrumb(requestContext, 'Cache', 'Cache API hit - Ranged', {
                   url: request.url, status: 206, range: rangeHeader
                });
            }
            return new Response(body, { status: 206, headers: rangeHeaders });

        } else {
            // Invalid or unsatisfiable Range header was present
            logDebug('Unsatisfiable range requested for Cache API cached item', {
              url: request.url, range: rangeHeader, totalSize
            });
             if (requestContext) {
                addBreadcrumb(requestContext, 'Cache', 'Cache API hit - Unsatisfiable Range', {
                   url: request.url, status: 416, range: rangeHeader
                });
            }
            return createUnsatisfiableRangeResponse(totalSize); // Return 416
        }
    } else {
        // No Range header, or cached item not suitable for ranging (e.g., already 206)
        // Return the original cached response
        logDebug('Serving full/original response from Cache API cache', { url: request.url, status: cachedResponse.status });
         if (requestContext) {
            addBreadcrumb(requestContext, 'Cache', 'Cache API hit - Full', {
               url: request.url, status: cachedResponse.status
            });
        }
        return cachedResponse;
    }
    // ---> END Cache API Range Handling Logic <---
}

// Ensure the exported getCachedResponse uses the modified implementation
export const getCachedResponse = withErrorHandling<[Request], Promise<Response | null>>(
  getCachedResponseImpl,
  { /* ... error handling config ... */ },
  { /* ... */ }
);

// ... rest of cacheManagementService.ts ...
```

**Step 4: Verify/Diagnose Origin Fetch (Cache Miss)**

Your `curl` logs showed `200 OK` even on the first request (cache miss) when a `Range` header was sent.

* **Check `TransformVideoCommand.ts`:** The code in `execute` currently does `fetch(cdnCgiUrl, { method: request.method, headers: request.headers, ... })`. This *correctly* copies the original `Range` header to the fetch request sent to the CDN-CGI endpoint.
* **Possible Causes:**
    1.  **CDN-CGI Behavior:** The Cloudflare CDN-CGI endpoint might not honor the `Range` header for certain video transformations or under specific conditions. This is external behavior.
    2.  **Downstream Modification:** Less likely given the `ResponseBuilder` code, but something after the fetch *could* be altering the response status or body.
* **Diagnostic Step:** Add logging **immediately** after the fetch call within `TransformVideoCommand.ts::execute` to see exactly what the CDN-CGI endpoint returns:

    ```typescript
    // src/domain/commands/TransformVideoCommand.ts
    // Inside the execute method, after the fetch call:

    // ... previous code ...
    const response = await fetch(cdnCgiUrl, fetchOptions); // Existing fetch call

    // ---> Add Detailed Logging Here <---
    const responseStatus = response.status;
    const responseContentRange = response.headers.get('Content-Range');
    const responseContentLength = response.headers.get('Content-Length');
    const responseAcceptRanges = response.headers.get('Accept-Ranges');
    const responseCfCacheStatus = response.headers.get('CF-Cache-Status');

    await logDebug('TransformVideoCommand', 'Received response directly from CDN-CGI', {
        url: cdnCgiUrl.split('?')[0], // Log URL without query params
        status: responseStatus,
        contentRange: responseContentRange,
        contentLength: responseContentLength,
        acceptRanges: responseAcceptRanges,
        cfCacheStatus: responseCfCacheStatus
    });

     if (this.requestContext) {
        const { addBreadcrumb } = await import('../../utils/requestContext');
        addBreadcrumb(this.requestContext, 'CDN-CGI', 'Response received from CDN-CGI', {
           status: responseStatus,
           contentRange: responseContentRange,
           contentLength: responseContentLength,
           acceptRanges: responseAcceptRanges,
           cfCacheStatus: responseCfCacheStatus
        });
    }
    // ---> End Logging <---

    // ... rest of the execute method ...
    ```
    By checking these logs after sending a ranged request on a cache miss, you can determine if CDN-CGI returned `206 Partial Content` (meaning the issue is downstream) or `200 OK` (meaning the issue is with CDN-CGI itself not respecting the range for that request).

**Step 5: Testing**

After applying these changes and deploying:

1.  **Clear Caches:** Use `cfpurge` or similar methods to clear both KV and the Edge Cache (if possible) for your test URLs.
2.  **Test Cache Miss:** Send a `curl` request with a `Range` header (e.g., `curl -v -H "Range: bytes=0-1000" "YOUR_VIDEO_URL"`). Check the new logs from Step 4 to see the direct CDN-CGI response status. The final response *should* ideally be `206`.
3.  **Test Cache Hit (KV/Cache API):** Send the *same* `curl` request again. This time it should hit one of the worker caches (KV or Cache API). The response **must** be `206 Partial Content` with the correct `Content-Range` and `Content-Length` (e.g., 1001 bytes for `bytes=0-1000`).
4.  **Test Full Request:** Send a `curl` request *without* a `Range` header. Test both cache miss and cache hit scenarios. Both should return `200 OK` with the full `Content-Length`.

This comprehensive approach addresses range handling during the initial fetch and subsequent cache hits, ensuring consistent behavior for video streaming. Remember to adapt the code snippets precisely to your existing function signatures, context objects, and error handling patterns.

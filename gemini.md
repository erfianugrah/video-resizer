# Step-by-Step Guide: Consolidating Caching to KV Only

**Goal**: Refactor the `video-resizer` codebase to exclusively use Cloudflare KV for caching transformed video variants, removing the Cloudflare Cache API and `cf` object caching methods. This guide ensures that the manual range slicing logic for responses served from KV remains functional.

**Prerequisites**:
* Access to the `video-resizer` codebase.
* Understanding of the existing multi-layered caching system (Cache API, KV, `cf` object).
* Familiarity with TypeScript and Cloudflare Workers development.

## Progress Tracking

### Step 1: Configuration Cleanup ✅
- Removed `method: z.enum(['cf', 'cacheApi']).default('cacheApi')` from CacheConfigSchema
- Updated getCacheMethod() to return 'kv'
- Removed `method: 'cf'` from defaultCacheConfig
- Removed `method` from EnvironmentConfig cache interface
- Removed CACHE_METHOD from EnvVariables interface
- Removed CACHE_METHOD parsing in getEnvironmentConfig
- Removed "method": "cacheApi" from worker-config.json

### Step 2: Remove Cloudflare Object (`cf`) Caching Logic ✅
- Deleted `src/utils/cacheCfUtils.ts` file
- Removed `cf` property from fetch options in TransformVideoCommand.ts
- Removed createCfObjectParams import and usage in TransformVideoCommand.ts
- Updated debug mode log messages to reference 'kv' as the only caching method

### Step 3: Remove Cache API Caching Logic ✅
- Simplified `getCachedResponseImpl` in `src/utils/cacheRetrievalUtils.ts` to always return null, effectively bypassing Cache API
- Removed `storeInCacheWithRangeSupport` function and replaced with `prepareResponseForRangeSupport` in `src/utils/cacheStorageUtils.ts`
- Simplified `cacheResponseImpl` function in `src/utils/cacheResponseUtils.ts` to focus only on preparing responses and handling range requests
- Updated `cacheManagementService.ts` to remove createCfObjectParams import/export and references to Cache API
- Completely refactored `cacheOrchestrator.ts` to only use KV caching, removing all Cache API logic
- Preserved all range request handling logic for both KV and direct responses

---

### Step 1: Configuration Cleanup

**Objective**: Remove configuration options related to multiple caching methods.

1.  **Modify Cache Configuration Schema (`src/config/CacheConfigurationManager.ts`)**:
    * Open `src/config/CacheConfigurationManager.ts`.
    * Locate the `CacheConfigSchema` Zod schema definition.
    * Remove the `method: z.enum(['cf', 'cacheApi']).default('cacheApi'),` line. KV will be the only method.
    * Review the `enableKVCache` property. Decide if it should remain (to disable KV caching entirely) or be removed (making KV caching always active if the binding exists). For this guide, we'll assume it remains to allow disabling KV if needed.
    * Update the `defaultCacheConfig` object to remove the `method` property.

2.  **Modify Environment Configuration (`src/config/environmentConfig.ts`)**:
    * Open `src/config/environmentConfig.ts`.
    * Remove the `CACHE_METHOD?: string;` line from the `EnvVariables` interface.
    * In the `getEnvironmentConfig` function, remove the line that parses `CACHE_METHOD` and sets `config.cache.method`.

3.  **Update Default Worker Configuration (`config/worker-config.json`)**:
    * Open `config/worker-config.json`.
    * Locate the `cache` section.
    * Remove the `"method": "cacheApi",` line (or `"method": "cf",`).

4.  **Review `wrangler.jsonc`**:
    * Ensure no `CACHE_METHOD` variable is defined in the `[vars]` or `[env.*.vars]` sections. Remove it if present.

---

### Step 2: Remove Cloudflare Object (`cf`) Caching Logic

**Objective**: Eliminate code related to Cloudflare's `cf` object caching used via `fetch`.

1.  **Delete `cacheCfUtils.ts`**:
    * Delete the file `src/utils/cacheCfUtils.ts`. This file contains the `createCfObjectParams` function specific to `cf` object caching.

2.  **Remove `cf` Object Usage in Fetch Calls**:
    * Search the codebase (primarily in `src/domain/commands/TransformVideoCommand.ts` and potentially handlers or services) for calls to `fetch` that include a `cf` property in the options object, like `fetch(url, { cf: cfParams })`.
    * Remove the `cf` property and any logic related to generating `cfParams` using the now-deleted `createCfObjectParams`. The `fetch` call should look simpler, e.g., `fetch(url, fetchOptions)`.

---

### Step 3: Remove Cache API Caching Logic

**Objective**: Eliminate code related to the Cloudflare Cache API (`caches.default`) while preserving necessary range request handling functionality.

**Important Clarification**: We're removing the Cloudflare Cache API as a caching layer, but we must preserve the manual range slicing logic for responses from both:
1. KV storage
2. The origin/media proxy (CDN-CGI responses)

Range request handling is critical for video delivery and must be maintained regardless of the caching method used.

1.  **Modify Cache Retrieval Utilities (`src/utils/cacheRetrievalUtils.ts`)**:
    * Open `src/utils/cacheRetrievalUtils.ts`.
    * Locate the `getCachedResponseImpl` function.
    * Simplify this function to return `null` for all requests, effectively bypassing the Cache API.
    * Do NOT remove any range handling utility functions that might be used elsewhere.

2.  **Modify Cache Storage Utilities (`src/utils/cacheStorageUtils.ts`)**:
    * Open `src/utils/cacheStorageUtils.ts`.
    * Remove or refactor the `storeInCacheWithRangeSupport` function that uses `caches.default.put`.
    * Preserve any header manipulation or range request handling logic that's needed for other parts of the system.
    * Keep utility functions related to range requests since they're used by both KV and direct responses.

3.  **Modify Cache Response Utilities (`src/utils/cacheResponseUtils.ts`)**:
    * Open `src/utils/cacheResponseUtils.ts`.
    * Locate the `cacheResponseImpl` function.
    * Remove the logic that calls `caches.default.put(...)` or related Cache API storage functions.
    * IMPORTANT: Keep the `handleRangeRequest` helper function as it's needed for processing range requests from any source.
    * Refactor the function to focus only on preparing responses and handling range requests without using Cache API.

4.  **Update Cache Management Service (`src/services/cacheManagementService.ts`)**:
    * Open `src/services/cacheManagementService.ts`.
    * Remove `createCfObjectParams` import and export.
    * Update the remaining exports/functions to ensure they don't reference Cache API directly.

---

### Step 4: Update Cache Orchestrator

**Objective**: Modify the central caching logic to only use KV cache.

1.  **Modify `withCaching` Function (`src/utils/cacheOrchestrator.ts`)**:
    * Open `src/utils/cacheOrchestrator.ts`.
    * Locate the `withCaching` function.
    * Remove the initial parallel check for the Cache API (`getCachedResponse`). Delete the `cfPromise` logic.
    * Simplify the logic flow to:
        * Check `skipCache` conditions (non-GET, bypass params).
        * If not skipping cache and KV is enabled:
            * Call `getFromKVCache(env, sourcePath, options, request)`.
            * If HIT: Return the KV response.
            * If MISS: Proceed to handler.
        * If skipping cache or KV disabled or KV miss:
            * Execute the `handler()` function to get the response.
            * If the response is cacheable (check status code, content-type) and KV is enabled:
                * Call `storeInKVCache(env, sourcePath, response.clone(), options)` asynchronously (e.g., using `ctx.waitUntil` if available, otherwise fire-and-forget promise).
            * Return the handler's response.

---

### Step 5: Refactor Handlers

**Objective**: Simplify request handlers to reflect the KV-only caching strategy.

1.  **Modify `videoHandler.ts` and `videoHandlerWithCache.ts`**:
    * Review both `src/handlers/videoHandler.ts` and `src/handlers/videoHandlerWithCache.ts`.
    * Remove any conditional logic based on `cacheMethod`.
    * The core logic should now always involve the `withCaching` orchestrator (which itself only uses KV).
    * It's likely that `videoHandler.ts` becomes redundant, and the logic can be consolidated into `videoHandlerWithCache.ts` (which could be renamed, e.g., `videoHandler.ts`).
    * Ensure the handler correctly determines `videoOptions` to pass to `withCaching`.

---

### Step 6: Verify KV Range Slicing Logic

**Objective**: Ensure the existing manual range slicing for KV responses is preserved and functional.

1.  **Review `getTransformedVideoImpl` (`src/services/kvStorageService.ts`)**:
    * Carefully examine the section handling `if (request && request.headers.has('Range'))`.
    * **Confirm**: It correctly uses `parseRangeHeader` with the total size from the KV metadata (`value.byteLength`).
    * **Confirm**: It correctly slices the `ArrayBuffer` fetched from KV (`value.slice(range.start, range.end + 1)`).
    * **Confirm**: It creates a `new Response` with status `206`.
    * **Confirm**: It sets the `Content-Range` header correctly (`bytes ${range.start}-${range.end}/${range.total}`).
    * **Confirm**: It sets the `Content-Length` header to the size of the *sliced* body (`slicedBody.byteLength.toString()`).
    * **Confirm**: It sets the `Accept-Ranges: bytes` header.
    * **Confirm**: It handles invalid/unsatisfiable ranges by returning a `416` response using `createUnsatisfiableRangeResponse`.

---

### Step 7: Update Tests

**Objective**: Ensure the test suite accurately reflects the KV-only caching logic and verifies range request handling.

1.  **Remove/Update Unit Tests**:
    * Delete test files for deleted utilities (e.g., `test/utils/cacheCfUtils.spec.ts`).
    * Update tests for modified utilities (`cacheOrchestrator.spec.ts`, `kvCacheUtils.spec.ts`, `cacheManagementService.spec.ts`, handler tests) to remove checks for Cache API or `cf` object behavior. Focus tests on the KV check -> handler -> KV store flow.
2.  **Update Integration Tests**:
    * Modify `test/integration/video-kv-caching.spec.ts` and `test/edge-cases/cache-behavior.spec.ts` to reflect that only KV caching is active. Remove assertions related to Cache API hits/misses.
3.  **Add KV Range Request Tests**:
    * Create new tests (or add to existing ones like `kvStorageService.spec.ts` or integration tests) specifically for range requests served from the KV cache.
    * Test scenarios:
        * Valid range request -> 206 response with correct headers and sliced body.
        * Range starting at 0.
        * Range ending at the end of the content.
        * Suffix range (`bytes=-500`).
        * Invalid range header format -> 416 response.
        * Range starting beyond content length -> 416 response.
        * Range where start > end -> 416 response.

---

### Step 8: Update Documentation

**Objective**: Reflect the simplified KV-only caching strategy in all documentation.

1.  **Configuration Documentation**:
    * Update `docs/configuration/cache-configuration.md`: Remove `method` option, explain KV is the sole method (if `enableKVCache` is true).
    * Update `docs/configuration/CONFIGURATION_REFERENCE.md`: Remove `cache.method`.
    * Update `docs/configuration/wrangler-vs-kv-config.md`: Remove `CACHE_METHOD`.
2.  **KV Caching Documentation**:
    * Update `docs/kv-caching/README.md`: State clearly that KV is the *only* caching layer besides Cloudflare's default edge caching (if applicable).
    * Review `docs/kv-caching/implementation.md`, `docs/kv-caching/cache-api-vs-kv.md` and remove comparisons or explanations involving the Cache API method.
3.  **Architecture Documentation**:
    * Update `docs/architecture/ARCHITECTURE_OVERVIEW.md` and diagrams to show only the KV cache layer interacting with the transformation process.
    * Remove references to Cache API or `cf` object caching in `docs/architecture/ARCHITECTURE_PATTERNS.md`.
4.  **README**:
    * Review the main `README.md` and ensure the caching features section accurately describes the KV-only approach.
5.  **Remove Obsolete Docs**: Delete any documentation files solely dedicated to the Cache API or `cf` object caching methods if they exist (e.g., potentially `docs/archive/CACHING_OPTIONS.md` needs review/removal).

---

### Conclusion

Following these steps will result in a streamlined caching system for the `video-resizer` that relies exclusively on Cloudflare KV for storing and retrieving transformed video variants, while preserving the necessary logic for handling HTTP range requests directly from KV storage. Remember to commit changes incrementally and run tests frequently during the refactoring process.

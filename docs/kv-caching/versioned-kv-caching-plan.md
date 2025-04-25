# Versioned KV Caching Implementation Plan

## Overview

This document outlines the plan to implement a versioned KV caching system for video-resizer. The approach will:

1. Replace the current Cache API and CF object caching with a pure KV-based solution
2. Add version tracking for cache keys to enable controlled invalidation
3. Use the media proxy's native caching and range request handling capabilities
4. Simplify the caching configuration and implementation

## Current Implementation Status

The implementation is in progress. The following components have been completed:

1. ✅ Added `VIDEO_CACHE_KEY_VERSIONS` KV namespace to wrangler.jsonc
2. ✅ Updated environment types to include the new KV namespace
3. ✅ Created version management service (`versionManagerService.ts`)
4. ✅ Modified KV key generation to support versioning
5. ✅ Updated cache orchestrator to use versioned approach
6. ✅ Updated video handler to use versioned caching
7. ✅ Created tests for versioned caching

## Current Issues

- Current caching is complex with multiple layers (Cache API, CF object cache, KV)
- Cache invalidation requires purging multiple caches
- Range request handling adds complexity to our implementation

## Solution Benefits

- **Simplified Architecture**: Single caching layer with versioning
- **Controlled Cache Invalidation**: Version updates automatically invalidate cached content
- **Better Range Request Handling**: Delegate to the media proxy's native capabilities
- **Reduced Code Complexity**: Remove Cache API-related code and simplify configuration

## Implementation Steps

### 1. Update Wrangler Configuration

Add the version tracking KV namespace to all environments in wrangler.jsonc:

```jsonc
"kv_namespaces": [
  {
    "binding": "VIDEO_CONFIGURATION_STORE",
    "id": "ddaf6d5142af4f79b39defe745dac556"
  },
  {
    "binding": "VIDEO_TRANSFORMATIONS_CACHE",
    "id": "8e790768576242cc98fa3e4aa327f815"
  },
  {
    "binding": "VIDEO_CACHE_KEY_VERSIONS",
    "id": "949610c936b8480bad5b61f3aa934de1"
  }
]
```

### 2. Update Environment Types

Update the environment types in `src/config/environmentConfig.ts` to include the new KV namespace:

```typescript
export interface EnvVariables {
  // Existing bindings
  VIDEO_CONFIGURATION_STORE?: KVNamespace;
  VIDEO_TRANSFORMATIONS_CACHE?: KVNamespace;
  VIDEO_TRANSFORMS_KV?: KVNamespace;
  // New version tracking KV namespace
  VIDEO_CACHE_KEY_VERSIONS?: KVNamespace;
  // ...other environment variables
}
```

### 3. Create Version Management Service

Create a new service to handle version tracking at `src/services/versionManagerService.ts`:

```typescript
/**
 * Version Manager Service for versioned KV caching
 * 
 * This service tracks and manages version numbers for cache keys to enable controlled invalidation
 */

import { EnvVariables } from '../config/environmentConfig';
import { createLogger, debug as pinoDebug } from '../utils/pinoLogger';
import { getCurrentContext } from '../utils/legacyLoggerAdapter';
import { withErrorHandling } from '../utils/errorHandlingUtils';

/**
 * Helper for logging debug messages
 */
function logDebug(message: string, data?: Record<string, unknown>): void {
  const requestContext = getCurrentContext();
  if (requestContext) {
    const logger = createLogger(requestContext);
    pinoDebug(requestContext, logger, 'VersionManager', message, data);
  } else {
    console.debug(`VersionManager: ${message}`, data || {});
  }
}

/**
 * Get the current version for a cache key
 * 
 * @param env - Environment with KV namespace binding
 * @param cacheKey - The base cache key (without version)
 * @returns Current version number (defaults to 1 if not found)
 */
export const getCurrentVersion = withErrorHandling<
  [EnvVariables, string],
  Promise<number>
>(
  async function getCurrentVersionImpl(
    env: EnvVariables,
    cacheKey: string
  ): Promise<number> {
    const versionKV = env.VIDEO_CACHE_KEY_VERSIONS;
    
    if (!versionKV) {
      logDebug('Version KV namespace not available, defaulting to version 1');
      return 1;
    }
    
    const version = await versionKV.get(cacheKey);
    
    if (version === null) {
      logDebug('No version found for key, defaulting to version 1', { cacheKey });
      return 1;
    }
    
    const versionNumber = parseInt(version, 10);
    logDebug('Found version for key', { cacheKey, version: versionNumber });
    
    return versionNumber;
  },
  {
    functionName: 'getCurrentVersion',
    component: 'VersionManager',
    logErrors: true
  },
  1 // Default to version 1 if error occurs
);

/**
 * Increment the version for a cache key
 * 
 * @param env - Environment with KV namespace binding
 * @param cacheKey - The base cache key (without version)
 * @returns New version number after increment
 */
export const incrementVersion = withErrorHandling<
  [EnvVariables, string],
  Promise<number>
>(
  async function incrementVersionImpl(
    env: EnvVariables,
    cacheKey: string
  ): Promise<number> {
    const versionKV = env.VIDEO_CACHE_KEY_VERSIONS;
    
    if (!versionKV) {
      logDebug('Version KV namespace not available, defaulting to version 1');
      return 1;
    }
    
    const currentVersion = await getCurrentVersion(env, cacheKey);
    const newVersion = currentVersion + 1;
    
    await versionKV.put(cacheKey, newVersion.toString());
    logDebug('Incremented version for key', { cacheKey, oldVersion: currentVersion, newVersion });
    
    return newVersion;
  },
  {
    functionName: 'incrementVersion',
    component: 'VersionManager',
    logErrors: true
  },
  1 // Default to version 1 if error occurs
);

/**
 * Reset the version for a cache key to 1
 * 
 * @param env - Environment with KV namespace binding
 * @param cacheKey - The base cache key (without version)
 * @returns Success boolean
 */
export const resetVersion = withErrorHandling<
  [EnvVariables, string],
  Promise<boolean>
>(
  async function resetVersionImpl(
    env: EnvVariables,
    cacheKey: string
  ): Promise<boolean> {
    const versionKV = env.VIDEO_CACHE_KEY_VERSIONS;
    
    if (!versionKV) {
      logDebug('Version KV namespace not available');
      return false;
    }
    
    await versionKV.put(cacheKey, '1');
    logDebug('Reset version for key to 1', { cacheKey });
    
    return true;
  },
  {
    functionName: 'resetVersion',
    component: 'VersionManager',
    logErrors: true
  },
  false // Default to false if error occurs
);
```

### 4. Modify KV Key Generation

Update the key generation in `src/services/kvStorageService.ts` to include version:

```typescript
/**
 * Generate a base KV key (without version) for a transformed video variant
 * 
 * @param sourcePath - The original video source path
 * @param options - Transformation options
 * @returns A base key for the KV store (without version)
 */
function generateBaseKVKeyImpl(
  sourcePath: string,
  options: {
    mode?: string | null;
    width?: number | null;
    height?: number | null;
    format?: string | null;
    quality?: string | null;
    compression?: string | null;
    derivative?: string | null;
    time?: string | null;
    columns?: number | null;
    rows?: number | null;
    interval?: string | null;
    customData?: Record<string, unknown>;
  }
): string {
  // Remove leading slashes for consistency
  const normalizedPath = sourcePath.replace(/^\/+/, '');
  
  // Set default mode to 'video' if not specified
  const mode = options.mode || 'video';
  
  // Create a base key from the mode and path
  let key = `${mode}:${normalizedPath}`;
  
  // Always prefer derivative-based caching for better cache efficiency
  if (options.derivative) {
    // Derivative-based caching is the primary method for better cache utilization
    key += `:derivative=${options.derivative}`;
  } else {
    // Only use individual parameters if no derivative specified
    if (options.width) key += `:w=${options.width}`;
    if (options.height) key += `:h=${options.height}`;
    
    // Add mode-specific parameters
    if (mode === 'frame') {
      if (options.time) key += `:t=${options.time}`;
      if (options.format) key += `:f=${options.format}`;
    } else if (mode === 'spritesheet') {
      if (options.columns) key += `:cols=${options.columns}`;
      if (options.rows) key += `:rows=${options.rows}`;
      if (options.interval) key += `:interval=${options.interval}`;
    } else {
      // Video-specific parameters
      if (options.format) key += `:f=${options.format}`;
      if (options.quality) key += `:q=${options.quality}`;
      if (options.compression) key += `:c=${options.compression}`;
    }
  }
  
  // Only replace spaces and other truly invalid characters, preserving slashes and equals signs
  return key.replace(/[^\w:/=.*-]/g, '-');
}

export const generateBaseKVKey = tryOrDefault<
  [string, {
    mode?: string | null;
    width?: number | null;
    height?: number | null;
    format?: string | null;
    quality?: string | null;
    compression?: string | null;
    derivative?: string | null;
    time?: string | null;
    columns?: number | null;
    rows?: number | null;
    interval?: string | null;
    customData?: Record<string, unknown>;
  }],
  string
>(
  generateBaseKVKeyImpl,
  {
    functionName: 'generateBaseKVKey',
    component: 'KVStorageService',
    logErrors: true
  },
  'video:error:fallback-key' // Default fallback key if generation fails
);

/**
 * Generate a versioned KV key for a transformed video variant
 * 
 * @param baseKey - The base key without version
 * @param version - The version number to append
 * @returns A versioned key for the KV store
 */
export function generateVersionedKVKey(baseKey: string, version: number): string {
  return `${baseKey}:v${version}`;
}
```

### 5. Update KV Cache Utilities

Modify `src/utils/kvCacheUtils.ts` to use versioned keys:

```typescript
/**
 * Try to get a transformed video from KV cache with version support
 * 
 * @param env - Environment variables with KV namespaces
 * @param sourcePath - Original source path
 * @param options - Transformation options
 * @param request - Optional request for range request support
 * @returns The cached response, version number, or null if not found
 */
export async function getFromKVCache(
  env: EnvVariables,
  sourcePath: string,
  options: TransformOptions,
  request?: Request
): Promise<{ response: Response; version: number } | null> {
  // Check if KV caching is enabled
  const config = getCacheConfig(env);
  const kvNamespace = env.VIDEO_TRANSFORMATIONS_CACHE || env.VIDEO_TRANSFORMS_KV;
  
  if (!config.enableKVCache || !kvNamespace) {
    logDebug('KV cache disabled or namespace not found');
    return null;
  }
  
  // Check if we should bypass cache for this request
  const shouldBypass = await shouldBypassKVCache(sourcePath);
  if (shouldBypass) {
    logDebug('Bypassing KV cache by configuration', { sourcePath });
    return null;
  }
  
  try {
    // Generate the base key (without version)
    const baseKey = generateBaseKVKey(sourcePath, options);
    
    // Get the current version for this key
    const version = await getCurrentVersion(env, baseKey);
    
    // Generate the versioned key
    const versionedKey = generateVersionedKVKey(baseKey, version);
    
    logDebug('Looking up with versioned key', { 
      baseKey, 
      version, 
      versionedKey,
      sourcePath,
      derivative: options.derivative
    });
    
    // Look up the versioned key in KV
    const { value, metadata } = await kvNamespace.getWithMetadata<TransformationMetadata>(
      versionedKey, 
      'arrayBuffer'
    );
    
    if (!value || !metadata) {
      logDebug('KV cache miss for versioned key', { versionedKey, version });
      return null;
    }
    
    // Create response and headers
    const headers = new Headers();
    headers.set('Content-Type', metadata.contentType);
    headers.set('Accept-Ranges', 'bytes');
    
    // Add Cache-Control header
    const now = Date.now();
    if (metadata.expiresAt) {
      const remainingTtl = Math.max(0, Math.floor((metadata.expiresAt - now) / 1000));
      headers.set('Cache-Control', `public, max-age=${remainingTtl}`);
    } else {
      const cacheConfig = CacheConfigurationManager.getInstance();
      const ttl = cacheConfig.getConfig().defaultMaxAge;
      headers.set('Cache-Control', `public, max-age=${ttl}`);
    }
    
    // Add Cache-Tag header
    if (metadata.cacheTags && metadata.cacheTags.length > 0) {
      headers.set('Cache-Tag', metadata.cacheTags.join(','));
    }
    
    // Add debugging headers
    const cacheAge = Math.floor((now - metadata.createdAt) / 1000);
    const cacheTtl = metadata.expiresAt ? Math.floor((metadata.expiresAt - now) / 1000) : 300;
    
    headers.set('X-KV-Cache-Age', `${cacheAge}s`);
    headers.set('X-KV-Cache-TTL', `${cacheTtl}s`);
    headers.set('X-KV-Cache-Key', versionedKey);
    headers.set('X-KV-Cache-Version', version.toString());
    headers.set('X-Cache-Status', 'HIT');
    headers.set('X-Cache-Source', 'KV');
    
    // Create response (handle range requests if present)
    let response: Response;
    
    if (request && request.headers.has('Range')) {
      try {
        const { parseRangeHeader, createUnsatisfiableRangeResponse } = await import('../utils/httpUtils');
        
        const rangeHeader = request.headers.get('Range');
        const totalSize = value.byteLength;
        
        logDebug('Processing range request from KV cache', { 
          versionedKey,
          range: rangeHeader,
          totalSize,
          version
        });
        
        const range = parseRangeHeader(rangeHeader, totalSize);
        
        if (range) {
          // Valid range request - create a 206 Partial Content response
          const slicedBody = value.slice(range.start, range.end + 1);
          const rangeHeaders = new Headers(headers);
          rangeHeaders.set('Content-Range', `bytes ${range.start}-${range.end}/${range.total}`);
          rangeHeaders.set('Content-Length', slicedBody.byteLength.toString());
          
          // Add debug headers
          rangeHeaders.set('X-Range-Handled-By', 'KV-Cache');
          rangeHeaders.set('X-Range-Request', rangeHeader || '');
          rangeHeaders.set('X-Range-Bytes', `${range.start}-${range.end}/${range.total}`);
          
          response = new Response(slicedBody, { 
            status: 206, 
            statusText: 'Partial Content',
            headers: rangeHeaders 
          });
        } else {
          // Invalid range
          response = createUnsatisfiableRangeResponse(totalSize);
        }
      } catch (err) {
        // Fall back to full response on error
        headers.set('Content-Length', metadata.contentLength.toString());
        response = new Response(value, { headers });
      }
    } else {
      // Not a range request - normal response
      headers.set('Content-Length', metadata.contentLength.toString());
      response = new Response(value, { headers });
    }
    
    logDebug('KV cache hit with versioned key', {
      versionedKey,
      version,
      size: metadata.contentLength,
      age: cacheAge + 's'
    });
    
    return { response, version };
  } catch (err) {
    logDebug('Error retrieving from KV cache', {
      sourcePath,
      error: err instanceof Error ? err.message : String(err)
    });
    return null;
  }
}

/**
 * Store a transformed video in KV cache with version support
 * 
 * @param env - Environment variables with KV namespaces
 * @param sourcePath - Original source path
 * @param response - The transformed video response
 * @param options - Transformation options
 * @param version - The version to use for this cache entry
 * @returns Boolean indicating if storage was successful
 */
export async function storeInKVCache(
  env: EnvVariables,
  sourcePath: string,
  response: Response,
  options: TransformOptions,
  version: number
): Promise<boolean> {
  // Check if KV caching is enabled
  const config = getCacheConfig(env);
  const kvNamespace = env.VIDEO_TRANSFORMATIONS_CACHE || env.VIDEO_TRANSFORMS_KV;
  
  if (!config.enableKVCache || !kvNamespace) {
    logDebug('KV cache storage disabled or namespace not found');
    return false;
  }
  
  try {
    // Clone the response to avoid consuming it
    const responseClone = response.clone();
    
    // Check if response is cacheable
    const statusCode = responseClone.status;
    const isError = statusCode >= 400;
    const contentType = responseClone.headers.get('content-type') || '';
    
    // Get MIME types from configuration for cacheable content
    const mimeTypes = getCacheableMimeTypes();
    
    const isVideoResponse = mimeTypes.video.some(mimeType => contentType.startsWith(mimeType));
    const isImageResponse = mimeTypes.image.some(mimeType => contentType.startsWith(mimeType));
    const isCachableResponse = isVideoResponse || isImageResponse;
    
    // Skip for errors or non-cacheable responses
    if (isError || !isCachableResponse) {
      logDebug('Skipping KV storage for error or non-cacheable response', {
        statusCode,
        contentType,
        isError,
        isCachableResponse
      });
      return false;
    }
    
    // Determine TTL based on content type and configuration
    const ttl = determineTTL(responseClone, config);
    
    // Generate base key and versioned key
    const baseKey = generateBaseKVKey(sourcePath, options);
    const versionedKey = generateVersionedKVKey(baseKey, version);
    
    logDebug('Storing with versioned key', { 
      baseKey, 
      version, 
      versionedKey,
      ttl,
      contentType
    });
    
    // Get response body as ArrayBuffer
    const videoData = await responseClone.arrayBuffer();
    
    // Create metadata object
    const metadata: TransformationMetadata = createTransformationMetadata(
      sourcePath,
      options,
      responseClone,
      ttl
    );
    
    // Store in KV with the versioned key
    if (ttl) {
      await kvNamespace.put(versionedKey, videoData, { metadata, expirationTtl: ttl });
    } else {
      await kvNamespace.put(versionedKey, videoData, { metadata });
    }
    
    logDebug('Successfully stored in KV cache with version', {
      versionedKey,
      version,
      size: metadata.contentLength,
      ttl,
      expiresAt: new Date(Date.now() + (ttl * 1000)).toISOString()
    });
    
    return true;
  } catch (err) {
    logDebug('Error storing in KV cache', {
      sourcePath,
      error: err instanceof Error ? err.message : String(err)
    });
    return false;
  }
}
```

### 6. Create a New Cache Orchestrator

Replace the existing cache orchestrator with a simplified version in `src/utils/versionedCacheOrchestrator.ts`:

```typescript
/**
 * Versioned Cache Orchestrator for video-resizer
 * 
 * This utility manages the versioned KV caching system for transformed videos
 */

import { EnvVariables } from '../config/environmentConfig';
import { getCurrentVersion, incrementVersion } from '../services/versionManagerService';
import { getFromKVCache, storeInKVCache, TransformOptions } from './kvCacheUtils';
import { createLogger, debug as pinoDebug } from '../utils/pinoLogger';
import { getCurrentContext } from '../utils/legacyLoggerAdapter';
import { addBreadcrumb } from '../utils/requestContext';
import { generateBaseKVKey } from '../services/kvStorageService';

/**
 * Helper for logging debug messages
 */
function logDebug(message: string, data?: Record<string, unknown>): void {
  const requestContext = getCurrentContext();
  if (requestContext) {
    const logger = createLogger(requestContext);
    pinoDebug(requestContext, logger, 'VersionedCacheOrchestrator', message, data);
  } else {
    console.debug(`VersionedCacheOrchestrator: ${message}`, data || {});
  }
}

/**
 * Append version parameter to URL for cache busting
 * 
 * @param url - Original URL object
 * @param version - Version number to append
 * @returns New URL with version parameter
 */
function appendVersionToUrl(url: URL, version: number): URL {
  const newUrl = new URL(url.toString());
  newUrl.searchParams.set('v', version.toString());
  return newUrl;
}

/**
 * Cache orchestrator that uses versioned KV caching
 * 
 * Order of operations:
 * 1. Check KV storage with current version
 * 2. If cache miss, check if previous version exists
 * 3. If previous version exists, increment version and add to request
 * 4. Execute handler to generate response
 * 5. Store result in KV with current version
 * 
 * @param request - Original request
 * @param env - Environment variables
 * @param handler - Function to execute if cache miss occurs
 * @param options - Transformation options for KV cache
 * @returns Response from cache or handler
 */
export async function withVersionedCaching(
  request: Request,
  env: EnvVariables,
  handler: (requestToUse: Request) => Promise<Response>,
  options?: TransformOptions
): Promise<Response> {
  const requestContext = getCurrentContext();
  const url = new URL(request.url);
  
  // Helper for adding breadcrumbs
  const addCacheBreadcrumb = (action: string, data: Record<string, unknown>) => {
    if (requestContext) {
      addBreadcrumb(requestContext, 'VersionedCache', action, data);
    }
  };
  
  // Skip cache for non-GET requests or if bypass parameters are present
  const { CacheConfigurationManager } = await import('../config/CacheConfigurationManager');
  const cacheConfig = CacheConfigurationManager.getInstance();
  
  const shouldBypass = cacheConfig.shouldBypassCache(url);
  const isNotGet = request.method !== 'GET';
  const skipCache = isNotGet || shouldBypass;
  
  if (skipCache) {
    logDebug('Bypassing cache', { method: request.method, shouldBypass, url: request.url });
    return handler(request);
  }
  
  try {
    // Only continue if we have valid options and environment
    if (!options || !env.VIDEO_TRANSFORMATIONS_CACHE) {
      logDebug('Missing options or KV namespace, executing handler directly');
      return handler(request);
    }
    
    const sourcePath = url.pathname;
    
    // Add IMQuery parameters to options for cache key generation
    const imwidth = url.searchParams.get('imwidth');
    const imheight = url.searchParams.get('imheight');
    
    const customData: Record<string, unknown> = {};
    if (imwidth) customData.imwidth = imwidth;
    if (imheight) customData.imheight = imheight;
    
    const lookupOptions: TransformOptions = {
      ...options,
      customData: Object.keys(customData).length > 0 ? customData : undefined
    };
    
    // Step 1: Generate base key for version lookup
    const baseKey = generateBaseKVKey(sourcePath, lookupOptions);
    
    // Step 2: Get current version for this key
    const currentVersion = await getCurrentVersion(env, baseKey);
    logDebug('Current version for key', { baseKey, currentVersion });
    
    // Step 3: Try to get cached response with current version
    const cachedResult = await getFromKVCache(env, sourcePath, lookupOptions, request);
    
    if (cachedResult) {
      logDebug('Cache hit with current version', { 
        baseKey, 
        version: currentVersion,
        contentType: cachedResult.response.headers.get('content-type')
      });
      
      addCacheBreadcrumb('Cache hit with current version', {
        baseKey,
        version: currentVersion,
        url: request.url
      });
      
      return cachedResult.response;
    }
    
    // Step 4: Cache miss for current version
    logDebug('Cache miss for current version, incrementing version', { 
      baseKey, 
      currentVersion,
      sourcePath 
    });
    
    // Step 5: Increment the version
    const newVersion = await incrementVersion(env, baseKey);
    
    // Step 6: Add version parameter to request URL for cache busting
    const versionedUrl = appendVersionToUrl(url, newVersion);
    
    logDebug('Using versioned URL for cache busting', { 
      originalUrl: url.toString(),
      versionedUrl: versionedUrl.toString(),
      newVersion,
      baseKey
    });
    
    addCacheBreadcrumb('Cache miss, using incremented version', {
      baseKey,
      oldVersion: currentVersion,
      newVersion,
      versionedUrl: versionedUrl.toString()
    });
    
    // Step 7: Create a new request with the versioned URL
    const versionedRequest = new Request(versionedUrl.toString(), {
      method: request.method,
      headers: request.headers,
      redirect: request.redirect,
      cf: request.cf
    });
    
    // Step 8: Execute handler with versioned request
    const response = await handler(versionedRequest);
    
    // Step 9: Store response in KV with the new version
    if (response.ok && response.status !== 304) {
      const contentType = response.headers.get('content-type') || '';
      const isVideoOrImage = /^(video|image)\//.test(contentType);
      
      if (isVideoOrImage) {
        // Clone the response to avoid consuming it
        const responseClone = response.clone();
        
        // Store in KV with the new version
        await storeInKVCache(env, sourcePath, responseClone, lookupOptions, newVersion);
        
        addCacheBreadcrumb('Stored response with new version', {
          baseKey,
          version: newVersion,
          contentType
        });
      }
    }
    
    // Return the original response
    return response;
  } catch (err) {
    logDebug('Error in versioned cache flow', {
      error: err instanceof Error ? err.message : String(err),
      url: request.url
    });
    
    // Fallback to handler directly if caching fails
    return handler(request);
  }
}
```

### 7. Update Video Handler with Cache

Modify `src/handlers/videoHandlerWithCache.ts` to use the new versioned caching:

```typescript
/**
 * Video handler implementation with versioned KV caching integration
 */

import { EnvVariables } from '../config/environmentConfig';
import { withVersionedCaching } from '../utils/versionedCacheOrchestrator';
import { transformVideo } from '../services/videoTransformationService';
import { getVideoPathPatterns } from '../config';
import { createLogger } from '../utils/pinoLogger';
import { getCurrentContext, addBreadcrumb } from '../utils/requestContext';
import { logErrorWithContext, withErrorHandling } from '../utils/errorHandlingUtils';

/**
 * Handle video transformation requests with integrated versioned caching
 * 
 * This handler uses a versioned KV caching approach that enables controlled cache invalidation
 * through version tracking.
 * 
 * @param request - The incoming request
 * @param env - Environment variables including KV bindings
 * @param ctx - Execution context
 * @returns The response with the transformed video
 */
export const handleRequestWithCaching = withErrorHandling<
  [Request, EnvVariables, ExecutionContext],
  Response
>(
  async function handleRequestWithCachingImpl(
    request: Request, 
    env: EnvVariables, 
    ctx: ExecutionContext
  ): Promise<Response> {
    // Pass execution context to environment for waitUntil usage in caching
    (env as any).executionCtx = ctx;
    const url = new URL(request.url);
    const pathPatterns = getVideoPathPatterns();
    
    // Parse debug information from query parameters
    const debugInfo = {
      isEnabled: url.searchParams.has('debug'),
      isVerbose: url.searchParams.get('debug') === 'verbose',
      includeHeaders: true,
      format: url.searchParams.get('debug_format') || 'json'
    };
    
    // Get transformation options from query parameters
    const videoOptions = {
      quality: url.searchParams.get('quality') || undefined,
      compression: url.searchParams.get('compression') || undefined,
      width: url.searchParams.get('width') ? parseInt(url.searchParams.get('width') || '', 10) : undefined,
      height: url.searchParams.get('height') ? parseInt(url.searchParams.get('height') || '', 10) : undefined,
      derivative: url.searchParams.get('derivative') || undefined,
      format: url.searchParams.get('format') || undefined,
      loop: url.searchParams.has('loop') ? url.searchParams.get('loop') === 'true' : undefined,
      autoplay: url.searchParams.has('autoplay') ? url.searchParams.get('autoplay') === 'true' : undefined,
      muted: url.searchParams.has('muted') ? url.searchParams.get('muted') === 'true' : undefined,
      duration: url.searchParams.has('duration') ? url.searchParams.get('duration') || '' : undefined,
      fps: url.searchParams.has('fps') ? parseInt(url.searchParams.get('fps') || '', 10) : undefined
    };
    
    try {
      // Set up request context
      const { createRequestContext, setCurrentContext, addBreadcrumb, getCurrentContext } = 
        await import('../utils/requestContext');
      
      let requestContext = getCurrentContext();
      
      if (!requestContext) {
        requestContext = createRequestContext(request, ctx);
        setCurrentContext(requestContext);
      }
      
      const logger = createLogger(requestContext);
      
      // Log detailed request information
      logger.info('Video transformation request with versioned caching', {
        path: url.pathname,
        requestId: requestContext.requestId,
        method: request.method,
        hasOptions: Object.values(videoOptions).some(v => v !== undefined),
        options: {
          width: videoOptions.width,
          height: videoOptions.height,
          derivative: videoOptions.derivative,
          format: videoOptions.format
        }
      });
      
      // Add breadcrumb for request tracing
      addBreadcrumb(requestContext, 'VideoHandler', 'Processing video request with versioned caching', {
        url: request.url,
        path: url.pathname,
        timestamp: new Date().toISOString()
      });
    } catch (err) {
      logErrorWithContext('Failed to initialize request context', err, {
        url: request.url,
        path: url.pathname
      }, 'VideoHandlerWithCache');
    }
    
    // Wrap with versioned caching middleware
    return withVersionedCaching(
      request,
      env,
      (requestToUse) => transformVideo(requestToUse, videoOptions, pathPatterns, debugInfo, env),
      videoOptions
    );
  },
  {
    functionName: 'handleRequestWithCaching',
    component: 'VideoHandlerWithCache',
    logErrors: true
  });
```

### 8. Create Admin API for Cache Management

Add an admin API for cache management in `src/handlers/cacheAdminHandler.ts`:

```typescript
/**
 * Admin API for cache management operations
 */

import { EnvVariables } from '../config/environmentConfig';
import { resetVersion } from '../services/versionManagerService';
import { generateBaseKVKey } from '../services/kvStorageService';
import { createLogger, debug as pinoDebug } from '../utils/pinoLogger';
import { getCurrentContext } from '../utils/legacyLoggerAdapter';
import { withErrorHandling } from '../utils/errorHandlingUtils';

/**
 * Helper for logging debug messages
 */
function logDebug(message: string, data?: Record<string, unknown>): void {
  const requestContext = getCurrentContext();
  if (requestContext) {
    const logger = createLogger(requestContext);
    pinoDebug(requestContext, logger, 'CacheAdmin', message, data);
  } else {
    console.debug(`CacheAdmin: ${message}`, data || {});
  }
}

/**
 * Handle cache admin API requests
 * 
 * Supported operations:
 * - POST /admin/cache/purge?path=/video/path.mp4 - Purge specific path from cache
 * - POST /admin/cache/purge/all - Purge all cache entries
 * 
 * @param request - The incoming request
 * @param env - Environment variables including KV bindings
 * @param ctx - Execution context
 * @returns API response with operation result
 */
export const handleCacheAdminRequest = withErrorHandling<
  [Request, EnvVariables, ExecutionContext],
  Response
>(
  async function handleCacheAdminRequestImpl(
    request: Request,
    env: EnvVariables,
    ctx: ExecutionContext
  ): Promise<Response> {
    // Verify authorization (use a configurable token)
    const authHeader = request.headers.get('Authorization') || '';
    const expectedToken = env.CACHE_ADMIN_TOKEN || 'default-admin-token';
    
    // Simple bearer token authentication
    if (!authHeader.startsWith('Bearer ') || authHeader.substring(7) !== expectedToken) {
      return new Response('Unauthorized', { status: 401 });
    }
    
    const url = new URL(request.url);
    const path = url.pathname;
    
    // Handle different admin operations
    if (path === '/admin/cache/purge/all' && request.method === 'POST') {
      // Purge all cache entries (not implemented - would require listing all keys)
      return new Response(JSON.stringify({ 
        success: false, 
        error: 'Purging all cache entries is not supported. Use KV dashboard instead.'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    } else if (path === '/admin/cache/purge' && request.method === 'POST') {
      // Purge specific path
      const videoPath = url.searchParams.get('path');
      
      if (!videoPath) {
        return new Response(JSON.stringify({ 
          success: false, 
          error: 'Missing required parameter: path' 
        }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      
      // Generate base key for the path (without specific options)
      const baseKey = generateBaseKVKey(videoPath, { mode: 'video' });
      
      // Reset the version to force cache invalidation
      const success = await resetVersion(env, baseKey);
      
      if (success) {
        logDebug('Successfully reset version for path', { path: videoPath, baseKey });
        
        return new Response(JSON.stringify({ 
          success: true, 
          message: `Cache purged for path: ${videoPath}`,
          key: baseKey
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      } else {
        logDebug('Failed to reset version for path', { path: videoPath, baseKey });
        
        return new Response(JSON.stringify({ 
          success: false, 
          error: 'Failed to reset version. Check logs for details.' 
        }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }
    
    // Unknown operation
    return new Response(JSON.stringify({ 
      success: false, 
      error: 'Unknown operation or method'
    }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' }
    });
  },
  {
    functionName: 'handleCacheAdminRequest',
    component: 'CacheAdmin',
    logErrors: true
  });
```

### 9. Update Request Router in src/index.ts

Update the request router to use the new versioned caching and admin API:

```typescript
// Handle admin API requests
if (url.pathname.startsWith('/admin/cache/')) {
  const { handleCacheAdminRequest } = await import('./handlers/cacheAdminHandler');
  return handleCacheAdminRequest(request, env, ctx);
}

// Handle video transformation requests
if (isVideoTransformPath(url.pathname)) {
  const { handleRequestWithCaching } = await import('./handlers/videoHandlerWithCache');
  return handleRequestWithCaching(request, env, ctx);
}
```

### 10. Simplify Cache Configuration

Update `src/config/CacheConfigurationManager.ts` to simplify the cache configuration:

```typescript
// Define simplified Zod schemas for cache configuration
export const CacheTTLSchema = z.object({
  ok: z.number().nonnegative().default(300), // 5 minutes for successful responses
  redirects: z.number().nonnegative().default(300), // 5 minutes for redirects
  clientError: z.number().nonnegative().default(60), // 1 minute for client errors
  serverError: z.number().nonnegative().default(10), // 10 seconds for server errors
});

export const CacheProfileSchema = z.object({
  regex: z.string().optional(),
  ttl: CacheTTLSchema.default({
    ok: 300,
    redirects: 300,
    clientError: 60,
    serverError: 10,
  }),
});

export const CacheConfigSchema = z.object({
  // Enable/disable KV caching
  enableKVCache: z.boolean().default(true),
  
  // Default behavior for cache headers
  defaultMaxAge: z.number().nonnegative().default(300),
  
  // Cache bypass parameters
  bypassQueryParameters: z.array(z.string()).default(['debug', 'nocache', 'bypass']),
  bypassHeaderName: z.string().default('Cache-Control'),
  bypassHeaderValue: z.string().default('no-cache'),
  
  // Cacheable content types
  mimeTypes: z.object({
    video: z.array(z.string()).default([
      'video/mp4', 'video/webm', 'video/ogg', 'video/x-msvideo',
      'video/quicktime', 'video/x-matroska', 'video/x-flv',
      'video/3gpp', 'video/3gpp2', 'video/mpeg',
      'application/x-mpegURL', 'application/dash+xml'
    ]),
    image: z.array(z.string()).default([
      'image/jpeg', 'image/jpg', 'image/png', 'image/webp',
      'image/gif', 'image/avif'
    ])
  }).default({
    video: [
      'video/mp4', 'video/webm', 'video/ogg', 'video/x-msvideo',
      'video/quicktime', 'video/x-matroska', 'video/x-flv', 
      'video/3gpp', 'video/3gpp2', 'video/mpeg',
      'application/x-mpegURL', 'application/dash+xml'
    ],
    image: [
      'image/jpeg', 'image/jpg', 'image/png', 'image/webp',
      'image/gif', 'image/avif'
    ]
  }),
  
  // Path-specific cache profiles
  profiles: z.record(z.string(), CacheProfileSchema).default({
    default: {
      ttl: {
        ok: 300,
        redirects: 300,
        clientError: 60,
        serverError: 10,
      }
    }
  })
});

export type CacheConfiguration = z.infer<typeof CacheConfigSchema>;
```

### 11. Create Tests for the New Functionality

Create a test for the versioned caching system in `test/kv-cache/versioned-kv-caching.spec.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getCurrentVersion, incrementVersion, resetVersion } from '../../src/services/versionManagerService';
import { withVersionedCaching } from '../../src/utils/versionedCacheOrchestrator';
import { getFromKVCache, storeInKVCache } from '../../src/utils/kvCacheUtils';
import { generateBaseKVKey, generateVersionedKVKey } from '../../src/services/kvStorageService';

// Mock dependencies
vi.mock('../../src/services/versionManagerService');
vi.mock('../../src/utils/kvCacheUtils');
vi.mock('../../src/services/kvStorageService');

describe('Versioned KV Caching', () => {
  // Mock environment and request
  const mockEnv = {
    VIDEO_TRANSFORMATIONS_CACHE: {} as KVNamespace,
    VIDEO_CACHE_KEY_VERSIONS: {} as KVNamespace
  };
  
  const mockRequest = new Request('https://example.com/videos/test.mp4?width=640&height=360');
  const mockOptions = { width: 640, height: 360 };
  
  // Handler function that returns a test response
  const mockHandler = vi.fn().mockResolvedValue(new Response('test video content', {
    headers: {
      'content-type': 'video/mp4',
      'content-length': '100'
    }
  }));
  
  beforeEach(() => {
    vi.clearAllMocks();
    
    // Mock generateBaseKVKey
    vi.mocked(generateBaseKVKey).mockReturnValue('video:videos/test.mp4:w=640:h=360');
    
    // Mock generateVersionedKVKey
    vi.mocked(generateVersionedKVKey).mockImplementation((baseKey, version) => 
      `${baseKey}:v${version}`);
  });
  
  it('should use cached response when cache hit with current version', async () => {
    // Set up mocks for cache hit
    vi.mocked(getCurrentVersion).mockResolvedValue(1);
    vi.mocked(getFromKVCache).mockResolvedValue({
      response: new Response('cached content', {
        headers: { 'content-type': 'video/mp4' }
      }),
      version: 1
    });
    
    // Execute with caching
    const response = await withVersionedCaching(mockRequest, mockEnv, mockHandler, mockOptions);
    
    // Check results
    expect(getCurrentVersion).toHaveBeenCalled();
    expect(getFromKVCache).toHaveBeenCalled();
    expect(incrementVersion).not.toHaveBeenCalled();
    expect(mockHandler).not.toHaveBeenCalled();
    
    // Check response
    const text = await response.text();
    expect(text).toBe('cached content');
  });
  
  it('should increment version and call handler on cache miss', async () => {
    // Set up mocks for cache miss
    vi.mocked(getCurrentVersion).mockResolvedValue(1);
    vi.mocked(getFromKVCache).mockResolvedValue(null);
    vi.mocked(incrementVersion).mockResolvedValue(2);
    
    // Execute with caching
    const response = await withVersionedCaching(mockRequest, mockEnv, mockHandler, mockOptions);
    
    // Check results
    expect(getCurrentVersion).toHaveBeenCalled();
    expect(getFromKVCache).toHaveBeenCalled();
    expect(incrementVersion).toHaveBeenCalled();
    expect(mockHandler).toHaveBeenCalled();
    expect(storeInKVCache).toHaveBeenCalled();
    
    // Verify the handler was called with a versioned URL
    const handlerArg = mockHandler.mock.calls[0][0];
    expect(handlerArg.url).toContain('v=2');
    
    // Check response
    const text = await response.text();
    expect(text).toBe('test video content');
  });
  
  it('should store response with the new version number after cache miss', async () => {
    // Set up mocks for cache miss
    vi.mocked(getCurrentVersion).mockResolvedValue(3);
    vi.mocked(getFromKVCache).mockResolvedValue(null);
    vi.mocked(incrementVersion).mockResolvedValue(4);
    vi.mocked(storeInKVCache).mockResolvedValue(true);
    
    // Execute with caching
    await withVersionedCaching(mockRequest, mockEnv, mockHandler, mockOptions);
    
    // Check that storeInKVCache was called with version 4
    expect(storeInKVCache).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      4 // New version
    );
  });
  
  it('should bypass cache for non-GET requests', async () => {
    const postRequest = new Request('https://example.com/videos/test.mp4', { method: 'POST' });
    
    // Execute with caching
    await withVersionedCaching(postRequest, mockEnv, mockHandler, mockOptions);
    
    // Should skip cache operations
    expect(getCurrentVersion).not.toHaveBeenCalled();
    expect(getFromKVCache).not.toHaveBeenCalled();
    expect(incrementVersion).not.toHaveBeenCalled();
    
    // Should call handler directly
    expect(mockHandler).toHaveBeenCalledWith(postRequest);
  });
  
  it('should bypass cache for requests with bypass parameters', async () => {
    const bypassRequest = new Request('https://example.com/videos/test.mp4?debug=true');
    
    // Mock shouldBypassCache to return true
    vi.mock('../../src/config/CacheConfigurationManager', () => ({
      CacheConfigurationManager: {
        getInstance: () => ({
          shouldBypassCache: () => true,
          getConfig: () => ({
            enableKVCache: true
          })
        })
      }
    }));
    
    // Execute with caching
    await withVersionedCaching(bypassRequest, mockEnv, mockHandler, mockOptions);
    
    // Should skip cache operations
    expect(getCurrentVersion).not.toHaveBeenCalled();
    expect(getFromKVCache).not.toHaveBeenCalled();
    expect(incrementVersion).not.toHaveBeenCalled();
    
    // Should call handler directly
    expect(mockHandler).toHaveBeenCalledWith(bypassRequest);
  });
});
```

### 12. Update Wrangler Configuration

Update the wrangler.jsonc file to include the new KV namespace for all environments:

```jsonc
"kv_namespaces": [
  {
    "binding": "VIDEO_CONFIGURATION_STORE",
    "id": "ddaf6d5142af4f79b39defe745dac556"
  },
  {
    "binding": "VIDEO_TRANSFORMATIONS_CACHE",
    "id": "8e790768576242cc98fa3e4aa327f815"
  },
  {
    "binding": "VIDEO_CACHE_KEY_VERSIONS",
    "id": "949610c936b8480bad5b61f3aa934de1"
  }
]
```

## Migration Steps

1. Deploy the new configuration to add the VERSION_KV namespace
2. Deploy the code with versioned caching
3. Verify the KV version tracking works correctly using debug headers
4. Test cache invalidation through version increments
5. Consider adding a cleanup mechanism for old versions eventually

## Implementation Details

The versioned KV caching approach works as follows:

1. **Cache Key Structure**: Base keys follow the format `{mode}:{path}:{params}`. Versioned keys add `:v{version}` at the end.
2. **Version Tracking**: Each base key has a corresponding version number stored in `VIDEO_CACHE_KEY_VERSIONS` KV namespace.
3. **Cache Lookup Process**:
   - Generate base key for the request
   - Get current version number from the version KV
   - Look up the fully versioned key in the cache KV
   - If found, return the cached content
   - If not found, increment the version and add version parameter to URL
   - Call the origin with the version parameter to force a fresh response
   - Cache the response with the new version number

4. **Cache Invalidation**:
   - When a cache entry needs to be invalidated, simply increment its version number
   - This causes subsequent requests to miss and fetch fresh content
   - No need to purge the old content; it will naturally expire

5. **Version Parameter**: The `v={version}` query parameter is added to URL requests to ensure the origin's cache is also busted when needed.

## Cleanup Opportunities

With this simplified approach, we can eliminate or significantly reduce:

1. Cache API-related code (cacheManagementService.ts, cacheCfUtils.ts)
2. Complex range request handling in multiple places (delegated to media proxy)
3. Complex cache orchestration logic with multiple cache layers

## Testing Strategy

1. **Unit Tests**: Test version management service and versioned cache orchestrator
2. **Integration Tests**: Test end-to-end flow with KV mocks
3. **Manual Testing**: Verify cache hit/miss behavior and version increments

## Advantages

- **Simplified Architecture**: Single source of truth for cached content
- **Controlled Cache Invalidation**: Version-based invalidation without purging
- **Better Range Request Handling**: Leveraging media proxy's native support
- **Reduced Complexity**: Eliminated multiple caching layers

## Monitoring Considerations

- Add debug headers for cache version tracking
- Log version increments and cache operations
- Track version counts to identify frequently invalidated content

## Next Steps

1. **Test in Development Environment**: Deploy the changes to the development environment and verify functionality.
2. **Phase out Cache API Usage**: Gradually remove dependencies on the Cache API and CF object caching.
3. **Optimize Version KV Usage**: Add TTL to version KV entries to prevent unbounded growth.
4. **Add Version Monitoring**: Create monitoring for version increment rates to detect potential issues.
5. **Documentation Updates**: Update user documentation with information about the new caching strategy.

## Summary

The versioned KV caching approach provides a clean, efficient way to handle video caching with controlled invalidation. By appending version numbers to keys and using query parameters to bust origin caches, we can ensure fresh content when needed while maintaining excellent performance for cached content. This approach is simpler to maintain, offers better control over cache invalidation, and delegates complex tasks like range request handling to the media proxy, which already handles it well.
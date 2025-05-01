# KV Cache Implementation

*Last Updated: May 1, 2025*

## Table of Contents

- [Overview](#overview)
- [KV Storage Components](#kv-storage-components)
- [Cache Key Generation](#cache-key-generation)
- [Metadata Structure](#metadata-structure)
- [Storage Operations](#storage-operations)
- [Retrieval Operations](#retrieval-operations)
- [TTL Management](#ttl-management)
- [Cache Tags](#cache-tags)
- [Bypass Mechanisms](#bypass-mechanisms)
- [Error Handling](#error-handling)
- [Performance Optimizations](#performance-optimizations)
- [Cache Versioning Integration](#cache-versioning-integration)
- [Monitoring and Diagnostics](#monitoring-and-diagnostics)
- [Best Practices](#best-practices)
- [Implementation Examples](#implementation-examples)

## Overview

The KV (Key-Value) cache implementation in the Video Resizer provides a global, persistent caching layer for transformed video content. It leverages Cloudflare's KV storage to cache transformed videos, reducing origin load, speeding up content delivery, and improving the user experience.

KV caching is particularly valuable for:
- Content that's accessed from multiple edge locations
- Transformations that require significant processing
- Videos that need consistent global availability
- High-reuse transformations with standardized parameters

This document explains the technical implementation details of the KV caching system.

## KV Storage Components

The KV caching system consists of several key components:

### 1. kvStorageService.ts

Core service responsible for KV operations:
- Manages interaction with Cloudflare KV
- Handles key generation and normalization
- Manages metadata association
- Controls TTL settings
- Implements cache bypass logic

```typescript
export class KVStorageService {
  private readonly namespace: KVNamespace;
  private readonly versionService: CacheVersionService;
  
  constructor(env: Env) {
    this.namespace = env.VIDEO_TRANSFORMATIONS_CACHE;
    this.versionService = new CacheVersionService(env);
  }
  
  public async get(key: string): Promise<Response | null> {
    // KV retrieval implementation
  }
  
  public async put(key: string, value: Response, options?: { ttl?: number }): Promise<void> {
    // KV storage implementation
  }
  
  // Additional methods
}
```

### 2. kvCacheUtils.ts

Helper utilities for KV caching:
- Provides key generation functions
- Handles metadata extraction and processing
- Implements cache bypass checks
- Manages TTL calculations
- Provides content type filtering

```typescript
// Key generation function
export function generateCacheKey(path: string, options: VideoTransformOptions): string {
  // Key generation logic
}

// Bypass check function
export function shouldBypassKVCache(
  requestContext: RequestContext | null,
  sourcePath: string
): boolean {
  // Bypass logic
}

// TTL determination function
export function getTtlForResponse(response: Response, ttlConfig: TTLConfig): number {
  // TTL calculation
}
```

### 3. cacheOrchestrator.ts

Coordinates cache operations across different caching layers:
- Determines which cache layer to check
- Handles background storage with waitUntil
- Manages error handling and fallbacks
- Integrates with cache versioning
- Provides consistent cache interfaces

```typescript
export class CacheOrchestrator {
  private readonly kvStorage: KVStorageService;
  private readonly versionService: CacheVersionService;
  
  constructor(env: Env) {
    this.kvStorage = new KVStorageService(env);
    this.versionService = new CacheVersionService(env);
  }
  
  public async getCachedResponse(
    request: Request,
    options: VideoTransformOptions
  ): Promise<Response | null> {
    // Cache retrieval orchestration
  }
  
  public async cacheResponse(
    request: Request,
    response: Response,
    options: VideoTransformOptions
  ): Promise<void> {
    // Cache storage orchestration
  }
}
```

## Cache Key Generation

The cache key structure is crucial for efficient storage and retrieval:

### Key Format

```
video:<source_path>[:option=value][:option=value]...[:version=N]
```

For example:
- `video:videos/sample.mp4` (original video)
- `video:videos/sample.mp4:derivative=mobile` (mobile derivative)
- `video:videos/sample.mp4:w=640:h=360:f=mp4:q=high:version=2` (specific transformation with version)

### Implementation

The key generation normalizes and sorts parameters for consistency:

```typescript
export function generateCacheKey(
  sourcePath: string,
  options: VideoTransformOptions,
  version?: number
): string {
  // Start with base key
  let key = `video:${sanitizePath(sourcePath)}`;
  
  // Add derivative if present
  if (options.derivative) {
    key += `:derivative=${options.derivative}`;
    return version ? `${key}:version=${version}` : key;
  }
  
  // Add sorted transform parameters
  const paramPairs: string[] = [];
  
  if (options.width) paramPairs.push(`w=${options.width}`);
  if (options.height) paramPairs.push(`h=${options.height}`);
  if (options.fit) paramPairs.push(`fit=${options.fit}`);
  if (options.format) paramPairs.push(`f=${options.format}`);
  if (options.quality) paramPairs.push(`q=${options.quality}`);
  if (options.mode && options.mode !== 'video') paramPairs.push(`mode=${options.mode}`);
  
  // Mode-specific parameters
  if (options.mode === 'frame' && options.time) {
    paramPairs.push(`t=${options.time}`);
  } else if (options.mode === 'spritesheet') {
    if (options.time) paramPairs.push(`t=${options.time}`);
    if (options.duration) paramPairs.push(`d=${options.duration}`);
  }
  
  // Sort for consistent order
  paramPairs.sort();
  
  // Add parameters to key
  if (paramPairs.length > 0) {
    key += `:${paramPairs.join(':')}`;
  }
  
  // Add version if provided
  if (version) {
    key += `:version=${version}`;
  }
  
  return key;
}
```

### IMQuery Key Normalization

For IMQuery requests, the system uses derivative-based keys:

```typescript
// If IMQuery maps to a derivative, use the derivative for the cache key
if (isIMQuery && derivativeMapping) {
  return `video:${sanitizePath(sourcePath)}:derivative=${derivativeMapping.name}`;
}
```

This significantly improves cache hit rates by mapping many dimension combinations to a single derivative-based key.

## Metadata Structure

Each KV entry includes detailed metadata:

```typescript
interface TransformationMetadata {
  // Original source path
  sourcePath: string;
  
  // Transformation parameters
  width?: number | null;
  height?: number | null;
  format?: string | null;
  quality?: string | null;
  compression?: string | null;
  derivative?: string | null;
  mode?: string;
  
  // Cache information
  cacheTags: string[];
  cacheVersion?: number;
  
  // Content information
  contentType: string;
  contentLength: number;
  
  // Timestamps
  createdAt: number;
  expiresAt?: number;
  
  // Additional metadata
  duration?: number | null;
  fps?: number | null;
  customData?: Record<string, unknown>;
}
```

This metadata is stored in the KV entry's metadata field and is used for:
- Setting appropriate response headers
- Managing cache lifetime
- Organizing content with cache tags
- Providing diagnostic information
- Supporting cache versioning

## Storage Operations

The storage process follows these steps:

### 1. Check Cache Eligibility

```typescript
// Check if this response should be cached
if (!cacheConfig.cacheability || shouldBypassKVCache(context, sourcePath)) {
  logDebug('Skipping KV storage due to cache bypass', { sourcePath });
  return originalResponse;
}
```

### 2. Generate Cache Key

```typescript
// Generate the cache key
const version = options.cacheVersion || 
  await versionService.getVersionForPath(sourcePath);
const cacheKey = generateCacheKey(sourcePath, options, version);
```

### 3. Extract Response Body

```typescript
// Clone the response and extract the body
const responseClone = response.clone();
const body = await responseClone.arrayBuffer();
```

### 4. Create Metadata

```typescript
// Create metadata object
const metadata: TransformationMetadata = {
  sourcePath,
  width: options.width,
  height: options.height,
  format: options.format,
  quality: options.quality,
  compression: options.compression,
  derivative: options.derivative,
  mode: options.mode,
  cacheTags: generateCacheTags(sourcePath, options),
  cacheVersion: version,
  contentType: responseClone.headers.get('Content-Type') || 'video/mp4',
  contentLength: parseInt(responseClone.headers.get('Content-Length') || '0'),
  createdAt: Date.now()
};

// Add TTL-based expiration if applicable
const ttl = getTtlForResponse(responseClone, ttlConfig);
if (ttl > 0) {
  metadata.expiresAt = Date.now() + (ttl * 1000);
}
```

### 5. Store in KV

```typescript
// Store in KV with metadata
await this.namespace.put(cacheKey, body, {
  expirationTtl: ttl > 0 ? ttl : undefined,
  metadata
});

// Log storage success
logDebug('Stored in KV cache', {
  key: cacheKey,
  contentType: metadata.contentType,
  contentLength: metadata.contentLength,
  ttl: ttl > 0 ? ttl : 'unlimited'
});
```

## Retrieval Operations

The retrieval process follows these steps:

### 1. Check Cache Eligibility

```typescript
// Check if cache should be bypassed
if (shouldBypassKVCache(context, sourcePath)) {
  logDebug('Bypassing KV cache', { sourcePath });
  return null;
}
```

### 2. Generate Cache Key

```typescript
// Get current version
const version = options.cacheVersion || 
  await versionService.getVersionForPath(sourcePath);

// Generate the cache key
const cacheKey = generateCacheKey(sourcePath, options, version);
```

### 3. Check KV Cache

```typescript
// Try to retrieve from KV
const cachedValue = await this.namespace.getWithMetadata(cacheKey, 'arrayBuffer');
```

### 4. Process Cache Hit

```typescript
if (cachedValue.value) {
  const metadata = cachedValue.metadata as TransformationMetadata;
  
  // Create headers from metadata
  const headers = new Headers();
  headers.set('Content-Type', metadata.contentType);
  headers.set('Content-Length', metadata.contentLength.toString());
  headers.set('Cache-Control', `max-age=${ttl}`);
  headers.set('X-Cache-Source', 'kv');
  headers.set('X-Cache-Key', cacheKey);
  headers.set('X-Cache-Version', (metadata.cacheVersion || version).toString());
  
  // Add validation headers
  headers.set('ETag', `"kv-${metadata.cacheVersion || version}-${metadata.contentLength}"`);
  headers.set('Last-Modified', new Date(metadata.createdAt).toUTCString());
  
  // Create response from cached value
  const response = new Response(cachedValue.value, {
    status: 200,
    headers
  });
  
  // Log cache hit
  logDebug('KV cache hit', {
    key: cacheKey,
    contentType: metadata.contentType,
    contentLength: metadata.contentLength
  });
  
  return response;
}
```

### 5. Handle Range Requests

```typescript
// If this is a range request, process it
if (request.headers.has('Range') && cachedValue.value) {
  const metadata = cachedValue.metadata as TransformationMetadata;
  const range = parseRangeHeader(request.headers.get('Range') || '', metadata.contentLength);
  
  if (range) {
    // Extract the requested range
    const fullBody = cachedValue.value as ArrayBuffer;
    const rangeBody = fullBody.slice(range.start, range.end + 1);
    
    // Create a range response
    const headers = new Headers();
    headers.set('Content-Type', metadata.contentType);
    headers.set('Content-Length', (range.end - range.start + 1).toString());
    headers.set('Content-Range', `bytes ${range.start}-${range.end}/${metadata.contentLength}`);
    headers.set('Accept-Ranges', 'bytes');
    headers.set('X-Cache-Source', 'kv-range');
    
    const rangeResponse = new Response(rangeBody, {
      status: 206,
      headers
    });
    
    return rangeResponse;
  }
}
```

## TTL Management

TTL (Time-To-Live) values are determined based on response status:

```typescript
export function getTtlForResponse(response: Response, ttlConfig: TTLConfig): number {
  const status = response.status;
  
  // Determine TTL based on status code
  if (status >= 200 && status < 300) {
    return ttlConfig.ok;
  } else if (status >= 300 && status < 400) {
    return ttlConfig.redirects;
  } else if (status >= 400 && status < 500) {
    return ttlConfig.clientError;
  } else if (status >= 500) {
    return ttlConfig.serverError;
  }
  
  // Default to the OK TTL if status doesn't match
  return ttlConfig.ok;
}
```

Default TTL values:

| Status Range | Description | Default TTL |
|--------------|-------------|-------------|
| 200-299 | Success | 86400s (24h) |
| 300-399 | Redirects | 3600s (1h) |
| 400-499 | Client Errors | 60s (1m) |
| 500-599 | Server Errors | 10s (10s) |

These values can be configured through the cache configuration:

```json
{
  "cache": {
    "kvTtl": {
      "ok": 86400,
      "redirects": 3600,
      "clientError": 60,
      "serverError": 10
    }
  }
}
```

## Cache Tags

Cache tags are labels attached to cached items for grouped management:

```typescript
export function generateCacheTags(sourcePath: string, options: VideoTransformOptions): string[] {
  const tags: string[] = [];
  
  // Add source-based tag
  const sourceIdentifier = getSourceIdentifier(sourcePath);
  tags.push(`video-${sourceIdentifier}`);
  
  // Add derivative-based tag
  if (options.derivative) {
    tags.push(`video-derivative-${options.derivative}`);
  }
  
  // Add format-based tag
  if (options.format) {
    tags.push(`video-format-${options.format}`);
  }
  
  // Add mode-based tag
  if (options.mode) {
    tags.push(`video-mode-${options.mode}`);
  }
  
  return tags;
}
```

These tags enable organized cache management:
- Purge all videos from a specific source with `video-<source>`
- Purge all mobile derivatives with `video-derivative-mobile`
- Purge all WebM videos with `video-format-webm`

## Bypass Mechanisms

Several conditions trigger cache bypass:

### 1. Debug Mode

```typescript
// Check for debug query parameter
if (url.searchParams.has('debug')) {
  logDebug('Bypassing KV cache due to debug mode', { sourcePath });
  return true;
}
```

### 2. Cache Control Headers

```typescript
// Check for cache control headers
const cacheControl = request.headers.get('Cache-Control');
if (cacheControl && (
    cacheControl.includes('no-store') || 
    cacheControl.includes('no-cache')
  )) {
  logDebug('Bypassing KV cache due to Cache-Control header', { 
    sourcePath,
    cacheControl 
  });
  return true;
}
```

### 3. Explicit Bypass Parameter

```typescript
// Check for explicit cache bypass parameter
if (url.searchParams.get('cache') === 'false') {
  logDebug('Bypassing KV cache due to explicit cache=false parameter', { 
    sourcePath 
  });
  return true;
}
```

### 4. Configuration-Based Bypass

```typescript
// Check if KV cache is disabled in configuration
if (!cacheConfig.enableKVCache) {
  logDebug('Bypassing KV cache due to configuration setting', { 
    sourcePath,
    enableKVCache: false 
  });
  return true;
}
```

## Error Handling

The KV implementation includes robust error handling:

### 1. KV Operation Errors

```typescript
try {
  await this.namespace.put(cacheKey, body, options);
} catch (error) {
  logErrorWithContext(
    'Error storing in KV cache',
    error,
    { key: cacheKey, contentType: metadata.contentType },
    'KVStorageService'
  );
  // Continue execution despite the error
}
```

### 2. Malformed Responses

```typescript
// Validate content length
const contentLength = parseInt(response.headers.get('Content-Length') || '0');
if (!contentLength || contentLength <= 0) {
  logWarn('Skipping KV storage for response with invalid Content-Length', {
    contentLength,
    key: cacheKey
  });
  return;
}

// Validate content type
const contentType = response.headers.get('Content-Type');
if (!contentType) {
  logWarn('Skipping KV storage for response with missing Content-Type', {
    key: cacheKey
  });
  return;
}
```

### 3. Non-Video Content

```typescript
// Only cache video content
const isVideoContent = contentType.startsWith('video/') || 
  VIDEO_MIME_TYPES.some(mimeType => contentType.startsWith(mimeType));

if (!isVideoContent) {
  logDebug('Skipping KV storage for non-video response', {
    contentType,
    key: cacheKey
  });
  return;
}
```

### 4. Error Responses

```typescript
// Check if response is an error (4xx, 5xx)
const statusCode = responseClone.status;
const isError = statusCode >= 400;

// Skip KV storage for errors
if (isError) {
  logDebug('Skipping KV storage for error response', { statusCode });
  return false;
}
```

## Performance Optimizations

Several optimizations improve KV cache performance:

### 1. Derivative-Based Caching

```typescript
// If IMQuery maps to a derivative, use the derivative for the cache key
if (isIMQuery && derivativeMapping) {
  const derivativeKey = `video:${sanitizePath(sourcePath)}:derivative=${derivativeMapping.name}`;
  return version ? `${derivativeKey}:version=${version}` : derivativeKey;
}
```

This maps many similar requests to a single cache entry, improving hit rates.

### 2. Minimal Key Parameters

```typescript
// Only include essential parameters in the cache key
const paramPairs: string[] = [];

if (options.width) paramPairs.push(`w=${options.width}`);
if (options.height) paramPairs.push(`h=${options.height}`);
if (options.format) paramPairs.push(`f=${options.format}`);
if (options.quality) paramPairs.push(`q=${options.quality}`);
if (options.mode && options.mode !== 'video') paramPairs.push(`mode=${options.mode}`);
```

Only essential parameters are included in cache keys to avoid unnecessary variations.

### 3. Streamlined Range Handling

For small videos, the implementation fetches the entire content:

```typescript
// For videos under the size threshold, retrieve the full content
if (contentLength < RANGE_THRESHOLD) {
  const fullResponse = await getFullResponse(request, sourcePath, options);
  // Set appropriate headers for range support
  return fullResponse;
}
```

For larger videos, it delegates to the Cache API:

```typescript
// For larger videos, delegate range handling to the Cache API
await cacheInCacheApi(request, sourcePath, options, response);
return cache.match(request);
```

### 4. Cache Warming

For predictable access patterns, cache warming is supported:

```typescript
export async function warmCache(
  env: Env,
  paths: string[],
  derivatives: string[]
): Promise<void> {
  const kvStorage = new KVStorageService(env);
  
  // Create a list of cache operations
  const operations: Promise<void>[] = [];
  
  // For each path, warm the cache with all derivatives
  for (const path of paths) {
    for (const derivative of derivatives) {
      const options: VideoTransformOptions = { derivative };
      operations.push(kvStorage.warmCache(path, options));
    }
  }
  
  // Execute all operations in parallel
  await Promise.all(operations);
}
```

## Cache Versioning Integration

The KV cache integrates with the cache versioning system:

### 1. Version Retrieval

```typescript
// Get current version
const version = options.cacheVersion || 
  await versionService.getVersionForPath(sourcePath);
```

### 2. Versioned Keys

```typescript
// Add version to the cache key
const cacheKey = generateCacheKey(sourcePath, options, version);
```

### 3. Version Metadata

```typescript
// Add version to metadata
const metadata: TransformationMetadata = {
  // ... other metadata
  cacheVersion: version
};
```

### 4. Version Headers

```typescript
// Add version information to response headers
headers.set('X-Cache-Version', version.toString());
```

For detailed information on cache versioning, see the [Cache Versioning documentation](./versioning.md).

## Monitoring and Diagnostics

The KV implementation includes comprehensive monitoring:

### 1. Detailed Logging

```typescript
logDebug('KV cache hit', {
  key: cacheKey,
  contentType: metadata.contentType,
  contentLength: metadata.contentLength,
  createdAt: metadata.createdAt,
  age: (Date.now() - metadata.createdAt) / 1000
});
```

### 2. Performance Tracking

```typescript
// Start timing
const startTime = performance.now();

// Perform operation
const result = await this.namespace.get(key, 'arrayBuffer');

// Record duration
const duration = performance.now() - startTime;

// Log performance
if (duration > SLOW_OPERATION_THRESHOLD) {
  logWarn('Slow KV operation', {
    operation: 'get',
    key,
    duration,
    threshold: SLOW_OPERATION_THRESHOLD
  });
}
```

### 3. Debug Headers

```typescript
// Add diagnostic headers
headers.set('X-Cache-Source', 'kv');
headers.set('X-Cache-Key', cacheKey);
headers.set('X-Cache-Hit', 'true');
headers.set('X-Cache-Hit-Time', new Date().toISOString());
headers.set('X-Cache-Age', ((Date.now() - metadata.createdAt) / 1000).toString());
```

### 4. Debug UI Integration

The KV cache system integrates with the Debug UI:

```typescript
// Add KV cache information to diagnostics
if (context.diagnosticsInfo) {
  context.diagnosticsInfo.cache = {
    source: 'kv',
    key: cacheKey,
    hit: true,
    version: metadata.cacheVersion || version,
    createdAt: metadata.createdAt,
    age: (Date.now() - metadata.createdAt) / 1000,
    ttl: getTtlForResponse(response, ttlConfig),
    contentType: metadata.contentType,
    contentLength: metadata.contentLength,
    tags: metadata.cacheTags
  };
}
```

## Best Practices

1. **Optimize Cache Keys**:
   - Use derivatives for common transformations
   - Include only essential parameters in keys
   - Normalize parameters for consistency

2. **Configure Appropriate TTLs**:
   - Use longer TTLs for static content
   - Use shorter TTLs for dynamic content
   - Consider response status when setting TTLs

3. **Manage Cache Size**:
   - Use cache tags for organized management
   - Set appropriate expiration times
   - Monitor KV storage usage

4. **Error Handling**:
   - Implement graceful fallbacks for KV errors
   - Log detailed information for debugging
   - Validate response properties before caching

5. **Performance Monitoring**:
   - Track KV operation durations
   - Monitor cache hit rates
   - Identify slow operations

## Implementation Examples

### Basic KV Cache Retrieval

```typescript
export async function getFromKVCache(
  env: Env,
  sourcePath: string,
  options: VideoTransformOptions
): Promise<Response | null> {
  try {
    // Get current version
    const versionService = new CacheVersionService(env);
    const version = await versionService.getVersionForPath(sourcePath);
    
    // Generate cache key
    const cacheKey = generateCacheKey(sourcePath, options, version);
    
    // Try to retrieve from KV
    const result = await env.VIDEO_TRANSFORMATIONS_CACHE.getWithMetadata(
      cacheKey,
      'arrayBuffer'
    );
    
    // If found, create response from cached value
    if (result.value) {
      const metadata = result.metadata as TransformationMetadata;
      
      // Create headers
      const headers = new Headers();
      headers.set('Content-Type', metadata.contentType);
      headers.set('Content-Length', metadata.contentLength.toString());
      headers.set('X-Cache-Source', 'kv');
      
      // Create response
      const response = new Response(result.value, {
        status: 200,
        headers
      });
      
      return response;
    }
    
    // Return null if not found
    return null;
  } catch (error) {
    // Log error and return null
    console.error('Error retrieving from KV cache', error);
    return null;
  }
}
```

### KV Cache Storage

```typescript
export async function storeInKVCache(
  env: Env,
  sourcePath: string,
  response: Response,
  options: VideoTransformOptions
): Promise<void> {
  try {
    // Clone response and extract body
    const responseClone = response.clone();
    const body = await responseClone.arrayBuffer();
    
    // Get content information
    const contentType = responseClone.headers.get('Content-Type') || 'video/mp4';
    const contentLength = parseInt(responseClone.headers.get('Content-Length') || '0');
    
    // Skip if invalid response
    if (!contentLength || contentLength <= 0) {
      console.warn('Skipping KV storage for invalid response');
      return;
    }
    
    // Get current version
    const versionService = new CacheVersionService(env);
    const version = await versionService.getVersionForPath(sourcePath);
    
    // Generate cache key
    const cacheKey = generateCacheKey(sourcePath, options, version);
    
    // Create metadata
    const metadata: TransformationMetadata = {
      sourcePath,
      width: options.width,
      height: options.height,
      format: options.format,
      quality: options.quality,
      mode: options.mode,
      cacheTags: generateCacheTags(sourcePath, options),
      cacheVersion: version,
      contentType,
      contentLength,
      createdAt: Date.now()
    };
    
    // Determine TTL
    const ttlConfig = {
      ok: 86400,
      redirects: 3600,
      clientError: 60,
      serverError: 10
    };
    const ttl = getTtlForResponse(responseClone, ttlConfig);
    
    // Store in KV
    await env.VIDEO_TRANSFORMATIONS_CACHE.put(cacheKey, body, {
      expirationTtl: ttl > 0 ? ttl : undefined,
      metadata
    });
    
    console.log('Stored in KV cache', { key: cacheKey, ttl });
  } catch (error) {
    // Log error
    console.error('Error storing in KV cache', error);
    // Continue execution
  }
}
```
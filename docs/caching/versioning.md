# Cache Versioning

*Last Updated: May 1, 2025*

## Table of Contents

- [Overview](#overview)
- [Versioning Mechanisms](#versioning-mechanisms)
- [Version Storage](#version-storage)
- [Version Integration in Cache Keys](#version-integration-in-cache-keys)
- [Automatic Version Incrementation](#automatic-version-incrementation)
- [Manual Version Control](#manual-version-control)
- [Version Propagation](#version-propagation)
- [Invalidation Patterns](#invalidation-patterns)
- [Version Namespace Management](#version-namespace-management)
- [Implementation Components](#implementation-components)
- [Performance Considerations](#performance-considerations)
- [Monitoring and Diagnostics](#monitoring-and-diagnostics)
- [Best Practices](#best-practices)
- [Implementation Examples](#implementation-examples)

## Overview

The cache versioning system in the Video Resizer provides controlled cache invalidation without requiring direct cache deletion. By incorporating version numbers into cache keys, the system can effectively "expire" existing cached content by incrementing the version, forcing new cache entries to be created while old entries remain untouched until they naturally expire.

This approach offers several advantages:
- No need for costly purge operations
- Granular control over invalidation scope
- Immediate effectiveness across all edge locations
- Reduced risk of cache stampedes
- Simplified deployment workflows

## Versioning Mechanisms

The cache versioning system uses several mechanisms to control cache invalidation:

### 1. Version Keys

Version information is stored separately from the cached content:

```
version:<sanitized_path>
```

For example:
- `version:videos/sample.mp4`
- `version:videos/category/`

These keys store the current version number for a specific path or path pattern.

### 2. Versioned Cache Keys

Version numbers are incorporated into cache keys:

```
video:<source_path>:<options>:version=<N>
```

For example:
- `video:videos/sample.mp4:version=2`
- `video:videos/sample.mp4:derivative=mobile:version=3`

This ensures that after a version increment, new cache lookups will miss.

### 3. URL Parameter Override

Version can be explicitly specified in URLs:

```
https://cdn.example.com/videos/sample.mp4?cache-version=3
```

This allows for testing new versions or forcing specific version use.

## Version Storage

Version information is stored in a dedicated KV namespace:

```typescript
// KV namespace binding
export interface Env {
  // Other bindings...
  VIDEO_CACHE_KEY_VERSIONS: KVNamespace;
}
```

This separation ensures:
- Version information persists even if cache entries are purged
- Version operations don't interfere with content operations
- Version storage has different TTL requirements than content

The implementation stores integers as version numbers:

```typescript
// Store version
await env.VIDEO_CACHE_KEY_VERSIONS.put(
  `version:${sanitizePath(path)}`,
  version.toString()
);
```

## Version Integration in Cache Keys

Version numbers are incorporated into cache keys during both storage and retrieval:

### Cache Key Generation

```typescript
// Generate versioned cache key
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
  } else {
    // Add other parameters...
  }
  
  // Add version if provided
  if (version) {
    key += `:version=${version}`;
  }
  
  return key;
}
```

### Version Retrieval

```typescript
// Get current version before cache operation
async function getVersionedCacheKey(
  env: Env,
  sourcePath: string,
  options: VideoTransformOptions
): Promise<string> {
  // Check for version override in options
  if (options.cacheVersion) {
    return generateCacheKey(sourcePath, options, options.cacheVersion);
  }
  
  // Get current version from KV
  const version = await getVersionForPath(env, sourcePath);
  
  // Generate cache key with version
  return generateCacheKey(sourcePath, options, version);
}
```

## Automatic Version Incrementation

Versions are automatically incremented in several scenarios:

### 1. Error Handling

```typescript
// Increment version on transformation error
async function handleTransformationError(
  env: Env,
  path: string,
  error: Error
): Promise<void> {
  try {
    // Increment version to invalidate potentially corrupted cache entries
    await incrementVersionForPath(env, path);
    
    logInfo('Incremented cache version due to transformation error', {
      path,
      error: error.message
    });
  } catch (versionError) {
    logError('Failed to increment cache version', versionError);
  }
}
```

### 2. Validation Failures

```typescript
// Increment version on content validation failure
if (!validateContent(response)) {
  await incrementVersionForPath(env, sourcePath);
  
  logWarn('Incremented cache version due to content validation failure', {
    sourcePath,
    contentType: response.headers.get('Content-Type')
  });
}
```

### 3. Format Changes

```typescript
// Increment version when format changes
if (lastFormat !== currentFormat) {
  await incrementVersionForPath(env, sourcePath);
  
  logInfo('Incremented cache version due to format change', {
    sourcePath,
    from: lastFormat,
    to: currentFormat
  });
}
```

## Manual Version Control

The system provides APIs for manual version control:

### 1. Increment Version API

```typescript
// API handler for incrementing versions
export async function handleIncrementVersion(
  request: Request,
  env: Env
): Promise<Response> {
  // Parse request
  const url = new URL(request.url);
  const path = url.searchParams.get('path');
  
  if (!path) {
    return new Response('Path parameter is required', { status: 400 });
  }
  
  // Increment version
  const oldVersion = await getVersionForPath(env, path);
  const newVersion = await incrementVersionForPath(env, path);
  
  // Return response
  return new Response(JSON.stringify({
    path,
    oldVersion,
    newVersion,
    success: true
  }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json'
    }
  });
}
```

### 2. Set Version API

```typescript
// API handler for setting specific versions
export async function handleSetVersion(
  request: Request,
  env: Env
): Promise<Response> {
  // Parse request
  const url = new URL(request.url);
  const path = url.searchParams.get('path');
  const versionParam = url.searchParams.get('version');
  
  if (!path || !versionParam) {
    return new Response('Path and version parameters are required', { status: 400 });
  }
  
  const version = parseInt(versionParam);
  if (isNaN(version) || version < 1) {
    return new Response('Version must be a positive integer', { status: 400 });
  }
  
  // Set version
  const oldVersion = await getVersionForPath(env, path);
  await setVersionForPath(env, path, version);
  
  // Return response
  return new Response(JSON.stringify({
    path,
    oldVersion,
    newVersion: version,
    success: true
  }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json'
    }
  });
}
```

## Version Propagation

Version changes propagate immediately:

### 1. Global Availability

KV writes are eventually consistent across all edge locations, but version increments work immediately for new cache entries, since:
- New cache entries will use the new version number
- Old entries remain accessible but are not reused

### 2. No Cache Flushing

Unlike purge operations, version increments:
- Don't remove existing content
- Don't risk cache stampedes
- Don't require propagating invalidations
- Work immediately for all requests after the increment

### 3. Versioning Order of Operations

```
┌───────────┐         ┌───────────┐         ┌───────────┐
│ Request 1 │         │ Request 2 │         │ Request 3 │
└─────┬─────┘         └─────┬─────┘         └─────┬─────┘
      │                     │                     │
      │  Get version=1      │                     │
      │←────────────────────┘                     │
      │                     │                     │
      │  Increment to v=2   │                     │
      │──────────────────────────────────────────→│
      │                     │                     │
      │                     │  Get version=2      │
      │                     │←────────────────────┘
      │                     │                     │
      │                     │  Use v=2 in key     │
      │                     │                     │
┌─────▼─────┐         ┌─────▼─────┐         ┌─────▼─────┐
│ Uses key  │         │ Uses key  │         │ Uses key  │
│ with v=1  │         │ with v=1  │         │ with v=2  │
└───────────┘         └───────────┘         └───────────┘
```

Requests in flight continue using their retrieved version, while new requests use the incremented version.

## Invalidation Patterns

The versioning system supports different invalidation scopes:

### 1. Path-Specific Invalidation

Increment version for a specific file:

```typescript
await incrementVersionForPath(env, 'videos/sample.mp4');
```

Only invalidates cache entries for this specific file.

### 2. Directory Invalidation

Increment version for all files in a directory:

```typescript
await incrementVersionForPath(env, 'videos/category/');
```

Invalidates all cache entries whose keys start with this path.

### 3. Global Invalidation

Increment the global version:

```typescript
await incrementVersionForPath(env, 'global');
```

When integrated into cache key generation, this invalidates all cache entries.

### 4. Pattern-Based Invalidation

```typescript
// Increment versions for multiple paths matching a pattern
async function incrementVersionsForPattern(
  env: Env,
  pattern: string
): Promise<void> {
  const matchingKeys = await getKeysMatchingPattern(env, pattern);
  
  for (const key of matchingKeys) {
    await incrementVersionForPath(env, key);
  }
}
```

This allows for more complex invalidation rules.

## Version Namespace Management

The version KV namespace requires careful management:

### 1. Key Structure

```typescript
// Generate version key
function getVersionKey(path: string): string {
  // Sanitize and normalize path
  const sanitizedPath = sanitizePath(path);
  
  // Return versioning key
  return `version:${sanitizedPath}`;
}
```

### 2. Version Initialization

```typescript
// Get version, initializing if not found
async function getVersionForPath(env: Env, path: string): Promise<number> {
  const key = getVersionKey(path);
  
  // Attempt to get existing version
  const version = await env.VIDEO_CACHE_KEY_VERSIONS.get(key);
  
  if (version) {
    // Return parsed version
    return parseInt(version);
  } else {
    // Initialize to version 1
    await env.VIDEO_CACHE_KEY_VERSIONS.put(key, '1');
    return 1;
  }
}
```

### 3. Directory Versioning

```typescript
// Get version for a path, checking parent directories if not found
async function getEffectiveVersionForPath(env: Env, path: string): Promise<number> {
  // Check for specific path version
  const pathVersion = await env.VIDEO_CACHE_KEY_VERSIONS.get(`version:${path}`);
  if (pathVersion) {
    return parseInt(pathVersion);
  }
  
  // Check for parent directory versions
  const pathParts = path.split('/');
  
  // Iterate from most specific to least specific
  for (let i = pathParts.length - 1; i > 0; i--) {
    const parentPath = pathParts.slice(0, i).join('/') + '/';
    const dirVersion = await env.VIDEO_CACHE_KEY_VERSIONS.get(`version:${parentPath}`);
    
    if (dirVersion) {
      return parseInt(dirVersion);
    }
  }
  
  // Check for global version
  const globalVersion = await env.VIDEO_CACHE_KEY_VERSIONS.get('version:global');
  if (globalVersion) {
    return parseInt(globalVersion);
  }
  
  // Default to version 1
  return 1;
}
```

## Implementation Components

The cache versioning system consists of several key components:

### 1. cacheVersionService.ts

Core service responsible for version management:
- Handles version storage and retrieval
- Provides version incrementation
- Manages version inheritance
- Integrates with cache keys

```typescript
export class CacheVersionService {
  private readonly namespace: KVNamespace;
  
  constructor(env: Env) {
    this.namespace = env.VIDEO_CACHE_KEY_VERSIONS;
  }
  
  // Get version for a path
  public async getVersionForPath(path: string): Promise<number> {
    const versionKey = this.getVersionKey(path);
    const version = await this.namespace.get(versionKey);
    
    if (version) {
      return parseInt(version);
    } else {
      // Initialize to version 1
      await this.namespace.put(versionKey, '1');
      return 1;
    }
  }
  
  // Increment version for a path
  public async incrementVersionForPath(path: string): Promise<number> {
    const currentVersion = await this.getVersionForPath(path);
    const newVersion = currentVersion + 1;
    
    await this.namespace.put(this.getVersionKey(path), newVersion.toString());
    
    return newVersion;
  }
  
  // Set specific version for a path
  public async setVersionForPath(path: string, version: number): Promise<void> {
    await this.namespace.put(this.getVersionKey(path), version.toString());
  }
  
  // Get version key for a path
  private getVersionKey(path: string): string {
    return `version:${sanitizePath(path)}`;
  }
}
```

### 2. Integration in Cache Key Generation

```typescript
// Generate cache key with version
export async function getVersionedCacheKey(
  env: Env,
  sourcePath: string,
  options: VideoTransformOptions
): Promise<string> {
  // Check for version override in options
  if (options.cacheVersion) {
    return generateCacheKey(sourcePath, options, options.cacheVersion);
  }
  
  // Get cache version service
  const versionService = new CacheVersionService(env);
  
  // Get current version
  const version = await versionService.getVersionForPath(sourcePath);
  
  // Generate cache key with version
  return generateCacheKey(sourcePath, options, version);
}
```

### 3. Cache Handlers

Integration in cache handling:

```typescript
// Get cached response with version handling
export async function getCachedResponse(
  env: Env,
  request: Request,
  sourcePath: string,
  options: VideoTransformOptions
): Promise<Response | null> {
  // Check for version override in URL
  const url = new URL(request.url);
  const urlVersion = url.searchParams.get('cache-version');
  
  if (urlVersion) {
    options.cacheVersion = parseInt(urlVersion);
  }
  
  // Get cache key with version
  const cacheKey = await getVersionedCacheKey(env, sourcePath, options);
  
  // Attempt to retrieve from cache
  return await getFromCacheByKey(env, cacheKey);
}
```

## Performance Considerations

Version operations are designed for minimal performance impact:

### 1. Low-Latency Version Lookups

```typescript
// Cache version lookups in memory
const versionCache = new Map<string, { version: number, timestamp: number }>();

// Get version with caching
async function getVersionWithCaching(env: Env, path: string): Promise<number> {
  const key = `version:${path}`;
  const now = Date.now();
  
  // Check in-memory cache
  const cached = versionCache.get(key);
  if (cached && now - cached.timestamp < VERSION_CACHE_TTL) {
    return cached.version;
  }
  
  // Get from KV
  const version = await getVersionForPath(env, path);
  
  // Update cache
  versionCache.set(key, { version, timestamp: now });
  
  return version;
}
```

### 2. Parallel Version Operations

```typescript
// Get versions for multiple paths in parallel
async function getVersionsForPaths(
  env: Env,
  paths: string[]
): Promise<Record<string, number>> {
  // Create promises for all paths
  const versionPromises = paths.map(path => 
    getVersionForPath(env, path).then(version => ({ path, version }))
  );
  
  // Wait for all to complete
  const versions = await Promise.all(versionPromises);
  
  // Convert to record
  return versions.reduce((result, { path, version }) => {
    result[path] = version;
    return result;
  }, {} as Record<string, number>);
}
```

### 3. Version Batching

```typescript
// Increment versions for multiple paths
async function incrementVersionsForPaths(
  env: Env,
  paths: string[]
): Promise<void> {
  // Get current versions
  const currentVersions = await getVersionsForPaths(env, paths);
  
  // Prepare batch operations
  const operations = Object.entries(currentVersions).map(([path, version]) => ({
    key: `version:${path}`,
    value: (version + 1).toString()
  }));
  
  // Execute batch update
  await batchPutKV(env.VIDEO_CACHE_KEY_VERSIONS, operations);
}
```

## Monitoring and Diagnostics

The versioning system includes monitoring capabilities:

### 1. Version Change Logs

```typescript
// Log version changes
export async function incrementVersionForPath(
  env: Env,
  path: string,
  reason?: string
): Promise<number> {
  const versionService = new CacheVersionService(env);
  
  // Get current version
  const oldVersion = await versionService.getVersionForPath(path);
  
  // Increment version
  const newVersion = await versionService.incrementVersionForPath(path);
  
  // Log the change
  logInfo('Cache version incremented', {
    path,
    oldVersion,
    newVersion,
    reason: reason || 'manual update',
    timestamp: new Date().toISOString()
  });
  
  return newVersion;
}
```

### 2. Version Headers

```typescript
// Add version information to response headers
headers.set('X-Cache-Version', version.toString());
headers.set('X-Cache-Version-Key', versionKey);
```

### 3. Debug UI Integration

The versioning system integrates with the Debug UI:

```typescript
// Add version information to diagnostics
if (context.diagnosticsInfo) {
  context.diagnosticsInfo.cache = {
    ...context.diagnosticsInfo.cache,
    version: {
      current: version,
      key: versionKey,
      parameter: options.cacheVersion,
      fromUrl: url.searchParams.has('cache-version')
    }
  };
}
```

## Best Practices

1. **Selective Versioning**:
   - Increment versions only when necessary
   - Use the appropriate invalidation scope
   - Consider impact on cache efficiency

2. **Version Key Management**:
   - Use consistent path normalization
   - Consider directory hierarchy for inheritance
   - Monitor version namespace size

3. **Integration Best Practices**:
   - Always include version in cache keys
   - Handle version overrides in URLs
   - Use version inheritance for efficiency

4. **Operational Patterns**:
   - Increment versions during deployments
   - Use automated invalidation for content changes
   - Implement version cleanup for unused paths

5. **Monitoring**:
   - Track version changes
   - Monitor KV namespace usage
   - Analyze cache hit rates by version

## Implementation Examples

### Basic Version Management

```typescript
// Basic version management implementation
export class VersionManager {
  private readonly namespace: KVNamespace;
  
  constructor(namespace: KVNamespace) {
    this.namespace = namespace;
  }
  
  // Get version for a path
  public async getVersion(path: string): Promise<number> {
    const key = `version:${this.sanitizePath(path)}`;
    const version = await this.namespace.get(key);
    
    if (version) {
      return parseInt(version);
    } else {
      // Initialize to version 1
      await this.namespace.put(key, '1');
      return 1;
    }
  }
  
  // Increment version for a path
  public async incrementVersion(path: string): Promise<number> {
    const key = `version:${this.sanitizePath(path)}`;
    const currentVersion = await this.getVersion(path);
    const newVersion = currentVersion + 1;
    
    await this.namespace.put(key, newVersion.toString());
    
    return newVersion;
  }
  
  // Set specific version for a path
  public async setVersion(path: string, version: number): Promise<void> {
    const key = `version:${this.sanitizePath(path)}`;
    await this.namespace.put(key, version.toString());
  }
  
  // Delete version for a path
  public async deleteVersion(path: string): Promise<void> {
    const key = `version:${this.sanitizePath(path)}`;
    await this.namespace.delete(key);
  }
  
  // Sanitize path for version key
  private sanitizePath(path: string): string {
    // Remove leading/trailing slashes
    let sanitized = path.replace(/^\/+|\/+$/g, '');
    
    // Ensure no double slashes
    sanitized = sanitized.replace(/\/+/g, '/');
    
    return sanitized;
  }
}
```

### Cache Key Integration

```typescript
// Integrate versions into cache keys
async function getCacheKey(
  env: Env,
  path: string,
  options: TransformOptions
): Promise<string> {
  // Start with base key
  let key = `video:${path}`;
  
  // Add options to key
  for (const [name, value] of Object.entries(options)) {
    if (value !== undefined && value !== null) {
      key += `:${name}=${value}`;
    }
  }
  
  // Get version manager
  const versionManager = new VersionManager(env.VIDEO_CACHE_KEY_VERSIONS);
  
  // Get version for path
  const version = await versionManager.getVersion(path);
  
  // Add version to key
  key += `:version=${version}`;
  
  return key;
}
```

### URL Version Override

```typescript
// Handle URL version override
function getVersionFromRequest(
  request: Request,
  defaultVersion: number
): number {
  const url = new URL(request.url);
  const versionParam = url.searchParams.get('cache-version');
  
  if (versionParam) {
    const version = parseInt(versionParam);
    if (!isNaN(version) && version > 0) {
      return version;
    }
  }
  
  return defaultVersion;
}
```
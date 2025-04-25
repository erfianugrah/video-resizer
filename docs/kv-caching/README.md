# KV Caching System

## Overview

The KV caching system enhances video-resizer by storing transformed video variants in Cloudflare KV, enabling faster retrieval of previously transformed content. This multi-layered caching approach complements Cloudflare's Cache API for improved performance.

## Comprehensive Documentation

For a complete guide to the KV caching system, see our [KV Cache System Guide](./KV_CACHE_SYSTEM_GUIDE.md), which provides detailed information on all aspects of the caching system in a single document.

## Architecture

![KV Caching Architecture](https://i.imgur.com/b7vmQGa.png)

The KV caching system follows a multi-layered approach:

1. **Request Processing**:
   - Incoming video URL requests are parsed for transformation parameters
   - A cache key is generated based on the source path and transformation options

2. **Cache Orchestration**:
   - First, check Cloudflare Cache API for a cached response
   - If not found, check KV storage for a cached variant
   - If still not found, transform the video and store in KV for future use

3. **Background Storage**:
   - Transformed videos are stored in the background using `waitUntil()`
   - This ensures the response is returned to the client quickly while caching happens asynchronously

4. **Cache Management**:
   - Different TTLs based on response status codes
   - Metadata stored alongside the video for variant information
   - Cache tags for coordinated purging of related content

## Table of Contents

- [Complete KV Cache System Guide](./KV_CACHE_SYSTEM_GUIDE.md) - Comprehensive documentation covering all aspects
- [KV Caching Strategy](./strategy.md) - Strategic rationale and alternatives considered
- [Implementation Details](./implementation.md)
- [Configuration Guide](./configuration.md)
- [Testing Guide](./testing.md)
- [Performance Considerations](./performance.md)
- [Cache Versioning System](./cache-versioning.md)

## Key Benefits

- **Faster response times**: Cached variants can be retrieved directly from KV storage without transformation
- **Reduced compute costs**: Avoids repeated transformation of the same variants
- **Origin traffic reduction**: Minimizes requests to origin storage services
- **Variant management**: Cache specific variants based on transformation parameters
- **Purge flexibility**: Support for cache tags to purge related cached content
- **Automatic cache busting**: Version parameters ensure clients receive fresh content after updates
- **Version persistence**: Dedicated version storage system survives content deletion or expiration

## Enabling/Disabling KV Cache

The KV cache system can be enabled or disabled using the `enableKVCache` configuration option. When set to `false`, the worker will not read from or write to KV cache.

### Configuration

```json
{
  "cache": {
    "enableKVCache": true,  // Set to false to disable KV cache
    "method": "cf",
    "enableCacheTags": true,
    // Other cache configuration...
  }
}
```

### Environment Variables

```
CACHE_ENABLE_KV=true  # Set to false to disable KV cache
```

## Recent Updates

### Cache Versioning System (April 2025)

Implemented a dedicated KV cache versioning system to address cache staleness issues:

1. Added new `VIDEO_CACHE_KEY_VERSIONS` KV namespace for version tracking
2. Implemented version increment logic on cache misses and errors
3. Added URL versioning for automatic cache busting
4. Integrated with KV storage and transformation services
5. Enhanced diagnostics with version information in headers and debug UI

For full details, see the [Cache Versioning System](./cache-versioning.md) documentation.

### enableKVCache Flag Fix (April 2025)

Fixed an issue where the `enableKVCache` flag was not being respected in the direct videoHandler.ts KV cache check path.

Changes made:
1. Updated videoHandler.ts to check the enableKVCache flag before calling getFromKVCache directly
2. Updated videoHandler.ts to check the enableKVCache flag before attempting to write to KV cache
3. Added logging when KV cache operations are skipped due to configuration

These changes ensure that all KV cache operations (both read and write) properly respect the enableKVCache configuration setting, whether it's set via KV configuration or environment variables.
# KV Caching System

## Overview

The KV caching system enhances video-resizer by storing transformed video variants in Cloudflare KV, enabling faster retrieval of previously transformed content. This multi-layered caching approach complements Cloudflare's Cache API for improved performance.

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

- [Implementation Details](./implementation.md)
- [Configuration Guide](./configuration.md)
- [Testing Guide](./testing.md)
- [Performance Considerations](./performance.md)

## Key Benefits

- **Faster response times**: Cached variants can be retrieved directly from KV storage without transformation
- **Reduced compute costs**: Avoids repeated transformation of the same variants
- **Origin traffic reduction**: Minimizes requests to origin storage services
- **Variant management**: Cache specific variants based on transformation parameters
- **Purge flexibility**: Support for cache tags to purge related cached content
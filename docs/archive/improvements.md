---
pcx_content_type: concept
title: Video-Resizer Improvements
sidebar:
order: 2
badge:
text: New
---

# Video-Resizer Enhancements

The video-resizer has been significantly enhanced with several new features based on the successful image-resizer-2 architecture. These improvements provide more flexibility, better caching, and more resilient video delivery.

## Multi-Source Storage

The most significant enhancement is the new multi-source storage system, which allows fetching videos from different sources with configurable fallback paths:

- **R2 Storage**: Store videos directly in Cloudflare's R2 storage for fastest access
- **Remote Origin**: Fetch videos from your primary origin server
- **Fallback Origin**: Use a secondary origin when videos aren't found elsewhere

This architecture improves reliability by providing multiple sources for the same videos, and optimizes performance by keeping frequently accessed videos in R2.

### Key Storage Features

- **Prioritized Fetching**: Configure the order in which sources are checked
- **Path Transformations**: Transform paths differently for each storage backend
- **Authentication**: Support for various authentication methods for remote sources
- **Range Requests**: Full support for byte-range requests for efficient streaming
- **Conditional Requests**: Support for If-Modified-Since and If-None-Match headers

For detailed configuration, see the [Storage Documentation](/Docs/storage.mdx).

## Enhanced Caching

The caching system has been completely revamped to provide more granular control:

- **Multiple Cache Methods**: Choice between Cloudflare's Edge Cache and the Cache API
- **Cache Profiles**: Different caching strategies for different video types
- **Cache Tags**: Automatically tag videos for selective purging
- **Context-Aware TTLs**: Different TTLs based on response status codes
- **Cache Bypass**: Simple mechanisms to bypass cache when needed

### Cache Tags

One of the most powerful new features is automatic cache tagging. Every video is tagged with metadata like:

```
video-path-popular-my-video-mp4
video-derivative-high
video-quality-high
video-width-1080
```

These tags enable selective purging of related videos without purging the entire cache.

For detailed configuration, see the [Cache Documentation](/Docs/cache.mdx).

## Architecture Improvements

The architecture has been refactored to be more modular and easier to maintain:

- **Service Layer**: Clean separation of concerns with dedicated services
- **Dependency Injection**: Dynamic imports to avoid circular dependencies
- **Better Error Handling**: More consistent error handling and reporting
- **Improved TypeScript**: Better type safety throughout the codebase
- **Configuration Management**: More robust configuration with validation

## Configuration

The enhanced features are configured in `wrangler.jsonc`:

```json
// R2 bucket binding for video storage
"r2_buckets": [
  {
    "binding": "VIDEOS_BUCKET",
    "bucket_name": "videos",
    "preview_bucket_name": "videos-dev"
  }
],

// Storage configuration for multi-source fetching
"STORAGE_CONFIG": {
  "priority": ["r2", "remote", "fallback"],
  "r2": {
    "enabled": true,
    "bucketBinding": "VIDEOS_BUCKET"
  },
  "remoteUrl": "https://videos.example.com",
  "fallbackUrl": "https://cdn.example.com",
  "pathTransforms": {
    "videos": {
      "r2": {
        "removePrefix": true,
        "prefix": ""
      },
      "remote": {
        "removePrefix": true,
        "prefix": "videos/"
      }
    }
  }
}
```

## Getting Started

To start using these new features:

1. **Update your configuration**: Add storage and cache configuration to `wrangler.jsonc`
2. **Create an R2 bucket**: Set up an R2 bucket if you want to use R2 storage
3. **Deploy**: Run `npm run deploy` or `wrangler deploy`

## Conclusion

These enhancements bring the video-resizer closer to a production-ready system with better reliability, performance, and configurability. The multi-source storage and improved caching make it suitable for high-traffic applications where video delivery needs to be fast and resilient.
# Video Resizer Quickstart Guide

*Last Updated: May 10, 2025*

## Table of Contents

- [Introduction](#introduction)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Basic Configuration](#basic-configuration)
- [Deployment](#deployment)
- [Testing Your Setup](#testing-your-setup)
- [Basic Usage](#basic-usage)
  - [Video Transformation](#video-transformation)
  - [Frame Extraction](#frame-extraction)
  - [Spritesheet Generation](#spritesheet-generation)
- [Next Steps](#next-steps)
- [Troubleshooting](#troubleshooting)

## Introduction

This quickstart guide will help you set up and deploy a Video Resizer instance to transform and optimize video content using Cloudflare Workers and the Cloudflare Media Transformation API.

## Prerequisites

- **Cloudflare Account**: With Workers and Media Transformation enabled
- **Node.js**: Version 16 or higher
- **npm**: Version 7 or higher
- **Wrangler CLI**: For deploying to Cloudflare
- **Video Storage**: A source for your original video content (Cloudflare R2, AWS S3, or HTTP-accessible storage)

## Installation

1. **Clone the repository**:
   ```bash
   git clone https://github.com/example/video-resizer.git
   cd video-resizer
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Install Wrangler globally** (if not already installed):
   ```bash
   npm install -g @cloudflare/wrangler
   ```

4. **Authenticate with Cloudflare**:
   ```bash
   wrangler login
   ```

## Basic Configuration

1. **Create a wrangler.jsonc file**:
   ```jsonc
   {
     "name": "video-resizer",
     "compatibility_date": "2023-09-01",
     "main": "dist/index.js",
     "kv_namespaces": [
       {
         "binding": "VIDEO_TRANSFORMATIONS_CACHE",
         "id": "<your-kv-namespace-id>"
       },
       {
         "binding": "VIDEO_CACHE_KEY_VERSIONS",
         "id": "<your-versions-kv-id>"
       },
       {
         "binding": "CONFIGURATION",
         "id": "<your-config-kv-id>"
       }
     ],
     "vars": {
       "CACHE_METHOD": "cf",
       "LOG_LEVEL": "info"
     },
     "routes": [
       {
         "pattern": "videos.example.com/*",
         "zone_name": "example.com"
       }
     ]
   }
   ```

2. **Create KV namespaces** (if you haven't already):
   ```bash
   wrangler kv:namespace create VIDEO_TRANSFORMATIONS_CACHE
   wrangler kv:namespace create VIDEO_CACHE_KEY_VERSIONS
   wrangler kv:namespace create CONFIGURATION
   ```
   
   Update the IDs in your wrangler.jsonc with the values returned by these commands.

3. **Configure your video source**:
   
   For HTTP-accessible content:
   ```bash
   node tools/config-upload.js --env production --config ./config/storage-http.json
   ```
   
   Where storage-http.json contains:
   ```json
   {
     "storage": {
       "primary": {
         "type": "remote",
         "url": "https://your-video-storage.com"
       }
     }
   }
   ```
   
   For S3 or R2 storage, see the [Storage Configuration](../configuration/configuration-guide.md#storage-configuration) in the Configuration Guide.

4. **Configure path patterns**:
   
   Create a basic configuration file config/path-patterns.json:
   ```json
   {
     "pathPatterns": [
       {
         "name": "standard",
         "matcher": "^/(.*\\.mp4)",
         "processPath": true,
         "baseUrl": null,
         "originUrl": "https://your-video-storage.com/{0}",
         "ttl": {
           "ok": 86400,
           "redirects": 3600,
           "clientError": 60,
           "serverError": 10
         },
         "useTtlByStatus": true
       }
     ]
   }
   ```
   
   Upload the configuration:
   ```bash
   node tools/config-upload.js --env production --config ./config/path-patterns.json
   ```

## Deployment

1. **Build the worker**:
   ```bash
   npm run build
   ```

2. **Deploy to Cloudflare**:
   ```bash
   wrangler deploy
   ```

3. **Verify deployment**:
   ```bash
   wrangler tail
   ```
   This will show the logs from your deployed worker.

## Testing Your Setup

1. **Test with debug mode**:
   
   Access a video URL with debug mode enabled:
   ```
   https://videos.example.com/sample.mp4?debug=view
   ```
   
   You should see the debug UI showing your configuration and transformation options.

2. **Check logs**:
   
   Monitor the logs to verify correct operation:
   ```bash
   wrangler tail
   ```

## Basic Usage

### Video Transformation

To transform a video with specific dimensions and quality:

```
https://videos.example.com/sample.mp4?width=720&height=480&quality=high
```

This will output an optimized MP4 video with the specified dimensions and quality.

### Frame Extraction

To extract a thumbnail from a specific timestamp:

```
https://videos.example.com/sample.mp4?mode=frame&time=30s&width=640&height=360
```

This will extract a frame at the 30-second mark and output it as a JPEG image.

### Spritesheet Generation

To generate a spritesheet of frames:

```
https://videos.example.com/sample.mp4?mode=spritesheet&width=800&height=600
```

This will create a grid of thumbnails showing the progression of the video.

## Next Steps

Now that you have a basic setup running, you can:

1. **Configure video derivatives**:
   Create preset configurations for different device types.
   See [Video Derivatives](../features/video-mode.md#video-derivatives).

2. **Set up advanced caching**:
   Configure cache profiles for different content types.
   See [Cache Configuration](../configuration/configuration-guide.md#cache-configuration).

3. **Enable responsive behavior**:
   Configure the system to adapt to different devices.
   See [Responsive Behavior](../features/video-mode.md#responsive-behavior).

4. **Explore additional features**:
   - [Frame Mode](../features/frame-mode.md) for thumbnail extraction
   - [IMQuery Integration](../features/imquery.md) for responsive transformations
   - [Debug UI](../features/debug-ui.md) for troubleshooting

## Troubleshooting

### Common Issues

#### 1. Deployment Failures

**Issue**: Worker fails to deploy
**Solution**: Check for KV namespace binding errors in wrangler.jsonc

```bash
# Verify your KV namespaces
wrangler kv:namespace list
```

#### 2. Transformation Errors

**Issue**: Videos fail to transform
**Solution**: Ensure your videos are in MP4 format with H.264 encoding

```bash
# Check the logs for specific errors
wrangler tail
```

#### 3. Storage Access Issues

**Issue**: Cannot access origin videos
**Solution**: Verify your storage configuration and permissions

```bash
# Test your configuration
node tools/config-debug.js --check-storage
```

#### 4. Cache Issues

**Issue**: Videos not being cached properly
**Solution**: Check your cache configuration and TTL settings

```bash
# Verify cache configuration
node tools/config-debug.js --check-cache
```

### Getting Help

If you encounter issues not covered here:

1. Check the [Troubleshooting Guide](./troubleshooting.md) for more detailed solutions
2. Review the [Configuration Guide](../configuration/configuration-guide.md) for configuration options
3. Use the debug UI to inspect your request: `?debug=view`
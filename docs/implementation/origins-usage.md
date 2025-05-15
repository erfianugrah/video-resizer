# Origins Usage Examples

This document provides examples of how to use the new Origins-based approach for video storage and retrieval.

## Configuration Example

Here's an example of a configuration using the Origins schema:

```json
{
  "version": "2.0.0",
  "video": {
    "origins": [
      {
        "name": "videos",
        "matcher": "^/videos/(.+)$",
        "captureGroups": ["videoId"],
        "sources": [
          {
            "type": "r2",
            "bucketBinding": "VIDEOS_BUCKET",
            "path": "$1",
            "priority": 1
          },
          {
            "type": "remote",
            "url": "https://videos.erfi.dev",
            "path": "videos/$1",
            "auth": {
              "enabled": true,
              "type": "aws-s3",
              "accessKeyVar": "REMOTE_AWS_ACCESS_KEY_ID",
              "secretKeyVar": "REMOTE_AWS_SECRET_ACCESS_KEY",
              "region": "us-east-1",
              "service": "s3"
            },
            "priority": 2
          },
          {
            "type": "fallback",
            "url": "https://cdn.erfi.dev",
            "path": "$1",
            "priority": 3
          }
        ],
        "ttl": {
          "ok": 300,
          "redirects": 300,
          "clientError": 60,
          "serverError": 10
        },
        "useTtlByStatus": true,
        "cacheability": true,
        "videoCompression": "auto"
      },
      {
        "name": "popular",
        "matcher": "^/popular/(.*\\.mp4)$",
        "captureGroups": ["videoId"],
        "sources": [
          {
            "type": "r2",
            "bucketBinding": "VIDEOS_BUCKET",
            "path": "popular/$1",
            "priority": 1
          },
          {
            "type": "remote",
            "url": "https://videos.erfi.dev",
            "path": "popular/$1",
            "auth": {
              "enabled": true,
              "type": "aws-s3",
              "accessKeyVar": "REMOTE_AWS_ACCESS_KEY_ID",
              "secretKeyVar": "REMOTE_AWS_SECRET_ACCESS_KEY",
              "region": "us-east-1",
              "service": "s3"
            },
            "priority": 2
          }
        ],
        "ttl": {
          "ok": 604800,
          "redirects": 300,
          "clientError": 60,
          "serverError": 10
        },
        "useTtlByStatus": true,
        "cacheability": true,
        "videoCompression": "auto"
      }
    ]
  }
}
```

## Usage in Handler

Here's an example of how to use the Origins approach in a video handler:

```typescript
import { fetchVideoWithOrigins } from '../services/videoStorage';
import { VideoResizerConfig } from '../services/videoStorage/interfaces';
import { EnvVariables } from '../config/environmentConfig';

async function handleVideoRequest(request: Request, env: EnvVariables, config: VideoResizerConfig) {
  // Extract the path from the URL
  const url = new URL(request.url);
  const path = url.pathname;
  
  // Fetch the video using the origins-based approach
  const result = await fetchVideoWithOrigins(path, config, env, request);
  
  // Return the result
  return result.response;
}
```

## Using OriginResolver Directly

If you need more control over the resolution process, you can use the OriginResolver service directly:

```typescript
import { OriginResolver } from '../services/origins';
import { VideoResizerConfig } from '../services/videoStorage/interfaces';

function resolveVideoPath(path: string, config: VideoResizerConfig) {
  // Initialize the resolver
  const resolver = new OriginResolver(config);
  
  // Get a match with capture groups
  const match = resolver.matchOriginWithCaptures(path);
  
  if (!match) {
    return null;
  }
  
  // Get information about the match
  console.log(`Matched origin: ${match.origin.name}`);
  console.log(`Capture groups:`, match.captures);
  
  // Resolve to a specific source type
  const r2Resolution = resolver.resolvePathToSource(path, { originType: 'r2' });
  console.log(`R2 path: ${r2Resolution?.resolvedPath}`);
  
  const remoteResolution = resolver.resolvePathToSource(path, { originType: 'remote' });
  console.log(`Remote URL: ${remoteResolution?.sourceUrl}`);
  
  // Get the highest priority source and its resolved path
  const highestPrioritySource = resolver.getHighestPrioritySource(match.origin);
  
  if (highestPrioritySource) {
    const resolvedPath = resolver.resolvePathForSource(
      path, 
      highestPrioritySource, 
      match.captures
    );
    console.log(`Highest priority path: ${resolvedPath}`);
  }
}
```

## Migration from Legacy Configuration

The system automatically supports both the new Origins schema and the legacy configuration. If both are present, the Origins approach will be used.

To migrate from the legacy configuration, you can convert your existing `pathPatterns`, `pathTransforms`, and `storage` configurations into the Origins format as shown in the examples above.

1. Each `pathPattern` becomes an `origin` with the same `name` and `matcher`
2. Storage options (r2, remote, fallback) become `sources` with their respective configurations
3. Path transformations become path templates in each source

This unified approach simplifies the configuration and makes it more intuitive to manage.
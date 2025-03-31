---
pcx_content_type: configuration
title: Storage
head: []
description: Configure multiple video storage sources with R2, remote URLs, and fallback URLs

---

# Multi-Source Video Storage

The video-resizer worker supports fetching videos from multiple storage sources, with configurable fallback paths. This allows you to serve videos from Cloudflare R2, remote origins, or fallback URLs in a seamless, prioritized manner.

## Storage Configuration

The storage configuration in `wrangler.jsonc` defines how videos are fetched from different origins. Here's an example configuration:

```json
"STORAGE_CONFIG": {
  "priority": ["r2", "remote", "fallback"],
  "r2": {
    "enabled": true,
    "bucketBinding": "VIDEOS_BUCKET"
  },
  "remoteUrl": "https://videos.example.com",
  "remoteAuth": {
    "enabled": false,
    "type": "header"
  },
  "fallbackUrl": "https://cdn.example.com",
  "fetchOptions": {
    "userAgent": "Cloudflare-Video-Resizer/1.0"
  },
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

### Priority Order

The `priority` array determines the order in which storage backends are tried. If a video isn't found in the first storage backend, the worker will try the next one, and so on.

```json
"priority": ["r2", "remote", "fallback"]
```

Available options:
- `r2`: Cloudflare R2 storage
- `remote`: Primary remote origin 
- `fallback`: Secondary remote origin

### R2 Storage

Configure R2 bucket access for direct video storage in Cloudflare's network:

```json
"r2": {
  "enabled": true,
  "bucketBinding": "VIDEOS_BUCKET"
}
```

You'll also need to configure the R2 bucket binding in `wrangler.jsonc`:

```json
"r2_buckets": [
  {
    "binding": "VIDEOS_BUCKET",
    "bucket_name": "videos",
    "preview_bucket_name": "videos-dev"
  }
]
```

### Remote Storage

Configure a primary remote origin for videos:

```json
"remoteUrl": "https://videos.example.com"
```

Optional authentication can be added:

```json
"remoteAuth": {
  "enabled": true,
  "type": "header",
  "headers": {
    "Authorization": "Bearer YOUR-TOKEN-HERE"
  }
}
```

Authentication types supported:
- `header`: Custom HTTP headers
- `aws-s3`: AWS S3 signature authentication
- `bearer`: Bearer token authentication
- `query`: URL query parameters

### Fallback Storage

Configure a fallback origin for cases where videos aren't found in R2 or the primary remote:

```json
"fallbackUrl": "https://cdn.example.com"
```

Like with remote storage, you can configure authentication for the fallback:

```json
"fallbackAuth": {
  "enabled": true,
  "type": "header",
  "headers": {
    "Authorization": "Bearer YOUR-TOKEN-HERE"
  }
}
```

### Path Transformations

Path transformations allow you to store videos with different path structures in different storage backends:

```json
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
```

For example, with the above configuration:
- A request for `/videos/example.mp4` would look for `example.mp4` in R2
- The same request would look for `videos/example.mp4` in the remote origin
- Without a transformation for `fallback`, it would look for `/videos/example.mp4` in the fallback origin

## AWS S3 Authentication

For AWS S3 authentication, you'll need to:

1. Set up environment variables for your AWS credentials
2. Configure the authentication in your storage config

```json
"remoteAuth": {
  "enabled": true,
  "type": "aws-s3",
  "accessKeyVar": "AWS_ACCESS_KEY_ID",
  "secretKeyVar": "AWS_SECRET_ACCESS_KEY",
  "region": "us-east-1",
  "service": "s3"
}
```

And add the secrets to your environment:

```bash
wrangler secret put AWS_ACCESS_KEY_ID
wrangler secret put AWS_SECRET_ACCESS_KEY
```

## Advanced Configuration

### General Authentication Settings

Control global authentication behavior:

```json
"auth": {
  "useOriginAuth": true,
  "securityLevel": "strict",
  "cacheTtl": 3600
}
```

- `useOriginAuth`: When true, enables origin authentication mechanisms
- `securityLevel`: Either "strict" (fail if auth fails) or "permissive" (try without auth)
- `cacheTtl`: Cache TTL for authenticated requests (in seconds)

### Fetch Options

Configure default fetch behavior for remote requests:

```json
"fetchOptions": {
  "userAgent": "Cloudflare-Video-Resizer/1.0",
  "headers": {
    "X-Custom-Header": "value"
  }
}
```

## Performance Considerations

The worker implements several performance optimizations:

1. **Range requests**: All storage backends support byte-range requests for efficient video streaming
2. **Conditional requests**: Support for If-None-Match and If-Modified-Since headers
3. **Cache headers**: Proper cache headers are automatically added based on configuration
4. **Cache tagging**: Videos are tagged for easy purging from Cloudflare's cache

## Caching Behavior

Videos fetched from any storage backend are cached according to your cache configuration. The worker adds appropriate cache headers based on:

1. The source of the video (R2, remote, fallback)
2. The video type (from the URL pattern)
3. The configured TTLs for different response status codes

For more details on cache configuration, see the [Cache](/Docs/cache.mdx) documentation.
# Flexible KV Namespace Bindings

The video resizer now supports flexible KV namespace binding names, allowing you to use custom names for your KV namespaces instead of the hardcoded defaults.

## Overview

Instead of being forced to use specific KV namespace names like `VIDEO_CONFIGURATION_STORE`, you can now:
1. Name your KV namespaces whatever you want
2. Map them to the expected internal names using environment variables
3. Deploy multiple instances with different configurations

## Configuration

### 1. Define Your Custom KV Namespaces

In your `wrangler.jsonc`, you can name your KV namespaces however you prefer:

```json
{
  "kv_namespaces": [
    {
      "binding": "MY_CONFIG_KV",
      "id": "ddaf6d5142af4f79b39defe745dac556"
    },
    {
      "binding": "COMPANY_CACHE_STORE",
      "id": "8e790768576242cc98fa3e4aa327f815"
    },
    {
      "binding": "CUSTOM_VERSIONS_KV",
      "id": "949610c936b8480bad5b61f3aa934de1"
    },
    {
      "binding": "PRESIGNED_CACHE",
      "id": "502fa1f64a6e4e48bb7e0bcd32472ba8"
    }
  ]
}
```

### 2. Map Custom Names Using Variables

Add mapping variables in the `vars` section to tell the code which bindings to use:

```json
{
  "vars": {
    "CONFIG_KV_NAME": "MY_CONFIG_KV",
    "CACHE_KV_NAME": "COMPANY_CACHE_STORE",
    "VERSION_KV_NAME": "CUSTOM_VERSIONS_KV",
    "PRESIGNED_KV_NAME": "PRESIGNED_CACHE"
  }
}
```

## Available Mapping Variables

| Variable | Default Binding | Purpose |
|----------|----------------|---------|
| `CONFIG_KV_NAME` | `VIDEO_CONFIGURATION_STORE` | Stores dynamic worker configuration |
| `CACHE_KV_NAME` | `VIDEO_TRANSFORMATIONS_CACHE` | Caches transformed video data |
| `VERSION_KV_NAME` | `VIDEO_CACHE_KEY_VERSIONS` | Tracks cache key versions |
| `PRESIGNED_KV_NAME` | `PRESIGNED_URLS` | Caches presigned URLs |

## Complete Example

Here's a complete example showing custom KV namespace names:

```json
{
  "name": "video-resizer",
  "env": {
    "production": {
      "kv_namespaces": [
        {
          "binding": "ACME_VIDEO_CONFIG",
          "id": "ddaf6d5142af4f79b39defe745dac556"
        },
        {
          "binding": "ACME_VIDEO_CACHE",
          "id": "8e790768576242cc98fa3e4aa327f815"
        },
        {
          "binding": "ACME_CACHE_VERSIONS",
          "id": "949610c936b8480bad5b61f3aa934de1"
        },
        {
          "binding": "ACME_PRESIGNED_URLS",
          "id": "502fa1f64a6e4e48bb7e0bcd32472ba8"
        }
      ],
      "vars": {
        "ENVIRONMENT": "production",
        "CONFIG_KV_NAME": "ACME_VIDEO_CONFIG",
        "CACHE_KV_NAME": "ACME_VIDEO_CACHE",
        "VERSION_KV_NAME": "ACME_CACHE_VERSIONS",
        "PRESIGNED_KV_NAME": "ACME_PRESIGNED_URLS"
      }
    }
  }
}
```

## R2 Bucket Binding

The flexible binding system also supports R2 bucket bindings:

| Variable | Default Binding | Purpose |
|----------|----------------|---------|
| `VIDEO_BUCKET_NAME` | `video-uploads` | R2 bucket for video storage |

Example:
```json
{
  "r2_buckets": [
    {
      "binding": "MY_VIDEO_STORAGE",
      "bucket_name": "acme-videos"
    }
  ],
  "vars": {
    "VIDEO_BUCKET_NAME": "MY_VIDEO_STORAGE"
  }
}
```

## Backward Compatibility

If you don't specify the mapping variables, the system will fall back to the default binding names:
- `VIDEO_CONFIGURATION_STORE`
- `VIDEO_TRANSFORMATIONS_CACHE`
- `VIDEO_CACHE_KEY_VERSIONS`
- `PRESIGNED_URLS`
- `video-uploads` (for R2)

This ensures existing deployments continue to work without any changes.

## Benefits

1. **Flexibility**: Use naming conventions that match your organization's standards
2. **Multi-tenant Support**: Deploy multiple instances with different KV namespaces
3. **No Code Changes**: Configuration is entirely through `wrangler.jsonc`
4. **Backward Compatible**: Existing deployments work without modification
5. **Type Safety**: Full TypeScript support with proper error handling

## Implementation Details

The flexible binding system uses dynamic property access to resolve KV namespaces:

```typescript
// Instead of hardcoded access:
const configKV = env.VIDEO_CONFIGURATION_STORE;

// The system now uses:
const bindingName = env.CONFIG_KV_NAME || 'VIDEO_CONFIGURATION_STORE';
const configKV = env[bindingName];
```

This is handled through centralized utility functions in `src/utils/flexibleBindings.ts` that provide:
- Type-safe namespace resolution
- Proper error handling for missing bindings
- Consistent logging and debugging information
- Support for all KV namespaces and R2 buckets

## Troubleshooting

### KV Namespace Not Found
If you see errors about missing KV namespaces:
1. Verify the binding name in your `wrangler.jsonc` matches the value in your mapping variable
2. Check that the KV namespace ID is correct
3. Ensure the mapping variables are in the correct environment section

### Type Errors
The flexible binding system maintains full TypeScript compatibility. If you encounter type errors:
1. Ensure your `wrangler.jsonc` is valid JSON
2. Run `npm run cf-typegen` to regenerate types
3. Check that all required namespaces are defined

### Debugging
To debug binding resolution:
1. Check the worker logs for binding resolution messages
2. Look for headers like `X-KV-Binding-Used` in responses
3. Enable debug mode with `?debug=true` query parameter

## Migration Guide

To migrate from hardcoded bindings to flexible bindings:

1. **No changes needed** if you're using the default binding names
2. **To use custom names**:
   - Add the mapping variables to your `wrangler.jsonc`
   - Deploy the updated configuration
   - No code changes required

Example migration:
```json
// Before (forced to use these exact names):
{
  "kv_namespaces": [
    { "binding": "VIDEO_CONFIGURATION_STORE", "id": "..." },
    { "binding": "VIDEO_TRANSFORMATIONS_CACHE", "id": "..." }
  ]
}

// After (use any names you want):
{
  "kv_namespaces": [
    { "binding": "CONFIG", "id": "..." },
    { "binding": "CACHE", "id": "..." }
  ],
  "vars": {
    "CONFIG_KV_NAME": "CONFIG",
    "CACHE_KV_NAME": "CACHE"
  }
}
```
# Migrating to Unified Origins

This guide provides step-by-step instructions for migrating from the legacy storage configuration to the new unified origins approach in video-resizer.

## Why Migrate?

The unified origins configuration offers several advantages:

1. **Centralized Configuration**: All origin definitions are in one place
2. **Path-Specific Priorities**: Each path can have its own origin priority list
3. **Descriptive Names**: Instead of generic types, use meaningful names
4. **Improved Flexibility**: More control over origin selection and fallback
5. **Better Type Safety**: Reduced chance of configuration errors

## Migration Strategy: Gradual Transition

You can migrate gradually while maintaining backward compatibility:

### Step 1: Add the `origins` Configuration

First, add the new `origins` section to your `STORAGE_CONFIG` while keeping the existing configuration:

```json
"STORAGE_CONFIG": {
  // Keep existing configuration
  "priority": ["r2", "remote", "fallback"],
  "r2": {
    "enabled": true,
    "bucketBinding": "VIDEOS_BUCKET"
  },
  "remoteUrl": "https://videos.example.com",
  "remoteAuth": {
    "enabled": true,
    "type": "aws-s3",
    "accessKeyVar": "REMOTE_AWS_ACCESS_KEY_ID",
    "secretKeyVar": "REMOTE_AWS_SECRET_ACCESS_KEY"
  },
  "fallbackUrl": "https://cdn.example.com",
  
  // Add new origins configuration
  "origins": {
    "mainR2": {
      "type": "r2",
      "bucketBinding": "VIDEOS_BUCKET",
      "pathTransforms": {
        "videos": {
          "removePrefix": true,
          "prefix": ""
        }
      }
    },
    "primaryStorage": {
      "type": "remote",
      "url": "https://videos.example.com",
      "auth": {
        "enabled": true,
        "type": "aws-s3",
        "accessKeyVar": "REMOTE_AWS_ACCESS_KEY_ID",
        "secretKeyVar": "REMOTE_AWS_SECRET_ACCESS_KEY"
      },
      "pathTransforms": {
        "videos": {
          "removePrefix": true,
          "prefix": "videos/"
        }
      }
    },
    "cdnBackup": {
      "type": "remote",
      "url": "https://cdn.example.com",
      "auth": {
        "enabled": false
      }
    }
  }
}
```

At this point, the system will continue to use the legacy configuration, but you've set up the foundation for migration.

### Step 2: Update Path Patterns One at a Time

Start adding the `origins` property to your path patterns to specify which origins to use for each pattern:

```json
"PATH_PATTERNS": [
  {
    "name": "videos",
    "matcher": "^/videos/",
    "processPath": true,
    // Add origins array with origin names in priority order
    "origins": ["mainR2", "primaryStorage", "cdnBackup"],
    "ttl": {
      "ok": 3600,
      "redirects": 360,
      "clientError": 60,
      "serverError": 10
    }
  },
  // Keep other patterns unchanged for now
  {
    "name": "shorts",
    "matcher": "^/shorts/",
    "processPath": true,
    "baseUrl": null,
    "originUrl": "https://videos.example.com"
  }
]
```

The system will:
- Use the new unified origins approach for patterns with an `origins` array
- Fall back to the legacy approach for patterns without it

This allows for selective, gradual migration.

### Step 3: Customize Origin Priorities for Each Path

One of the key advantages of the new approach is path-specific origin priorities. 
You can customize which origins are used for different content types:

```json
"PATH_PATTERNS": [
  {
    "name": "videos",
    "matcher": "^/videos/",
    "processPath": true,
    "origins": ["mainR2", "primaryStorage", "cdnBackup"],
    "ttl": { "ok": 3600 }
  },
  {
    "name": "shorts",
    "matcher": "^/shorts/",
    "processPath": true,
    // Different origin priority for shorts
    "origins": ["mainR2", "cdnBackup"],
    "ttl": { "ok": 43200 }
  },
  {
    "name": "premium",
    "matcher": "^/premium/",
    "processPath": true,
    // Premium content only from primary storage
    "origins": ["primaryStorage"],
    "ttl": { "ok": 7200 }
  }
]
```

### Step 4: Remove Legacy Configuration (When Ready)

Once all your path patterns have been updated to use the new origins approach, you can remove the legacy configuration:

```json
"STORAGE_CONFIG": {
  // Remove legacy configuration
  // "priority": ["r2", "remote", "fallback"],
  // "r2": { ... },
  // "remoteUrl": "...",
  // etc.
  
  // Only keep the unified origins configuration
  "origins": {
    "mainR2": { ... },
    "primaryStorage": { ... },
    "cdnBackup": { ... }
  },
  
  // Keep global settings if needed
  "fetchOptions": {
    "userAgent": "Cloudflare-Video-Resizer/1.0"
  }
}
```

## Testing Your Migration

During migration, it's important to test each step carefully:

1. **Test Path Patterns Individually**: After adding an `origins` array to a path pattern, test requests matching that pattern
2. **Verify Fallback Behavior**: Test that fallback works by temporarily disabling the primary origin
3. **Check Path Transformations**: Ensure content is found with the correct path transformations
4. **Monitor Performance**: Watch for any unexpected performance changes

## Troubleshooting

### Content Not Found After Migration

If content can't be found after migration:

1. Check path transformations in your origin definitions
2. Verify that origin names in path patterns match the ones in your `origins` configuration
3. Enable debug mode to see which origins are being tried and which paths are being used

### Authentication Issues

If you encounter authentication issues:

1. Ensure you've correctly moved auth configurations from `remoteAuth`/`fallbackAuth` to the individual origin definitions
2. Check that environment variable names for credentials match in your new configuration

## Complete Example

Here's a complete example of a fully migrated configuration:

```json
"STORAGE_CONFIG": {
  "origins": {
    "mainR2": {
      "type": "r2",
      "bucketBinding": "VIDEOS_BUCKET",
      "pathTransforms": {
        "videos": { "removePrefix": true, "prefix": "" },
        "shorts": { "removePrefix": true, "prefix": "shorts/" }
      }
    },
    "primaryStorage": {
      "type": "remote",
      "url": "https://videos.example.com",
      "auth": {
        "enabled": true,
        "type": "aws-s3",
        "accessKeyVar": "REMOTE_AWS_ACCESS_KEY_ID",
        "secretKeyVar": "REMOTE_AWS_SECRET_ACCESS_KEY"
      },
      "pathTransforms": {
        "videos": { "removePrefix": true, "prefix": "videos/" }
      }
    },
    "cdnBackup": {
      "type": "remote",
      "url": "https://cdn.example.com",
      "auth": { "enabled": false }
    }
  },
  "fetchOptions": {
    "userAgent": "Cloudflare-Video-Resizer/1.0"
  }
},
"PATH_PATTERNS": [
  {
    "name": "videos",
    "matcher": "^/videos/",
    "processPath": true,
    "origins": ["mainR2", "primaryStorage", "cdnBackup"],
    "ttl": { "ok": 3600 }
  },
  {
    "name": "shorts",
    "matcher": "^/shorts/",
    "processPath": true,
    "origins": ["mainR2", "cdnBackup"],
    "ttl": { "ok": 43200 }
  },
  {
    "name": "premium",
    "matcher": "^/premium/",
    "processPath": true,
    "origins": ["primaryStorage"],
    "ttl": { "ok": 7200 }
  }
]
```

## Need Help?

If you encounter any issues during migration, please:
1. Enable debug mode to get more information about what's happening
2. Check the logs for detailed error messages
3. Refer to the full [Configuration Reference](../CONFIGURATION_REFERENCE.md)
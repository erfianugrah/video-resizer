# Origins System Migration

*Last Updated: May 15, 2025*

## Overview

This document outlines the migration process from the legacy path patterns configuration to the new Origins system. It provides guidance for transitioning existing configurations while ensuring backward compatibility.

## Migration Steps

1. **Assessment**: Review existing path patterns, transforms, and storage configurations
2. **Configuration Conversion**: Transform legacy configuration to Origins format
3. **Testing**: Validate the converted configuration
4. **Progressive Rollout**: Gradually deploy with careful monitoring
5. **Legacy Support**: Maintain backward compatibility during transition

## Legacy to Origins Mapping

### Basic Mapping

| Legacy Component | Origins Equivalent |
|-----------------|-------------------|
| `pathPatterns` | Origins `matcher` property |
| `pathTransforms` | Origins `path` template in sources |
| `storage.r2` | Origins source with `type: "r2"` |
| `storage.remote` | Origins source with `type: "remote"` |
| `storage.fallback` | Origins source with `type: "fallback"` |

### Example Conversion

**Legacy Configuration**:

```json
{
  "pathPatterns": [
    {
      "name": "videos",
      "matcher": "^/videos/([a-zA-Z0-9]+)$"
    }
  ],
  "pathTransforms": {
    "videos": {
      "r2": "$1.mp4",
      "remote": "videos/$1",
      "fallback": "videos/fallback/$1.mp4"
    }
  },
  "storage": {
    "r2": {
      "bucketBinding": "VIDEOS_BUCKET"
    },
    "remote": {
      "url": "https://example.com",
      "auth": {
        "enabled": true,
        "type": "aws-s3",
        "accessKeyVar": "AWS_ACCESS_KEY",
        "secretKeyVar": "AWS_SECRET_KEY"
      }
    },
    "fallback": {
      "url": "https://fallback.example.com"
    }
  }
}
```

**Origins Configuration**:

```json
{
  "origins": [
    {
      "name": "videos",
      "matcher": "^/videos/([a-zA-Z0-9]+)$",
      "captureGroups": ["videoId"],
      "sources": [
        {
          "type": "r2",
          "priority": 1,
          "bucketBinding": "VIDEOS_BUCKET",
          "path": "${videoId}.mp4"
        },
        {
          "type": "remote",
          "priority": 2,
          "url": "https://example.com",
          "path": "videos/${videoId}",
          "auth": {
            "enabled": true,
            "type": "aws-s3",
            "accessKeyVar": "AWS_ACCESS_KEY",
            "secretKeyVar": "AWS_SECRET_KEY"
          }
        },
        {
          "type": "fallback",
          "priority": 3,
          "url": "https://fallback.example.com",
          "path": "videos/fallback/${videoId}.mp4"
        }
      ],
      "ttl": {
        "ok": 300,
        "redirects": 300,
        "clientError": 60,
        "serverError": 10
      }
    }
  ]
}
```

## Automatic Conversion

The system supports automatic conversion from legacy to Origins format at runtime:

```json
"video": {
  "origins": {
    "enabled": true,
    "useLegacyPathPatterns": true,
    "convertPathPatternsToOrigins": true
  }
}
```

With these settings:
1. `enabled`: Enables the Origins system
2. `useLegacyPathPatterns`: Allows legacy configuration to be used
3. `convertPathPatternsToOrigins`: Automatically converts legacy to Origins format

## Compatibility Layer

During migration, the system includes:

1. **Dual Support**: Both configuration styles can coexist
2. **Automatic Detection**: The system automatically detects which style to use
3. **Gradual Migration**: Components can be migrated individually

## Testing Approach

1. **Parallel Testing**: Run both legacy and Origins configurations simultaneously
2. **Request Patterns**: Test with varied request patterns to ensure matching behavior
3. **Performance Comparison**: Assess performance differences

## Rollback Plan

If issues arise during migration:

1. **Immediate Rollback**: Disable Origins and revert to legacy configuration
2. **Log Analysis**: Review logs to identify issues
3. **Partial Rollback**: Selectively roll back problematic patterns

## Migration Checklist

- [ ] Backup existing configuration
- [ ] Convert configuration to Origins format
- [ ] Test in development environment
- [ ] Deploy with monitoring in staging
- [ ] Validate with real traffic patterns
- [ ] Progressive rollout to production
- [ ] Monitor key metrics during rollout
- [ ] Complete migration after validation period

## Related Documentation

- [Origins System](./origins-system.md) - Complete documentation of the Origins architecture
- [Origins Configuration](../configuration/origins-configuration.md) - Configuration details for Origins
- [Multi-Origin Fallback](./multi-origin-fallback.md) - Enhanced origin fallback strategy
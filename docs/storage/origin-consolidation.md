# Origin Configuration Consolidation

This document outlines a plan to consolidate and simplify the origin configuration in the video-resizer project. The goal is to create a more maintainable, flexible, and easier-to-understand system for handling multiple video sources.

## Current Implementation

The current implementation uses a mix of different configuration approaches:

1. **Storage Configuration**:
   - `remoteUrl` and `fallbackUrl` in `STORAGE_CONFIG`
   - `remoteAuth` and `fallbackAuth` for authentication
   - Storage priority list (`r2`, `remote`, `fallback`)
   - Path transformations defined per path segment

2. **Path Patterns**:
   - Each path pattern can have its own `originUrl`
   - Different TTL settings per pattern
   - Path patterns don't directly relate to storage priorities

3. **Code Implementation**:
   - Separate functions for `fetchFromR2`, `fetchFromRemote`, and `fetchFromFallback`
   - Duplicate code for authentication and path handling
   - Linear priority-based origin resolution

## Problems with Current Approach

1. **Configuration Duplication**: 
   - Similar URLs and auth configs spread across different sections
   - Path transformations are separate from their related origins

2. **Unclear Relationships**:
   - Storage priority is global, not path-specific
   - No clear mapping between path patterns and origins

3. **Code Complexity**:
   - Separate functions for each storage type leads to code duplication
   - Path transformation logic repeated across storage types

4. **Limited Flexibility**:
   - Difficult to add new origin types
   - Path patterns can't easily have custom origin priority

## Proposed Solution: Unified Origins

We propose a unified "origins" configuration system that consolidates all source-related settings:

1. **Centralized Origins Configuration**:
   - Define all origins in one place (R2, remote servers, CDNs, etc.)
   - Include all settings for each origin (URL, auth, path transforms)
   - Give each origin a unique identifier

2. **Origin References in Path Patterns**:
   - Path patterns reference origins by name
   - Path-specific origin priority lists
   - Clear relationship between paths and their data sources

3. **Unified Storage Service**:
   - Single fetch method for all origin types
   - Simplified authentication handling
   - Clearer error handling and logging

## Implementation Plan

### Phase 1: Configuration Schema Updates

1. Create a new `OriginConfigSchema` in `src/config/storageConfig.ts`
2. Update `PathPatternSchema` to support origin references
3. Add backward compatibility for existing config format

### Phase 2: Service Implementation

1. Create a new `OriginService` to handle fetching from any origin type
2. Refactor `videoStorageService.ts` to use the new OriginService
3. Update path transformation utilities to work with the new schema

### Phase 3: Migration & Documentation

1. Update `wrangler.jsonc` with the new configuration format
2. Update the configuration reference documentation
3. Create migration examples for existing configurations

## New Configuration Format

```jsonc
"ORIGINS": {
  "primary": {
    "url": "https://videos.example.com",
    "type": "remote",
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
  "r2Storage": {
    "type": "r2",
    "bucketBinding": "VIDEOS_BUCKET",
    "pathTransforms": {
      "videos": {
        "removePrefix": true,
        "prefix": ""
      }
    }
  },
  "cdn": {
    "url": "https://cdn.example.com",
    "type": "remote",
    "auth": {
      "enabled": false
    }
  }
},

"PATH_PATTERNS": [
  {
    "name": "videos",
    "matcher": "^/videos/",
    "origins": ["r2Storage", "primary", "cdn"],
    "ttl": {
      "ok": 3600
    },
    "quality": "high"
  }
]
```

## Code Changes

### 1. New Origin Schema

```typescript
// src/config/storageConfig.ts
export const OriginConfigSchema = z.object({
  type: z.enum(['r2', 'remote']),
  url: z.string().optional(),
  bucketBinding: z.string().optional(),
  auth: AuthConfigSchema.optional(),
  pathTransforms: z.record(z.object({
    removePrefix: z.boolean().default(false),
    prefix: z.string().default(''),
  })).optional(),
});

export const OriginsConfigSchema = z.record(z.string(), OriginConfigSchema);
```

### 2. Updated Path Pattern Schema

```typescript
// src/config/videoConfig.ts
export const PathPatternSchema = z.object({
  name: z.string(),
  matcher: z.string(),
  origins: z.array(z.string()).optional(), // References to origin IDs
  // ... existing fields
});
```

### 3. New Origin Service

```typescript
// src/services/originService.ts
export class OriginService {
  // Method to fetch from any origin by name
  async fetchFromOrigin(originName: string, path: string, config: VideoResizerConfig, env: EnvVariables): Promise<StorageResult | null> {
    // Implementation...
  }
  
  // Helper for path transformations
  applyPathTransformation(path: string, origin: OriginConfig): string {
    // Implementation...
  }
}
```

## Migration Steps

1. **Add New Configuration**: Add the `ORIGINS` section to your `wrangler.jsonc`
2. **Update Path Patterns**: Add `origins` arrays to your path patterns
3. **Remove Old Configuration**: Eventually remove `remoteUrl`, `fallbackUrl`, etc.

## Backward Compatibility

To ensure backward compatibility:

- The config system will fall back to the old format if `ORIGINS` is not defined
- Path patterns without `origins` will use the global storage priority
- The existing storage service functions will be maintained temporarily

## Progress Tracking

- [x] Phase 1: Configuration Schema Updates
  - [x] Create OriginConfigSchema
  - [x] Update PathPatternSchema
  - [x] Add backward compatibility

- [x] Phase 2: Service Implementation
  - [x] Create OriginService
  - [x] Refactor videoStorageService.ts to use OriginService
  - [x] Update path transformation utilities

- [x] Phase 3: Migration & Documentation
  - [x] Create example wrangler.jsonc configuration
  - [x] Update typings and interfaces
  - [x] Create migration examples

## Benefits

1. **Clearer Configuration**: All origin information in one place
2. **Better Path Control**: Path-specific origin priorities
3. **Easier Maintenance**: Less code duplication
4. **More Flexible**: Easier to add new origin types
5. **Future-proof**: Better foundation for additional features

## Implementation Status

All planned phases have been completed:

- ✅ **Phase 1**: Configuration Schema Updates
- ✅ **Phase 2**: Service Implementation
- ✅ **Phase 3**: Migration & Documentation

## Additional Resources

The following resources are now available:

1. **[Configuration Reference](../CONFIGURATION_REFERENCE.md)** - Updated with unified origins documentation
2. **[Migration Guide](./MIGRATING_TO_UNIFIED_ORIGINS.md)** - Step-by-step guide for transitioning
3. **[Example Configuration](../examples/wrangler-unified-origins.jsonc)** - Complete example of unified origins

## Next Steps

Future enhancements could include:

1. **Performance Metrics** - Add telemetry for origin performance and availability
2. **Health Checks** - Implement periodic checks for origin availability
3. **UI Components** - Create admin panels for managing origins
4. **Caching Optimizations** - Implement more sophisticated caching strategies per origin
5. **Additional Origin Types** - Support for more storage backends (GCS, Azure, etc.)
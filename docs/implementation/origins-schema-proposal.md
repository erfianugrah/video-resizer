# Origins Schema Proposal

This document outlines a proposal to simplify and improve the current approach to handling multiple content origins by merging the existing `pathPatterns`, `pathTransforms`, and `storage` configurations into a single, more intuitive `origins` schema.

## Current Implementation Issues

The current implementation has several issues:

1. **Separation of related concepts**: Path patterns, transforms, and storage configurations are separated across different parts of the config
2. **Complex path transformation logic**: The current implementation uses a complex segment-by-segment path transformation approach
3. **Indirect relationships**: The relationship between path patterns and transforms is implicit rather than explicit
4. **Redundant configuration**: Similar information is repeated across different parts of the config

## Proposed Origins Schema

```typescript
interface Origin {
  name: string;                      // Unique identifier for this origin
  matcher: string;                   // Regex pattern to match incoming requests
  captureGroups?: string[];          // Names of capture groups in the matcher (optional)
  
  // Sources in priority order
  sources: Source[];
  
  // General settings for this origin
  ttl?: {
    ok: number;                      // TTL for successful responses (200-299)
    redirects: number;               // TTL for redirects (300-399)
    clientError: number;             // TTL for client errors (400-499)
    serverError: number;             // TTL for server errors (500-599)
  };
  useTtlByStatus?: boolean;          // Whether to use status-specific TTLs
  cacheability?: boolean;            // Whether responses can be cached
  videoCompression?: string;         // Video compression setting
  quality?: string;                  // Quality setting
  processPath?: boolean;             // Whether to process the path or pass it through
}

interface Source {
  type: 'r2' | 'remote' | 'fallback'; // The type of storage source
  priority: number;                   // Priority order (lower is higher priority)
  
  // Type-specific fields
  bucketBinding?: string;             // For r2: binding name for the bucket
  url?: string;                       // For remote/fallback: base URL
  
  // Path mapping using template strings with capture groups
  // e.g., "videos/$1" where $1 is the first capture group from the matcher
  path: string;
  
  // Authentication settings (if needed)
  auth?: Auth;
}

interface Auth {
  enabled: boolean;
  type: 'aws-s3' | 'token' | 'basic';
  // Auth type-specific fields
  accessKeyVar?: string;
  secretKeyVar?: string;
  region?: string;
  service?: string;
  tokenVar?: string;
  headerName?: string;
}
```

## Example Configuration

```json
{
  "version": "2.0.0",
  "lastUpdated": "2025-05-15T12:00:00Z",
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
          },
          {
            "type": "fallback",
            "url": "https://cdn.erfi.dev",
            "path": "popular/$1",
            "priority": 3
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
    ],
    
    // Rest of video config (derivatives, defaults, etc.) remains the same
  },
  
  // Rest of config (cache, debug, logging) remains the same
}
```

## Benefits of the New Approach

1. **Unified configuration**: All related settings for each origin pattern are in one place
2. **Explicit source priority**: Clear priority ordering through numbered priorities
3. **Simplified path mapping**: Direct template-based path mapping using capture groups
4. **Reduced complexity**: No need for complex path transformation logic
5. **Better developer experience**: More intuitive configuration schema
6. **Improved maintainability**: Easier to understand and modify

## Backward Compatibility

To ensure a smooth transition, we can:

1. Add a version flag to detect the new schema
2. Provide a utility to convert from the old schema to the new one
3. Support both schemas during a transition period
4. Provide clear migration documentation

## Next Steps

1. Implement the new schema interfaces
2. Create the OriginResolver service
3. Update storage services to use the new approach
4. Provide a migration utility
5. Update documentation and examples
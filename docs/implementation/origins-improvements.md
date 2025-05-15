# Origins Implementation Improvements

This document outlines identified issues and proposed improvements for the Origins implementation.

## 1. Identified Issues

### Core Architecture Issues

| Issue | Severity | Description |
|-------|----------|-------------|
| CDN_URL Hardcoding | High | The CDN_URL is hardcoded as "https://cdnjs.cloudflare.com" which is likely incorrect |
| Type Safety | Medium | Several instances of `any` types that should be more specific |
| Test Coverage | Medium | Test failures related to module loading and missing Origin-specific tests |
| ResponseBuilder Context | Low | Complex context handling with manual creation of context objects |
| Auth Implementation | Medium | Authentication flow needs thorough testing |

### Implementation Gaps

| Gap | Severity | Description |
|-----|----------|-------------|
| Schema Validation | Medium | Need proper Zod schemas for Origins validation |
| Documentation | Medium | Missing JSDoc comments and user-facing documentation |
| Error Types | Medium | Need specific error types for Origin-related failures |
| Performance Optimizations | Low | No caching of compiled regexes or other optimizations |
| Diagnostics | Low | Limited diagnostics for Origin-related operations |

## 2. Improvement Plan

### Phase 1: Critical Foundation Fixes

#### 1.1 Fix CDN_URL Configuration

```typescript
// In src/config/environmentConfig.ts - Add to EnvironmentConfig interface
export interface EnvironmentConfig {
  // ...existing fields
  cdnUrl?: string;
}

// In src/config/VideoConfigurationManager.ts - Add getter method
public getCdnUrl(): string {
  return this.config.cdnUrl || process.env.CDN_URL || 'https://cloudflare-cdn.com';
}

// In src/utils/urlTransformUtils.ts - Replace hardcoded value
import { VideoConfigurationManager } from '../config/VideoConfigurationManager';

// Remove hardcoded: export const CDN_URL = 'https://cdnjs.cloudflare.com';
export function getCdnUrl(): string {
  const configManager = VideoConfigurationManager.getInstance();
  return configManager.getCdnUrl();
}

// Update all references in TransformVideoCommand.ts
const { getCdnUrl } = await import('../../utils/urlTransformUtils');
const cdnUrl = getCdnUrl();
let cdnCgiUrl = `${cdnUrl}/cdn-cgi/video/`;
```

#### 1.2 Improve Type Safety

```typescript
// In src/services/origins/OriginResolver.ts - Create proper interfaces
export interface SourceResolutionResult {
  source: Source;
  resolvedPath: string;
  originType: 'r2' | 'remote' | 'fallback';
  sourceUrl?: string;
  auth?: Auth | null;
}

// Replace any types in method signatures
public resolvePathToSource(path: string, options?: PathResolutionOptions): SourceResolutionResult | null {
  // Implementation
}

// In TransformVideoCommand.ts - Improve environment access typing
interface R2Bucket {
  get(key: string): Promise<R2Object | null>;
}

interface R2Object {
  body: ReadableStream;
  size: number;
  httpEtag?: string;
  httpMetadata?: {
    contentType?: string;
  };
  uploaded: Date;
}

// Then type-safe access
const envRecord = env as Record<string, unknown>;
const r2Bucket = envRecord[bucketBinding] as R2Bucket;
```

#### 1.3 Create Validation Schema

```typescript
// In src/config/originSchema.ts
import { z } from 'zod';

export const AuthSchema = z.object({
  enabled: z.boolean(),
  type: z.enum(['aws-s3', 'token', 'basic']),
  accessKeyVar: z.string().optional(),
  secretKeyVar: z.string().optional(),
  // Other auth fields
});

export const SourceSchema = z.object({
  type: z.enum(['r2', 'remote', 'fallback']),
  priority: z.number().int().positive(),
  bucketBinding: z.string().optional(),
  url: z.string().url().optional(),
  path: z.string(),
  auth: AuthSchema.optional()
});

export const OriginSchema = z.object({
  name: z.string().min(1),
  matcher: z.string().min(1),
  captureGroups: z.array(z.string()).optional(),
  sources: z.array(SourceSchema).min(1),
  ttl: z.object({
    ok: z.number().int().positive(),
    redirects: z.number().int().positive().optional(),
    clientError: z.number().int().positive().optional(),
    serverError: z.number().int().positive().optional()
  }).optional()
});

// Validate in VideoConfigurationManager
import { OriginSchema } from './originSchema';

public addOrigin(origin: Origin): void {
  // Validate before adding
  const result = OriginSchema.safeParse(origin);
  if (!result.success) {
    throw new Error(`Invalid Origin config: ${result.error.message}`);
  }
  // Add if valid
  this.config.origins = [...(this.config.origins || []), origin];
}
```

### Phase 2: Enhance Error Handling & Testing

#### 2.1 Add Proper Error Types

```typescript
// In src/errors/OriginError.ts
export class OriginError extends Error {
  constructor(message: string, public details?: Record<string, unknown>) {
    super(message);
    this.name = 'OriginError';
  }
}

export class OriginMatchError extends OriginError {
  constructor(path: string, details?: Record<string, unknown>) {
    super(`No matching origin found for path: ${path}`, details);
    this.name = 'OriginMatchError';
  }
}

export class SourceResolutionError extends OriginError {
  constructor(originName: string, details?: Record<string, unknown>) {
    super(`Failed to resolve source for origin: ${originName}`, details);
    this.name = 'SourceResolutionError';
  }
}

// In OriginResolver.ts - Use specific errors
if (!matchingOrigin) {
  throw new OriginMatchError(path, { availableOrigins: this.config.origins?.length || 0 });
}
```

#### 2.2 Improve ResponseBuilder Flexibility

```typescript
// In src/utils/responseBuilder.ts - Update constructor
constructor(
  response: Response, 
  context?: Partial<RequestContext> | null
) {
  this.response = response;
  
  // Create minimal context if none provided
  if (!context) {
    this.context = createMinimalContext();
  } else if (!isCompleteContext(context)) {
    // Merge with default context if partial
    this.context = {
      ...createMinimalContext(),
      ...context
    };
  } else {
    this.context = context as RequestContext;
  }
  
  this.headers = new Headers(response.headers);
}

// Add helper functions
function createMinimalContext(): RequestContext {
  return {
    requestId: `auto-${Date.now()}`,
    url: '',
    startTime: performance.now(),
    breadcrumbs: [],
    componentTiming: {},
    diagnostics: {
      errors: [],
      warnings: [],
      originalUrl: ''
    },
    debugEnabled: false,
    verboseEnabled: false
  };
}

function isCompleteContext(context: Partial<RequestContext>): boolean {
  return !!(
    context.requestId &&
    context.url !== undefined &&
    context.startTime !== undefined &&
    context.breadcrumbs !== undefined &&
    context.componentTiming !== undefined &&
    context.diagnostics !== undefined
  );
}
```

#### 2.3 Create Unit Tests for OriginResolver

```typescript
// In test/services/origins/OriginResolver.spec.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { OriginResolver } from '../../../src/services/origins/OriginResolver';

describe('OriginResolver', () => {
  let resolver: OriginResolver;
  
  beforeEach(() => {
    const testConfig = {
      origins: [
        {
          name: 'videos',
          matcher: '^/videos/([a-zA-Z0-9]+)$',
          captureGroups: ['videoId'],
          sources: [
            {
              type: 'r2' as const,
              priority: 1,
              bucketBinding: 'VIDEO_ASSETS',
              path: 'videos/${videoId}.mp4'
            },
            {
              type: 'remote' as const,
              priority: 2,
              url: 'https://example.com',
              path: 'videos/${videoId}'
            }
          ]
        }
      ]
    };
    
    resolver = new OriginResolver(testConfig);
  });
  
  describe('findMatchingOrigin', () => {
    it('should find matching origin for valid path', () => {
      const result = resolver.findMatchingOrigin('/videos/abc123');
      expect(result).toBeDefined();
      expect(result?.name).toBe('videos');
    });
    
    it('should return null for non-matching path', () => {
      const result = resolver.findMatchingOrigin('/images/abc123');
      expect(result).toBeNull();
    });
  });
  
  describe('matchOriginWithCaptures', () => {
    it('should extract named capture groups correctly', () => {
      const result = resolver.matchOriginWithCaptures('/videos/abc123');
      expect(result).toBeDefined();
      expect(result?.captures).toHaveProperty('videoId');
      expect(result?.captures.videoId).toBe('abc123');
    });
  });
  
  describe('resolvePathToSource', () => {
    it('should resolve to highest priority source by default', () => {
      const result = resolver.resolvePathToSource('/videos/abc123');
      expect(result).toBeDefined();
      expect(result?.source.type).toBe('r2');
      expect(result?.resolvedPath).toBe('videos/abc123.mp4');
    });
    
    it('should respect type filter in options', () => {
      const result = resolver.resolvePathToSource('/videos/abc123', {
        originType: 'remote'
      });
      expect(result).toBeDefined();
      expect(result?.source.type).toBe('remote');
      expect(result?.sourceUrl).toBe('https://example.com/videos/abc123');
    });
  });
});
```

### Phase 3: Integration & Documentation

#### 3.1 Add Integration Tests

```typescript
// In test/integration/origins-integration.spec.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleVideoRequestWithOrigins } from '../../src/handlers/videoHandlerWithOrigins';
import { VideoConfigurationManager } from '../../src/config/VideoConfigurationManager';

describe('Origins Integration', () => {
  beforeEach(() => {
    // Setup test environment and mocks
    // Mock fetch responses
    global.fetch = vi.fn().mockImplementation(() => {
      return Promise.resolve(new Response('test video content', {
        status: 200,
        headers: {
          'Content-Type': 'video/mp4'
        }
      }));
    });
    
    // Configure test Origins
    const configManager = VideoConfigurationManager.getInstance();
    configManager.setConfig({
      origins: [
        {
          name: 'test-videos',
          matcher: '^/videos/([a-z0-9]+)$',
          captureGroups: ['id'],
          sources: [
            {
              type: 'remote',
              priority: 1,
              url: 'https://test-cdn.example.com',
              path: 'media/${id}.mp4'
            }
          ]
        }
      ]
    });
  });
  
  it('should match origin and create proper transformation', async () => {
    // Create test request
    const request = new Request('https://example.com/videos/abc123');
    
    // Call the handler
    const response = await handleVideoRequestWithOrigins(
      request,
      {}, // Empty config to use defaults 
      {}, // Empty env
      undefined // No execution context
    );
    
    // Verify response
    expect(response.status).toBe(200);
    expect(response.headers.get('X-Origin')).toBe('test-videos');
    expect(response.headers.get('X-Source-Type')).toBe('remote');
    expect(response.headers.get('X-Handler')).toBe('Origins');
    
    // Verify fetch was called with correct transform URL
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/cdn-cgi/video/'),
      expect.any(Object)
    );
  });
});
```

#### 3.2 Add User Documentation

Create `docs/features/origins-system.md` with comprehensive documentation for the Origins system:

```markdown
# Origins System

## Overview
The Origins system provides a flexible way to configure video sources with pattern-based routing. It replaces the legacy `pathPatterns` and `pathTransforms` with a more intuitive model.

## Configuration
An Origin consists of:
- A name (unique identifier)
- A matcher pattern (regex)
- Optional capture groups to extract path components
- Prioritized sources (R2, remote, fallback)
- TTL settings

Example configuration:
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
          "bucketBinding": "VIDEO_ASSETS",
          "path": "videos/${videoId}.mp4"
        },
        {
          "type": "remote",
          "priority": 2,
          "url": "https://example.com",
          "path": "videos/${videoId}"
        }
      ],
      "ttl": {
        "ok": 86400,
        "redirects": 3600,
        "clientError": 300,
        "serverError": 60
      }
    }
  ]
}
```

## Migration from Legacy Configuration
To migrate from the legacy configuration to Origins:
1. Create an Origin for each pathPattern
2. Set the matcher to the pathPattern.matcher
3. Add sources for each storage type needed (r2, remote, fallback)
4. Set path templates using capture groups from the matcher
```

### Phase 4: Performance & Optimization

#### 4.1 Add Performance Optimizations

```typescript
// In src/services/origins/OriginResolver.ts - Add regex caching
export class OriginResolver {
  private config: VideoResizerConfig;
  private regexCache: Map<string, RegExp> = new Map();
  
  // Get or compile regex
  private getRegex(pattern: string): RegExp {
    if (!this.regexCache.has(pattern)) {
      this.regexCache.set(pattern, new RegExp(pattern));
    }
    return this.regexCache.get(pattern)!;
  }
  
  public findMatchingOrigin(path: string): Origin | null {
    // Use cached regex for better performance
    for (const origin of this.config.origins || []) {
      try {
        const regex = this.getRegex(origin.matcher);
        if (regex.test(path)) {
          return origin;
        }
      } catch (err) {
        // Error handling
      }
    }
    return null;
  }
}
```

#### 4.2 Add Diagnostics Enhancement

```typescript
// In src/handlers/videoHandlerWithOrigins.ts - Add timing operations
// At the start of match process
startTimedOperation(context, 'origin-resolution', 'Origins');

// Origin match result
addBreadcrumb(context, 'Origins', 'Origin resolution', {
  matchTime: endTimedOperation(context, 'origin-resolution'),
  matchedOrigin: originMatch?.origin.name || 'none',
  matcherPattern: originMatch?.origin.matcher,
  captureCount: originMatch?.captures ? Object.keys(originMatch.captures).length : 0
});

// Add diagnostics object for detailed request tracking
context.diagnostics.originResolution = {
  matchedOrigin: originMatch?.origin.name,
  matcher: originMatch?.origin.matcher,
  timingMs: context.componentTiming['origin-resolution']?.duration || 0,
  captures: originMatch?.captures || {},
  sourceType: sourceResolution?.originType,
  priority: sourceResolution?.source.priority
};
```

## 3. Priority Action Items

| Task | Priority | Notes |
|------|----------|-------|
| Fix CDN_URL configuration | High | Critical to ensure proper operation |
| Add proper type definitions | High | Prevents runtime errors |
| Create validation schemas | High | Ensures configuration correctness |
| Add error types | Medium | Improves error handling and diagnostics |
| Update ResponseBuilder | Medium | Enhances resilience |
| Refactor configuration files and tools | Medium | Support Origins configuration format |
| Add unit tests | Medium | Ensures reliability |
| Create integration tests | Medium | Validates full functionality |
| Add documentation | Medium | Ensures maintainability |
| Add performance optimizations | Low | Enhances efficiency |
| Enhance diagnostics | Low | Improves observability |

## 4. Implementation Tracking

| Task | Status | Assignee | Notes |
|------|--------|----------|-------|
| Fix CDN_URL configuration | Completed | Claude | The CDN URL logic was removed as it was redundant. We're using the request's origin directly in the TransformVideoCommand for CDN-CGI URLs. |
| Add proper type definitions | Completed | Claude | Added proper type definitions for Origins and improved type safety by eliminating 'any' types in TransformVideoCommand and related files. Created a WorkerEnvironment interface for environment typing. Extended DiagnosticsInfo to include Origins-specific properties. |
| Create validation schemas | Completed | Claude | Created Zod schemas for Origin, Source, and Auth objects in originSchema.ts with appropriate validation rules. Implemented safe validation functions and updated VideoConfigurationManager.addOrigin() to use them. Created originConverters.ts to handle conversion from legacy path patterns to Origins format with proper type safety. |
| Add error types | Completed | Claude | Created specialized error classes for Origin-related failures, including OriginError as a base class with factory methods for common errors. Added OriginResolutionError and SourceResolutionError with proper inheritance. Updated OriginResolver to use these error types throughout its methods with optional throw parameters for better developer control. |
| Update ResponseBuilder | Completed | Claude | Enhanced the ResponseBuilder class to work with Origins: improved constructor to handle partial context, added withOriginInfo method to add Origin headers, enhanced diagnostics headers, and created a static createOriginErrorResponse method to handle Origin-specific errors consistently. |
| Refactor configuration files and tools | Completed | Claude | Created worker-config-origins.json with Origins format, updated check-config.js to validate Origins, created origins-converter.js tool for legacy-to-Origins conversion, added validation to config-upload.js, implemented OriginConfigurationManager.ts for managing Origins configurations, and added Origins configuration documentation. |
| Add unit tests | Pending | | |
| Create integration tests | Pending | | |
| Add documentation | Pending | | |
| Add performance optimizations | Pending | | |
| Enhance diagnostics | Pending | | |

## 5. Configuration System Refactoring Plan

### 1. Configuration Structure Changes

#### A. Create a new "Origins" section in worker-config.json

```json
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
        "path": "videos/${videoId}.mp4"
      },
      {
        "type": "remote",
        "priority": 2,
        "url": "https://videos.erfi.dev",
        "path": "videos/${videoId}"
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
```

#### B. Modify video section to include Origins configuration

```json
"video": {
  // Existing fields
  "origins": {
    "enabled": true,
    "useLegacyPathPatterns": true, // For backward compatibility
    "convertPathPatternsToOrigins": true, // Auto-convert legacy pathPatterns to Origins
    "fallbackHandling": {
      "enabled": true,
      "maxRetries": 2
    }
  }
}
```

#### C. Create a migration path for pathPatterns and pathTransforms

Create a conversion utility that translates from the legacy format to the new Origins format automatically.

### 2. Schema Updates

Update the Zod schemas to support the new Origins configuration:

1. Create `OriginSchema.ts` (already done)
2. Update `VideoConfigSchema` to include Origins section
3. Update `WorkerConfigurationSchema` to reference Origins

### 3. Tool Updates

#### A. Update check-config.js

1. Add Origins-specific validation rules
2. Add automatic conversion from pathPatterns to Origins format
3. Add validation for the new Origins array fields

```javascript
// Add to requiredArrayFields
{ path: 'origins', description: 'Origins configuration array' },
{ path: 'origins[].sources', description: 'Sources for each origin' },
{ path: 'origins[].captureGroups', description: 'Capture groups for origin matcher' },
```

#### B. Create origins-converter.js Tool

Create a new tool that helps convert from the old pathPatterns format to the new Origins format:

```javascript
#!/usr/bin/env node

/**
 * Origins Converter Tool
 * 
 * Converts legacy pathPatterns and pathTransforms into the new Origins format
 * 
 * Usage:
 *   node origins-converter.js [options]
 * 
 * Options:
 *   --config, -c       Path to config file (default: ./config/worker-config.json)
 *   --output, -o       Output path for converted config (default: ./config/worker-config-origins.json)
 *   --merge, -m        Merge with existing origins configuration
 *   --help, -h         Show help
 */
```

#### C. Update config-upload.js

Enhance the config-upload.js tool to validate Origins configuration before upload:

```javascript
// Add Origins validation
const validateOriginsConfig = (config) => {
  if (!config.origins && (!config.video || !config.video.pathPatterns)) {
    console.warn('Warning: No origins or pathPatterns found in configuration');
    return false;
  }
  
  // Check for common issues with Origins configuration
  if (config.origins) {
    // Check that each origin has required fields
    // Check that each source has required fields based on type
    // etc.
  }
  
  return true;
};
```

### 4. Configuration Management Services

Update the services to support Origins:

#### A. Update VideoConfigurationManager.ts

1. Add Origins accessors and validators
2. Add a method to convert pathPatterns to Origins format
3. Implement graceful fallback for backward compatibility

#### B. Create OriginConfigurationManager.ts

Create a specialized configuration manager for Origins:

```typescript
/**
 * Manages Origin configuration with specialized methods for validation,
 * access, and conversion between formats.
 */
export class OriginConfigurationManager {
  private static instance: OriginConfigurationManager;
  private config: OriginConfig[];
  
  public static getInstance(): OriginConfigurationManager {
    if (!OriginConfigurationManager.instance) {
      OriginConfigurationManager.instance = new OriginConfigurationManager();
    }
    return OriginConfigurationManager.instance;
  }
  
  // Methods to manage Origins configuration
  public getOrigins(): OriginConfig[] { /*...*/ }
  public findOriginByName(name: string): OriginConfig | null { /*...*/ }
  public convertFromPathPatterns(): OriginConfig[] { /*...*/ }
  // etc.
}
```

### 5. Comprehensive Worker-Config JSON

Create a comprehensive worker-config-origins.json that demonstrates the new format:

```json
{
  "version": "2.0.0",
  "lastUpdated": "2025-05-15T12:00:00Z",
  "video": {
    // Original configuration
    "origins": {
      "enabled": true,
      "useLegacyPathPatterns": false,
      "convertPathPatternsToOrigins": false
    }
  },
  // Rest of original config
  "origins": [
    // New Origins configuration
  ]
}
```

### 6. Documentation Updates

Create comprehensive documentation for the new Origins configuration:

1. Create `docs/configuration/origins-configuration.md`
2. Update `docs/configuration/configuration-guide.md`
3. Create migration guide: `docs/configuration/migrating-to-origins.md`

### 7. Implementation Strategy

1. **Phase 1:** Add Origins configuration schema and validation
2. **Phase 2:** Add backward compatibility helpers (auto-conversion)
3. **Phase 3:** Update tools for validation and conversion
4. **Phase 4:** Create sample configuration files
5. **Phase 5:** Write comprehensive documentation

## 6. Complete Origins Transition Plan

### Current State Analysis

Based on the logs and code examination, we're currently in a transition state where:

- Configuration supports both Origins and pathPatterns formats
- Some components use Origins (presigned URLs, caching)
- Path matching still primarily uses legacy pathPatterns
- Both systems can run in parallel via configuration flags
- Type safety improved for both approaches

### Full Transition Plan

#### 1. Documentation & Schema Updates

- [x] Update interfaces and schemas to support both formats
- [x] Fix TypeScript errors in OriginConfigurationManager
- [ ] Update `origins-configuration.md` with complete reference for the new format
- [ ] Document the transition timeline and process

#### 2. Core Component Refactoring

- [ ] Modify `pathUtils.ts` to use OriginResolver internally
- [ ] Refactor `videoHandler.ts` to call OriginResolver directly
- [ ] Update `TransformVideoCommand` to prioritize Origins path
- [ ] Remove duplicate logic between pathPatterns and Origins implementations

#### 3. Replace Path Matching

- [ ] Prioritize OriginResolver over legacy path matching
- [ ] Add metrics to track usage of both systems
- [ ] Create and test conversion utilities to ensure no functionality loss
- [ ] Replace all calls to `findMatchingPathPattern` with OriginResolver equivalents

#### 4. Configuration Updates

- [ ] Update default configurations to fully use Origins format
- [ ] Add warnings when using legacy pathPatterns format
- [ ] Create configuration migration tool for existing customers
- [ ] Set default for `useLegacyPathPatterns` to false

#### 5. Testing & Validation

- [ ] Add comprehensive unit tests for OriginResolver
- [ ] Test all code paths using Origins exclusively
- [ ] Verify performance impact of full Origins vs. pathPatterns
- [ ] Conduct A/B testing with both implementations

#### 6. Clean-up Phase

- [ ] Remove legacy pathway once Origins is confirmed working
- [ ] Clean up conditional logic and unused code
- [ ] Remove backward compatibility checks
- [ ] Optimize OriginResolver for performance

### Migration Timeline

| Phase | Description | Estimated Timeline |
|-------|-------------|-------------------|
| 1 | Infrastructure Preparation (✅) | Completed |
| 2 | Core Component Refactoring | 1-2 weeks |
| 3 | Path Matching Replacement | 1 week |
| 4 | Configuration Updates | 1 week |
| 5 | Testing & Validation | 2 weeks |
| 6 | Clean-up & Documentation | 1 week |

### Special Considerations

1. **Performance Impact:** Monitor response times during the transition

2. **Cache Compatibility:** Ensure cached items remain valid during migration

3. **Client Detection:** Test client-specific features with the Origins approach

4. **Path Transform Migration:** Create a utility to convert existing `pathTransforms` to the Origins format

5. **Config Validation:** Update config validation tools to support the new format

### Implementation Priority

1. Replace `findMatchingPathPattern` with OriginResolver in the primary request flow
2. Update transformation logic to use Origins sources
3. Modify cache keys to be format-agnostic
4. Remove fallbacks to legacy path matching
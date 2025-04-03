# Path Pattern Matching System

## Overview

The path pattern matching system is a core component of the video-resizer that enables URL-based configuration and transformation rules. It uses regular expressions to match incoming request paths and determine how to process and transform video content.

Path patterns allow you to:

1. Define different processing rules for different URL patterns
2. Extract dynamic parts from URLs using capture groups
3. Specify origin content sources for specific paths
4. Apply different quality presets and caching settings based on URL patterns
5. Prioritize certain patterns over others when multiple patterns might match

## Path Pattern Structure

Each path pattern is defined with the following properties:

```typescript
interface PathPattern {
  name: string;                                   // Descriptive name for the pattern
  matcher: string;                                // Regular expression pattern to match against URL paths
  processPath: boolean;                           // Whether to process the path or pass it through
  baseUrl: string | null;                         // Base URL for the CDN-CGI transformation
  originUrl: string | null;                       // Source content URL (can be different from request URL)
  quality?: string;                               // Optional quality preset for this path pattern
  cacheTtl?: number;                              // Legacy cache TTL setting (seconds)
  ttl?: {                                         // Structured TTL settings per status code
    ok: number;                                   // TTL for 200 OK responses (seconds)
    redirects: number;                            // TTL for redirect responses (seconds)
    clientError: number;                          // TTL for client error responses (seconds)
    serverError: number;                          // TTL for server error responses (seconds)
  };
  useTtlByStatus?: boolean;                       // Whether to use different TTLs by status
  priority?: number;                              // Optional priority for pattern matching (higher values checked first)
  transformationOverrides?: Record<string, unknown>; // Optional parameter overrides for this path
  captureGroups?: string[];                       // Names for regex capture groups
}
```

## Configuration Examples

Here are some example path pattern configurations from the `worker-config.json` file:

### Basic Video Pattern

```json
{
  "name": "videos",
  "matcher": "^/videos/",
  "processPath": true,
  "baseUrl": null,
  "originUrl": null,
  "ttl": {
    "ok": 86400,
    "redirects": 3600,
    "clientError": 60,
    "serverError": 10
  },
  "useTtlByStatus": true,
  "captureGroups": ["videoId"],
  "quality": "high"
}
```

### Pattern with Named Capture Groups

```json
{
  "name": "popular",
  "matcher": "^/popular/(.*\\.mp4)",
  "processPath": true,
  "baseUrl": null,
  "originUrl": "https://videos.erfi.dev",
  "ttl": {
    "ok": 604800,
    "redirects": 3600,
    "clientError": 60,
    "serverError": 10
  },
  "useTtlByStatus": true,
  "captureGroups": ["videoId"]
}
```

## How Path Pattern Matching Works

The path pattern matching system follows these steps:

1. **Priority Sorting**: Patterns are sorted by their `priority` property in descending order (higher values first)
2. **Sequential Matching**: Each pattern's `matcher` regex is tested against the request path
3. **First Match Wins**: The first pattern that matches is selected
4. **Capture Group Extraction**: If the pattern contains capture groups, the values are extracted
5. **Configuration Application**: The matched pattern's configuration is applied to the transformation

### Priority-Based Matching

When multiple patterns could match a path, the `priority` property determines the order of evaluation:

```typescript
// Sort patterns by priority if specified (higher values first)
const sortedPatterns = [...patterns].sort((a, b) => {
  const priorityA = a.priority ?? 0;
  const priorityB = b.priority ?? 0;
  return priorityB - priorityA;
});
```

### Regular Expression Matching

The system uses JavaScript's RegExp to perform pattern matching:

```typescript
for (const pattern of sortedPatterns) {
  const regex = new RegExp(pattern.matcher);
  const match = path.match(regex);
  
  if (match) {
    // Pattern found!
    // ...
  }
}
```

### Capture Group Handling

The system supports both numbered and named capture groups:

```typescript
// Add numbered captures
for (let i = 1; i < match.length; i++) {
  captures[i.toString()] = match[i];
  
  // If there are named capture groups defined, use those names too
  if (pattern.captureGroups && i <= pattern.captureGroups.length) {
    const name = pattern.captureGroups[i - 1];
    if (name) {
      captures[name] = match[i];
    }
  }
}
```

## Common Pattern Examples

Here are some common regex patterns used in path matching:

| Pattern | Description | Example |
|---------|-------------|---------|
| `^/videos/` | Matches paths starting with "/videos/" | `/videos/sample.mp4` |
| `^/videos/([a-z0-9]+)(?:/.*)?$` | Matches video paths with an ID | `/videos/abc123/index.mp4` |
| `^/([a-z]+)/([a-z0-9-]+\\.mp4)$` | Matches category+filename structure | `/sports/highlight-reel.mp4` |
| `\\.(mp4|webm|mov)$` | Matches specific file extensions | `video.mp4`, `clip.webm` |
| `^/popular/(.*\\.mp4)` | Captures filename after "/popular/" | `/popular/trending.mp4` |

## Extracting Video IDs

The system provides a utility function for extracting video IDs from matched paths:

```typescript
export function extractVideoId(path: string, pattern: PathPattern): string | null {
  const result = matchPathWithCaptures(path, [pattern]);
  if (!result) return null;
  
  // Try named videoId capture first
  if (result.captures['videoId']) {
    return result.captures['videoId'];
  }
  
  // Then try to use the first capture group
  if (result.captures['1']) {
    return result.captures['1'];
  }
  
  return null;
}
```

## Troubleshooting Path Pattern Issues

### Common Issues and Solutions

#### 1. Pattern Not Matching

**Symptoms**: Your URL is not being matched by any pattern

**Solutions**:
- Check the regex pattern syntax in the `matcher` property
- Ensure the pattern starts with `^` to match from the beginning 
- Test your regex with tools like regex101.com
- Check if another pattern with higher priority is matching first
- Verify the case sensitivity of your paths

#### 2. Wrong Pattern Matching

**Symptoms**: Your URL is being matched by the wrong pattern

**Solutions**:
- Review the priority values of your patterns
- Make more specific patterns have higher priority values
- Inspect the debug logs which show pattern matching
- Check for overlapping patterns

#### 3. Capture Groups Not Working

**Symptoms**: Capture groups are not extracting the expected values

**Solutions**:
- Ensure capture groups are properly defined with parentheses in the regex
- Check that `captureGroups` property is defined with the correct names
- Make sure the captured values match the expected format

#### 4. Pattern Processing Issues

**Symptoms**: Pattern is matched but not processed correctly

**Solutions**:
- Verify the `processPath` property is set to true
- Check if `baseUrl` and `originUrl` are properly configured
- Enable debug mode to see detailed processing logs

### Using Debugging to Identify Issues

Enable debug mode to see detailed information about path pattern matching:

```
https://your-worker.example.com/videos/sample.mp4?debug=view
```

The debug output will show:
- All patterns sorted by priority
- Each pattern tested against the path
- The matching result for each pattern
- The captured values for the matched pattern
- The final transformation configuration

## Advanced Usage

### Pattern Priority Best Practices

1. **Assign Higher Priorities to More Specific Patterns**: 
   - Example: "/videos/featured/" (priority: 10) before "/videos/" (priority: 1)

2. **Categorize Your Patterns by Type**:
   - High priority (100+): Critical or very specific patterns
   - Medium priority (10-99): Content type or category specific patterns
   - Low priority (1-9): General catch-all patterns

3. **Leave Priority Gaps for Future Patterns**:
   - Instead of 1,2,3,4, use 10,20,30,40 to allow insertion of new patterns

### Using Capture Groups Effectively

1. **Standard Naming Conventions**:
   - Use consistent names like "videoId", "category", "filename"
   - Document your naming pattern for other developers

2. **Multiple Captures**:
   - Use multiple named captures to extract structured information:
   ```json
   "matcher": "^/([a-z]+)/([a-z0-9-]+)/([0-9]{4})/(.*\\.mp4)$",
   "captureGroups": ["category", "subcategory", "year", "filename"]
   ```

3. **Transformation Parameter Mapping**:
   - Use captured values to control transformation parameters:
   ```json
   "transformationOverrides": {
     "width": "{width}",
     "height": "{height}"
   }
   ```

### Integration with Other Components

Path patterns are integrated with other components in the system:

1. **Caching Integration**: TTL values from matched patterns affect caching behavior
2. **Quality Presets**: The `quality` property can set transformation defaults
3. **Origin Selection**: The `originUrl` property determines content source
4. **Transformation Overrides**: The `transformationOverrides` property customizes transformation parameters

## Implementation Details

### Pattern Matching Core Functions

The core pattern matching functionality is implemented in `pathUtils.ts`:

1. `findMatchingPathPattern`: Finds the first matching pattern based on priority
2. `matchPathWithCaptures`: Matches a path and extracts capture group values
3. `extractVideoId`: Extracts a video ID from a path using a pattern

```typescript
// This function finds the matching pattern without capturing groups
export function findMatchingPathPattern(path: string, patterns: PathPattern[]): PathPattern | null {
  // Sort patterns by priority
  const sortedPatterns = [...patterns].sort((a, b) => {
    const priorityA = a.priority ?? 0;
    const priorityB = b.priority ?? 0;
    return priorityB - priorityA;
  });

  // Test each pattern in order
  for (let i = 0; i < sortedPatterns.length; i++) {
    const pattern = sortedPatterns[i];
    
    try {
      const regex = new RegExp(pattern.matcher);
      const isMatch = regex.test(path);
      
      if (isMatch) {
        return pattern;
      }
    } catch (err) {
      // Log error and continue with next pattern
    }
  }

  return null;
}

// This function matches with full capture group support
export function matchPathWithCaptures(path: string, patterns: PathPattern[]): PathMatchResult | null {
  // Sort by priority
  const sortedPatterns = [...patterns].sort((a, b) => {
    const priorityA = a.priority ?? 0;
    const priorityB = b.priority ?? 0;
    return priorityB - priorityA;
  });

  // Test each pattern
  for (const pattern of sortedPatterns) {
    const regex = new RegExp(pattern.matcher);
    const match = path.match(regex);
    
    if (match) {
      const captures: Record<string, string> = {};
      
      // Process capture groups
      for (let i = 1; i < match.length; i++) {
        captures[i.toString()] = match[i];
        
        // Handle named captures if provided
        if (pattern.captureGroups && i <= pattern.captureGroups.length) {
          const name = pattern.captureGroups[i - 1];
          if (name) {
            captures[name] = match[i];
          }
        }
      }
      
      return {
        pattern,
        matched: true,
        captures,
        originalPath: path,
      };
    }
  }

  return null;
}
```

### Pattern Loading and Configuration

Path patterns are loaded through multiple layers:

1. Default empty array in `videoConfig.ts`
2. Overrides from `worker-config.json` during startup
3. Dynamic updates from KV storage via the `ConfigurationService`

```typescript
// From ConfigurationService.ts - loading pattern from KV
async loadVideoConfiguration(env: WorkerEnvironment): Promise<Partial<VideoConfiguration>> {
  const videoConfig = await this.getFromKVWithCache(
    env,
    'VIDEO_CONFIGURATION',
    this.CACHE_TTL_MS
  );

  if (videoConfig?.pathPatterns?.length > 0) {
    // Log successful path pattern loading
    this.logInfo('Loaded path patterns from KV', {
      count: videoConfig.pathPatterns.length,
      patternNames: videoConfig.pathPatterns.map(p => p.name)
    });
  }

  return videoConfig || {};
}
```

### Validation with Zod

Path patterns are validated using Zod schema in the `VideoConfigurationManager`:

```typescript
export const PathPatternSchema = z.object({
  name: z.string(),
  matcher: z.string(),
  processPath: z.boolean(),
  baseUrl: z.string().nullable(),
  originUrl: z.string().nullable(),
  quality: z.string().optional(),
  cacheTtl: z.number().positive().optional(),
  ttl: TtlSchema.optional(),
  useTtlByStatus: z.boolean().optional().default(true),
  priority: z.number().optional(),
  transformationOverrides: z.record(z.unknown()).optional(),
  captureGroups: z.array(z.string()).optional(),
});
```

## Performance Considerations

### Optimizing Pattern Matching

1. **Keep Pattern Count Reasonable**: Excessive patterns can impact performance
2. **Use Simple Patterns When Possible**: Complex regexes are slower to evaluate
3. **Sort Patterns Effectively**: Put frequently used patterns at higher priorities
4. **Consider Pattern Caching**: For high-volume applications, avoid recompiling patterns

### Pattern Matching Performance Impact

In tests, the pattern matching system shows minimal overhead:
- Average matching time of <1ms for typical pattern sets (5-10 patterns)
- Linear scaling with the number of patterns
- Negligible impact on overall request processing time

## Best Practices for Path Patterns

1. **Be Specific**: Define patterns that precisely match your URL structure
2. **Test Thoroughly**: Verify patterns with sample URLs before deploying
3. **Order by Specificity**: More specific patterns should have higher priority
4. **Use Named Capture Groups**: For better readability and maintenance
5. **Include Fallback Pattern**: Always include a catch-all pattern with lowest priority

## Debugging Tips

1. **Use Debug Mode**: Enable debug mode with query parameters
   ```
   https://your-worker.example.com/videos/sample.mp4?debug=true
   ```

2. **Check Response Headers**: Look for debug headers with pattern information
   - `X-Debug-Path-Match`: Shows which pattern matched the URL
   - `X-Debug-Path-Patterns`: Shows how many path patterns were available

3. **Console Logging**: Check worker logs for detailed pattern matching logs
   - Pattern testing: `Testing pattern #X`
   - Pattern matching results: `Path pattern matching result`

4. **Run Tests**: Use tests to verify pattern matching behavior
   ```typescript
   // Sample test for pattern matching
   it('should match the correct pattern based on priority', () => {
     const patterns = [
       { name: 'general', matcher: '^/videos/', priority: 1, /* ... */ },
       { name: 'specific', matcher: '^/videos/featured/', priority: 10, /* ... */ }
     ];
     
     const match = findMatchingPathPattern('/videos/featured/sample.mp4', patterns);
     expect(match?.name).toBe('specific');
   });
   ```

## Conclusion

The path pattern matching system is a key component of the video-resizer architecture that enables flexible configuration based on URL patterns. By understanding its features and proper usage, you can create sophisticated URL handling rules that optimize video delivery, caching, and transformation for different content types and sources.
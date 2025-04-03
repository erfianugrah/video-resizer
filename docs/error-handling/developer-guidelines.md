# Error Handling Developer Guidelines

## Overview

This document provides guidelines for implementing standardized error handling in the video-resizer codebase. Following these patterns will ensure consistent, robust error handling across the application.

## Key Principles

1. **Don't let errors propagate** - Handle errors at appropriate boundaries
2. **Provide safe defaults** - When functions fail, they should return reasonable defaults
3. **Log with context** - Include relevant context data with all error logs
4. **Use standardized patterns** - Follow the Implementation/Wrapper pattern consistently
5. **Consider performance** - Be mindful of the performance impact of error handling

## Standard Implementation Pattern

### The Implementation/Wrapper Pattern

```typescript
// Implementation function (might throw)
function someUtilityImpl(...args) {
  // Core implementation that might throw errors
}

// Public wrapper with error handling
export const someUtility = tryOrDefault(
  someUtilityImpl,
  {
    functionName: 'someUtility',
    component: 'ComponentName',
    logErrors: true
  },
  safeDefaultValue // Appropriate default value
);
```

### When to Use Each Error Handling Utility

1. **tryOrDefault**: For functions that should never fail and can return a reasonable default value
   ```typescript
   export const determineCacheConfig = tryOrDefault<[string], CacheConfig>(
     determineCacheConfigImpl,
     { functionName: 'determineCacheConfig', component: 'CacheUtils', logErrors: true },
     { /* Safe default cache config */ }
   );
   ```

2. **tryOrNull**: For functions where null is a valid return value indicating "not found" or "not applicable"
   ```typescript
   export const getDerivativeForPath = tryOrNull<[string[], string, DeploymentConfig], string | null>(
     getDerivativeForPathImpl,
     { functionName: 'getDerivativeForPath', component: 'URLTransformUtils', logErrors: true },
     null
   );
   ```

3. **withErrorHandling**: For functions that should propagate errors after logging them
   ```typescript
   export const fetchOriginalContentFallback = withErrorHandling<
     [string, VideoTransformError, Request],
     Response | null
   >(
     fetchOriginalContentFallbackImpl,
     { functionName: 'fetchOriginalContentFallback', component: 'ErrorHandlerService', logErrors: true },
     { operation: 'fetch_original_content_fallback' }
   );
   ```

## Choosing Safe Default Values

When selecting default values for `tryOrDefault`, consider:

1. **Conservative behavior**: Default to the safer option (e.g., disable caching on error)
2. **User experience**: Choose defaults that won't break the user experience
3. **Detectability**: Make error defaults distinguishable from normal values for easier debugging
4. **Data consistency**: Ensure default values maintain the expected data structure

Examples of good default values:
- For cache configuration: `{ cacheability: false, ttl: { ok: 0, ... } }`
- For video size: `{ width: 854, height: 480, source: 'error-fallback' }`
- For network quality: `{ quality: 'medium', source: 'error-fallback', supportsHints: false }`

## Error Context Best Practices

Provide rich error context to make debugging easier:

```typescript
logErrorWithContext(
  `Error during ${context.functionName}`,
  error,
  {
    // Include relevant arguments
    url: request.url,
    path: path,
    // Include operation-specific context
    bucketName: result.bucketName,
    transformedPath,
    remoteOrigin
  },
  context.component
);
```

Guidelines for error context:
1. Include function arguments (sanitized for security)
2. Add operation-specific context data
3. Include identifiers (request ID, URL, etc.)
4. Avoid including large objects or sensitive data

## Performance Considerations

For performance-critical functions:
1. Consider using `logErrors: false` for very frequent calls
2. Set appropriate log levels based on function importance
3. For high-frequency utilities, use lightweight error context
4. Consider selective error handling for hot paths

Example with performance considerations:
```typescript
export const shouldCache = tryOrDefault<[CacheConfig], boolean>(
  shouldCacheImpl,
  {
    functionName: 'shouldCache',
    component: 'CacheUtils',
    logErrors: false // Turn off logging for this high-frequency call
  },
  false
);
```

## Handling Circular Dependencies

When dealing with circular dependencies:

1. **Local utility functions**: Create local versions of utility functions when needed
   ```typescript
   // Local utility to avoid circular dependencies
   function normalizeErrorBasic(err: unknown, context: Record<string, unknown> = {}) {
     // Simplified error normalization logic
   }
   ```

2. **Dynamic imports**: Use dynamic imports for deeper dependencies
   ```typescript
   const errorHandlerService = await import('../services/errorHandlerService');
   ```

3. **Function parameterization**: Pass dependencies as parameters rather than importing them

## Testing Error Handling

For each function with error handling:
1. Test the happy path (normal operation)
2. Test error paths (create scenarios that trigger errors)
3. Verify that default values are correctly returned
4. Check that error logging occurs with the expected context

Example test:
```typescript
it('should return safe defaults when parsing fails', () => {
  // Arrange - setup to trigger error
  vi.spyOn(console, 'error').mockImplementation(() => {});
  
  // Act
  const result = parseTimeString('invalid');
  
  // Assert
  expect(result).toBeNull();
  expect(console.error).toHaveBeenCalled();
});
```

## Common Pitfalls to Avoid

1. **Swallowing errors silently**: Always log errors with context
2. **Returning unsafe defaults**: Don't return undefined or null unless appropriate
3. **Generic catch blocks**: Use specific error types where possible
4. **Incomplete error context**: Include all relevant data for debugging
5. **Forgetting TypeScript generics**: Properly type input parameters and return values
6. **Over-logging**: Don't log at high levels for expected errors
7. **Inadequate testing**: Test both happy and error paths

## Checklist for Implementing Error Handling

When adding error handling to a function:

1. [ ] Separate implementation function from public export
2. [ ] Choose the appropriate error handling utility (tryOrDefault, tryOrNull, withErrorHandling)
3. [ ] Provide descriptive error messages with component and function names
4. [ ] Add relevant error context data
5. [ ] Select appropriate safe default values
6. [ ] Ensure TypeScript generics are correctly specified
7. [ ] Add tests for both normal and error paths
8. [ ] Consider performance impact for frequently called functions

## Example Implementation

```typescript
// Inside videoUtils.ts

// Implementation function (might throw)
function parseVideoDimensionsImpl(dimensionString: string): Dimensions {
  // Parse dimensions like "1280x720"
  const parts = dimensionString.split('x');
  if (parts.length !== 2) {
    throw new Error(`Invalid dimension format: ${dimensionString}`);
  }
  
  const width = parseInt(parts[0], 10);
  const height = parseInt(parts[1], 10);
  
  if (isNaN(width) || isNaN(height)) {
    throw new Error(`Invalid numeric dimensions: ${dimensionString}`);
  }
  
  return { width, height };
}

// Public export with error handling
export const parseVideoDimensions = tryOrDefault<[string], Dimensions>(
  parseVideoDimensionsImpl,
  {
    functionName: 'parseVideoDimensions',
    component: 'VideoUtils',
    logErrors: true
  },
  { width: 854, height: 480 } // Safe default dimensions
);
```
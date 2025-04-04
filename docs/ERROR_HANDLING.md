# Error Handling in Video Resizer

## Overview

This document outlines the standard error handling practices for the Video Resizer application. Following these guidelines ensures consistent error handling, proper logging, and improved debugging capabilities.

## Error Handling Utilities

We provide a set of standardized utilities in `src/utils/errorHandlingUtils.ts` to make error handling consistent across the codebase.

### Key Utilities

1. **logErrorWithContext** - Log errors with proper context tracking
   ```typescript
   logErrorWithContext(
     message: string,
     error: unknown,
     context?: Record<string, unknown>,
     category?: string
   ): void
   ```

2. **withErrorHandling** - Higher-order function to wrap async functions with error handling
   ```typescript
   withErrorHandling<A extends any[], R>(
     fn: (...args: A) => Promise<R>,
     context: {
       functionName: string,
       component: string,
       logErrors?: boolean
     },
     additionalContext?: Record<string, unknown>
   ): (...args: A) => Promise<R>
   ```

3. **tryOrNull** - Safe execution with null fallback
   ```typescript
   tryOrNull<P extends any[], R>(
     fn: (...args: P) => R,
     context: {
       functionName: string,
       component: string,
       logErrors?: boolean
     },
     defaultValue?: R | null
   ): (...args: P) => R | null
   ```

4. **tryOrDefault** - Safe execution with default value fallback
   ```typescript
   tryOrDefault<P extends any[], R>(
     fn: (...args: P) => R,
     context: {
       functionName: string,
       component: string,
       logErrors?: boolean
     },
     defaultValue: R
   ): (...args: P) => R
   ```

5. **toTransformError** - Normalize any error to a VideoTransformError
   ```typescript
   toTransformError(
     error: unknown,
     errorType?: ErrorType,
     context?: Record<string, unknown>
   ): VideoTransformError
   ```

## Usage Examples

### Example 1: Basic Error Logging

```typescript
import { logErrorWithContext } from '../utils/errorHandlingUtils';

try {
  // Some operation that might fail
  await fetchData();
} catch (error) {
  logErrorWithContext('Failed to fetch data', error, {
    requestUrl: url,
    retryCount: retries
  }, 'DataService');
  // Handle the error appropriately
  throw error; // or return a fallback
}
```

### Example 2: Wrapping Async Functions

```typescript
import { withErrorHandling } from '../utils/errorHandlingUtils';

// Using the function-first approach with context object
const fetchVideoData = withErrorHandling<[string], VideoData>(
  // Implementation function
  async function fetchVideoDataImpl(videoId: string): Promise<VideoData> {
    const response = await fetch(`/api/videos/${videoId}`);
    if (!response.ok) {
      throw new Error(`Failed to fetch video data: ${response.status}`);
    }
    return response.json();
  },
  // Context object
  {
    functionName: 'fetchVideoData',
    component: 'VideoService',
    logErrors: true
  },
  // Additional context
  { source: 'api' }
);

// Usage - errors will be automatically logged with context
try {
  const data = await fetchVideoData('video123');
  // Process data
} catch (error) {
  // Handle the error (retry, fallback, etc.)
}
```

### Example 3: Safe Execution with Fallbacks

```typescript
import { tryOrNull, tryOrDefault } from '../utils/errorHandlingUtils';

// Return null on failure with the updated API
const fetchConfig = tryOrNull<[], ConfigData>(
  function fetchConfigImpl() {
    return fetchConfigFromKV();
  },
  {
    functionName: 'fetchConfig',
    component: 'ConfigService'
  }
);

// If result is null, the operation failed
const data = fetchConfig();
if (!data) {
  // Use fallback configuration
}

// Or use a default value directly
const getConfig = tryOrDefault<[], ConfigData>(
  function getConfigImpl() {
    return fetchConfigFromKV();
  },
  {
    functionName: 'getConfig',
    component: 'ConfigService'
  },
  DEFAULT_CONFIG
);

// Here, config will never be null - it will be the default if fetch failed
const config = getConfig();
```

## Error Types

Use the appropriate error type from `src/errors/index.ts`:

- **VideoTransformError**: Base error class for all video transformation errors
- **ValidationError**: For input validation failures
- **NotFoundError**: When requested resources are not found
- **ConfigurationError**: For configuration-related issues
- **ProcessingError**: For errors that occur during processing

## Best Practices

1. **Always include context**: Add relevant information about what was happening when the error occurred
2. **Use breadcrumbs**: Add breadcrumbs for important operations to make debugging easier
3. **Handle errors at appropriate levels**: Don't catch errors unless you can handle them meaningfully
4. **Normalize errors**: Use `toTransformError` to convert any error to a standard format
5. **Provide fallbacks**: Where possible, degrade gracefully instead of failing completely

## Implementation in key components

The error handling utilities have been implemented in several key components of the system:

### TransformationService

The TransformationService demonstrates comprehensive implementation of error handling utilities:

```typescript
import { logErrorWithContext, withErrorHandling, tryOrNull } from '../utils/errorHandlingUtils';

// Main function wrapped with error handling
export const prepareVideoTransformation = withErrorHandling<
  [Request, VideoTransformOptions, PathPattern[], DebugInfo | undefined, { ASSETS?: { fetch: (request: Request) => Promise<Response> } } | undefined],
  {
    cdnCgiUrl: string;
    cacheConfig: CacheConfig;
    source: string;
    derivative: string;
    diagnosticsInfo: DiagnosticsInfo;
  }
>(
  async function prepareVideoTransformationImpl(request, options, pathPatterns, debugInfo, env) {
    try {
      // Implementation logic
    } catch (err) {
      logErrorWithContext('Error preparing video transformation', err, {
        operation: 'prepareVideoTransformation',
        url: request?.url,
        options
      });
      throw err;
    }
  },
  {
    functionName: 'prepareVideoTransformation',
    component: 'TransformationService',
    logErrors: true
  }
);

// Helper with safe execution and null fallback
const constructVideoUrl = tryOrNull<
  [string, URL, PathPattern, VideoTransformOptions],
  string
>(
  function constructVideoUrlImpl(path, url, pattern, options) {
    // Implementation that might fail
    return finalUrl;
  },
  {
    functionName: 'constructVideoUrl',
    component: 'TransformationService'
  },
  null // default return value when error occurs
);
```

### CacheManagementService

The CacheManagementService demonstrates error handling for cache operations:

```typescript
import { logErrorWithContext, withErrorHandling, tryOrNull } from '../utils/errorHandlingUtils';

// Apply cache headers with error handling
export const applyCacheHeaders = withErrorHandling<
  [Response, number, CacheConfig | null | undefined, string | undefined, string | undefined],
  Promise<Response>
>(
  async function applyCacheHeadersImpl(response, status, cacheConfig, source, derivative) {
    // Implementation that constructs and returns a new response with cache headers
    return new Response(response.body, responseInit);
  },
  {
    functionName: 'applyCacheHeaders',
    component: 'CacheManagementService',
    logErrors: true
  }
);

// Safe creation of CF cache parameters
export const createCfObjectParams = tryOrNull<
  [number, CacheConfig | null | undefined, string | undefined, string | undefined, string | undefined],
  Record<string, unknown>
>(
  function createCfObjectParamsImpl(status, cacheConfig, source, derivative, contentType) {
    // Implementation that might return null
    return cfObject;
  },
  {
    functionName: 'createCfObjectParams',
    component: 'CacheManagementService',
    logErrors: true
  },
  {} // Empty default object if there's an error
);
```

### ConfigurationService

The ConfigurationService handles KV storage operations with proper error handling:

```typescript
import { withErrorHandling, logErrorWithContext, tryOrNull } from '../utils/errorHandlingUtils';

export class ConfigurationService {
  // Load configuration with error handling
  public loadConfiguration = withErrorHandling<
    [{ VIDEO_CONFIGURATION_STORE?: KVNamespace; ENVIRONMENT?: string; }],
    Promise<WorkerConfiguration | null>
  >(
    async function loadConfigurationImpl(env) {
      // Implementation with proper error handling
      return config;
    },
    {
      functionName: 'loadConfiguration',
      component: 'ConfigurationService',
      logErrors: true
    }
  );

  // Safe operation for setting duration limits
  private setDurationLimitsFromConfig = tryOrNull<
    [WorkerConfiguration | null],
    void
  >(
    function setDurationLimitsFromConfigImpl(config) {
      // Implementation that might throw
    },
    {
      functionName: 'setDurationLimitsFromConfig',
      component: 'ConfigurationService',
      logErrors: true
    }
  );
}
```

### API Handlers

In API handlers, use the errorHandlerService to create proper error responses:

```typescript
import { createErrorResponse } from '../services/errorHandlerService';

export async function handleRequest(request: Request): Promise<Response> {
  try {
    // Process the request
    return new Response('Success');
  } catch (error) {
    // Let the error handler create an appropriate response
    return await createErrorResponse(error, request);
  }
}
```

### Service Layer

In services, use withErrorHandling to wrap critical functions:

```typescript
import { withErrorHandling } from '../utils/errorHandlingUtils';

// Updated API with context object
const transformVideo = withErrorHandling(
  async function transformVideoImpl(options) {
    // Transformation logic
  },
  {
    functionName: 'transformVideo', 
    component: 'VideoService',
    logErrors: true
  },
  { serviceVersion: '1.0.0' } // Additional context
);
```

### Utility Functions

For utility functions that might fail, provide fallbacks:

```typescript
import { tryOrDefault } from '../utils/errorHandlingUtils';

// Using the updated API with context object
export const getClientConfiguration = tryOrDefault<[string], ClientConfig>(
  function getClientConfigurationImpl(clientId: string): ClientConfig {
    // Try to load client-specific configuration
    return fetchClientConfig(clientId);
  },
  {
    functionName: 'getClientConfiguration',
    component: 'ConfigService',
    logErrors: true
  },
  DEFAULT_CLIENT_CONFIG
);
```

## Fallback Mechanism

The application implements a sophisticated fallback mechanism for handling transformation failures:

1. **Transformation Attempt**: First, the system attempts to transform the video using the requested parameters.

2. **Fallback Detection**: When transformation fails (especially with server errors):
   - For 400-level errors: Indicates client error (invalid parameters), uses standard fallback
   - For 500-level errors: Indicates server error (transformation service issue), uses enhanced fallback

3. **Intelligent Cache Strategy**:
   - On first fallback: Store original video in Cache API with a special key (`__fb=1` parameter)
   - On subsequent fallbacks: Check Cache API first for previously cached original
   - Always try transformation first on new requests before using fallbacks

4. **Cache Storage Optimization**:
   - Uses Cache API instead of KV for fallback originals (KV has 25MB limit)
   - Applies cache tags (`video-resizer,fallback:true,source:{path}`) for purging
   - Background caching using waitUntil for non-blocking operation
   - Clear separation between transformed videos and fallback originals in cache

5. **Enhanced Diagnostics**:
   - Fallback response includes detailed diagnostic headers:
     - `X-Fallback-Applied: true` indicates fallback was used
     - `X-Fallback-Cache-Hit: true` when using a cached fallback
     - `X-Fallback-Reason: [reason]` explaining the specific error
     - `X-Original-Status: [code]` preserving the original error status
     - `Cache-Tag: video-resizer,fallback:true,source:{path}` for cache management

This approach ensures that:
1. Users still get the video content even when transformation fails
2. Performance is optimized through intelligent caching of fallback content
3. System automatically tries transformation on each request for self-healing
4. Detailed diagnostics help monitor and debug transformation issues

## Conclusion

By following these error handling practices, we ensure that:

1. Errors are consistently logged and tracked
2. Debug information is comprehensive and useful
3. The application degrades gracefully when possible
4. Maintenance is easier because error handling is standardized
5. User experience remains optimal even when errors occur

Remember: Good error handling is about more than just preventing crashes - it's about making the system resilient, debuggable, and maintaining excellent user experience even under failure conditions.

## Additional Documentation

For comprehensive documentation on the error handling implementation, see the [error-handling](./error-handling/) directory, which contains:

1. [**Implementation Plan**](./error-handling/implementation-plan.md) - The original plan and phases for implementing standardized error handling
2. [**Developer Guidelines**](./error-handling/developer-guidelines.md) - Guidelines for implementing standardized error handling in new code
3. [**Test Improvements**](./error-handling/test-improvements.md) - Recommended test improvements to validate error handling
4. [**Monitoring Plan**](./error-handling/monitoring-plan.md) - Plan for monitoring error handling effectiveness
5. [**Summary**](./error-handling/summary.md) - Overall summary of the error handling implementation

For implementation details of specific components, see the [implementations](./error-handling/implementations/) subdirectory, particularly:

1. [**Video Storage Implementation**](./error-handling/implementations/video-storage.md) - Details on the enhanced fallback mechanism
2. [**Cache Utils Implementation**](./error-handling/implementations/cache-utils.md) - Cache-related error handling and fallback caching
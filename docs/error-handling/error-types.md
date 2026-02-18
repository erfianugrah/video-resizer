# Error Types Reference

_Last Updated: February 18, 2026_

This document provides a comprehensive reference of all error types defined in the Video Resizer, their meanings, and recommended handling approaches.

## Table of Contents

- [Error Type Enum](#error-type-enum)
- [Error Status Code Mapping](#error-status-code-mapping)
- [Client Errors (400-Level)](#client-errors-400-level)
- [Server Errors (500-Level)](#server-errors-500-level)
- [Not Found Errors (404)](#not-found-errors-404)
- [Unknown Errors](#unknown-errors)
- [Error Context Object](#error-context-object)
- [Common Error Patterns](#common-error-patterns)

## Error Type Enum

The Video Resizer defines errors using the `ErrorType` enum:

```typescript
// src/errors/VideoTransformError.ts
export enum ErrorType {
  // Client errors (400 range)
  INVALID_PARAMETERS = 'INVALID_PARAMETERS',
  INVALID_MODE = 'INVALID_MODE',
  INVALID_FORMAT = 'INVALID_FORMAT',
  INVALID_DIMENSIONS = 'INVALID_DIMENSIONS',
  INVALID_DERIVATIVE = 'INVALID_DERIVATIVE',
  PATTERN_NOT_FOUND = 'PATTERN_NOT_FOUND',

  // Server errors (500 range)
  TRANSFORMATION_ERROR = 'TRANSFORMATION_ERROR',
  FILE_SIZE_LIMIT_EXCEEDED = 'FILE_SIZE_LIMIT_EXCEEDED',
  URL_CONSTRUCTION_ERROR = 'URL_CONSTRUCTION_ERROR',
  FETCH_ERROR = 'FETCH_ERROR',
  STORAGE_ERROR = 'STORAGE_ERROR',
  CONFIGURATION_ERROR = 'CONFIGURATION_ERROR',

  // Resource not found (404)
  NOT_FOUND = 'NOT_FOUND',

  // Unknown errors
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
}
```

## Error Status Code Mapping

Error types are mapped to HTTP status codes through the `getStatusFromErrorType` function:

```typescript
// src/errors/VideoTransformError.ts
export function getStatusFromErrorType(type: ErrorType): number {
  switch (type) {
    // Client errors (400 range)
    case ErrorType.INVALID_PARAMETERS:
    case ErrorType.INVALID_MODE:
    case ErrorType.INVALID_FORMAT:
    case ErrorType.INVALID_DIMENSIONS:
    case ErrorType.INVALID_DERIVATIVE:
    case ErrorType.PATTERN_NOT_FOUND:
      return 400;

    // Server errors (500 range)
    case ErrorType.TRANSFORMATION_ERROR:
    case ErrorType.FILE_SIZE_LIMIT_EXCEEDED:
    case ErrorType.URL_CONSTRUCTION_ERROR:
    case ErrorType.FETCH_ERROR:
    case ErrorType.STORAGE_ERROR:
    case ErrorType.CONFIGURATION_ERROR:
      return 500;

    // Resource not found (404)
    case ErrorType.NOT_FOUND:
      return 404;

    // Unknown errors
    case ErrorType.UNKNOWN_ERROR:
    default:
      return 500;
  }
}
```

## Client Errors (400-Level)

These errors result from issues with client requests and map to 400-level HTTP status codes.

### INVALID_PARAMETERS

Indicates that a request contained invalid parameters.

**HTTP Status Code:** 400 Bad Request

**Common Causes:**

- Missing required URL parameters
- Malformed URL query string
- Incorrect parameter types or formats

**Example:**

```typescript
throw new ValidationError('Missing required parameter: quality', ErrorType.INVALID_PARAMETERS, {
  path: request.url,
  params: request.url.searchParams,
});
```

### INVALID_MODE

Indicates that an unsupported transformation mode was requested.

**HTTP Status Code:** 400 Bad Request

**Common Causes:**

- Mode parameter not one of: 'video', 'frame', 'spritesheet', 'audio'
- Mode parameter missing when required

**Example:**

```typescript
throw ValidationError.invalidMode(mode, { path: request.url });
```

### INVALID_FORMAT

Indicates that an unsupported output format was requested.

**HTTP Status Code:** 400 Bad Request

**Common Causes:**

- Format parameter not one of supported formats (mp4, webm, etc.)
- Format incompatible with selected mode

**Example:**

```typescript
throw new ValidationError(
  `Format '${format}' is not supported for mode '${mode}'`,
  ErrorType.INVALID_FORMAT,
  { format, mode, path: request.url }
);
```

### INVALID_DIMENSIONS

Indicates that invalid width or height dimensions were provided.

**HTTP Status Code:** 400 Bad Request

**Common Causes:**

- Dimensions not numeric
- Negative or zero dimensions
- Dimensions exceed maximum allowed

**Example:**

```typescript
throw ValidationError.invalidDimensions(width, height, { path: request.url });
```

### INVALID_DERIVATIVE

Indicates that an invalid or unsupported derivative preset was requested.

**HTTP Status Code:** 400 Bad Request

**Common Causes:**

- Derivative not one of: 'high', 'medium', 'low', 'mobile', 'thumbnail', etc.
- Derivative incompatible with selected mode

**Example:**

```typescript
throw new ValidationError(
  `Derivative '${derivative}' is not supported for mode '${mode}'`,
  ErrorType.INVALID_DERIVATIVE,
  { derivative, mode, path: request.url }
);
```

### PATTERN_NOT_FOUND

Indicates that the URL did not match any configured path patterns.

**HTTP Status Code:** 400 Bad Request

**Common Causes:**

- URL path structure doesn't match any configured patterns
- Missing pattern configuration

**Example:**

```typescript
throw ValidationError.patternNotFound(path, {
  path,
  availablePatterns: patterns.map((p) => p.match),
});
```

## Server Errors (500-Level)

These errors result from server-side issues and map to 500-level HTTP status codes.

### TRANSFORMATION_ERROR

Indicates that video transformation failed.

**HTTP Status Code:** 500 Internal Server Error

**Common Causes:**

- Transformation service failure
- Invalid video source
- Corrupted video file
- Unsupported video codec

**Example:**

```typescript
throw ProcessingError.transformationFailed(
  'Video processing failed due to corrupt source',
  { url, duration, attemptCount },
  originalError
);
```

### FILE_SIZE_LIMIT_EXCEEDED

Indicates that the source file exceeded the maximum allowed size for transformation.

**HTTP Status Code:** 500 Internal Server Error

**Common Causes:**

- Video file too large for processing
- Configuration limits exceeded

**Example:**

```typescript
throw new ProcessingError(
  `File size ${fileSize}MB exceeds the maximum limit of ${maxSize}MB`,
  ErrorType.FILE_SIZE_LIMIT_EXCEEDED,
  { fileSize, maxSize, url }
);
```

### URL_CONSTRUCTION_ERROR

Indicates an error occurred while constructing transformation URLs.

**HTTP Status Code:** 500 Internal Server Error

**Common Causes:**

- Invalid origin URL configuration
- Path pattern expression errors
- Malformed URL components

**Example:**

```typescript
throw new ProcessingError(
  'Failed to construct transformation URL',
  ErrorType.URL_CONSTRUCTION_ERROR,
  { originUrl, pathExpression, options }
);
```

### FETCH_ERROR

Indicates an error occurred while fetching content from the origin.

**HTTP Status Code:** 500 Internal Server Error

**Common Causes:**

- Origin server unreachable
- Authentication failure
- Rate limit exceeded
- Network connectivity issues

**Example:**

```typescript
throw ProcessingError.fetchFailed(
  url,
  response.status,
  { status: response.status, statusText: response.statusText },
  originalError
);
```

### STORAGE_ERROR

Indicates an error occurred while accessing storage services.

**HTTP Status Code:** 500 Internal Server Error

**Common Causes:**

- Storage service unavailable
- Authentication failure
- Permission issues
- Rate limit exceeded

**Example:**

```typescript
throw new ProcessingError(
  'Failed to access storage service',
  ErrorType.STORAGE_ERROR,
  { service: 'S3', bucket, key },
  originalError
);
```

### CONFIGURATION_ERROR

Indicates an error in the worker configuration.

**HTTP Status Code:** 500 Internal Server Error

**Common Causes:**

- Missing required configuration
- Invalid configuration format
- Configuration conflicts

**Example:**

```typescript
throw ConfigurationError.missingProperty('wranglerConfig.kv_namespaces', {
  configPath: 'wrangler.jsonc',
});
```

## Not Found Errors (404)

These errors indicate that a requested resource was not found.

### NOT_FOUND

Indicates that the requested resource does not exist.

**HTTP Status Code:** 404 Not Found

**Common Causes:**

- Non-existent file path
- Resource has been moved or deleted
- Missing assets

**Example:**

```typescript
throw NotFoundError.resourceNotFound(path, { bucket, requestUrl: request.url });
```

## Unknown Errors

### UNKNOWN_ERROR

A fallback error type for unclassified errors.

**HTTP Status Code:** 500 Internal Server Error

**Common Causes:**

- Uncaught exceptions
- External service errors without specific type
- System-level failures

**Example:**

```typescript
throw new VideoTransformError('An unexpected error occurred', ErrorType.UNKNOWN_ERROR, {
  requestId,
});
```

## Error Context Object

The `ErrorContext` interface defines the structure for additional context information:

```typescript
// src/errors/VideoTransformError.ts
export interface ErrorContext {
  // Request information
  requestId?: string;
  url?: string;
  path?: string;

  // Error specifics
  status?: number;
  statusText?: string;

  // Operation context
  options?: Record<string, any>;
  duration?: number;
  attemptCount?: number;

  // Source information
  handler?: string;
  service?: string;

  // For resource errors
  bucket?: string;
  key?: string;

  // Additional data
  [key: string]: any;
}
```

Context information provides critical details for debugging and should be included with all errors.

## Common Error Patterns

### Transformation Error with Retry

```typescript
async function transformWithRetry(
  url: string,
  options: VideoTransformOptions,
  maxAttempts = 3
): Promise<Response> {
  let attemptCount = 0;
  let lastError: Error | null = null;

  while (attemptCount < maxAttempts) {
    attemptCount++;

    try {
      return await transformVideo(url, options);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Only retry certain error types
      if (error instanceof ProcessingError && error.type === ErrorType.TRANSFORMATION_ERROR) {
        logger.warn(
          { err: error, attemptCount, maxAttempts },
          `Transformation failed, attempt ${attemptCount}/${maxAttempts}`
        );

        // Add exponential backoff if needed
        await new Promise((resolve) => setTimeout(resolve, 100 * Math.pow(2, attemptCount)));
        continue;
      }

      // Don't retry other error types
      throw error;
    }
  }

  // All attempts failed
  throw new ProcessingError(
    `Transformation failed after ${maxAttempts} attempts`,
    ErrorType.TRANSFORMATION_ERROR,
    { url, options, attemptCount, maxAttempts },
    lastError
  );
}
```

### Differentiated Fallback Based on Error Type

```typescript
async function handleVideoWithFallback(
  request: Request,
  options: VideoTransformOptions
): Promise<Response> {
  try {
    return await videoService.transformVideo(request, options);
  } catch (error) {
    // Normalize error
    const transformError = normalizeErrorBasic(error);

    // Handle different error types
    switch (transformError.type) {
      case ErrorType.FILE_SIZE_LIMIT_EXCEEDED:
        // Special handling for file size errors - fallback to original
        logger.warn(
          { err: transformError, url: request.url },
          'File size limit exceeded, falling back to original'
        );
        return storageService.fetchOriginalContent(request.url);

      case ErrorType.TRANSFORMATION_ERROR:
        // Check if it's a temporary error
        if (isTemporaryError(transformError)) {
          // Generate reduced quality options
          const reducedOptions = reduceQualityOptions(options);
          // Try with reduced quality
          return videoService.transformVideo(request, reducedOptions);
        }
      // Fallthrough to default for permanent errors

      default:
        // Standard error response for other errors
        return errorHandlerService.createErrorResponse(transformError, request);
    }
  }
}
```

### Error Aggregation and Reporting

```typescript
// Track errors for monitoring
const errorStats: Record<string, number> = {};

export function trackError(error: unknown): void {
  const transformError = normalizeErrorBasic(error);

  // Increment counter for this error type
  const errorType = transformError.type || ErrorType.UNKNOWN_ERROR;
  errorStats[errorType] = (errorStats[errorType] || 0) + 1;

  // Log to centralized error monitoring if over threshold
  if (errorStats[errorType] > ERROR_THRESHOLD) {
    sendErrorToMonitoring(transformError);
  }
}

// Report error stats
export function getErrorStats(): Record<string, number> {
  return { ...errorStats };
}

// Reset error counters
export function resetErrorStats(): void {
  Object.keys(errorStats).forEach((key) => {
    errorStats[key] = 0;
  });
}
```

## Cloudflare Error Codes (CfErrorCode)

In addition to the application-level `ErrorType` enum, the system defines a `CfErrorCode` enum in `src/errors/cfErrorCodes.ts` for classifying errors returned by Cloudflare's Media Transformation API via the `Cf-Resized` response header.

### CfErrorCode Enum

```typescript
// src/errors/cfErrorCodes.ts
export enum CfErrorCode {
  INPUT_VIDEO_TOO_LARGE = 9401,
  COULD_NOT_FETCH_VIDEO = 9402,
  INPUT_DURATION_TOO_LONG = 9403,
  INVALID_INPUT_VIDEO = 9406,
  INPUT_VIDEO_TOO_WIDE_OR_TALL = 9407,
  REQUEST_TIMEOUT = 9409,
  INPUT_TOO_LARGE = 9413,
  UNSUPPORTED_MEDIA_TYPE = 9415,
  UNPROCESSABLE = 9422,
  RATE_LIMITED = 9429,
  INTERNAL_ERROR = 9500,
  SERVICE_UNAVAILABLE = 9503,
  ORIGIN_UNREACHABLE = 9523,
}
```

### CF_ERROR_MAP

Each `CfErrorCode` is mapped via `CF_ERROR_MAP` to:

- **description**: A human-readable explanation
- **httpStatus**: The corresponding HTTP status code
- **retryable**: Whether the error is considered retryable

### extractCfErrorCode()

The `extractCfErrorCode()` function parses the `Cf-Resized` header (format: `err=XXXX`) and returns the matching `CfErrorCode` if recognized.

When a CF error code is detected, the response includes an `X-CF-Error-Code` header with the numeric code.

This reference provides a comprehensive guide to all error types defined in the Video Resizer, their meanings, and recommended handling approaches. Errors are a key part of the system's resilient architecture, providing detailed diagnostics while ensuring graceful degradation in failure scenarios.

# Error Handling Implementation

*Last Updated: May 1, 2025*

This document describes the comprehensive error handling system implemented in the Video Resizer. It covers the error class hierarchy, utilities, context tracking mechanisms, fallback strategies, and best practices for working with errors.

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Error Class Hierarchy](#error-class-hierarchy)
- [Error Handling Utilities](#error-handling-utilities)
- [Request Context Tracking](#request-context-tracking)
- [Error Logging](#error-logging)
- [Fallback Mechanisms](#fallback-mechanisms)
- [Error Response Creation](#error-response-creation)
- [Integration With Cache System](#integration-with-cache-system)
- [Best Practices](#best-practices)
- [Examples](#examples)

## Architecture Overview

The error handling system is designed with these key principles:

1. **Standardization**: All errors are normalized to a common `VideoTransformError` format
2. **Context Preservation**: Errors maintain detailed context information for debugging
3. **Graceful Degradation**: Multiple fallback strategies ensure service resiliency
4. **Detailed Logging**: Rich contextual logging for operational visibility
5. **Type Safety**: TypeScript typing throughout the error system

This architecture enables confident error handling while providing maximum diagnostic information.

## Error Class Hierarchy

The error system is built around a central `VideoTransformError` class that serves as the base for all specialized error types.

### Base Error Class: VideoTransformError

The `VideoTransformError` class extends the native `Error` class and adds:

- **Error categorization** via `ErrorType` enum
- **HTTP status mapping** automatically derived from error type
- **Context tracking** with the `ErrorContext` interface
- **Serialization** capabilities for generating standardized error responses

```typescript
// src/errors/VideoTransformError.ts
export class VideoTransformError extends Error {
  public readonly type: ErrorType;
  public readonly status: number;
  public readonly context?: ErrorContext;
  public readonly originalError?: Error;

  constructor(
    message: string,
    type: ErrorType = ErrorType.UNKNOWN_ERROR,
    context?: ErrorContext,
    originalError?: Error
  ) {
    super(message);
    this.name = 'VideoTransformError';
    this.type = type;
    // Status code mapping based on error type
    this.status = getStatusFromErrorType(type);
    this.context = context;
    this.originalError = originalError;
  }

  // Methods for JSON serialization and response creation
  toJSON(): ErrorResponseBody { /* ... */ }
  toResponse(): Response { /* ... */ }
}
```

### Specialized Error Classes

The system provides specialized error classes for common scenarios:

#### ValidationError

For client input validation failures (maps to 400-level status codes):

```typescript
// src/errors/ValidationError.ts
export class ValidationError extends VideoTransformError {
  constructor(
    message: string,
    type: ErrorType = ErrorType.INVALID_PARAMETERS,
    context?: ErrorContext,
    originalError?: Error
  ) {
    super(message, type, context, originalError);
    this.name = 'ValidationError';
  }

  // Static factory methods
  static invalidMode(mode: string, context?: ErrorContext): ValidationError { /* ... */ }
  static invalidDimensions(width: string, height: string, context?: ErrorContext): ValidationError { /* ... */ }
  static patternNotFound(path: string, context?: ErrorContext): ValidationError { /* ... */ }
}
```

#### ProcessingError

For transformation and processing failures (maps to 500-level status codes):

```typescript
// src/errors/ProcessingError.ts
export class ProcessingError extends VideoTransformError {
  constructor(
    message: string,
    type: ErrorType = ErrorType.TRANSFORMATION_ERROR,
    context?: ErrorContext,
    originalError?: Error
  ) {
    super(message, type, context, originalError);
    this.name = 'ProcessingError';
  }

  // Static factory methods
  static transformationFailed(reason: string, context?: ErrorContext, originalError?: Error): ProcessingError { /* ... */ }
  static fetchFailed(url: string, status: number, context?: ErrorContext, originalError?: Error): ProcessingError { /* ... */ }
}
```

#### ConfigurationError

For configuration-related errors:

```typescript
// src/errors/ConfigurationError.ts
export class ConfigurationError extends VideoTransformError {
  constructor(
    message: string,
    type: ErrorType = ErrorType.CONFIGURATION_ERROR,
    context?: ErrorContext,
    originalError?: Error
  ) {
    super(message, type, context, originalError);
    this.name = 'ConfigurationError';
  }

  // Static factory methods
  static missingProperty(property: string, context?: ErrorContext): ConfigurationError { /* ... */ }
  static invalidConfiguration(property: string, value: any, context?: ErrorContext): ConfigurationError { /* ... */ }
}
```

#### NotFoundError

For resource or pattern not found errors:

```typescript
// src/errors/NotFoundError.ts
export class NotFoundError extends VideoTransformError {
  constructor(
    message: string,
    type: ErrorType = ErrorType.NOT_FOUND,
    context?: ErrorContext,
    originalError?: Error
  ) {
    super(message, type, context, originalError);
    this.name = 'NotFoundError';
  }

  // Static factory methods
  static resourceNotFound(path: string, context?: ErrorContext): NotFoundError { /* ... */ }
  static patternNotFound(path: string, context?: ErrorContext): NotFoundError { /* ... */ }
}
```

### Error Type Categorization

Errors are categorized using the `ErrorType` enum:

```typescript
// src/errors/VideoTransformError.ts
export enum ErrorType {
  // Client errors (400 range)
  INVALID_PARAMETERS = 'INVALID_PARAMETERS',
  INVALID_MODE = 'INVALID_MODE',
  INVALID_FORMAT = 'INVALID_FORMAT',
  INVALID_DIMENSIONS = 'INVALID_DIMENSIONS',
  PATTERN_NOT_FOUND = 'PATTERN_NOT_FOUND',
  
  // Server errors (500 range)
  TRANSFORMATION_ERROR = 'TRANSFORMATION_ERROR',
  URL_CONSTRUCTION_ERROR = 'URL_CONSTRUCTION_ERROR',
  FETCH_ERROR = 'FETCH_ERROR',
  STORAGE_ERROR = 'STORAGE_ERROR',
  CONFIGURATION_ERROR = 'CONFIGURATION_ERROR',
  
  // Resource not found (404)
  NOT_FOUND = 'NOT_FOUND',
  
  // Unknown errors
  UNKNOWN_ERROR = 'UNKNOWN_ERROR'
}
```

Each error type is mapped to an appropriate HTTP status code through the `getStatusFromErrorType` function.

## Error Handling Utilities

The system provides robust error handling utilities in `errorHandlingUtils.ts`:

### Error Normalization

```typescript
// src/utils/errorHandlingUtils.ts
export function normalizeErrorBasic(error: unknown): VideoTransformError {
  if (error instanceof VideoTransformError) {
    return error;
  }
  
  if (error instanceof Error) {
    return new VideoTransformError(
      error.message,
      ErrorType.UNKNOWN_ERROR,
      undefined,
      error
    );
  }
  
  return new VideoTransformError(
    typeof error === 'string' ? error : 'Unknown error occurred',
    ErrorType.UNKNOWN_ERROR
  );
}
```

### Context-Aware Error Logging

```typescript
// src/utils/errorHandlingUtils.ts
export function logErrorWithContext(
  logger: Logger,
  error: unknown,
  context?: ErrorContext,
  level: LogLevel = 'error'
): void {
  const normalizedError = normalizeErrorBasic(error);
  
  // Merge contexts if both exist
  if (context && normalizedError.context) {
    normalizedError.context = {
      ...normalizedError.context,
      ...context
    };
  } else if (context) {
    normalizedError.context = context;
  }
  
  // Log with appropriate level
  logger[level]({
    err: normalizedError,
    type: normalizedError.type,
    status: normalizedError.status,
    context: normalizedError.context,
    // Include stack trace for errors
    stack: normalizedError.stack,
    // Include original error if available
    originalError: normalizedError.originalError
  }, `Error: ${normalizedError.message}`);
}
```

### Higher-Order Function Wrappers

```typescript
// src/utils/errorHandlingUtils.ts
export function withErrorHandling<T>(
  fn: () => Promise<T>,
  errorHandler: (error: unknown) => Promise<T>
): Promise<T> {
  return fn().catch(errorHandler);
}

export async function tryOrNull<T>(
  fn: () => Promise<T>,
  logger?: Logger
): Promise<T | null> {
  try {
    return await fn();
  } catch (error) {
    if (logger) {
      logErrorWithContext(logger, error);
    }
    return null;
  }
}

export async function tryOrDefault<T>(
  fn: () => Promise<T>,
  defaultValue: T,
  logger?: Logger
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (logger) {
      logErrorWithContext(logger, error);
    }
    return defaultValue;
  }
}
```

### Error Conversion with Context

```typescript
// src/utils/errorHandlingUtils.ts
export function toTransformError(
  error: unknown,
  context?: ErrorContext
): VideoTransformError {
  const transformError = normalizeErrorBasic(error);
  
  // Add context if provided
  if (context) {
    transformError.context = {
      ...transformError.context,
      ...context
    };
  }
  
  return transformError;
}
```

## Request Context Tracking

The system implements robust context tracking for comprehensive error diagnostics:

### RequestContext Interface

```typescript
// src/utils/requestContext.ts
export interface RequestContext {
  requestId: string;
  url: string;
  method: string;
  startTime: number;
  breadcrumbs: Breadcrumb[];
  timedOperations: Record<string, TimedOperation>;
  clientInfo?: {
    userAgent?: string;
    ip?: string;
    country?: string;
    device?: string;
  };
}

export interface Breadcrumb {
  message: string;
  category: string;
  timestamp: number;
  data?: Record<string, any>;
}

export interface TimedOperation {
  name: string;
  startTime: number;
  endTime?: number;
  duration?: number;
}
```

### Context Management Functions

```typescript
// src/utils/requestContext.ts
// Store current context in a singleton to avoid passing through many functions
let currentContext: RequestContext | null = null;

export function createRequestContext(request: Request): RequestContext {
  const context: RequestContext = {
    requestId: crypto.randomUUID(),
    url: request.url,
    method: request.method,
    startTime: Date.now(),
    breadcrumbs: [],
    timedOperations: {}
  };
  
  // Add client information if available
  const clientIP = request.headers.get('CF-Connecting-IP');
  const country = request.headers.get('CF-IPCountry');
  const userAgent = request.headers.get('User-Agent');
  
  if (clientIP || country || userAgent) {
    context.clientInfo = {
      ip: clientIP || undefined,
      country: country || undefined,
      userAgent: userAgent || undefined,
      device: userAgent ? parseDeviceFromUserAgent(userAgent) : undefined
    };
  }
  
  return context;
}

export function setCurrentContext(context: RequestContext): void {
  currentContext = context;
}

export function getCurrentContext(): RequestContext | null {
  return currentContext;
}

export function addBreadcrumb(
  message: string,
  category: string,
  data?: Record<string, any>
): void {
  if (!currentContext) {
    return;
  }
  
  currentContext.breadcrumbs.push({
    message,
    category,
    timestamp: Date.now(),
    data
  });
}
```

## Error Logging

The system integrates with a structured logging system:

### Logger Integration

```typescript
// src/utils/pinoLogger.ts
import pino, { Logger } from 'pino';
import { getCurrentContext } from './requestContext';

export function createLogger(name: string): Logger {
  return pino({
    name,
    level: 'info',
    messageKey: 'message',
    timestamp: pino.stdTimeFunctions.isoTime,
    base: null,
    mixin() {
      // Automatically include request context in all logs
      const context = getCurrentContext();
      if (context) {
        return {
          requestId: context.requestId,
          url: context.url,
          breadcrumbs: context.breadcrumbs,
        };
      }
      return {};
    }
  });
}
```

### Error Logging Example

```typescript
// Example error logging in a service
try {
  // Operation that might fail
  await transformVideo(options);
} catch (error) {
  // Add context and log the error
  logErrorWithContext(
    logger,
    error,
    {
      path: request.url,
      options,
      mode: 'video'
    },
    'error'
  );
  
  // Handle the error or rethrow
  throw toTransformError(error, { handler: 'videoHandler' });
}
```

## Fallback Mechanisms

The system implements sophisticated fallback mechanisms for graceful degradation:

### Error Handling Service

```typescript
// src/services/errorHandlerService.ts
export class ErrorHandlerService {
  // Dependencies injection
  constructor(
    private readonly logger: Logger,
    private readonly storageService: VideoStorageService,
    private readonly configService: ConfigurationService
  ) {}

  // Creates standardized error responses
  createErrorResponse(error: unknown, request: Request): Response {
    const transformError = normalizeErrorBasic(error);
    
    // Add debug information if enabled
    if (this.configService.isDebugMode(request)) {
      const response = transformError.toResponse();
      
      // Add debug headers
      response.headers.set('X-Error-Type', transformError.type);
      response.headers.set('X-Error-Status', transformError.status.toString());
      
      // Return HTML debug view for browsers requesting it
      const accept = request.headers.get('Accept') || '';
      if (accept.includes('text/html')) {
        return this.createDebugHtmlErrorResponse(transformError, request);
      }
      
      return response;
    }
    
    // Return standard JSON error response
    return transformError.toResponse();
  }

  // Fetches original content when transformation fails
  async fetchOriginalContentFallback(
    url: string,
    error: unknown,
    request: Request,
    options: VideoFallbackOptions
  ): Promise<Response> {
    // Only fallback for certain error types if configured
    const transformError = normalizeErrorBasic(error);
    if (
      options.badRequestOnly &&
      transformError.status < 400 &&
      transformError.status >= 500
    ) {
      throw transformError;
    }
    
    // Try pattern-specific fallback first
    try {
      const response = await this.patternSpecificFallback(url, options);
      
      // Add fallback headers
      response.headers.set('X-Fallback-Reason', transformError.type);
      response.headers.set('X-Original-Error', transformError.message);
      
      return response;
    } catch (fallbackError) {
      // Log fallback failure
      this.logger.warn(
        { err: fallbackError, originalError: error },
        'Pattern-specific fallback failed, trying storage service'
      );
      
      // Try storage service as a last resort
      return this.storageService.fetchOriginalContent(url);
    }
  }

  // Handles transformation-specific errors
  async handleTransformationError(
    error: unknown,
    request: Request,
    originalUrl: string,
    options: VideoTransformOptions
  ): Promise<Response> {
    const transformError = normalizeErrorBasic(error);
    
    // Special handling for file size errors
    if (
      this.configService.getConfig().fileSizeErrorHandling &&
      transformError.type === ErrorType.FILE_SIZE_LIMIT_EXCEEDED
    ) {
      this.logger.warn(
        { err: transformError, url: originalUrl },
        'File size limit exceeded, falling back to original'
      );
      
      // Fetch original without transformation
      return this.fetchOriginalContentFallback(
        originalUrl,
        transformError,
        request,
        { badRequestOnly: false }
      );
    }
    
    // Handle other errors
    return this.createErrorResponse(transformError, request);
  }
}
```

### Specialized Fallback Strategies

```typescript
// src/services/errorHandlerService.ts
private async patternSpecificFallback(
  url: string,
  options: VideoFallbackOptions
): Promise<Response> {
  // Get matched pattern for URL
  const pattern = this.configService.getPatternForPath(url);
  if (!pattern) {
    throw new NotFoundError(`No pattern found for path: ${url}`);
  }
  
  // Use pattern-specific origin
  const originUrl = pattern.originUrl || this.configService.getDefaultOrigin();
  if (!originUrl) {
    throw new ConfigurationError('No origin URL configured for fallback');
  }
  
  // Construct full origin URL
  const fullUrl = new URL(url.replace(pattern.match, pattern.pathExpression), originUrl);
  
  // Handle authentication if required
  if (pattern.authentication === 'aws-s3-presigned-url') {
    return this.fetchWithPresignedUrl(fullUrl.toString(), pattern);
  } else if (pattern.authentication === 'aws-s3') {
    return this.fetchWithAwsAuth(fullUrl.toString(), pattern);
  }
  
  // Direct fetch for no authentication
  return fetch(fullUrl.toString());
}
```

## Error Response Creation

The system provides standardized error response creation:

```typescript
// From VideoTransformError.ts
toResponse(): Response {
  const body = this.toJSON();
  
  return new Response(JSON.stringify(body), {
    status: this.status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store, must-revalidate',
      'X-Error-Type': this.type
    }
  });
}

toJSON(): ErrorResponseBody {
  return {
    error: true,
    type: this.type,
    message: this.message,
    status: this.status,
    // Only include context in non-production environments
    ...(process.env.NODE_ENV !== 'production' && { context: this.context })
  };
}
```

## Integration With Cache System

The error handling system is integrated with the caching system for advanced behavior:

### Cache Version Increment on Error

```typescript
// src/services/cacheVersionService.ts
async incrementVersionOnError(
  error: unknown, 
  path: string
): Promise<number> {
  const transformError = normalizeErrorBasic(error);
  
  // Only increment version for certain error types
  if (
    transformError.type === ErrorType.FETCH_ERROR ||
    transformError.type === ErrorType.STORAGE_ERROR
  ) {
    // Get path pattern
    const pathPattern = this.getPathPatternFromUrl(path);
    if (!pathPattern) {
      return this.currentVersion;
    }
    
    // Increment version for this path pattern
    return this.incrementVersion(pathPattern);
  }
  
  return this.currentVersion;
}
```

### Error-Aware Cache TTL

```typescript
// src/utils/cacheControlUtils.ts
export function getCacheTtlForResponse(
  response: Response,
  config: CacheConfig
): number {
  const status = response.status;
  
  // Use different TTLs based on response status
  if (status >= 200 && status < 300) {
    return config.ttl.ok;
  } else if (status >= 300 && status < 400) {
    return config.ttl.redirects;
  } else if (status >= 400 && status < 500) {
    return config.ttl.clientError;
  } else {
    return config.ttl.serverError;
  }
}
```

## Best Practices

When working with the error handling system, follow these best practices:

### 1. Use specialized error classes

Create specialized errors for better categorization:

```typescript
// Don't throw generic errors
throw new Error('Invalid mode: ' + mode);

// Do use specialized errors
throw ValidationError.invalidMode(mode, { path: request.url });
```

### 2. Include detailed context

Always include relevant context with errors:

```typescript
// Don't throw errors without context
throw new ProcessingError('Transformation failed');

// Do include detailed context
throw new ProcessingError(
  'Transformation failed',
  ErrorType.TRANSFORMATION_ERROR,
  {
    url: request.url,
    options: transformOptions,
    duration: operation.duration
  }
);
```

### 3. Use utility functions

Prefer utility functions for standardized error handling:

```typescript
// Don't manually try/catch everywhere
try {
  const result = await riskyOperation();
  return result;
} catch (e) {
  logger.error(e);
  return null;
}

// Do use utility functions
const result = await tryOrNull(riskyOperation, logger);
```

### 4. Normalize unknown errors

Always normalize unknown errors before using them:

```typescript
// Don't pass unknown errors directly
async function handleError(error: unknown) {
  logger.error(error); // error might not be formatted properly
}

// Do normalize errors
async function handleError(error: unknown) {
  const normalizedError = normalizeErrorBasic(error);
  logger.error(normalizedError);
}
```

### 5. Use breadcrumbs for complex operations

Record detailed breadcrumbs for complex operations:

```typescript
// Do leave breadcrumbs for complex operations
async function transformVideo(options: VideoTransformOptions) {
  addBreadcrumb('Starting video transformation', 'transform', { options });
  
  try {
    const result = await performTransformation(options);
    addBreadcrumb('Transformation successful', 'transform', { duration: result.duration });
    return result;
  } catch (error) {
    addBreadcrumb('Transformation failed', 'error', { error });
    throw error;
  }
}
```

## Examples

### Example 1: Basic Error Handling

```typescript
import { ValidationError, ErrorType, logErrorWithContext } from '../errors';

export async function validateOptions(options: VideoTransformOptions): Promise<void> {
  // Check for valid mode
  if (!['video', 'frame', 'spritesheet'].includes(options.mode)) {
    throw ValidationError.invalidMode(options.mode, { options });
  }
  
  // Check dimensions if provided
  if (options.width && options.height) {
    const width = parseInt(options.width, 10);
    const height = parseInt(options.height, 10);
    
    if (isNaN(width) || isNaN(height) || width <= 0 || height <= 0) {
      throw ValidationError.invalidDimensions(
        options.width,
        options.height,
        { options }
      );
    }
  }
}
```

### Example 2: Using Higher-Order Functions

```typescript
import { withErrorHandling, logErrorWithContext } from '../utils/errorHandlingUtils';

export async function fetchVideo(url: string): Promise<VideoData> {
  return withErrorHandling(
    async () => {
      // Risky operation
      const response = await fetch(url);
      if (!response.ok) {
        throw new ProcessingError.fetchFailed(
          url,
          response.status,
          { status: response.status, statusText: response.statusText }
        );
      }
      return await response.json();
    },
    async (error) => {
      // Error handler
      logErrorWithContext(logger, error, { url });
      
      // Increment cache version on fetch errors
      await cacheVersionService.incrementVersionOnError(error, url);
      
      // Re-throw with additional context
      throw toTransformError(error, { handler: 'fetchVideo', url });
    }
  );
}
```

### Example 3: Complete HTTP Handler with Error Handling

```typescript
export async function handleVideoRequest(request: Request): Promise<Response> {
  // Create and set request context
  const context = createRequestContext(request);
  setCurrentContext(context);
  
  // Start timed operation
  const operationName = 'handleVideoRequest';
  startTimedOperation(operationName);
  
  try {
    // Parse URL and options
    const url = new URL(request.url);
    const options = parseVideoOptions(url);
    
    // Add breadcrumb
    addBreadcrumb('Processing video request', 'handler', { url: url.toString(), options });
    
    // Validate options
    await validateOptions(options);
    
    // Process request
    return await videoTransformationService.transformVideo(request, options);
  } catch (error) {
    // Handle error
    return errorHandlerService.handleTransformationError(
      error,
      request,
      request.url,
      options
    );
  } finally {
    // End timed operation
    endTimedOperation(operationName);
    
    // Add performance metrics breadcrumb
    const metrics = getPerformanceMetrics();
    addBreadcrumb('Request completed', 'performance', { metrics });
  }
}
```

This error handling implementation provides a robust foundation for handling failures gracefully while providing detailed diagnostic information for troubleshooting.
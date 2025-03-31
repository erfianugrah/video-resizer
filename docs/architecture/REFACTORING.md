# Video Resizer Refactoring

This document outlines the refactoring work done to improve the architecture of the Video Resizer component.

## 0. Latest Refactoring: Logging Configuration Management

We've improved the configuration flow to ensure wrangler.jsonc is properly the single source of truth for all configuration, especially logging. This involved several key improvements:

1. **Enhanced LoggingConfigurationManager**:
   - Added proper schema with Zod for all logging components including breadcrumbs and Pino-specific settings
   - Added methods for accessing all configuration aspects (getPinoConfig, getBreadcrumbConfig, etc.)
   - Made LoggingConfigurationManager the central source for all logging settings

2. **Removed Direct Global Variable Access**:
   - Replaced direct access to global variables (LOGGING_CONFIG, DEBUG_ENABLED, DEBUG_VERBOSE) with manager method calls
   - Updated pinoLogger.ts to use LoggingConfigurationManager for all settings
   - Updated requestContext.ts to use configuration managers for debug flags and breadcrumb settings

3. **Improved Configuration Initialization**:
   - Updated index.ts to use proper configuration initialization
   - Ensured consistent type safety throughout the configuration flow
   - Added better error handling for configuration issues

4. **Benefits**:
   - **Type Safety**: All configuration is now properly typed with TypeScript and validated with Zod
   - **Centralized Management**: Single source of truth for all configuration
   - **Testability**: Easier to mock configuration for tests
   - **Maintainability**: Cleaner code with proper separation of concerns

## 1. Code Structure Refactoring

### Implemented Strategy Pattern

The large `TransformVideoCommand` class (500+ lines) has been refactored using the Strategy pattern to improve maintainability and separation of concerns:

- Created a `TransformationStrategy` interface to define common operations across all transformation types
- Implemented concrete strategies for each transformation mode:
  - `VideoStrategy`: Handles video mode transformations
  - `FrameStrategy`: Handles frame extraction (still images) 
  - `SpritesheetStrategy`: Handles spritesheet generation

### Added Strategy Factory

- Implemented a `StrategyFactory` that selects the appropriate strategy based on the transformation mode
- This allows for easy addition of new transformation types in the future

### Created Dedicated Transformation Service

- Added a new `TransformationService` to coordinate the transformation process
- The service acts as a facade that handles:
  - URL construction
  - Cache configuration 
  - Path pattern application
  - Diagnostics information collection

### Benefits of the New Architecture

1. **Improved Separation of Concerns**:
   - Each transformation type has dedicated logic in its own class
   - Validation, parameter preparation, and diagnostics are cleanly separated

2. **Enhanced Maintainability**:
   - Reduced the size of the `TransformVideoCommand` class from 500+ lines to ~200 lines
   - Better organization of code makes it easier to understand and extend

3. **Better Testability**:
   - Each strategy can be unit tested in isolation
   - The command class is focused on orchestration rather than implementation details

4. **Flexible Extension Points**:
   - New transformation modes can be added by implementing new strategies
   - Common behavior is shared through the strategy interface

## 2. Circular Dependency Improvements

The refactoring also helped address circular dependency issues:

- Services now use more dynamic imports for dependencies
- Shared functionality moved to the proper abstraction level
- Strategy pattern helps keep dependencies flowing in one direction

## Implementation Details

### Strategy Interface

```typescript
export interface TransformationStrategy {
  prepareTransformParams(context: TransformationContext): TransformParams;
  validateOptions(options: VideoTransformOptions): void;
  updateDiagnostics(context: TransformationContext): void;
}
```

### Strategy Factory

```typescript
export function createTransformationStrategy(options: VideoTransformOptions): TransformationStrategy {
  const mode = options.mode || 'video'; // Default to video mode
  
  switch (mode) {
    case 'frame':
      return new FrameStrategy();
    case 'spritesheet':
      return new SpritesheetStrategy();
    case 'video':
    default:
      return new VideoStrategy();
  }
}
```

### Transformation Service

The new transformation service orchestrates the process:

```typescript
export async function prepareVideoTransformation(
  request: Request,
  options: VideoTransformOptions,
  pathPatterns: PathPattern[],
  debugInfo?: DebugInfo,
  env?: { ASSETS?: { fetch: (request: Request) => Promise<Response> }}
): Promise<{
  cdnCgiUrl: string;
  cacheConfig: any;
  source: string;
  derivative: string;
  diagnosticsInfo: any;
}>
```

## 3. Error Handling Enhancements

### Custom Error Class Hierarchy

Implemented a robust error handling system with a proper hierarchy:

- `VideoTransformError`: Base error class with error type classification and status code mapping
- Specialized error classes for different scenarios:
  - `ValidationError`: For input validation issues
  - `ProcessingError`: For transformation and processing failures
  - `ConfigurationError`: For configuration-related problems
  - `NotFoundError`: For missing resources or patterns

### Improved Error Context

Enhanced errors with rich contextual information:

- Each error includes detailed context about what happened
- Errors have specific error types for better categorization
- Appropriate HTTP status codes are automatically assigned based on error type

### Centralized Error Handling

Added a dedicated error handling service:

- `errorHandlerService`: Centralizes error handling logic
- Provides consistent error normalization and logging
- Generates appropriate error responses with diagnostics
- Enhanced integration with the debug interface

### Error Response Improvements

Error responses now include:

- Appropriate HTTP status codes (400, 404, 500, etc.)
- Structured JSON responses with error type and message
- Additional diagnostic headers (X-Error-Type)
- Improved caching directives for error responses
- Enhanced debug view for errors when debug mode is enabled

### Error Implementation

```typescript
export enum ErrorType {
  // Validation errors - 400 range
  INVALID_PARAMETER = 'INVALID_PARAMETER',
  INVALID_MODE = 'INVALID_MODE',
  INVALID_FORMAT = 'INVALID_FORMAT',
  // ... more error types

  // Unknown errors
  UNKNOWN_ERROR = 'UNKNOWN_ERROR'
}

export class VideoTransformError extends Error {
  public errorType: ErrorType;
  public statusCode: number;
  public context: ErrorContext;
  
  // ... constructor and methods
  
  toResponse(): Response {
    // Creates an appropriate HTTP response
  }
}

// Example specialized error
export class ValidationError extends VideoTransformError {
  // Factory methods for common validation errors
  static invalidMode(mode: string, validModes: string[]): ValidationError {
    // ...
  }
  
  static invalidDimension(dimensionName: string, value: number, min: number, max: number): ValidationError {
    // ...
  }
}
```

### Error Handler Service

```typescript
// Convert any error to a VideoTransformError
export function normalizeError(err: unknown, context: Record<string, any> = {}): VideoTransformError {
  // ...
}

// Create an appropriate error response based on the error type
export async function createErrorResponse(
  err: unknown,
  request: Request,
  debugInfo?: DebugInfo,
  diagnosticsInfo?: DiagnosticsInfo,
  env?: { ASSETS?: { fetch: (request: Request) => Promise<Response> }}
): Promise<Response> {
  // ...
}
```

## 4. Error Handling System Implementation

The error handling system has been fully implemented across all transformation strategies:

### Error System Adoption in All Strategies

- **VideoStrategy**: Previously implemented the error system
- **FrameStrategy**: Now updated to use specialized ValidationError classes
- **SpritesheetStrategy**: Now updated to use specialized ValidationError classes

### Consistent Error Context

- All strategies now provide consistent error contexts
- Context includes the transformation mode and relevant parameters
- Errors include diagnostic information for debugging
- Type safety is enforced across all error handling code

### Contextual Error Factories

Each strategy uses appropriate error factory methods:

- `ValidationError.invalidDimension()`: For width/height validation failures
- `ValidationError.invalidFormat()`: For format, quality and fit validation
- `ValidationError.invalidTimeValue()`: For time and duration validation
- `ValidationError.invalidOptionCombination()`: For incompatible option combinations

### Benefits of the Unified Error System

1. **Consistent Error Responses**:
   - All transformations now return standardized error responses
   - HTTP status codes are appropriate for the error type
   - Error messages are clear and actionable

2. **Enhanced Debugging**:
   - Errors provide rich context for easier troubleshooting
   - Error type is included in response headers
   - Debug mode shows detailed error information

3. **Improved Developer Experience**:
   - Clear validation feedback for API users
   - Specific error types make it easier to handle errors programmatically
   - Consistent structure allows for predictable error handling

## 5. Configuration Management Implementation

The configuration management system has been implemented to provide a type-safe, validated, and centralized approach to handling video transformation configuration:

### Zod Schema Validation

- Created comprehensive schemas for all configuration objects
- Implemented strong type checking and runtime validation
- Added proper error messages for invalid configurations
- Generated TypeScript types from the Zod schemas

### VideoConfigurationManager Class

- Implemented as a singleton to ensure consistent configuration access
- Provides type-safe getters for all configuration sections
- Validates configuration at initialization and during updates
- Throws specialized `ConfigurationError` instances with detailed context
- Supports dynamic configuration updates with validation

### Configuration Features

- **Strongly Typed API**: Full TypeScript support with proper type inference
- **Runtime Validation**: Catches configuration errors at startup or update time
- **Centralized Access**: Single source of truth for all configuration data
- **Extensible System**: Easy to add new configuration sections
- **Developer Experience**: Helpful error messages with detailed path information

### Schema-Based Validation Benefits

1. **Type Safety**: Ensures configuration matches expected types
2. **Value Validation**: Validates values meet business logic constraints
3. **Self-Documentation**: Schemas document expected types and constraints
4. **Fail-Fast**: Catches configuration errors early rather than at runtime
5. **Detailed Error Reporting**: Provides clear error messages for invalid configuration

### Unit Testing

Added comprehensive tests for the configuration manager:
- Singleton pattern implementation
- Configuration validation functionality
- Accessors for all configuration sections 
- Configuration modification methods
- Error handling for invalid configurations

## 6. Logging System Improvements

The logging system has been enhanced with a more efficient and configurable architecture that respects production environment requirements:

### Structured Logging with Pino

- Implemented a structured JSON logging system using Pino
- Added request-scoped logging with breadcrumb support
- Created a centralized logging configuration via wrangler.jsonc
- Added proper log level filtering based on environment

### Breadcrumb System

- Added an efficient request-scoped breadcrumb collection system
- Made breadcrumb collection configurable (can be disabled in production)
- Implemented breadcrumb count limiting to prevent memory issues
- Integrated breadcrumbs with performance tracking

### Environment-Aware Logging

- Log levels are now configurable per environment (debug, info, warn, error)
- Production environment uses higher log level threshold (info)
- Development and staging use more verbose logging (debug)
- Debug flags can be toggled via URL parameters or headers, overriding environment defaults

### Log Sampling

- Added support for log sampling to reduce log volume in production
- Configurable sampling rates per environment
- Full logging in development, reduced rates in staging/production
- Debug logs can still be triggered for specific requests

### Enhanced Debug Headers

- Debug headers include performance metrics
- Component timing breakdowns are tracked and exposed
- Breadcrumb counts are reported in response headers
- Debug mode can be activated per request

### Type-Safe Configuration

- Created proper interfaces for all logging configuration
- Added schema validation for log configuration
- Implemented strong typing for log levels and options
- Uses proper type narrowing for safer code

### Latest Improvement: Centralized Configuration Management

We've improved the configuration flow to ensure wrangler.jsonc is properly the single source of truth for all logging configuration:

1. **Enhanced LoggingConfigurationManager**:
   - Added proper schema with Zod for all logging components including breadcrumbs and Pino-specific settings
   - Added methods for accessing all configuration aspects (getPinoConfig, getBreadcrumbConfig, etc.)
   - Made LoggingConfigurationManager the central source for all logging settings

2. **Removed Direct Global Variable Access**:
   - Replaced direct access to global variables (LOGGING_CONFIG, DEBUG_ENABLED, DEBUG_VERBOSE) with manager method calls
   - Updated pinoLogger.ts to use LoggingConfigurationManager for all settings
   - Updated requestContext.ts to use configuration managers for debug flags and breadcrumb settings

3. **Improved Configuration Initialization**:
   - Updated index.ts to use proper configuration initialization
   - Ensured consistent type safety throughout the configuration flow
   - Added better error handling for configuration issues

### Implementation Details

```typescript
// Logging configuration in wrangler.jsonc
"LOGGING_CONFIG": {
  "pino": {
    "level": "info",  // Only log info and above in production
    "browser": {
      "asObject": true
    },
    "base": {
      "service": "video-resizer",
      "env": "production"
    }
  },
  "sampling": {
    "enabled": true,
    "rate": 0.05      // Sample only 5% of logs in production
  },
  "breadcrumbs": {
    "enabled": false, // Disable breadcrumbs in production
    "maxItems": 25
  }
}

// Log level enforcement in pinoLogger.ts
export function debug(
  context: RequestContext, 
  logger: pino.Logger, 
  category: string, 
  message: string, 
  data?: Record<string, unknown>
) {
  // Always add breadcrumb for tracking, regardless of log level
  const breadcrumb = addBreadcrumb(context, category, message, data);
  
  // Skip debug logs if:
  // 1. The logger's level is higher than debug OR
  // 2. Debug is not enabled in the request context
  const loggerLevel = logger.level as string;
  const isDebugAllowedByLevel = loggerLevel === 'debug' || loggerLevel === 'trace';
  
  if (!isDebugAllowedByLevel || !context.debugEnabled) {
    return breadcrumb;
  }
  
  // Apply sampling if enabled
  if (samplingConfig.enabled && Math.random() > samplingConfig.rate) {
    return breadcrumb;
  }
  
  // Log with Pino - (rest of implementation)
}
```

### Benefits

1. **Production Performance**:
   - Reduced log volume with appropriate levels
   - Memory optimization by disabling breadcrumbs in production
   - Sampling to prevent log overload
   - Configurable per environment

2. **Better Diagnostics**:
   - Structured logging enables better log parsing and analysis
   - Breadcrumbs provide request history for debugging
   - Performance metrics help identify bottlenecks
   - Per-component timing information

3. **Flexibility**:
   - Temporary debug mode available even in production
   - URL parameters can enable debug for specific requests
   - Headers can trigger more detailed logging
   - Environment-specific configuration

4. **Type Safety**:
   - Proper TypeScript interfaces for all logging components
   - Safer code with explicit null and undefined handling
   - Better IDE support with proper typing
   - All configuration is now properly typed with TypeScript and validated with Zod

## Next Steps

1. **Further Strategy Refinements**:
   - Add specialized cache strategies
   - Implement content negotiation strategies
   - Replace direct usage of videoConfig with ConfigurationManager

2. **Testing Improvements**:
   - Add specific tests for each strategy implementation
   - Update parametrized tests to cover all strategy types
   - Add more comprehensive error handling tests
   - Add more unit tests specific to configuration integration
   - Add tests for edge cases in configuration loading

3. **Performance Improvements**:
   - Optimize imports to reduce cold start times
   - Improve cache handling for better performance
   
4. **Documentation Updates**:
   - Add JSDoc comments to all public interfaces
   - Create examples of common configuration patterns
   - Document the schema validation approach

5. **Logging System Refinements**:
   - Add more granular component filtering
   - Implement log rotation for development environment
   - Add correlation IDs for cross-service tracing
   - Create dashboard visualizations for log analysis
   - Standardize all code to use configuration managers consistently
   - Remove any remaining direct access to environment variables
   - Add monitoring for configuration issues
   - Improve error reporting when configuration fails to load
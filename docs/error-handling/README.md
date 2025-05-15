# Video Resizer Error Handling

*Last Updated: May 15, 2025* (Updated with transformation error handling documentation)

This section provides documentation on the error handling system used in the Video Resizer.

## Core Error Handling Documents

- [Error Handling Implementation](./implementation.md) - Detailed implementation guide
- [Error Types](./error-types.md) - Reference for error classes and types
- [Transformation Error Handling](./transformation-error-handling.md) - Specialized handling for transformation errors

## Error Handling Overview

The Video Resizer implements a comprehensive error handling system with:

1. **Specialized Error Classes**:
   - `VideoTransformError` - Base error class
   - `ValidationError` - Input validation errors
   - `ProcessingError` - Video processing errors
   - `ConfigurationError` - Configuration-related errors
   - `NotFoundError` - Resource not found errors

2. **Standardized Utilities**:
   - `logErrorWithContext` - Structured error logging
   - `withErrorHandling` - Higher-order function for error handling
   - `tryOrNull` - Safe execution with null fallback
   - `tryOrDefault` - Safe execution with custom default fallback
   - `toTransformError` - Error normalization

3. **Context Tracking**:
   - Breadcrumb creation for error tracing
   - Detailed context objects
   - Request information preservation

4. **Fallback Mechanisms**:
   - Multi-origin fallback for resilient content delivery
   - Pattern-specific fallbacks with authentication
   - Direct fetch fallback for large files
   - Storage service fallback as a last resort

See the [Error Handling Implementation](./implementation.md) and [Transformation Error Handling](./transformation-error-handling.md) documents for detailed information on using these features.
# Video Resizer Error Handling

*Last Updated: May 10, 2025* (Updated with implementation and error types documentation)

This section provides documentation on the error handling system used in the Video Resizer.

## Core Error Handling Documents

- [Error Handling Implementation](./implementation.md) - Detailed implementation guide
- [Error Types](./error-types.md) - Reference for error classes and types

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

See the [Error Handling Implementation](./implementation.md) document for detailed information on using these features.
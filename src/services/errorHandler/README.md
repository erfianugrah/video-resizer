# Error Handler Service

This directory contains the implementation of the Error Handler Service, which was refactored from a single monolithic file into smaller, more focused modules.

## Directory Structure

- `logging.ts` - Helper functions for consistent logging throughout the service
- `normalizeError.ts` - Utilities for normalizing different types of errors into VideoTransformError
- `fallbackContent.ts` - Implementation of original content fallback when transformation fails
- `errorResponse.ts` - Functions for creating appropriate error responses
- `transformationErrorHandler.ts` - Specialized handling for transformation errors
- `index.ts` - Re-exports all functionality to maintain backward compatibility

## Functionality

The Error Handler Service is responsible for:

1. Normalizing different types of errors into a consistent format
2. Providing fallback to original content when transformations fail
3. Creating appropriate error responses with consistent formatting
4. Handling transformation-specific errors and retries
5. Integrating with the debug service for error visualization
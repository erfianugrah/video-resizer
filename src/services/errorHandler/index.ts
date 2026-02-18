/**
 * Error Handler Service
 * Re-exports all functionality to maintain backward compatibility
 */

// Export the error normalization functions
export { normalizeError } from './normalizeError';

// Export the fallback content functions
export { fetchOriginalContentFallback } from './fallbackContent';

// Export the error response functions
export { createErrorResponse } from './errorResponse';

// Export the transformation error handler
export { handleTransformationError } from './transformationErrorHandler';

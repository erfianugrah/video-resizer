/**
 * Functions for normalizing different types of errors into VideoTransformError
 */
import { VideoTransformError, ErrorType, ProcessingError } from '../../errors';
import { tryOrDefault } from '../../utils/errorHandlingUtils';
// Logger removed: error logging is handled by the tryOrDefault wrapper

/**
 * Implementation of normalizeError that might throw errors
 */
function normalizeErrorImpl(
  err: unknown,
  context: Record<string, unknown> = {}
): VideoTransformError {
  // If it's already a VideoTransformError, return it
  if (err instanceof VideoTransformError) {
    return err;
  }

  // If it's another type of Error, convert it
  if (err instanceof Error) {
    return ProcessingError.fromError(err, ErrorType.UNKNOWN_ERROR, context);
  }

  // If it's a string or other value, create a new error
  const message = typeof err === 'string' ? err : 'Unknown error occurred';
  return new VideoTransformError(message, ErrorType.UNKNOWN_ERROR, context);
}

/**
 * Convert any error to a VideoTransformError
 * Uses standardized error handling for consistent logging
 * This is a utility function to ensure consistent error handling across the application
 */
export const normalizeError = tryOrDefault<
  [unknown, Record<string, unknown>?],
  VideoTransformError
>(
  normalizeErrorImpl,
  {
    functionName: 'normalizeError',
    component: 'ErrorHandlerService',
    logErrors: true,
  },
  new VideoTransformError('Error normalization failed', ErrorType.UNKNOWN_ERROR, {})
);

/**
 * Utility functions for standardized error handling across the application.
 *
 * This module provides consistent error handling patterns to use throughout the codebase,
 * reducing duplication and ensuring proper logging, context capturing, and error normalization.
 */
import { VideoTransformError, ErrorType, ProcessingError } from '../errors';
import { getCurrentContext, addBreadcrumb } from './requestContext';
import { createCategoryLogger } from './logger';
import * as Sentry from '@sentry/cloudflare';

const errLogger = createCategoryLogger('Application');

/**
 * Create a JSON replacer that handles circular references.
 * Returns a replacer function for use with JSON.stringify.
 */
export function getCircularReplacer() {
  const seen = new WeakSet();
  return (_key: string, value: unknown) => {
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) return '[Circular]';
      seen.add(value);
    }
    return value;
  };
}

/**
 * Safely serialize an error for console output.
 * Error objects have non-enumerable properties, so they appear as [object Object] or {} when logged.
 * This function extracts the important error information for proper logging.
 *
 * @param error - The error to serialize
 * @returns A serializable object with error details
 */
export function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      // Include any additional custom properties
      ...Object.getOwnPropertyNames(error).reduce(
        (acc, prop) => {
          if (!['name', 'message', 'stack'].includes(prop)) {
            acc[prop] = (error as any)[prop];
          }
          return acc;
        },
        {} as Record<string, any>
      ),
    };
  }

  // For non-Error objects
  if (typeof error === 'object' && error !== null) {
    return { value: error };
  }

  // For primitives
  return { value: String(error) };
}

/**
 * Basic error normalization to prevent circular dependencies.
 * This is a simplified version of the normalizeError function in errorHandlerService.ts.
 *
 * @param err - Any error to normalize
 * @param context - Additional context data
 * @returns A VideoTransformError
 */
function normalizeErrorBasic(
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

  // If it's a string, use it directly
  if (typeof err === 'string') {
    return new VideoTransformError(err, ErrorType.UNKNOWN_ERROR, context);
  }

  // If it's an object with a message property, extract it
  if (err && typeof err === 'object' && 'message' in err) {
    const message = typeof err.message === 'string' ? err.message : String(err.message);
    return new VideoTransformError(message, ErrorType.UNKNOWN_ERROR, context);
  }

  // For any other type, create a generic error
  return new VideoTransformError('Unknown error occurred', ErrorType.UNKNOWN_ERROR, context);
}

/**
 * Capture error to Sentry with filtering for expected errors
 *
 * @param error - The error to capture
 * @param context - Additional context data
 */
function captureErrorToSentry(error: unknown, context: Record<string, unknown> = {}): void {
  // Don't capture expected errors
  if (error instanceof Error) {
    // Filter out client disconnects (AbortError)
    if (
      error.name === 'AbortError' ||
      (error instanceof DOMException && error.name === 'AbortError')
    ) {
      return;
    }

    // Filter out other expected errors if needed
    // Add more filters here as needed
  }

  // Try to capture to Sentry (may not be available in test environment)
  try {
    // Capture to Sentry with context
    Sentry.withScope((scope) => {
      // Add context data as tags and extra context
      Object.entries(context).forEach(([key, value]) => {
        // Add simple values as tags for better filtering in Sentry
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
          scope.setTag(key, String(value));
        } else {
          // Add complex values as extra context
          scope.setExtra(key, value);
        }
      });

      // Set error level based on error type
      if (context.errorType) {
        scope.setLevel(
          context.errorType === ErrorType.RESOURCE_NOT_FOUND ||
            context.errorType === ErrorType.PATTERN_NOT_FOUND ||
            context.errorType === ErrorType.ORIGIN_NOT_FOUND
            ? 'info'
            : context.errorType === ErrorType.INVALID_PARAMETER ||
                context.errorType === ErrorType.INVALID_MODE ||
                context.errorType === ErrorType.INVALID_FORMAT
              ? 'warning'
              : 'error'
        );
      }

      // Capture the exception
      if (error instanceof Error) {
        Sentry.captureException(error);
      } else {
        // For non-Error objects, create a message
        Sentry.captureMessage(String(error), 'error');
      }
    });
  } catch (sentryError) {
    // Silently fail if Sentry is not available (e.g., in test environment)
    // This prevents test failures while still capturing errors in production
  }
}

/**
 * Standard error logging with context tracking.
 *
 * @param category - Component or service category
 * @param message - Error message
 * @param error - Original error object
 * @param context - Additional context data
 */
export function logErrorWithContext(
  message: string,
  error: unknown,
  context: Record<string, unknown> = {},
  category: string = 'Application'
): void {
  // Get normalized error data - use our basic normalizer to avoid circular dependencies
  const normalizedErr = normalizeErrorBasic(error, context);
  const errorMessage = normalizedErr.message;
  const errorStack = normalizedErr instanceof Error ? normalizedErr.stack : undefined;

  // Combine provided context with error context
  const combinedContext = {
    ...context,
    errorType: normalizedErr.errorType,
    errorMessage,
    stack: errorStack,
  };

  // Try to get the request context
  const requestContext = getCurrentContext();

  // Add breadcrumb if request context is available
  if (requestContext) {
    // Add error breadcrumb
    addBreadcrumb(requestContext, 'Error', message, {
      category,
      errorType: normalizedErr.errorType,
      error: errorMessage,
    });

    // Log with category logger
    const categoryLogger = createCategoryLogger(category);
    categoryLogger.error(message, combinedContext);
  } else {
    // Fall back to console for logging
    console.error({
      context: category,
      operation: 'logErrorWithContext',
      message,
      ...combinedContext,
    });
  }

  // Capture exception to Sentry (filters out expected errors)
  captureErrorToSentry(error, {
    message,
    category,
    ...combinedContext,
  });
}

/**
 * Wraps a function with standardized error handling.
 * Works with both async and sync functions, preserving their return type.
 *
 * @param fn - Function to wrap (async or sync)
 * @param context - Error context object with component and function name
 * @param additionalContext - Optional additional context data
 * @returns A new function with error handling
 */
export function withErrorHandling<A extends any[], R>(
  fn: (...args: A) => R | Promise<R>,
  context: {
    functionName: string;
    component: string;
    logErrors?: boolean;
  },
  additionalContext: Record<string, unknown> = {}
): (...args: A) => Promise<R> {
  return async (...args: A): Promise<R> => {
    try {
      // Handle both Promise and non-Promise returns
      const result = fn(...args);
      return result instanceof Promise ? await result : result;
    } catch (error) {
      // Log the error with context if requested
      if (context.logErrors !== false) {
        // Format arguments to avoid logging sensitive data
        const formattedArgs = args.map((arg) => {
          // Handle sensitive data by not logging the full content
          if (arg instanceof Request) {
            return {
              type: 'Request',
              url: arg.url,
              method: arg.method,
            };
          }
          if (arg instanceof Response) {
            return {
              type: 'Response',
              status: arg.status,
              statusText: arg.statusText,
            };
          }
          // Return other arguments as is (add more special handling as needed)
          return arg;
        });

        // Log the error with context
        logErrorWithContext(
          `Error during ${context.functionName}`,
          error,
          {
            ...additionalContext,
            args: formattedArgs,
          },
          context.component
        );
      }

      // Rethrow for caller handling
      throw error;
    }
  };
}

/**
 * Try to execute a function and return null on error.
 *
 * @param fn - Function to execute
 * @param context - Error context including category and operationName
 * @param defaultValue - Default value to return on error (defaults to null)
 * @returns The function result or null/defaultValue if an error occurred
 */
export function tryOrNull<P extends any[], R>(
  fn: (...args: P) => R,
  context: {
    functionName: string;
    component: string;
    logErrors?: boolean;
  },
  defaultValue: R | null = null
): (...args: P) => R | null {
  return (...args: P): R | null => {
    try {
      return fn(...args);
    } catch (error) {
      // Only log if requested
      if (context.logErrors !== false) {
        // Log the error with context
        logErrorWithContext(
          `Error during ${context.functionName} (returning ${defaultValue === null ? 'null' : 'default value'})`,
          error,
          { args },
          context.component
        );
      }

      // Return null or default value instead of propagating the error
      return defaultValue;
    }
  };
}

/**
 * Try to execute a function and return a default value on error.
 *
 * @param fn - Function to execute
 * @param context - Error context including category and operationName
 * @param defaultValue - Default value to return on error
 * @returns The function result or defaultValue if an error occurred
 */
export function tryOrDefault<P extends any[], R>(
  fn: (...args: P) => R,
  context: {
    functionName: string;
    component: string;
    logErrors?: boolean;
  },
  defaultValue: R
): (...args: P) => R {
  return (...args: P): R => {
    try {
      return fn(...args);
    } catch (error) {
      // Log the error with context if requested
      if (context.logErrors !== false) {
        // Log the error with context
        logErrorWithContext(
          `Error during ${context.functionName} (using default value)`,
          error,
          { args },
          context.component
        );
      }

      // Return the default value instead of propagating the error
      return defaultValue;
    }
  };
}

/**
 * Create a VideoTransformError from any error.
 *
 * @param error - Original error
 * @param errorType - Error type for categorization
 * @param context - Additional context data
 * @returns A VideoTransformError
 */
export function toTransformError(
  error: unknown,
  errorType: ErrorType = ErrorType.UNKNOWN_ERROR,
  context: Record<string, unknown> = {}
): VideoTransformError {
  // Use our basic normalizer to avoid circular dependencies
  return normalizeErrorBasic(error, context);
}

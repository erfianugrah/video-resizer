/**
 * Utility functions for standardized error handling across the application.
 * 
 * This module provides consistent error handling patterns to use throughout the codebase,
 * reducing duplication and ensuring proper logging, context capturing, and error normalization.
 */
import { VideoTransformError, ErrorType } from '../errors';
import { normalizeError } from '../services/errorHandlerService';
import { getCurrentContext, addBreadcrumb } from './requestContext';
import { createLogger, error as pinoError, debug as pinoDebug } from './pinoLogger';

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
  // Get normalized error data
  const normalizedErr = normalizeError(error, context);
  const errorMessage = normalizedErr.message;
  const errorStack = normalizedErr instanceof Error ? normalizedErr.stack : undefined;
  
  // Combine provided context with error context
  const combinedContext = {
    ...context,
    errorType: normalizedErr.errorType,
    errorMessage,
    stack: errorStack
  };

  // Try to get the request context
  const requestContext = getCurrentContext();
  
  // Add breadcrumb if request context is available
  if (requestContext) {
    // Add error breadcrumb
    addBreadcrumb(requestContext, 'Error', message, {
      category,
      errorType: normalizedErr.errorType,
      error: errorMessage
    });
    
    // Log with pino logger
    const logger = createLogger(requestContext);
    pinoError(requestContext, logger, category, message, combinedContext);
  } else {
    // Fall back to console for logging
    console.error(`[${category}] ${message}`, combinedContext);
  }
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
    functionName: string,
    component: string,
    logErrors?: boolean
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
        const formattedArgs = args.map(arg => {
          // Handle sensitive data by not logging the full content
          if (arg instanceof Request) {
            return {
              type: 'Request',
              url: arg.url,
              method: arg.method
            };
          }
          if (arg instanceof Response) {
            return {
              type: 'Response',
              status: arg.status,
              statusText: arg.statusText
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
            args: formattedArgs
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
    functionName: string,
    component: string,
    logErrors?: boolean
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
    functionName: string,
    component: string,
    logErrors?: boolean
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
  return normalizeError(error, context);
}
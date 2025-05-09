/**
 * Helper functions for consistent logging throughout this service
 * These helpers handle context availability and fallback gracefully
 */
import { getCurrentContext } from '../../utils/legacyLoggerAdapter';
import { createLogger, debug as pinoDebug, error as pinoError } from '../../utils/pinoLogger';

/**
 * Log a debug message with proper context handling
 */
export function logDebug(category: string, message: string, data?: Record<string, unknown>) {
  const requestContext = getCurrentContext();
  if (requestContext) {
    const logger = createLogger(requestContext);
    pinoDebug(requestContext, logger, category, message, data);
  } else {
    // Fall back to console as a last resort
    console.debug(`[${category}] ${message}`, data || {});
  }
}

/**
 * Log an error message with proper context handling
 */
export function logError(category: string, message: string, data?: Record<string, unknown>) {
  const requestContext = getCurrentContext();
  if (requestContext) {
    const logger = createLogger(requestContext);
    pinoError(requestContext, logger, category, message, data);
  } else {
    // Fall back to console as a last resort
    console.error(`[${category}] ${message}`, data || {});
  }
}
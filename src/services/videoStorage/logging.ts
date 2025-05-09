/**
 * Logging utilities for the Video Storage Service
 */

import { createLogger, debug as pinoDebug } from '../../utils/pinoLogger';
import { getCurrentContext } from '../../utils/legacyLoggerAdapter';

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
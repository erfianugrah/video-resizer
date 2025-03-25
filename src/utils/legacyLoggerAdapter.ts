/**
 * Legacy logger adapter
 * 
 * Provides compatibility with existing logging calls
 * while using the new Pino-based logging system.
 */
import { RequestContext, createRequestContext } from './requestContext';
import { createLogger, debug as pinoDebug, info as pinoInfo, warn as pinoWarn, error as pinoError } from './pinoLogger';
import pino from 'pino';

// Global request context and logger for legacy calls
let currentContext: RequestContext | null = null;
let currentLogger: pino.Logger | null = null;

/**
 * Initialize the legacy logger with a request
 * @param request The request object
 * @returns The created context and logger
 */
export function initializeLegacyLogger(request: Request) {
  // If we don't already have a context, create one
  if (!currentContext) {
    currentContext = createRequestContext(request);
    
    // Create logger with the context
    currentLogger = createLogger(currentContext);
    
    // Log initialization for verbose mode only
    if (currentContext.verboseEnabled) {
      // Use the Pino logger directly - we already have it available
      pinoDebug(currentContext, currentLogger, 'LegacyLoggerAdapter', 'Initialized', {
        url: request.url
      });
    }
  }
  
  return { context: currentContext, logger: currentLogger };
}

/**
 * Clear the current request context
 */
export function clearLegacyLogger() {
  currentContext = null;
  currentLogger = null;
}

/**
 * Legacy debug function
 * @param component Component name
 * @param message Log message
 * @param data Additional data
 */
export function debug(component: string, message: string, data?: Record<string, unknown>) {
  if (!currentContext || !currentLogger) {
    console.debug(`[${component}] ${message}`, data);
    return;
  }
  
  pinoDebug(currentContext, currentLogger, component, message, data);
}

/**
 * Legacy info function
 * @param component Component name
 * @param message Log message
 * @param data Additional data
 */
export function info(component: string, message: string, data?: Record<string, unknown>) {
  if (!currentContext || !currentLogger) {
    console.info(`[${component}] ${message}`, data);
    return;
  }
  
  pinoInfo(currentContext, currentLogger, component, message, data);
}

/**
 * Legacy warn function
 * @param component Component name
 * @param message Log message
 * @param data Additional data
 */
export function warn(component: string, message: string, data?: Record<string, unknown>) {
  if (!currentContext || !currentLogger) {
    console.warn(`[${component}] ${message}`, data);
    return;
  }
  
  pinoWarn(currentContext, currentLogger, component, message, data);
}

/**
 * Legacy error function
 * @param component Component name
 * @param message Log message
 * @param data Additional data
 */
export function error(component: string, message: string, data?: Record<string, unknown>) {
  if (!currentContext || !currentLogger) {
    console.error(`[${component}] ${message}`, data);
    return;
  }
  
  pinoError(currentContext, currentLogger, component, message, data);
}

/**
 * Get the current request context
 * @returns The current request context or null
 */
export function getCurrentContext(): RequestContext | null {
  return currentContext;
}
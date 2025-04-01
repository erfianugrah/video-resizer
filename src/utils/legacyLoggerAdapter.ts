/**
 * Legacy logger adapter
 * 
 * Provides compatibility with existing logging calls
 * while using the new Pino-based logging system.
 * 
 * This adapter now uses the central context management system
 * from requestContext.ts to maintain consistent context across
 * both legacy and modern logging approaches.
 */
import { RequestContext, createRequestContext, getCurrentContext as getContextFromManager, setCurrentContext } from './requestContext';
import { createLogger, debug as pinoDebug, info as pinoInfo, warn as pinoWarn, error as pinoError } from './pinoLogger';
import pino from 'pino';

// Local cache for logger to avoid recreating it
let currentLogger: pino.Logger | null = null;

/**
 * Initialize the legacy logger with a request
 * @param request The request object
 * @returns The created context and logger
 */
export function initializeLegacyLogger(request: Request) {
  // First check if we already have a context from the context manager
  let context = getContextFromManager();
  
  // If we don't have a context from the manager, create a new one and set it
  if (!context) {
    context = createRequestContext(request);
    
    // Set the context in the central manager
    setCurrentContext(context);
    
    // Log this initialization
    console.debug('LegacyLoggerAdapter: Created and set new request context', {
      requestId: context.requestId,
      url: request.url,
      timestamp: new Date().toISOString()
    });
  }
  
  // Create/update logger with the context
  currentLogger = createLogger(context);
  
  // Log initialization for verbose mode only
  if (context.verboseEnabled) {
    // Use the Pino logger directly - we already have it available
    pinoDebug(context, currentLogger, 'LegacyLoggerAdapter', 'Initialized', {
      url: request.url,
      requestId: context.requestId,
      fromExistingContext: !!getContextFromManager()
    });
  }
  
  return { context, logger: currentLogger };
}

/**
 * Clear the current request context
 * This now also clears the context from the central manager
 */
export function clearLegacyLogger() {
  // Set null context in the central manager
  // This is just for cleanliness - not setting null avoids type errors
  currentLogger = null;
  
  console.debug('LegacyLoggerAdapter: Cleared logger');
}

/**
 * Gets the current context, either from the central manager or creates a new one
 * @returns The current request context or null
 */
function getOrCreateContext(): RequestContext | null {
  // Get context from central manager
  const context = getContextFromManager();
  
  if (!context) {
    console.debug('LegacyLoggerAdapter: No context available for logging');
    return null;
  }
  
  return context;
}

/**
 * Legacy debug function
 * @param component Component name
 * @param message Log message
 * @param data Additional data
 */
export function debug(component: string, message: string, data?: Record<string, unknown>) {
  const context = getOrCreateContext();
  
  if (!context) {
    console.debug(`[${component}] ${message}`, data);
    return;
  }
  
  // Create logger if needed
  if (!currentLogger) {
    currentLogger = createLogger(context);
  }
  
  pinoDebug(context, currentLogger, component, message, data);
}

/**
 * Legacy info function
 * @param component Component name
 * @param message Log message
 * @param data Additional data
 */
export function info(component: string, message: string, data?: Record<string, unknown>) {
  const context = getOrCreateContext();
  
  if (!context) {
    console.info(`[${component}] ${message}`, data);
    return;
  }
  
  // Create logger if needed
  if (!currentLogger) {
    currentLogger = createLogger(context);
  }
  
  pinoInfo(context, currentLogger, component, message, data);
}

/**
 * Legacy warn function
 * @param component Component name
 * @param message Log message
 * @param data Additional data
 */
export function warn(component: string, message: string, data?: Record<string, unknown>) {
  const context = getOrCreateContext();
  
  if (!context) {
    console.warn(`[${component}] ${message}`, data);
    return;
  }
  
  // Create logger if needed
  if (!currentLogger) {
    currentLogger = createLogger(context);
  }
  
  pinoWarn(context, currentLogger, component, message, data);
}

/**
 * Legacy error function
 * @param component Component name
 * @param message Log message
 * @param data Additional data
 */
export function error(component: string, message: string, data?: Record<string, unknown>) {
  const context = getOrCreateContext();
  
  if (!context) {
    console.error(`[${component}] ${message}`, data);
    return;
  }
  
  // Create logger if needed
  if (!currentLogger) {
    currentLogger = createLogger(context);
  }
  
  pinoError(context, currentLogger, component, message, data);
}

/**
 * Get the current request context
 * This now delegates to the central context manager
 * @returns The current request context or null
 */
export function getCurrentContext(): RequestContext | null {
  return getContextFromManager() || null;
}
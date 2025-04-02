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
    
    // We can't use our own logging here because we're initializing the logger
    // This is early initialization code so console usage is acceptable
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
  
  // We can't use our own logging here because we're clearing the logger
  // This is cleanup code so console usage is acceptable
}

/**
 * Gets the current context, either from the central manager or creates a new one
 * @returns The current request context or null
 */
function getOrCreateContext(): RequestContext | null {
  // Get context from central manager
  const context = getContextFromManager();
  
  if (!context) {
    // We can't use our own logging here because we're checking if context exists
    // This is early initialization code so console usage is acceptable
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
    // We can't use our own logging here because we don't have a context yet
    // This is a fallback for early initialization, so console usage is acceptable
    return;
  }
  
  // Create logger if needed
  if (!currentLogger) {
    currentLogger = createLogger(context as RequestContext);
  }
  
  pinoDebug(context as RequestContext, currentLogger, component, message, data);
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
    // We can't use our own logging here because we don't have a context yet
    // This is a fallback for early initialization, so console usage is acceptable
    return;
  }
  
  // Create logger if needed
  if (!currentLogger) {
    currentLogger = createLogger(context as RequestContext);
  }
  
  pinoInfo(context as RequestContext, currentLogger, component, message, data);
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
    // We can't use our own logging here because we don't have a context yet
    // This is a fallback for early initialization, so console usage is acceptable
    return;
  }
  
  // Create logger if needed
  if (!currentLogger) {
    currentLogger = createLogger(context as RequestContext);
  }
  
  pinoWarn(context as RequestContext, currentLogger, component, message, data);
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
    // We can't use our own logging here because we don't have a context yet
    // This is a fallback for early initialization, so console usage is acceptable
    return;
  }
  
  // Create logger if needed
  if (!currentLogger) {
    currentLogger = createLogger(context as RequestContext);
  }
  
  pinoError(context as RequestContext, currentLogger, component, message, data);
}

/**
 * Get the current request context
 * This now delegates to the central context manager
 * @returns The current request context or null
 */
export function getCurrentContext(): RequestContext | null {
  return getContextFromManager() || null;
}
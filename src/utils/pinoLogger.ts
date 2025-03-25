/**
 * Pino logger implementation for request-scoped logging
 */
import pino from 'pino';
import { RequestContext, addBreadcrumb } from './requestContext';
import { LoggingConfigurationManager } from '../config/LoggingConfigurationManager';

// Get the logging configuration manager instance
const loggingConfigManager = LoggingConfigurationManager.getInstance();

// Pretty formatting is configured in the transport options

// Default configuration for Pino
let pinoConfig: pino.LoggerOptions = {
  level: 'debug',
  // Use pretty formatting in development, standard JSON in production
  ...(typeof globalThis !== 'undefined' && typeof (globalThis as any).window === 'undefined' ? {
    // Node.js environment settings
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'HH:MM:ss.l',
        ignore: 'pid,hostname,requestId,elapsedMs,durationMs,breadcrumbsCount,breadcrumb',
        messageFormat: '{levelLabel} \x1b[36m[{category}]\x1b[0m {msg} \x1b[90m(req:{requestId})\x1b[0m',
        // Include all data including breadcrumbs to improve debug visibility
        singleLine: true,
        levelFirst: true,
        minimumLevel: 'debug',
        messageKey: 'msg',
        // Custom formatter to clean up output
        customPrettifiers: {
          time: (timestamp: string) => `\x1b[90m${timestamp}\x1b[0m`,
          level: (level: string) => {
            const colorMap: Record<string, string> = {
              debug: '\x1b[34m', // blue
              info: '\x1b[32m',  // green
              warn: '\x1b[33m',  // yellow
              error: '\x1b[31m', // red
              fatal: '\x1b[35m'  // magenta
            };
            const color = colorMap[level.toLowerCase()] || '\x1b[0m';
            return `${color}${level.toUpperCase()}\x1b[0m`;
          }
        }
      }
    }
  } : {
    // Browser environment settings
    browser: {
      asObject: true,
      transmit: {
        send: () => {}, // Noop function for browser compatibility
      }
    }
  }),
  // Base object with metadata that appears in every log
  base: { 
    service: 'video-resizer',
    logger: 'pino' 
  }
};

// Sampling configuration - default to logging everything
let samplingConfig = {
  enabled: false,
  rate: 1.0
};

// Try to get configuration from the LoggingConfigurationManager
try {
  // Get Pino configuration
  const managerPinoConfig = loggingConfigManager.getPinoConfig();
  if (managerPinoConfig) {
    // Merge with default configuration
    pinoConfig = {
      ...pinoConfig,
      ...managerPinoConfig
    };
  }
  
  // Get sampling configuration
  samplingConfig = loggingConfigManager.getSamplingConfig();
} catch (err) {
  console.error('Error applying Pino configuration from LoggingConfigurationManager:', err);
}

// Create the base logger
const baseLogger = pino(pinoConfig);

/**
 * Create a request-scoped logger
 * @param context The request context
 * @returns A Pino logger instance with request ID
 */
export function createLogger(context: RequestContext) {
  // Create a child logger with request ID binding
  const childLogger = baseLogger.child({ requestId: context.requestId });
  
  // Add bindings method for tests
  if (!childLogger.bindings && typeof process !== 'undefined' && process.env.NODE_ENV === 'test') {
    // For test environment only, add a bindings method that returns the bindings
    (childLogger as any).bindings = () => ({ requestId: context.requestId });
  }
  
  return childLogger;
}

// This section was moved to the top of the file to avoid TS2448 error

/**
 * Debug level log with breadcrumb
 * @param context Request context
 * @param logger Pino logger instance
 * @param category Component or category name
 * @param message Log message
 * @param data Additional data
 * @returns The created breadcrumb
 */
export function debug(
  context: RequestContext, 
  logger: pino.Logger, 
  category: string, 
  message: string, 
  data?: Record<string, unknown>
) {
  // Always add breadcrumb for tracking, regardless of log level or debug settings
  const breadcrumb = addBreadcrumb(context, category, message, data);
  
  // Skip debug logs if:
  // 1. The logger's level is higher than debug OR
  // 2. Debug is not enabled in the request context
  const loggerLevel = logger.level as string;
  const isDebugAllowedByLevel = loggerLevel === 'debug' || loggerLevel === 'trace';
  
  if (!isDebugAllowedByLevel || !context.debugEnabled) {
    return breadcrumb;
  }
  
  // Apply sampling if enabled
  if (samplingConfig.enabled && Math.random() > samplingConfig.rate) {
    return breadcrumb;
  }
  
  // Prepare log data - simplify structure for cleaner logging
  const logData = {
    ...data,
    requestId: context.requestId,
    elapsedMs: breadcrumb.elapsedMs,
    category, // Include category directly for pino-pretty format
    breadcrumb, // Include breadcrumb for visibility
    ...(breadcrumb.durationMs ? { durationMs: breadcrumb.durationMs } : {}),
    // Include breadcrumbs array size for diagnostics
    breadcrumbsCount: context.breadcrumbs.length,
    // For cleaner output
    msg: message
  };
  
  // Log with Pino - don't include message separately
  logger.debug(logData);
  
  return breadcrumb;
}

/**
 * Info level log with breadcrumb
 * @param context Request context
 * @param logger Pino logger instance
 * @param category Component or category name
 * @param message Log message
 * @param data Additional data
 * @returns The created breadcrumb
 */
export function info(
  context: RequestContext, 
  logger: pino.Logger, 
  category: string, 
  message: string, 
  data?: Record<string, unknown>
) {
  // Always add breadcrumb for tracking, regardless of log level
  const breadcrumb = addBreadcrumb(context, category, message, data);
  
  // Check if the logger's level allows info logs
  const loggerLevel = logger.level as string;
  const isLogLevelAllowed = ['debug', 'info', 'trace'].includes(loggerLevel);
  
  if (!isLogLevelAllowed) {
    return breadcrumb;
  }
  
  // Apply sampling if enabled
  if (samplingConfig.enabled && Math.random() > samplingConfig.rate) {
    return breadcrumb;
  }
  
  // Prepare log data - simplify structure for cleaner logging
  const logData = {
    ...data,
    requestId: context.requestId,
    elapsedMs: breadcrumb.elapsedMs,
    category, // Include category directly for pino-pretty format
    breadcrumb, // Include breadcrumb for visibility
    ...(breadcrumb.durationMs ? { durationMs: breadcrumb.durationMs } : {}),
    // Include breadcrumbs array size for diagnostics
    breadcrumbsCount: context.breadcrumbs.length,
    // For cleaner output
    msg: message
  };
  
  // Log with Pino - don't include message separately
  logger.info(logData);
  
  return breadcrumb;
}

/**
 * Warning level log with breadcrumb
 * @param context Request context
 * @param logger Pino logger instance
 * @param category Component or category name
 * @param message Log message
 * @param data Additional data
 * @returns The created breadcrumb
 */
export function warn(
  context: RequestContext, 
  logger: pino.Logger, 
  category: string, 
  message: string, 
  data?: Record<string, unknown>
) {
  // Always add breadcrumb for tracking, regardless of log level
  const breadcrumb = addBreadcrumb(context, category, message, data);
  
  // Check if the logger's level allows warn logs 
  const loggerLevel = logger.level as string;
  const isLogLevelAllowed = ['debug', 'info', 'warn', 'trace'].includes(loggerLevel);
  
  if (!isLogLevelAllowed) {
    return breadcrumb;
  }
  
  // Prepare log data - simplify structure for cleaner logging
  const logData = {
    ...data,
    requestId: context.requestId,
    elapsedMs: breadcrumb.elapsedMs,
    category, // Include category directly for pino-pretty format
    breadcrumb, // Include breadcrumb for visibility
    ...(breadcrumb.durationMs ? { durationMs: breadcrumb.durationMs } : {}),
    // Include breadcrumbs array size for diagnostics
    breadcrumbsCount: context.breadcrumbs.length,
    // For cleaner output
    msg: message
  };
  
  // Log with Pino - don't include message separately
  logger.warn(logData);
  
  return breadcrumb;
}

/**
 * Error level log with breadcrumb
 * @param context Request context
 * @param logger Pino logger instance
 * @param category Component or category name
 * @param message Log message
 * @param data Additional data
 * @returns The created breadcrumb
 */
export function error(
  context: RequestContext, 
  logger: pino.Logger, 
  category: string, 
  message: string, 
  data?: Record<string, unknown>
) {
  // Always add breadcrumb for tracking, regardless of log level
  const breadcrumb = addBreadcrumb(context, category, message, data);
  
  // Check if the logger's level allows error logs
  // Almost all log levels allow error logs, but we'll check anyway for consistency
  const loggerLevel = logger.level as string;
  const isLogLevelAllowed = ['debug', 'info', 'warn', 'error', 'trace'].includes(loggerLevel);
  
  if (!isLogLevelAllowed) {
    return breadcrumb;
  }
  
  // Prepare log data - simplify structure for cleaner logging
  const logData = {
    ...data,
    requestId: context.requestId,
    elapsedMs: breadcrumb.elapsedMs,
    category, // Include category directly for pino-pretty format
    breadcrumb, // Include breadcrumb for visibility
    ...(breadcrumb.durationMs ? { durationMs: breadcrumb.durationMs } : {}),
    // Include breadcrumbs array size for diagnostics
    breadcrumbsCount: context.breadcrumbs.length,
    // For cleaner output
    msg: message
  };
  
  // Log with Pino - don't include message separately
  logger.error(logData);
  
  return breadcrumb;
}
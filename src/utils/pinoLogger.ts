/**
 * Pino logger implementation for request-scoped logging
 */
import pino from 'pino';
import { RequestContext, addBreadcrumb } from './requestContext';
import { LoggingConfigurationManager } from '../config/LoggingConfigurationManager';

/**
 * Log an error message - simplified helper for pino logger initialization
 * Direct console.error is appropriate here as this runs during initialization
 * before the logging system is fully available
 */
function logError(message: string, data?: Record<string, unknown>): void {
  console.error(`PinoLogger: ${message}`, data || {});
}

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
  logError('Error applying Pino configuration from LoggingConfigurationManager', {
    error: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined
  });
}

// Create the base logger
const baseLogger = pino(pinoConfig);

// Global flag for breadcrumbs
let breadcrumbsEnabled = true;

// Try to get breadcrumbs configuration
try {
  breadcrumbsEnabled = loggingConfigManager.areBreadcrumbsEnabled();
} catch (err) {
  logError('Error getting breadcrumbs configuration', {
    error: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined
  });
}

/**
 * Check if a specified log level is enabled for a context
 * @param context Request context
 * @param level The log level to check
 * @returns Whether logging at this level is enabled
 */
export function isLevelEnabled(
  context: RequestContext | undefined | null,
  level: string
): boolean {
  // Check sampling first
  if (!shouldSampleRequest(context)) {
    return false;
  }
  
  // Get configured log level from LoggingConfigurationManager
  const configManager = LoggingConfigurationManager.getInstance();
  const configuredLevel = configManager.getLogLevel();
  
  // Map levels to numeric values for comparison
  const levels: Record<string, number> = {
    error: 0,
    warn: 1,
    info: 2,
    debug: 3,
    trace: 4
  };
  
  return (levels[level] || 0) <= (levels[configuredLevel] || 2);
}

/**
 * Create a logger instance for the request
 * @param context Request context or undefined if not available
 * @returns A logger instance
 */
export function createLogger(context?: RequestContext | null): pino.Logger {
  if (!context) {
    return baseLogger;
  }
  
  // Create a child logger with context
  return baseLogger.child({
    requestId: context.requestId,
    // Don't include the URL in every log, as it can be long
  });
}

/**
 * Prepare common context for logging
 * @param context Request context
 * @returns Common logging context
 */
function prepareLoggingContext(context?: RequestContext | null): Record<string, unknown> {
  if (!context) {
    return {};
  }
  
  return {
    requestId: context.requestId,
    // Include just request ID for now to keep logs clean
  };
}

/**
 * Check if a request should be sampled based on sampling configuration
 * Using a deterministic approach based on request ID for consistency
 * @param context Request context
 * @returns True if the request should be sampled, false otherwise
 */
function shouldSampleRequest(context?: RequestContext | null): boolean {
  // If sampling is disabled, always return true
  if (!samplingConfig.enabled) {
    return true;
  }
  
  // If no context available, use random sampling
  if (!context) {
    return Math.random() <= samplingConfig.rate;
  }
  
  // Use request ID for deterministic sampling
  const requestId = context.requestId;
  const hash = Array.from(requestId).reduce((sum, char) => sum + char.charCodeAt(0), 0);
  
  // Normalize hash to [0, 1]
  const normalizedHash = (hash % 1000) / 1000;
  
  // Return true if the hash is less than or equal to the sampling rate
  return normalizedHash <= samplingConfig.rate;
}

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
  // Check if debug level is enabled before any object creation
  if (!isLevelEnabled(context, 'debug')) {
    return;
  }
  
  // Always add breadcrumb for tracking, regardless of log level
  const breadcrumb = addBreadcrumb(context, category, message, data);
  
  // Check if the logger's level allows debug logs
  const loggerLevel = logger.level as string;
  const isLogLevelAllowed = ['debug', 'trace'].includes(loggerLevel);
  
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
  // Check if info level is enabled before any object creation
  if (!isLevelEnabled(context, 'info')) {
    return;
  }
  
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
  // Check if warn level is enabled before any object creation
  if (!isLevelEnabled(context, 'warn')) {
    return;
  }
  
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
  // Check if error level is enabled before any object creation - almost always true
  if (!isLevelEnabled(context, 'error')) {
    return;
  }
  
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
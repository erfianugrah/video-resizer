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

// Pretty formatting is configured in the transport options

// Detect environment
// Cloudflare Workers: has caches API but no window or process
const isCloudflareWorkers = typeof globalThis !== 'undefined' &&
  typeof (globalThis as any).caches !== 'undefined' &&
  typeof (globalThis as any).window === 'undefined' &&
  typeof process === 'undefined';

// Node.js: has process and no window
const isNodeJS = typeof process !== 'undefined' &&
  typeof (globalThis as any).window === 'undefined';

// Browser: has window
const isBrowser = typeof (globalThis as any).window !== 'undefined';

/**
 * Custom JSON serializer that properly handles Error objects
 * Error objects have non-enumerable properties, so JSON.stringify returns {}
 * This function extracts error properties for proper serialization
 */
function serializeForConsole(obj: any): string {
  return JSON.stringify(obj, (key, value) => {
    // Handle Error objects specially
    if (value instanceof Error) {
      return {
        name: value.name,
        message: value.message,
        stack: value.stack,
        // Include any additional custom properties
        ...Object.getOwnPropertyNames(value).reduce((acc, prop) => {
          if (!['name', 'message', 'stack'].includes(prop)) {
            acc[prop] = (value as any)[prop];
          }
          return acc;
        }, {} as Record<string, any>)
      };
    }
    return value;
  });
}

// Default configuration for Pino
let pinoConfig: pino.LoggerOptions = {
  level: 'debug',
  // Base object with metadata that appears in every log
  base: {
    service: 'video-resizer',
    logger: 'pino'
  },
  // Environment-specific configuration
  ...(isCloudflareWorkers ? {
    // Cloudflare Workers: Use browser mode with console output for Sentry integration
    browser: {
      asObject: true, // Receive log object so we can serialize it properly
      write: {
        // Write to console.* methods so Sentry can capture them
        // Use custom serializer to properly handle Error objects
        trace: (o: any) => console.debug(serializeForConsole(o)),
        debug: (o: any) => console.debug(serializeForConsole(o)),
        info: (o: any) => console.info(serializeForConsole(o)),
        warn: (o: any) => console.warn(serializeForConsole(o)),
        error: (o: any) => console.error(serializeForConsole(o)),
        fatal: (o: any) => console.error(serializeForConsole(o)),
      }
    }
  } : isNodeJS ? {
    // Node.js environment: Use pino-pretty for development
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'HH:MM:ss.l',
        ignore: 'pid,hostname,requestId,elapsedMs,durationMs,breadcrumbsCount,breadcrumb',
        messageFormat: '{levelLabel} \x1b[36m[{category}]\x1b[0m {msg} \x1b[90m(req:{requestId})\x1b[0m',
        singleLine: true,
        levelFirst: true,
        minimumLevel: 'debug',
        messageKey: 'msg',
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
    // Browser environment
    browser: {
      asObject: true,
      transmit: {
        send: () => {}, // Noop function for browser compatibility
      }
    }
  })
};

// Log environment detection for debugging
console.debug(`[PinoLogger] Environment detected: ${
  isCloudflareWorkers ? 'Cloudflare Workers' :
  isNodeJS ? 'Node.js' :
  isBrowser ? 'Browser' : 'Unknown'
}`);

// Sampling configuration - default to logging everything
let samplingConfig = {
  enabled: false,
  rate: 1.0
};

// Track whether we're using default config or have updated from KV
let isUsingKvConfig = false;

// Function to update logger configuration from LoggingConfigurationManager
function updateLoggerConfig() {
  try {
    // Get the logging configuration manager instance
    const loggingConfigManager = LoggingConfigurationManager.getInstance();
    
    // Get Pino configuration
    const managerPinoConfig = loggingConfigManager.getPinoConfig();
    if (managerPinoConfig) {
      // Log the update for debugging purposes
      console.debug('Updating Pino logger with config:', JSON.stringify(managerPinoConfig));
      
      // Merge with default configuration
      pinoConfig = {
        ...pinoConfig,
        ...managerPinoConfig
      };
      
      // Set flag to indicate we're using configured settings
      isUsingKvConfig = true;
    }
    
    // Get sampling configuration
    samplingConfig = loggingConfigManager.getSamplingConfig();
    
    // Recreate the logger with updated config
    recreateBaseLogger();
    
    return true;
  } catch (err) {
    logError('Error applying Pino configuration from LoggingConfigurationManager', {
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined
    });
    return false;
  }
}

// Initial logger configuration from defaults
// This creates a starter logger that will be replaced once config is loaded
let baseLogger = pino(pinoConfig);

// Function to recreate the base logger with current config
function recreateBaseLogger() {
  try {
    baseLogger = pino(pinoConfig);
    console.debug('Pino logger recreated with ' + 
      (isUsingKvConfig ? 'KV configuration' : 'default configuration') + 
      ` (level: ${pinoConfig.level})`);
    return true;
  } catch (err) {
    console.error({
      context: 'PinoLogger',
      operation: 'recreateBaseLogger',
      error: err instanceof Error ? { name: err.name, message: err.message, stack: err.stack } : String(err)
    });
    return false;
  }
}

// Try to get initial configuration from the LoggingConfigurationManager
updateLoggerConfig();

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

/**
 * Update the Pino logger configuration
 * This should be called after the configuration has been loaded from KV
 */
export function updatePinoLoggerConfig(): boolean {
  return updateLoggerConfig();
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
  
  // Skip debug logs based ONLY on logger level
  // This unifies debug control to use only the log level configuration
  const loggerLevel = logger.level as string;
  const isDebugAllowedByLevel = loggerLevel === 'debug' || loggerLevel === 'trace';
  
  if (!isDebugAllowedByLevel) {
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
    elapsedMs: breadcrumb?.elapsedMs ?? 0,
    category, // Include category directly for pino-pretty format
    breadcrumb, // Include breadcrumb for visibility
    ...(breadcrumb?.durationMs ? { durationMs: breadcrumb.durationMs } : {}),
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
    elapsedMs: breadcrumb?.elapsedMs ?? 0,
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
    elapsedMs: breadcrumb?.elapsedMs ?? 0,
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
    elapsedMs: breadcrumb?.elapsedMs ?? 0,
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

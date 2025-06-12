/**
 * Centralized Logger Module
 * 
 * This is the single source of truth for all logging operations in the video-resizer.
 * It consolidates and standardizes all logging functionality.
 */

import { 
  createLogger,
  debug as pinoDebug, 
  info as pinoInfo, 
  warn as pinoWarn, 
  error as pinoError,
  updatePinoLoggerConfig
} from './pinoLogger';
import { getCurrentContext } from './legacyLoggerAdapter';
import { RequestContext } from './requestContext';
import { LoggingConfigurationManager } from '../config/LoggingConfigurationManager';

/**
 * Type definitions for logging
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogData {
  [key: string]: unknown;
}

export interface LogOptions {
  /** Skip adding breadcrumb for this log */
  skipBreadcrumb?: boolean;
  /** Force logging even if component is disabled */
  force?: boolean;
  /** Enrichment options for additional context */
  enrich?: EnrichmentOptions;
}

export interface EnrichmentOptions {
  /** Include memory usage information */
  includeMemoryUsage?: boolean;
  /** Include request metadata (URL, method, headers count) */
  includeRequestMetadata?: boolean;
  /** Include timing information */
  includeTiming?: boolean;
  /** Include environment information */
  includeEnvironment?: boolean;
}

/**
 * Helper to get current context and logger
 */
function getContextAndLogger() {
  const context = getCurrentContext();
  if (!context) {
    return null;
  }
  
  const logger = createLogger(context);
  return { context, logger };
}

/**
 * Check if a log should be filtered based on component and options
 */
function shouldFilterLog(category: string, options?: LogOptions): boolean {
  // Never filter if forced
  if (options?.force) {
    return false;
  }
  
  // Check component filtering
  const loggingConfig = LoggingConfigurationManager.getInstance();
  return !loggingConfig.shouldLogComponent(category);
}

/**
 * Enrich log data with additional context based on options
 */
function enrichLogData(
  data: LogData | undefined, 
  context: RequestContext, 
  options?: LogOptions
): LogData {
  const enrichedData = { ...data };
  const enrichOptions = options?.enrich;
  
  if (!enrichOptions) {
    return enrichedData;
  }
  
  // Add memory usage if requested
  if (enrichOptions.includeMemoryUsage && typeof process !== 'undefined' && process.memoryUsage) {
    try {
      const memUsage = process.memoryUsage();
      enrichedData.memory = {
        heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024) + 'MB',
        heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024) + 'MB',
        rss: Math.round(memUsage.rss / 1024 / 1024) + 'MB',
        external: Math.round(memUsage.external / 1024 / 1024) + 'MB'
      };
    } catch (e) {
      // Ignore errors - may not be available in all environments
    }
  }
  
  // Add request metadata if requested
  if (enrichOptions.includeRequestMetadata && context.url) {
    enrichedData.request = {
      url: context.url,
      breadcrumbCount: context.breadcrumbs.length,
      requestId: context.requestId
    };
  }
  
  // Add timing information if requested
  if (enrichOptions.includeTiming) {
    const now = performance.now();
    enrichedData.timing = {
      elapsed: Math.round(now - context.startTime) + 'ms',
      timestamp: new Date().toISOString(),
      breadcrumbCount: context.breadcrumbs.length
    };
  }
  
  // Add environment information if requested
  if (enrichOptions.includeEnvironment) {
    enrichedData.environment = {
      runtime: typeof process !== 'undefined' ? 'node' : 'browser',
      platform: typeof process !== 'undefined' ? process.platform : 'web',
      nodeVersion: typeof process !== 'undefined' ? process.version : undefined
    };
  }
  
  return enrichedData;
}

/**
 * Log a debug message
 * @param category Component or category name
 * @param message Log message
 * @param data Additional data to log
 * @param options Logging options
 */
export function logDebug(
  category: string, 
  message: string, 
  data?: LogData,
  options?: LogOptions
): void {
  // Check if log should be filtered
  if (shouldFilterLog(category, options)) {
    return;
  }
  
  const contextAndLogger = getContextAndLogger();
  if (!contextAndLogger) {
    // Fallback to console only during initialization
    if (typeof process !== 'undefined' && process.env.NODE_ENV === 'development') {
      console.debug(`[${category}] ${message}`, data || {});
    }
    return;
  }
  
  const { context, logger } = contextAndLogger;
  const enrichedData = enrichLogData(data, context, options);
  pinoDebug(context, logger, category, message, enrichedData);
}

/**
 * Log an info message
 * @param category Component or category name
 * @param message Log message
 * @param data Additional data to log
 * @param options Logging options
 */
export function logInfo(
  category: string, 
  message: string, 
  data?: LogData,
  options?: LogOptions
): void {
  // Check if log should be filtered
  if (shouldFilterLog(category, options)) {
    return;
  }
  
  const contextAndLogger = getContextAndLogger();
  if (!contextAndLogger) {
    // Fallback to console only during initialization
    console.info(`[${category}] ${message}`, data || {});
    return;
  }
  
  const { context, logger } = contextAndLogger;
  const enrichedData = enrichLogData(data, context, options);
  pinoInfo(context, logger, category, message, enrichedData);
}

/**
 * Log a warning message
 * @param category Component or category name
 * @param message Log message
 * @param data Additional data to log
 * @param options Logging options
 */
export function logWarn(
  category: string, 
  message: string, 
  data?: LogData,
  options?: LogOptions
): void {
  // Check if log should be filtered
  if (shouldFilterLog(category, options)) {
    return;
  }
  
  const contextAndLogger = getContextAndLogger();
  if (!contextAndLogger) {
    // Fallback to console only during initialization
    console.warn(`[${category}] ${message}`, data || {});
    return;
  }
  
  const { context, logger } = contextAndLogger;
  const enrichedData = enrichLogData(data, context, options);
  pinoWarn(context, logger, category, message, enrichedData);
}

/**
 * Log an error message
 * @param category Component or category name
 * @param message Log message
 * @param data Additional data to log
 * @param options Logging options
 */
export function logError(
  category: string, 
  message: string, 
  data?: LogData,
  options?: LogOptions
): void {
  // Check if log should be filtered (errors typically shouldn't be filtered, but respect force flag)
  if (shouldFilterLog(category, options)) {
    return;
  }
  
  const contextAndLogger = getContextAndLogger();
  if (!contextAndLogger) {
    // Fallback to console only during initialization
    console.error(`[${category}] ${message}`, data || {});
    return;
  }
  
  const { context, logger } = contextAndLogger;
  const enrichedData = enrichLogData(data, context, options);
  pinoError(context, logger, category, message, enrichedData);
}

/**
 * Log an error with full error object details
 * @param category Component or category name
 * @param message Log message
 * @param error The error object
 * @param data Additional data to log
 */
export function logErrorWithContext(
  category: string,
  message: string,
  error: unknown,
  data?: LogData
): void {
  let formattedError: any;
  
  if (error instanceof Error) {
    // Handle Error objects
    formattedError = {
      message: error.message,
      name: error.name,
      stack: error.stack,
      // Include any additional properties without overwriting
      ...(Object.getOwnPropertyNames(error).reduce((acc, key) => {
        if (!['message', 'name', 'stack'].includes(key)) {
          acc[key] = (error as any)[key];
        }
        return acc;
      }, {} as Record<string, unknown>))
    };
  } else if (error === null || error === undefined) {
    // Handle null/undefined
    formattedError = {
      message: 'Unknown error',
      type: 'unknown'
    };
  } else if (typeof error === 'string') {
    // Handle string errors
    formattedError = {
      message: error,
      type: 'string'
    };
  } else if (typeof error === 'object') {
    // Handle other objects
    formattedError = {
      message: JSON.stringify(error),
      type: 'object',
      data: error
    };
  } else {
    // Handle primitives
    formattedError = {
      message: String(error),
      type: typeof error
    };
  }
  
  const errorData: LogData = {
    ...data,
    error: formattedError
  };
  
  logError(category, message, errorData);
}

/**
 * Create a category-specific logger
 * This is useful for modules that want to avoid passing category name repeatedly
 * 
 * @param category The category name for all logs from this logger
 * @returns Logger methods bound to the specified category
 */
export function createCategoryLogger(category: string) {
  return {
    debug: (message: string, data?: LogData, options?: LogOptions) => 
      logDebug(category, message, data, options),
    info: (message: string, data?: LogData, options?: LogOptions) => 
      logInfo(category, message, data, options),
    warn: (message: string, data?: LogData, options?: LogOptions) => 
      logWarn(category, message, data, options),
    error: (message: string, data?: LogData, options?: LogOptions) => 
      logError(category, message, data, options),
    errorWithContext: (message: string, error: unknown, data?: LogData) =>
      logErrorWithContext(category, message, error, data)
  };
}

/**
 * Performance monitoring utilities
 */
export interface PerformanceMetrics {
  operation: string;
  duration: number;
  category: string;
  metadata?: Record<string, unknown>;
}

let performanceMetrics: PerformanceMetrics[] = [];
let performanceTimer: NodeJS.Timeout | null = null;

/**
 * Clear performance metrics for testing
 * @internal
 */
export function clearPerformanceMetrics(): void {
  performanceMetrics = [];
  if (performanceTimer) {
    clearTimeout(performanceTimer);
    performanceTimer = null;
  }
}

/**
 * Start a performance measurement
 * @param operation Operation name
 * @param category Component category
 * @returns Function to stop the measurement
 */
export function startPerformanceMeasurement(
  operation: string, 
  category: string
): () => void {
  const startTime = performance.now();
  
  return () => {
    const duration = performance.now() - startTime;
    const metrics: PerformanceMetrics = {
      operation,
      duration,
      category
    };
    
    // Add to metrics collection
    performanceMetrics.push(metrics);
    
    // Check if we should log based on threshold
    const loggingConfig = LoggingConfigurationManager.getInstance();
    if (loggingConfig.shouldLogPerformance() && 
        duration >= loggingConfig.getPerformanceThreshold()) {
      logWarn(category, `Slow operation detected: ${operation}`, {
        duration: Math.round(duration) + 'ms',
        threshold: loggingConfig.getPerformanceThreshold() + 'ms'
      });
    }
    
    // Schedule batch logging if not already scheduled
    if (!performanceTimer) {
      performanceTimer = setTimeout(flushPerformanceMetrics, 5000); // Flush every 5 seconds
    }
  };
}

/**
 * Flush accumulated performance metrics
 * @internal Exported for testing purposes
 */
export function flushPerformanceMetrics(): void {
  if (performanceMetrics.length === 0) {
    performanceTimer = null;
    return;
  }
  
  // Calculate statistics
  const stats = calculatePerformanceStats(performanceMetrics);
  
  // Log aggregated metrics
  logInfo('PerformanceMonitor', 'Performance metrics summary', {
    totalOperations: performanceMetrics.length,
    averageDuration: Math.round(stats.average) + 'ms',
    minDuration: Math.round(stats.min) + 'ms',
    maxDuration: Math.round(stats.max) + 'ms',
    p95Duration: Math.round(stats.p95) + 'ms',
    topOperations: stats.topOperations
  }, {
    force: true // Always log performance summaries
  });
  
  // Clear metrics
  performanceMetrics = [];
  performanceTimer = null;
}

/**
 * Calculate performance statistics
 */
function calculatePerformanceStats(metrics: PerformanceMetrics[]) {
  const durations = metrics.map(m => m.duration).sort((a, b) => a - b);
  const sum = durations.reduce((acc, d) => acc + d, 0);
  
  // Group by operation
  const operationGroups = metrics.reduce((acc, m) => {
    if (!acc[m.operation]) {
      acc[m.operation] = [];
    }
    acc[m.operation].push(m.duration);
    return acc;
  }, {} as Record<string, number[]>);
  
  // Find top operations by average duration
  const topOperations = Object.entries(operationGroups)
    .map(([operation, durations]) => ({
      operation,
      avgDuration: durations.reduce((a, b) => a + b, 0) / durations.length,
      count: durations.length
    }))
    .sort((a, b) => b.avgDuration - a.avgDuration)
    .slice(0, 5)
    .map(op => ({
      ...op,
      avgDuration: Math.round(op.avgDuration) + 'ms'
    }));
  
  return {
    average: sum / durations.length,
    min: durations[0] || 0,
    max: durations[durations.length - 1] || 0,
    p95: durations[Math.floor(durations.length * 0.95)] || 0,
    topOperations
  };
}

/**
 * Export additional utilities
 */
export { 
  updatePinoLoggerConfig,
  getCurrentContext,
  createLogger
};

/**
 * Export types
 */
export type { RequestContext } from './requestContext';
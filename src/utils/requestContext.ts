/**
 * Request context management
 * 
 * Provides utilities for creating and managing request-scoped context
 * including breadcrumb trails for debugging request flows.
 */
import { v4 as uuidv4 } from 'uuid';
import { DiagnosticsInfo } from '../types/diagnostics';
import { debug as pinoDebug, warn as pinoWarn } from './pinoLogger';

/**
 * Unified logging functions that avoid circular dependencies
 * Since this module is imported by the logging system itself,
 * we need to be careful about how we log from here
 */

/**
 * Local debug logging that avoids circular dependencies
 * This function only uses console.debug as this module is imported by the logging system
 */
function logDebug(message: string, data?: Record<string, unknown>): void {
  // Only use console.debug since we're in a core module imported by the logging system
  console.debug(`RequestContext: ${message}`, data || {});
}

/**
 * Local warning logging that avoids circular dependencies
 * This function only uses console.warn as this module is imported by the logging system
 */
function logWarn(message: string, data?: Record<string, unknown>): void {
  // Only use console.warn since we're in a core module imported by the logging system
  console.warn(`RequestContext: ${message}`, data || {});
}

/**
 * Breadcrumb for tracking events during request processing
 */
export interface Breadcrumb {
  timestamp: number;       // When this event occurred
  category: string;        // Component/category name
  message: string;         // Event description
  data?: Record<string, unknown>; // Additional context data
  durationMs?: number;     // Duration since last breadcrumb
  elapsedMs?: number;      // Time since request start
}

/**
 * Request context for tracking request lifecycle
 */
export interface RequestContext {
  // Request identification
  requestId: string;      // Unique ID for the request
  url: string;            // Original request URL
  startTime: number;      // Request start timestamp
  
  // Tracking data
  breadcrumbs: Breadcrumb[];  // Chronological events during processing
  diagnostics: DiagnosticsInfo; // Diagnostic information
  
  // Performance tracking
  componentTiming: Record<string, number>; // Time spent in each component
  operations?: Record<string, TimedOperation>; // For tracking timed operations
  
  // Feature flags
  debugEnabled: boolean;  // Whether debug mode is enabled
  verboseEnabled: boolean; // Whether verbose logging is enabled
  
  // For waitUntil operations
  executionContext?: ExecutionContext; // Worker execution context for waitUntil
}

/**
 * Timed operation for tracking performance
 */
export interface TimedOperation {
  startTime: number;      // When the operation started
  endTime?: number;       // When the operation ended (if completed)
  duration?: number;      // Duration of the operation
  category?: string;      // Category for breadcrumb grouping
}

/**
 * Create a new request context
 * @param request The HTTP request
 * @param ctx Optional execution context for waitUntil operations
 * @returns A new RequestContext object
 */
export function createRequestContext(request: Request, ctx?: ExecutionContext): RequestContext {
  const url = new URL(request.url);
  
  // Get debug configuration from DebugConfigurationManager
  let envDebugEnabled = false;
  let envVerboseEnabled = false;
  
  // Try to access the debug config through the existing module system
  // This will work as long as the DebugConfigurationManager has been initialized elsewhere in the app
  try {
    // Import directly from the module index where it should be initialized
    const { debugConfig } = require('../config');
    if (debugConfig) {
      envDebugEnabled = debugConfig.isDebugEnabled();
      envVerboseEnabled = debugConfig.isVerboseEnabled();
      
      logDebug('Loaded debug config', { 
        enabled: envDebugEnabled, 
        verbose: envVerboseEnabled 
      });
    }
  } catch (err) {
    // Fall back to async import if the module isn't loaded yet
    import('../config').then(module => {
      try {
        if (module && module.debugConfig) {
          const debugEnabled = module.debugConfig.isDebugEnabled();
          const verboseEnabled = module.debugConfig.isVerboseEnabled();
          
          // Update context after the fact
          if (currentRequestContext && currentRequestContext.requestId === context.requestId) {
            currentRequestContext.debugEnabled = debugEnabled;
            currentRequestContext.verboseEnabled = verboseEnabled;
            
            logDebug('Updated debug config asynchronously', { 
              enabled: debugEnabled, 
              verbose: verboseEnabled 
            });
          }
        }
      } catch (configErr) {
        logWarn('Error accessing debug configuration', { error: String(configErr) });
      }
    }).catch(importErr => {
      logWarn('Error importing configuration module', { error: String(importErr) });
    });
    
    // Log but continue with defaults
    logWarn('Error in initial debug configuration loading', { error: String(err) });
  }
  
  // Check for debug parameters - request parameters override environment settings
  const urlHasDebug = url.searchParams.has('debug');
  const headerHasDebug = request.headers.get('X-Debug') === 'true';
  
  // If URL explicitly sets debug=false, respect that regardless of env setting
  const debugEnabled = urlHasDebug 
    ? (url.searchParams.get('debug') !== 'false')
    : (headerHasDebug || envDebugEnabled);
  
  const verboseEnabled = debugEnabled && 
                        (url.searchParams.has('verbose') || 
                         url.searchParams.get('debug') === 'verbose' ||
                         envVerboseEnabled);
  
  // Create the context
  const context: RequestContext = {
    requestId: request.headers.get('X-Request-ID') || uuidv4(),
    url: request.url,
    startTime: performance.now(),
    breadcrumbs: [],
    diagnostics: {
      originalUrl: request.url
    },
    componentTiming: {},
    debugEnabled,
    verboseEnabled
  };
  
  // Store the execution context if provided, for waitUntil operations
  if (ctx) {
    context.executionContext = ctx;
  }
  
  return context;
}

/**
 * Global breadcrumb configuration
 */
interface BreadcrumbConfig {
  enabled: boolean;
  maxItems: number;
}

// Default breadcrumb configuration with initialization tracking
interface BreadcrumbConfigWithInit extends BreadcrumbConfig {
  initialized: boolean;
}

let breadcrumbConfig: BreadcrumbConfigWithInit = {
  enabled: true,
  maxItems: 100,
  initialized: false
};

// Helper function to update breadcrumb config
export function updateBreadcrumbConfig(config: { enabled: boolean, maxItems: number }) {
  if (config && typeof config.enabled === 'boolean' && typeof config.maxItems === 'number') {
    breadcrumbConfig = {
      enabled: config.enabled,
      maxItems: config.maxItems,
      initialized: true
    };
    
    logDebug('Updated breadcrumb config', { enabled: config.enabled, maxItems: config.maxItems });
  }
}

// Try to load breadcrumb configuration from LoggingConfigurationManager
// Using dynamic import to avoid circular dependencies
// This function is called at the end of this module to initialize breadcrumb config
async function initializeBreadcrumbConfig() {
  try {
    const LoggingConfigModule = await import('../config/LoggingConfigurationManager');
    if (LoggingConfigModule && LoggingConfigModule.LoggingConfigurationManager) {
      const loggingConfig = LoggingConfigModule.LoggingConfigurationManager.getInstance();
      const config = loggingConfig.getBreadcrumbConfig();
      breadcrumbConfig = {
        ...config,
        initialized: true
      };
      logDebug('Loaded breadcrumb config asynchronously', { enabled: config.enabled, maxItems: config.maxItems });
    }
  } catch {
    // If loading fails, we'll use the default config
    // Try fallback with global config if available
    if (typeof globalThis !== 'undefined' && 
        typeof (globalThis as any).LOGGING_CONFIG !== 'undefined' && 
        (globalThis as any).LOGGING_CONFIG.breadcrumbs) {
      const globalConfig = (globalThis as any).LOGGING_CONFIG.breadcrumbs;
      breadcrumbConfig = {
        enabled: typeof globalConfig.enabled === 'boolean' ? globalConfig.enabled : true,
        maxItems: typeof globalConfig.maxItems === 'number' ? globalConfig.maxItems : 100,
        initialized: true
      };
      logDebug('Loaded breadcrumb config from global', { enabled: breadcrumbConfig.enabled, maxItems: breadcrumbConfig.maxItems });
    }
    // If no fallback is available, we'll use the defaults already set
  }
}

/**
 * Add a new breadcrumb to the request context
 * @param context The request context
 * @param category The component or category name
 * @param message The event message
 * @param data Additional context data
 * @returns The created breadcrumb
 */
export function addBreadcrumb(
  context: RequestContext,
  category: string,
  message: string,
  data?: Record<string, unknown>
): Breadcrumb {
  // Initialize breadcrumb config if not already done
  if (!breadcrumbConfig.initialized) {
    // We don't need to await this - it'll be ready for future calls
    initializeBreadcrumbConfig().catch(() => {
      // Silently continue with defaults if initialization fails
    });
    breadcrumbConfig.initialized = true;
  }

  const timestamp = performance.now();
  const elapsedMs = timestamp - context.startTime;
  
  // Create the breadcrumb
  const breadcrumb: Breadcrumb = {
    timestamp,
    category,
    message,
    data,
    elapsedMs,
    durationMs: undefined
  };
  
  // Make sure the breadcrumbs array exists
  if (!context.breadcrumbs) {
    context.breadcrumbs = [];
    logDebug('Created breadcrumbs array for context');
  }

  // Only add breadcrumb to the context if breadcrumbs are enabled
  if (breadcrumbConfig.enabled) {
    // Calculate duration from previous breadcrumb if available
    if (context.breadcrumbs.length > 0) {
      const lastBreadcrumb = context.breadcrumbs[context.breadcrumbs.length - 1];
      breadcrumb.durationMs = timestamp - lastBreadcrumb.timestamp;
    }
    
    // Log breadcrumb for debugging with timing information
    logDebug('Adding breadcrumb', { 
      category, 
      message, 
      elapsedMs: elapsedMs.toFixed(2), 
      durationMs: breadcrumb.durationMs !== undefined ? breadcrumb.durationMs.toFixed(2) : undefined 
    });
    
    // Add to breadcrumbs array, respecting maxItems
    context.breadcrumbs.push(breadcrumb);
    
    // Trim breadcrumbs if they exceed maxItems
    if (context.breadcrumbs.length > breadcrumbConfig.maxItems) {
      context.breadcrumbs = context.breadcrumbs.slice(-breadcrumbConfig.maxItems);
    }
    
    // Update component timing if durationMs was calculated
    if (breadcrumb.durationMs !== undefined) {
      // Make sure the componentTiming object exists
      if (!context.componentTiming) {
        context.componentTiming = {};
      }
      
      context.componentTiming[category] = (context.componentTiming[category] || 0) + breadcrumb.durationMs;
    }
  } else {
    logDebug('Breadcrumb recording disabled, skipping', { category, message });
  }
  
  return breadcrumb;
}

/**
 * Start a timed operation in the request context
 * This is useful for tracking performance metrics for specific operations
 * @param context The request context
 * @param operationName The name of the operation
 * @param category Optional category for grouping operations
 */
export function startTimedOperation(context: RequestContext, operationName: string, category?: string): void {
  if (!context.operations) {
    context.operations = {};
  }
  
  context.operations[operationName] = {
    startTime: performance.now(),
    endTime: undefined,
    duration: undefined,
    category: category || 'Operation'
  };
  
  // Add a breadcrumb to mark the start of this operation
  addBreadcrumb(context, category || 'Performance', `Started ${operationName}`, {
    operationType: 'start',
    operation: operationName
  });
}

/**
 * End a timed operation in the request context
 * Call this after startTimedOperation to record the duration
 * @param context The request context
 * @param operationName The name of the operation
 * @returns Duration in milliseconds
 */
export function endTimedOperation(context: RequestContext, operationName: string): number | undefined {
  if (!context.operations || !context.operations[operationName]) {
    return undefined;
  }
  
  const operation = context.operations[operationName];
  operation.endTime = performance.now();
  operation.duration = operation.endTime - operation.startTime;
  
  // Add a breadcrumb to mark the end of this operation with duration
  addBreadcrumb(context, operation.category || 'Performance', `Completed ${operationName}`, {
    operationType: 'end',
    operation: operationName,
    durationMs: operation.duration
  });
  
  return operation.duration;
}

/**
 * Get performance metrics from the request context
 * @param context The request context
 * @returns Performance metrics
 */
export function getPerformanceMetrics(context: RequestContext) {
  // Gather all operation durations
  const operations: Record<string, number> = {};
  
  if (context.operations) {
    Object.entries(context.operations).forEach(([name, operation]) => {
      if (operation.duration !== undefined) {
        operations[name] = operation.duration;
      }
    });
  }
  
  return {
    totalElapsedMs: performance.now() - context.startTime,
    componentTiming: context.componentTiming,
    operations,
    breadcrumbCount: context.breadcrumbs.length
  };
}

/**
 * Get breadcrumbs from the request context
 * @param context The request context
 * @returns Breadcrumbs array
 */
export function getBreadcrumbs(context: RequestContext): Breadcrumb[] {
  return context.breadcrumbs;
}

// Global store for the current request context
// In a real worker environment, we'd use something like continuation-local-storage or AsyncLocalStorage
// But for our simplified implementation, we'll use a global variable
let currentRequestContext: RequestContext | undefined;

/**
 * Set the current request context
 * This is called at the start of request processing to establish the context
 * @param context The request context to set as current
 */
export function setCurrentContext(context: RequestContext): void {
  currentRequestContext = context;
  logDebug('Set current request context', { 
    requestId: context.requestId,
    url: context.url,
    timestamp: new Date().toISOString()
  });
}

/**
 * Get the current request context
 * This is a convenience function for logging and accessing request-scoped data
 * @returns The current request context or undefined if not available
 */
export function getCurrentContext(): RequestContext | undefined {
  if (!currentRequestContext) {
    logDebug('getCurrentContext called but no context is set');
  }
  return currentRequestContext;
}
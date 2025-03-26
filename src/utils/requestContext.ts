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
  
  // Feature flags
  debugEnabled: boolean;  // Whether debug mode is enabled
  verboseEnabled: boolean; // Whether verbose logging is enabled
}

/**
 * Create a new request context
 * @param request The HTTP request
 * @returns A new RequestContext object
 */
export function createRequestContext(request: Request): RequestContext {
  const url = new URL(request.url);
  
  // Get debug configuration from DebugConfigurationManager
  let envDebugEnabled = false;
  let envVerboseEnabled = false;
  
  try {
    // Use dynamic import to load the configuration manager
    // We'll use Promise.resolve to handle the async nature but proceed with default values
    // while the import is in progress
    import('../config/DebugConfigurationManager').then(module => {
      try {
        const debugConfig = module.DebugConfigurationManager.getInstance();
        // Get debug settings from manager - these will apply to future requests
        envDebugEnabled = debugConfig.isDebugEnabled();
        envVerboseEnabled = debugConfig.isVerboseEnabled();
      } catch (importErr) {
        logWarn('Error getting DebugConfigurationManager instance', { error: String(importErr) });
      }
    }).catch(importErr => {
      logWarn('Error importing DebugConfigurationManager', { error: String(importErr) });
    });
  } catch (err) {
    // Continue if we can't access configuration
    logWarn('Error in debug configuration loading', { error: String(err) });
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
  return {
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
}

/**
 * Global breadcrumb configuration
 */
interface BreadcrumbConfig {
  enabled: boolean;
  maxItems: number;
}

// Default breadcrumb configuration
let breadcrumbConfig: BreadcrumbConfig = {
  enabled: true,
  maxItems: 100
};

// Helper function to update breadcrumb config
export function updateBreadcrumbConfig(config: { enabled: boolean, maxItems: number }) {
  if (config && typeof config.enabled === 'boolean' && typeof config.maxItems === 'number') {
    breadcrumbConfig = {
      enabled: config.enabled,
      maxItems: config.maxItems
    };
    
    logDebug(`Updated breadcrumb config`, { enabled: config.enabled, maxItems: config.maxItems });
  }
}

// Try to load breadcrumb configuration from LoggingConfigurationManager
// First try to synchronously get the config if it's already initialized
try {
  // Use a require-like approach to avoid circular dependencies
  const LoggingConfigModule = require('../config/LoggingConfigurationManager');
  if (LoggingConfigModule && LoggingConfigModule.LoggingConfigurationManager) {
    const loggingConfig = LoggingConfigModule.LoggingConfigurationManager.getInstance();
    const config = loggingConfig.getBreadcrumbConfig();
    breadcrumbConfig = config;
    logDebug('Loaded breadcrumb config synchronously', { enabled: config.enabled, maxItems: config.maxItems });
  }
} catch (err) {
  // Fallback to asynchronous loading if synchronous fails
  try {
    // Import in a way that avoids circular dependencies
    // Use dynamic import to load the configuration manager
    import('../config/LoggingConfigurationManager').then(module => {
      try {
        // Get the logging config instance
        const loggingConfig = module.LoggingConfigurationManager.getInstance();
        // Update the breadcrumb config
        breadcrumbConfig = loggingConfig.getBreadcrumbConfig();
        logDebug('Loaded breadcrumb config asynchronously', { enabled: breadcrumbConfig.enabled, maxItems: breadcrumbConfig.maxItems });
      } catch (importErr) {
        logWarn('Error getting LoggingConfigurationManager instance', { error: String(importErr) });
      }
    }).catch(importErr => {
      // If dynamic import fails, try global config as fallback
      if (typeof globalThis !== 'undefined' && 
          typeof (globalThis as any).LOGGING_CONFIG !== 'undefined' && 
          (globalThis as any).LOGGING_CONFIG.breadcrumbs) {
        const globalConfig = (globalThis as any).LOGGING_CONFIG.breadcrumbs;
        breadcrumbConfig = {
          enabled: typeof globalConfig.enabled === 'boolean' ? globalConfig.enabled : true,
          maxItems: typeof globalConfig.maxItems === 'number' ? globalConfig.maxItems : 100
        };
        logDebug('Loaded breadcrumb config from global', { enabled: breadcrumbConfig.enabled, maxItems: breadcrumbConfig.maxItems });
      } else {
        logWarn('Error loading LoggingConfigurationManager and no global config available', { error: String(importErr) });
      }
    });
  } catch (err) {
    logWarn('Error in breadcrumb configuration loading', { error: String(err) });
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
    
    // Log breadcrumb for debugging
    logDebug(`Adding breadcrumb`, { category, message });
    
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
    logDebug(`Breadcrumb recording disabled, skipping`, { category, message });
  }
  
  return breadcrumb;
}

/**
 * Get performance metrics from the request context
 * @param context The request context
 * @returns Performance metrics
 */
export function getPerformanceMetrics(context: RequestContext) {
  return {
    totalElapsedMs: performance.now() - context.startTime,
    componentTiming: context.componentTiming,
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
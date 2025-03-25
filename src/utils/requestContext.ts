/**
 * Request context management
 * 
 * Provides utilities for creating and managing request-scoped context
 * including breadcrumb trails for debugging request flows.
 */
import { v4 as uuidv4 } from 'uuid';
import { DiagnosticsInfo } from '../types/diagnostics';

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
    // Import in a way that avoids circular dependencies
    const { DebugConfigurationManager } = require('../config/DebugConfigurationManager');
    const debugConfig = DebugConfigurationManager.getInstance();
    
    // Get debug settings from manager
    envDebugEnabled = debugConfig.isDebugEnabled();
    envVerboseEnabled = debugConfig.isVerboseEnabled();
  } catch (err) {
    // Silently continue if we can't access configuration
    console.warn('Error accessing debug configuration:', err);
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

// Get breadcrumb configuration from LoggingConfigurationManager
try {
  // Import in a way that avoids circular dependencies
  const { LoggingConfigurationManager } = require('../config/LoggingConfigurationManager');
  const loggingConfig = LoggingConfigurationManager.getInstance();
  
  // Get breadcrumb configuration from manager
  breadcrumbConfig = loggingConfig.getBreadcrumbConfig();
} catch (err) {
  console.warn('Error loading breadcrumb configuration from LoggingConfigurationManager:', err);
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
  
  // Only add breadcrumb to the context if breadcrumbs are enabled
  if (breadcrumbConfig.enabled) {
    // Calculate duration from previous breadcrumb if available
    if (context.breadcrumbs.length > 0) {
      const lastBreadcrumb = context.breadcrumbs[context.breadcrumbs.length - 1];
      breadcrumb.durationMs = timestamp - lastBreadcrumb.timestamp;
    }
    
    // Add to breadcrumbs array, respecting maxItems
    context.breadcrumbs.push(breadcrumb);
    
    // Trim breadcrumbs if they exceed maxItems
    if (context.breadcrumbs.length > breadcrumbConfig.maxItems) {
      context.breadcrumbs = context.breadcrumbs.slice(-breadcrumbConfig.maxItems);
    }
    
    // Update component timing if durationMs was calculated
    if (breadcrumb.durationMs !== undefined) {
      context.componentTiming[category] = (context.componentTiming[category] || 0) + breadcrumb.durationMs;
    }
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
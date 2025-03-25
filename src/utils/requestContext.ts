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
  
  // Check for debug parameters
  const debugEnabled = url.searchParams.has('debug') || 
                      request.headers.get('X-Debug') === 'true';
  
  const verboseEnabled = debugEnabled && 
                        (url.searchParams.has('verbose') || 
                         url.searchParams.get('debug') === 'verbose');
  
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
  
  // Calculate duration from previous breadcrumb if available
  let durationMs: number | undefined;
  if (context.breadcrumbs.length > 0) {
    const lastBreadcrumb = context.breadcrumbs[context.breadcrumbs.length - 1];
    durationMs = timestamp - lastBreadcrumb.timestamp;
  }
  
  // Create the breadcrumb
  const breadcrumb: Breadcrumb = {
    timestamp,
    category,
    message,
    data,
    elapsedMs,
    durationMs
  };
  
  // Add to breadcrumbs array
  context.breadcrumbs.push(breadcrumb);
  
  // Update component timing
  if (durationMs !== undefined) {
    context.componentTiming[category] = (context.componentTiming[category] || 0) + durationMs;
  }
  
  return breadcrumb;
}

/**
 * Get performance metrics from the request context
 * @param context The request context
 * @returns Performance metrics object
 */
export function getPerformanceMetrics(context: RequestContext) {
  const totalDurationMs = performance.now() - context.startTime;
  
  // Sort components by time spent
  const componentBreakdown = Object.entries(context.componentTiming)
    .map(([component, time]) => ({ component, time }))
    .sort((a, b) => b.time - a.time);
  
  // Find slowest operations based on breadcrumbs
  const operations = context.breadcrumbs
    .filter(b => b.durationMs !== undefined)
    .map(b => ({
      category: b.category,
      message: b.message,
      durationMs: b.durationMs as number
    }))
    .sort((a, b) => b.durationMs - a.durationMs);
  
  // Get top 5 slowest operations
  const slowestOperations = operations.slice(0, 5);
  
  return {
    totalDurationMs,
    componentBreakdown,
    slowestOperations,
    breadcrumbCount: context.breadcrumbs.length
  };
}
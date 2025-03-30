/**
 * Service for handling debug information and reporting
 */
import { DebugInfo, DiagnosticsInfo } from '../utils/debugHeadersUtils';
import { getCurrentContext } from '../utils/legacyLoggerAdapter';
import { createLogger, debug as pinoDebug, error as pinoError, warn as pinoWarn } from '../utils/pinoLogger';

/**
 * Helper functions for consistent logging throughout this file
 * These helpers handle context availability and fallback gracefully
 */

/**
 * Log a debug message with proper context handling
 */
function logDebug(message: string, data?: Record<string, unknown>): void {
  const requestContext = getCurrentContext();
  if (requestContext) {
    const logger = createLogger(requestContext);
    pinoDebug(requestContext, logger, 'DebugService', message, data);
  } else {
    // Fall back to console as a last resort
    console.debug(`DebugService: ${message}`, data || {});
  }
}

/**
 * Log a warning message with proper context handling
 */
function logWarn(message: string, data?: Record<string, unknown>): void {
  const requestContext = getCurrentContext();
  if (requestContext) {
    const logger = createLogger(requestContext);
    pinoWarn(requestContext, logger, 'DebugService', message, data);
  } else {
    // Fall back to console as a last resort
    console.warn(`DebugService: ${message}`, data || {});
  }
}

/**
 * Log an error message with proper context handling
 */
function logError(message: string, data?: Record<string, unknown>): void {
  const requestContext = getCurrentContext();
  if (requestContext) {
    const logger = createLogger(requestContext);
    pinoError(requestContext, logger, 'DebugService', message, data);
  } else {
    // Fall back to console as a last resort
    console.error(`DebugService: ${message}`, data || {});
  }
}

/**
 * Add debug headers to a response
 * 
 * @param response - The response to modify
 * @param debugInfo - Debug configuration
 * @param diagnosticsInfo - Diagnostic information
 * @returns Modified response with debug headers
 */
export function addDebugHeaders(
  response: Response,
  debugInfo: DebugInfo,
  diagnosticsInfo: DiagnosticsInfo
): Response {
  // Skip if debug is not enabled
  if (!debugInfo.isEnabled) {
    return response;
  }
  
  logDebug('Adding debug headers', {
    isVerbose: debugInfo.isVerbose,
    includeHeaders: debugInfo.includeHeaders
  });
  
  // Get the request context for performance metrics if available
  const requestContext = getCurrentContext();
  let performanceMetrics;
  
  if (requestContext && diagnosticsInfo) {
    // Get performance metrics synchronously to avoid timing issues
    // First try to import directly to avoid timing issues
    try {
      // Using a dynamic import with top-level await would be better,
      // but for now we're using synchronous approach for compatibility
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const requestContextModule = require('../utils/requestContext');
      performanceMetrics = requestContextModule.getPerformanceMetrics(requestContext);
      
      // Add performance metrics to diagnostics
      if (performanceMetrics) {
        diagnosticsInfo.performanceMetrics = performanceMetrics;
      }
    } catch (err) {
      logError('Error getting performance metrics', { error: String(err) });
    }
  }
  
  // Create new headers object
  const newHeaders = new Headers(response.headers);
  
  // Create response init with headers object
  const responseInit: ResponseInit = {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders,
  };
  
  // Add basic debug headers
  newHeaders.set('X-Video-Resizer-Debug', 'true');
  
  // Add processing time if available
  if (diagnosticsInfo.processingTimeMs !== undefined) {
    newHeaders.set('X-Processing-Time-Ms', 
      diagnosticsInfo.processingTimeMs.toString());
  }
  
  // Add performance metrics if available
  if (performanceMetrics && typeof performanceMetrics === 'object') {
    if (typeof performanceMetrics.totalElapsedMs === 'number') {
      newHeaders.set('X-Total-Processing-Time', `${performanceMetrics.totalElapsedMs.toFixed(2)}ms`);
    }
    
    if (typeof performanceMetrics.breadcrumbCount === 'number') {
      newHeaders.set('X-Breadcrumb-Count', String(performanceMetrics.breadcrumbCount));
    }
    
    // Add timings for top components if available
    if (performanceMetrics.componentTiming && typeof performanceMetrics.componentTiming === 'object') {
      const componentTimings = performanceMetrics.componentTiming;
      const topComponents = Object.entries(componentTimings)
        .sort(([, timeA], [, timeB]) => Number(timeB) - Number(timeA))
        .slice(0, 3);
      
      topComponents.forEach(([component, time], index) => {
        newHeaders.set(`X-Component-${index+1}-Time`, 
          `${component}=${(Number(time)).toFixed(2)}ms`);
      });
    }
  }
  
  // Add path match if available
  if (diagnosticsInfo.pathMatch) {
    newHeaders.set('X-Path-Match', diagnosticsInfo.pathMatch);
  }
  
  // Add transformation source if available
  if (diagnosticsInfo.transformSource) {
    newHeaders.set('X-Transform-Source', diagnosticsInfo.transformSource);
  }
  
  // Add verbose headers if enabled
  if (debugInfo.isVerbose) {
    // Add client detection method
    if (diagnosticsInfo.clientHints !== undefined) {
      newHeaders.set('X-Client-Hints', diagnosticsInfo.clientHints.toString());
    }
    
    // Add device type if available
    if (diagnosticsInfo.deviceType) {
      newHeaders.set('X-Device-Type', diagnosticsInfo.deviceType);
    }
    
    // Add network quality if available
    if (diagnosticsInfo.networkQuality) {
      newHeaders.set('X-Network-Quality', diagnosticsInfo.networkQuality);
    }
    
    // Add cacheability info if available
    if (diagnosticsInfo.cacheability !== undefined) {
      newHeaders.set('X-Cacheability', diagnosticsInfo.cacheability.toString());
    }
    
    // Add cache TTL if available
    if (diagnosticsInfo.cacheTtl !== undefined) {
      newHeaders.set('X-Cache-TTL', diagnosticsInfo.cacheTtl.toString());
    }
    
    // Add video ID if available
    if (diagnosticsInfo.videoId) {
      newHeaders.set('X-Video-ID', diagnosticsInfo.videoId);
    }
  }
  
  return new Response(response.body, responseInit);
}

/**
 * Create an HTML debug report
 * 
 * @param diagnosticsInfo - Diagnostic information
 * @param env - Environment with ASSETS binding (optional)
 * @returns Response with the debug report
 */
export async function createDebugReport(
  diagnosticsInfo: DiagnosticsInfo, 
  env?: { ASSETS?: { fetch: (request: Request) => Promise<Response> }}
): Promise<Response> {
  // Check if we have the debug UI available via ASSETS binding
  if (env?.ASSETS) {
    // Create a new URL for the debug.html page
    const debugUrl = new URL(diagnosticsInfo.originalUrl || 'https://example.com');
    debugUrl.pathname = '/debug.html';
    
    // Fetch the debug HTML page
    try {
      const debugResponse = await env.ASSETS.fetch(
        new Request(debugUrl.toString(), {
          method: 'GET',
          headers: new Headers({ 'Accept': 'text/html' })
        })
      );
      
      if (debugResponse.ok) {
        const html = await debugResponse.text();
        
        // Safely serialize the diagnostics info
        const safeJsonString = JSON.stringify(diagnosticsInfo)
          .replace(/</g, '\\u003c')  // Escape < to avoid closing script tags
          .replace(/>/g, '\\u003e')  // Escape > to avoid closing script tags
          .replace(/&/g, '\\u0026'); // Escape & to avoid HTML entities
        
        // Insert diagnostic data into the HTML
        let htmlWithData;
        
        // Try to insert in head (preferred) with fallback to body tag
        if (html.includes('<head>')) {
          htmlWithData = html.replace(
            '<head>',
            `<head>
            <script type="text/javascript">
              // Pre-load diagnostic data
              window.DIAGNOSTICS_DATA = ${safeJsonString};
              console.log('Debug data loaded from worker:', typeof window.DIAGNOSTICS_DATA);
            </script>`
          );
        } else {
          htmlWithData = html.replace(
            '<body',
            `<body data-debug="true"><script type="text/javascript">
              // Pre-load diagnostic data
              window.DIAGNOSTICS_DATA = ${safeJsonString};
              console.log('Debug data loaded from worker:', typeof window.DIAGNOSTICS_DATA);
            </script>`
          );
        }
        
        return new Response(htmlWithData, {
          status: 200,
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store'
          }
        });
      }
    } catch (error) {
      logError('Error loading debug UI from assets', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });
    }
  }
  
  // Fallback to a simple JSON response if assets aren't available
  return new Response(
    JSON.stringify({
      message: 'Debug UI could not be loaded. Raw diagnostic data is provided below.',
      diagnostics: diagnosticsInfo
    }, null, 2),
    {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store'
      }
    }
  );
}
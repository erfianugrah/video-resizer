/**
 * Service for handling errors consistently across the application
 */
import { VideoTransformError, ErrorType, ProcessingError } from '../errors';
import { getCurrentContext } from '../utils/legacyLoggerAdapter';
import { createLogger, error as pinoError, debug as pinoDebug } from '../utils/pinoLogger';
import type { DebugInfo, DiagnosticsInfo } from '../utils/debugHeadersUtils';

/**
 * Helper functions for consistent logging throughout this file
 * These helpers handle context availability and fallback gracefully
 */

/**
 * Log a debug message with proper context handling
 */
function logDebug(category: string, message: string, data?: Record<string, unknown>) {
  const requestContext = getCurrentContext();
  if (requestContext) {
    const logger = createLogger(requestContext);
    pinoDebug(requestContext, logger, category, message, data);
  } else {
    // Fall back to console as a last resort
    console.debug(`[${category}] ${message}`, data || {});
  }
}

/**
 * Log an error message with proper context handling
 */
function logError(category: string, message: string, data?: Record<string, unknown>) {
  const requestContext = getCurrentContext();
  if (requestContext) {
    const logger = createLogger(requestContext);
    pinoError(requestContext, logger, category, message, data);
  } else {
    // Fall back to console as a last resort
    console.error(`[${category}] ${message}`, data || {});
  }
}

/**
 * Convert any error to a VideoTransformError
 * This is a utility function to ensure consistent error handling
 */
export function normalizeError(err: unknown, context: Record<string, unknown> = {}): VideoTransformError {
  // If it's already a VideoTransformError, return it
  if (err instanceof VideoTransformError) {
    return err;
  }
  
  // If it's another type of Error, convert it
  if (err instanceof Error) {
    return ProcessingError.fromError(err, ErrorType.UNKNOWN_ERROR, context);
  }
  
  // If it's a string or other value, create a new error
  const message = typeof err === 'string' ? err : 'Unknown error occurred';
  return new VideoTransformError(message, ErrorType.UNKNOWN_ERROR, context);
}

/**
 * Fetch the original content when transformation fails with a 400 error
 * This provides graceful degradation by falling back to the original content
 * 
 * @param originalUrl - The original URL before transformation attempt
 * @param error - The error that occurred during transformation
 * @param request - The original request
 * @returns A response with the original content, or null if fallback should not be applied
 */
export async function fetchOriginalContentFallback(
  originalUrl: string, 
  error: VideoTransformError, 
  request: Request
): Promise<Response | null> {
  // Import configuration manager to check if fallback is enabled
  const { VideoConfigurationManager } = await import('../config');
  const config = VideoConfigurationManager.getInstance();
  const caching = config.getCachingConfig();
  const fallbackConfig = caching?.fallback;
  
  // Log configuration loaded for fallback
  logDebug('ErrorHandlerService', 'Configuration loaded for fallback', {
    errorStatus: error.statusCode,
    errorType: error.errorType,
    cachingMethod: caching?.method,
    fallbackEnabled: fallbackConfig?.enabled,
    badRequestOnly: fallbackConfig?.badRequestOnly
  });
  
  // Check if fallback is enabled in config
  if (!fallbackConfig || !fallbackConfig.enabled) {
    logDebug('ErrorHandlerService', 'Fallback disabled in config, skipping');
    return null;
  }
  
  // Only apply fallback for 400 Bad Request errors if badRequestOnly is true
  if (fallbackConfig.badRequestOnly && error.statusCode !== 400) {
    logDebug('ErrorHandlerService', 'Not a 400 error, skipping fallback');
    return null;
  }

  logDebug('ErrorHandlerService', 'Fetching original content as fallback', {
    originalUrl,
    errorType: error.errorType,
    errorMessage: error.message,
    config: {
      enabled: fallbackConfig.enabled,
      badRequestOnly: fallbackConfig.badRequestOnly
    }
  });

  try {
    // Create a new request for the original content
    const originalRequest = new Request(originalUrl, {
      method: request.method,
      headers: request.headers,
      redirect: 'follow'
    });

    // Fetch the original content
    const response = await fetch(originalRequest);

    // Create new headers
    const headers = new Headers();
    
    // Determine which headers to preserve
    const preserveHeaders = fallbackConfig.preserveHeaders || 
      ['Content-Type', 'Content-Length', 'Content-Range', 'Accept-Ranges'];
    
    // Copy preserved headers from original response
    preserveHeaders.forEach(headerName => {
      const headerValue = response.headers.get(headerName);
      if (headerValue) {
        headers.set(headerName, headerValue);
      }
    });
    
    // Add fallback-specific headers
    headers.set('X-Fallback-Applied', 'true');
    headers.set('X-Fallback-Reason', error.message);
    headers.set('X-Original-Error-Type', error.errorType);
    headers.set('X-Original-Status-Code', error.statusCode.toString());
    
    // Add Cache-Control header to prevent caching of fallback response
    headers.set('Cache-Control', 'no-store');

    // Log successful fallback
    logDebug('ErrorHandlerService', 'Successfully fetched fallback content', {
      status: response.status,
      contentType: response.headers.get('Content-Type'),
      preservedHeaders: preserveHeaders
    });
    
    logDebug('ErrorHandlerService', 'Successfully fetched original content', {
      originalUrl,
      status: response.status,
      contentType: response.headers.get('Content-Type'),
      size: response.headers.get('Content-Length')
    });

    // Return new response with modified headers
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers
    });
  } catch (fallbackError) {
    // Add breadcrumb for fallback error
    const requestContext = getCurrentContext();
    if (requestContext) {
      const { addBreadcrumb } = await import('../utils/requestContext');
      addBreadcrumb(requestContext, 'Error', 'Fallback fetch failed', {
        originalUrl,
        error: fallbackError instanceof Error ? fallbackError.message : 'Unknown error',
      });
    }

    // Log fallback error
    logError('ErrorHandlerService', 'Error fetching fallback content', {
      error: fallbackError instanceof Error ? fallbackError.message : 'Unknown error',
      stack: fallbackError instanceof Error ? fallbackError.stack : undefined,
      originalUrl
    });
    
    // Return null to indicate fallback failed
    return null;
  }
}

/**
 * Create an appropriate error response based on the error type
 * This is the main entry point for handling errors throughout the application
 */
export async function createErrorResponse(
  err: unknown,
  request: Request,
  debugInfo?: DebugInfo,
  diagnosticsInfo?: DiagnosticsInfo,
  env?: { 
    ASSETS?: { 
      fetch: (request: Request) => Promise<Response> 
    } 
  }
): Promise<Response> {
  // Normalize the error
  const normalizedError = normalizeError(err, { originalUrl: request.url });
  
  // Add breadcrumb for error normalization
  const requestContext = getCurrentContext();
  if (requestContext) {
    const { addBreadcrumb } = await import('../utils/requestContext');
    addBreadcrumb(requestContext, 'Error', 'Error normalized', {
      errorType: normalizedError.errorType,
      statusCode: normalizedError.statusCode,
      url: request.url
    });
  }
  
  // Log error processing request
  logError('ErrorHandlerService', 'Error processing request', {
    error: normalizedError.message,
    errorType: normalizedError.errorType,
    statusCode: normalizedError.statusCode,
    context: normalizedError.context,
    stack: normalizedError instanceof Error ? normalizedError.stack : undefined,
    url: request.url
  });
  
  // Initialize diagnostics if not provided
  const diagInfo = diagnosticsInfo || {
    errors: [normalizedError.message],
    warnings: [],
    originalUrl: request.url,
    processingTimeMs: 0
  };

  // Get the original URL if available in diagnostics, otherwise use request URL
  const originalUrl = diagInfo.originalUrl || request.url;
  
  // Check if we should apply the fallback logic
  // Import configuration manager to check if fallback is enabled
  const { VideoConfigurationManager } = await import('../config');
  const config = VideoConfigurationManager.getInstance();
  const caching = config.getCachingConfig();
  const fallbackConfig = caching?.fallback;
  
  // Log the configuration to help with debugging
  logDebug('FallbackHandler', 'Caching config loaded', {
    method: caching?.method,
    debug: caching?.debug,
    fallbackEnabled: fallbackConfig?.enabled,
    badRequestOnly: fallbackConfig?.badRequestOnly,
    preserveHeaders: fallbackConfig?.preserveHeaders?.length || 0
  });
  
  // If fallback is enabled, try to fetch original content
  if (fallbackConfig?.enabled) {
    // Only apply fallback for 400 Bad Request errors if badRequestOnly is true
    if (!fallbackConfig.badRequestOnly || normalizedError.statusCode === 400) {
      try {
        const fallbackResponse = await fetchOriginalContentFallback(originalUrl, normalizedError, request);
        
        // If fallback was successful, use it instead of error response
        if (fallbackResponse) {
          // Add debug headers if debug is enabled
          if (debugInfo?.isEnabled) {
            // Add the fallback information to diagnostics
            diagInfo.warnings = diagInfo.warnings || [];
            diagInfo.warnings.push('Returned original content due to transformation failure');
            diagInfo.fallbackApplied = true;
            diagInfo.fallbackReason = normalizedError.message;
            
            // Import debug service functions dynamically to avoid circular dependencies
            const { addDebugHeaders } = await import('./debugService');
            return addDebugHeaders(fallbackResponse, debugInfo, diagInfo);
          }
          
          return fallbackResponse;
        }
      } catch (fallbackError) {
        // Log the fallback error but continue with the original error response
        logError('ErrorHandlerService', 'Error in fallback handler', {
          error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
          originalError: normalizedError.message
        });
      }
    }
  }
  
  // Check if this is a debug view request
  const url = new URL(request.url);
  const isDebugView = url.searchParams.has('debug') && 
                    (url.searchParams.get('debug') === 'view' || 
                      url.searchParams.get('debug') === 'true');
  
  // Return debug HTML if requested and debug is enabled
  if (isDebugView && debugInfo?.isEnabled) {
    // Add error to diagnostics
    diagInfo.errors = diagInfo.errors || [];
    if (!diagInfo.errors.includes(normalizedError.message)) {
      diagInfo.errors.push(normalizedError.message);
    }
    
    // Use the ASSETS binding for the Astro-based debug UI
    if (env?.ASSETS) {
      try {
        // Create a new URL for the debug.html page
        const debugUrl = new URL(request.url);
        debugUrl.pathname = '/debug.html';
        
        // Fetch the debug HTML page
        const debugResponse = await env.ASSETS.fetch(
          new Request(debugUrl.toString(), {
            method: 'GET',
            headers: new Headers({ 'Accept': 'text/html' })
          })
        );
        
        if (debugResponse.ok) {
          const html = await debugResponse.text();
          
          // Safely serialize the diagnostics info
          const safeJsonString = JSON.stringify(diagInfo)
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
                console.log('Debug data loaded from worker (error):', typeof window.DIAGNOSTICS_DATA);
              </script>`
            );
          } else {
            htmlWithData = html.replace(
              '<body',
              `<body data-debug="true" data-error="true"><script type="text/javascript">
                // Pre-load diagnostic data
                window.DIAGNOSTICS_DATA = ${safeJsonString};
                console.log('Debug data loaded from worker (error):', typeof window.DIAGNOSTICS_DATA);
              </script>`
            );
          }
          
          return new Response(htmlWithData, {
            status: normalizedError.statusCode,
            headers: {
              'Content-Type': 'text/html; charset=utf-8',
              'Cache-Control': 'no-store',
              'X-Error-Type': normalizedError.errorType
            }
          });
        }
      } catch (htmlErr) {
        // Add breadcrumb for HTML generation error
        const requestContext = getCurrentContext();
        if (requestContext) {
          const { addBreadcrumb } = await import('../utils/requestContext');
          addBreadcrumb(requestContext, 'Error', 'Debug HTML generation failed', {
            error: htmlErr instanceof Error ? htmlErr.message : 'Unknown error',
            url: request.url
          });
        }
        
        // Log but continue if there's an error generating the HTML
        logError('ErrorHandlerService', 'Error generating debug HTML', {
          error: htmlErr instanceof Error ? htmlErr.message : 'Unknown error',
          stack: htmlErr instanceof Error ? htmlErr.stack : undefined
        });
      }
    }
    
    // Fallback to a simple error response with the diagnostics info as JSON
    return new Response(
      `<html><body><h1>Error</h1><p>${normalizedError.message}</p><h2>Debug Data</h2><pre>${JSON.stringify(diagInfo, null, 2)}</pre></body></html>`,
      {
        status: normalizedError.statusCode,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
          'X-Error-Type': normalizedError.errorType
        }
      }
    );
  }
  
  // Add debug headers if debug is enabled
  if (debugInfo?.isEnabled) {
    // Import debug service functions dynamically to avoid circular dependencies
    const { addDebugHeaders } = await import('./debugService');
    const response = normalizedError.toResponse();
    return addDebugHeaders(response, debugInfo, diagInfo);
  }
  
  // Return a normal error response
  return normalizedError.toResponse();
}
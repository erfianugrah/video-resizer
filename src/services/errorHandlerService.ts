/**
 * Service for handling errors consistently across the application
 */
import { VideoTransformError, ErrorType, ProcessingError } from '../errors';
import { getCurrentContext } from '../utils/legacyLoggerAdapter';
import { createLogger, error as pinoError } from '../utils/pinoLogger';
import type { DebugInfo, DiagnosticsInfo } from '../utils/debugHeadersUtils';

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
  
  // Get the current request context if available
  const requestContext = getCurrentContext();
  
  if (requestContext) {
    const logger = createLogger(requestContext);
    pinoError(requestContext, logger, 'ErrorHandlerService', 'Error processing request', {
      error: normalizedError.message,
      errorType: normalizedError.errorType,
      statusCode: normalizedError.statusCode,
      context: normalizedError.context,
      stack: normalizedError instanceof Error ? normalizedError.stack : undefined,
      url: request.url
    });
  } else {
    // Fallback to legacy logging
    console.error(`ErrorHandlerService: Error processing request: ${normalizedError.message}`, {
      errorType: normalizedError.errorType,
      statusCode: normalizedError.statusCode,
      url: request.url
    });
  }
  
  // Initialize diagnostics if not provided
  const diagInfo = diagnosticsInfo || {
    errors: [normalizedError.message],
    warnings: [],
    originalUrl: request.url,
    processingTimeMs: 0
  };
  
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
        // Log but continue if there's an error generating the HTML
        if (requestContext) {
          const logger = createLogger(requestContext);
          pinoError(requestContext, logger, 'ErrorHandlerService', 'Error generating debug HTML', {
            error: htmlErr instanceof Error ? htmlErr.message : 'Unknown error',
            stack: htmlErr instanceof Error ? htmlErr.stack : undefined
          });
        } else {
          console.error('ErrorHandlerService: Error generating debug HTML:', 
            htmlErr instanceof Error ? htmlErr.message : 'Unknown error');
        }
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
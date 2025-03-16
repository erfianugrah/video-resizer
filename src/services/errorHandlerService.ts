/**
 * Service for handling errors consistently across the application
 */
import { error as logError } from '../utils/loggerUtils';
import { VideoTransformError, ErrorType, ProcessingError } from '../errors';
import { DebugInfo, DiagnosticsInfo } from '../utils/debugHeadersUtils';

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
  
  // Log the error with context
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
    
    // Import debug service functions dynamically to avoid circular dependencies
    const { createDebugReport } = await import('../utils/debugHeadersUtils');
    
    // Use the ASSETS binding if available for a better debug view
    if (env?.ASSETS) {
      try {
        // Create a new URL for the debug.html page
        const debugUrl = new URL(request.url);
        debugUrl.pathname = '/debug.html';
        debugUrl.search = `?data=${encodeURIComponent(JSON.stringify(diagInfo))}&error=true`;
        
        // Fetch the debug HTML page
        const debugResponse = await env.ASSETS.fetch(
          new Request(debugUrl.toString(), {
            method: 'GET',
            headers: new Headers({ 'Accept': 'text/html' })
          })
        );
        
        if (debugResponse.ok) {
          const html = await debugResponse.text();
          
          // Insert diagnostic data into the HTML
          const htmlWithData = html.replace(
            '<body>',
            `<body>
            <script>
              // Pre-load diagnostic data
              window.DIAGNOSTICS_DATA = ${JSON.stringify(diagInfo)};
              console.log('Debug data loaded:', window.DIAGNOSTICS_DATA);
            </script>`
          );
          
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
        logError('ErrorHandlerService', 'Error generating debug HTML', {
          error: htmlErr instanceof Error ? htmlErr.message : 'Unknown error'
        });
      }
    }
    
    // Fallback to simple debug report
    return new Response(
      createDebugReport(diagInfo),
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
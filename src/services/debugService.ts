/**
 * Service for handling debug information and reporting
 */
import { DebugInfo, DiagnosticsInfo } from '../utils/debugHeadersUtils';
import { debug } from '../utils/loggerUtils';

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
  
  debug('DebugService', 'Adding debug headers', {
    isVerbose: debugInfo.isVerbose,
    includeHeaders: debugInfo.includeHeaders,
  });
  
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
      console.error('Error loading debug UI from assets:', error);
    }
  }
  
  // Fallback to a simple minimal HTML response if assets aren't available
  return new Response(
    `<!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Debug Report</title>
      <style>
        body { font-family: system-ui, sans-serif; line-height: 1.5; padding: 2rem; }
        pre { background: #f1f1f1; padding: 1rem; overflow-x: auto; }
        .container { max-width: 1200px; margin: 0 auto; }
        h1 { color: #0051c3; }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>Video Resizer Debug Report</h1>
        <p>This is a minimal fallback debug view. The Astro debug UI could not be loaded.</p>
        <h2>Diagnostic Data:</h2>
        <pre>${JSON.stringify(diagnosticsInfo, null, 2)}</pre>
      </div>
    </body>
    </html>`,
    {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store'
      }
    }
  );
}
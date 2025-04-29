/**
 * Service for handling debug information and reporting
 * 
 * This file now serves as a compatibility layer, re-exporting the centralized
 * debug utilities from debugHeadersUtils.ts to avoid breaking existing imports.
 * 
 * @deprecated Use the utilities in debugHeadersUtils.ts directly
 */
import { 
  addDebugHeaders as centralizedAddDebugHeaders, 
  createDebugReport as centralizedCreateDebugReport,
  DebugInfo, 
  DiagnosticsInfo
} from '../utils/debugHeadersUtils';
import { 
  logErrorWithContext, 
  withErrorHandling,
  tryOrNull
} from '../utils/errorHandlingUtils';
import { getCurrentContext, addBreadcrumb, getPerformanceMetrics, RequestContext } from '../utils/requestContext';
import { VideoConfigurationManager, CacheConfigurationManager, DebugConfigurationManager, LoggingConfigurationManager } from '../config';
import { getEnvironmentConfig } from '../config/environmentConfig';

/**
 * Implementation of addDebugHeaders that might throw errors
 */
function addDebugHeadersImpl(
  response: Response,
  debugInfo: DebugInfo,
  diagnosticsInfo: DiagnosticsInfo
): Response {
  // Add breadcrumb to track debug header addition
  const requestContext = getCurrentContext();
  if (requestContext) {
    addBreadcrumb(requestContext, 'Debug', 'Adding debug headers', {
      isVerbose: debugInfo.isVerbose,
      includeHeaders: debugInfo.includeHeaders,
      includePerformance: debugInfo.includePerformance,
      hasErrors: (diagnosticsInfo.errors || []).length > 0,
      hasWarnings: (diagnosticsInfo.warnings || []).length > 0
    });
  }
  
  // Forward to the centralized implementation
  return centralizedAddDebugHeaders(response, debugInfo, diagnosticsInfo);
}

/**
 * Add debug headers to a response (forwarded to debugHeadersUtils.ts)
 * Uses standardized error handling for consistent logging
 * 
 * @deprecated Use debugHeadersUtils.addDebugHeaders directly
 */
export const addDebugHeaders = withErrorHandling<
  [Response, DebugInfo, DiagnosticsInfo],
  Response
>(
  addDebugHeadersImpl,
  {
    functionName: 'addDebugHeaders',
    component: 'DebugService',
    logErrors: true
  },
  {
    operation: 'add_debug_headers'
  }
);

/**
 * Implementation of createDebugReport that might throw errors
 */
async function createDebugReportImpl(
  diagnosticsInfo: DiagnosticsInfo, 
  env?: { ASSETS?: { fetch: (request: Request) => Promise<Response> }}
): Promise<Response> {
  // Add breadcrumb to track debug report creation
  const requestContext = getCurrentContext();
  if (requestContext) {
    addBreadcrumb(requestContext, 'Debug', 'Creating debug report', {
      hasErrors: (diagnosticsInfo.errors || []).length > 0,
      hasWarnings: (diagnosticsInfo.warnings || []).length > 0,
      hasAssets: !!env?.ASSETS,
      timestamp: new Date().toISOString()
    });
  }
  
  // Forward to the centralized implementation
  return centralizedCreateDebugReport(diagnosticsInfo, env);
}

/**
 * Create an HTML debug report (forwarded to debugHeadersUtils.ts)
 * Uses standardized error handling for consistent logging and error tracking
 * 
 * @deprecated Use debugHeadersUtils.createDebugReport directly
 */
export const createDebugReport = withErrorHandling<
  [DiagnosticsInfo, { ASSETS?: { fetch: (request: Request) => Promise<Response> }} | undefined],
  Promise<Response>
>(
  createDebugReportImpl,
  {
    functionName: 'createDebugReport',
    component: 'DebugService',
    logErrors: true
  },
  {
    operation: 'create_debug_report'
  }
);

/**
 * Interface for debug page generation parameters
 */
export interface GenerateDebugPageParams {
  diagnosticsInfo: DiagnosticsInfo;
  isError: boolean;
  request: Request;
  env: any; // Environment bindings (like ASSETS)
  requestContext: RequestContext;
}

/**
 * Function to safely serialize JSON, handling circular references
 */
const getCircularReplacer = () => {
  const seen = new WeakSet();
  return (key: string, value: any) => {
    if (key === 'diagnosticsInfo') return '[DiagnosticsInfo Reference]'; // Specific known cycle
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) return '[Circular Reference]';
      seen.add(value);
    }
    return value;
  };
};

/**
 * Function to sanitize breadcrumbs to avoid circular references
 */
const sanitizeBreadcrumbs = (breadcrumbs: any[]): any[] => {
  if (!Array.isArray(breadcrumbs)) return [];
  
  try {
    return JSON.parse(JSON.stringify(breadcrumbs, getCircularReplacer()));
  } catch (e) {
    console.error("Error sanitizing breadcrumbs:", e);
    return [{ category: 'Error', message: 'Failed to sanitize breadcrumbs' }];
  }
};

/**
 * Generates a debug page with detailed diagnostic information
 * 
 * @param params Parameters for generating the debug page
 * @returns Response with HTML debug page
 */
export async function generateDebugPage({
  diagnosticsInfo,
  isError,
  request,
  env,
  requestContext
}: GenerateDebugPageParams): Promise<Response> {
  addBreadcrumb(requestContext, 'Debug', 'Generating debug page', { isError });

  // Add configuration data and performance metrics to diagnostics
  try {
    diagnosticsInfo.videoConfig = VideoConfigurationManager.getInstance().getConfig();
    diagnosticsInfo.cacheConfig = CacheConfigurationManager.getInstance().getConfig();
    diagnosticsInfo.debugConfig = DebugConfigurationManager.getInstance().getConfig();
    diagnosticsInfo.loggingConfig = LoggingConfigurationManager.getInstance().getConfig();
    diagnosticsInfo.environment = { ...getEnvironmentConfig() } as Record<string, unknown>;
    diagnosticsInfo.performanceMetrics = getPerformanceMetrics(requestContext);
    
    // Add sanitized breadcrumbs to avoid circular references
    diagnosticsInfo.breadcrumbs = sanitizeBreadcrumbs(requestContext.breadcrumbs);
  } catch (configError) {
    logErrorWithContext('Error gathering config/perf for debug page', configError, 
      { requestId: requestContext.requestId }, 'generateDebugPage');
    diagnosticsInfo.warnings = diagnosticsInfo.warnings || [];
    diagnosticsInfo.warnings.push('Could not load full configuration/performance data for debug view.');
  }

  // Check for ASSETS binding
  if (!env?.ASSETS) {
    addBreadcrumb(requestContext, 'Error', 'ASSETS binding missing for Debug UI', { severity: 'high' });
    
    // Return minimal error HTML
    return new Response(
      `<html><body><h1>Debug UI Error</h1><p>ASSETS binding not available. Please check your wrangler.toml configuration.</p><h2>Debug Data</h2><pre>${JSON.stringify(diagnosticsInfo, null, 2)}</pre></body></html>`,
      {
        status: isError ? 500 : 200,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store'
        }
      }
    );
  }

  // Create URL and request for debug template
  const debugUrl = new URL(request.url);
  debugUrl.pathname = '/debug.html';
  const debugRequest = new Request(debugUrl.toString(), { 
    method: 'GET', 
    headers: new Headers({ 'Accept': 'text/html' }) 
  });

  try {
    addBreadcrumb(requestContext, 'Debug', 'Fetching debug UI template', { url: debugUrl.toString() });
    const response = await env.ASSETS.fetch(debugRequest);

    if (!response.ok) {
      addBreadcrumb(requestContext, 'Error', 'Debug UI template fetch failed', { status: response.status });
      
      // Return minimal error HTML for template fetch failure
      return new Response(
        `<html><body><h1>Debug UI Error</h1><p>Could not load debug.html (${response.status}). Please check that debug UI is built and copied to the public directory.</p><h2>Debug Data</h2><pre>${JSON.stringify(diagnosticsInfo, null, 2)}</pre></body></html>`,
        {
          status: isError ? 500 : 200,
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store'
          }
        }
      );
    }

    // Get HTML content
    const html = await response.text();
    
    // Ensure originalUrl is set
    if (!diagnosticsInfo.originalUrl) {
      diagnosticsInfo.originalUrl = request.url;
    }

    // Safely serialize diagnostics
    const safeJsonString = JSON.stringify(diagnosticsInfo, getCircularReplacer())
      .replace(/</g, '\\u003c')
      .replace(/>/g, '\\u003e')
      .replace(/&/g, '\\u0026');

    // Inject data into HTML
    let htmlWithData = html.replace(
      /(<head[^>]*>)/i,
      `$1\n<script type="text/javascript">window.DIAGNOSTICS_DATA = ${safeJsonString};</script>`
    );
    
    // Fallback if no <head> tag
    if (htmlWithData === html) {
      htmlWithData = html.replace(
        /(<body[^>]*>)/i,
        `$1\n<script type="text/javascript">window.DIAGNOSTICS_DATA = ${safeJsonString};</script>`
      );
    }

    addBreadcrumb(requestContext, 'Debug', 'Debug UI prepared');
    
    return new Response(htmlWithData, {
      status: isError ? 500 : 200,
      headers: { 
        'Content-Type': 'text/html; charset=utf-8', 
        'Cache-Control': 'no-store' 
      }
    });

  } catch (err) {
    logErrorWithContext('Error generating debug UI', err, 
      { requestId: requestContext.requestId }, 'generateDebugPage');
    addBreadcrumb(requestContext, 'Error', 'Debug UI generation failed', 
      { error: err instanceof Error ? err.message : String(err) });
    
    // Format safe error message
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    const safeErrorMessage = String(errorMessage)
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    
    // Create minimal diagnostic information
    const safeDiagnostics = {
      url: diagnosticsInfo?.originalUrl || request.url,
      error: diagnosticsInfo?.errors?.[0] || 'Unknown error',
      timestamp: new Date().toISOString(),
      status: isError ? 500 : 200
    };
    
    // Return fallback error HTML
    return new Response(
      `<!DOCTYPE html>
      <html>
      <head>
        <title>Debug View Error</title>
        <style>
          body { font-family: monospace; padding: 20px; }
          pre { background: #f0f0f0; padding: 10px; overflow: auto; }
        </style>
      </head>
      <body>
        <h1>Debug UI Error</h1>
        <p>An error occurred while rendering the debug view:</p>
        <pre>${safeErrorMessage}</pre>
        <hr/>
        <h2>Minimal Diagnostics</h2>
        <pre>${JSON.stringify(safeDiagnostics, null, 2)}</pre>
      </body>
      </html>`,
      {
        status: isError ? 500 : 200,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store'
        }
      }
    );
  }
}
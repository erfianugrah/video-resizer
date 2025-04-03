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
import { getCurrentContext, addBreadcrumb } from '../utils/requestContext';

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
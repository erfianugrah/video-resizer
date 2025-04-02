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

/**
 * Add debug headers to a response (forwarded to debugHeadersUtils.ts)
 * @deprecated Use debugHeadersUtils.addDebugHeaders directly
 */
export function addDebugHeaders(
  response: Response,
  debugInfo: DebugInfo,
  diagnosticsInfo: DiagnosticsInfo
): Response {
  return centralizedAddDebugHeaders(response, debugInfo, diagnosticsInfo);
}

/**
 * Create an HTML debug report (forwarded to debugHeadersUtils.ts)
 * @deprecated Use debugHeadersUtils.createDebugReport directly
 */
export async function createDebugReport(
  diagnosticsInfo: DiagnosticsInfo, 
  env?: { ASSETS?: { fetch: (request: Request) => Promise<Response> }}
): Promise<Response> {
  return centralizedCreateDebugReport(diagnosticsInfo, env);
}
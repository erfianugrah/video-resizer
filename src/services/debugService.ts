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
 * @returns HTML string with debug information
 */
export function createDebugReport(diagnosticsInfo: DiagnosticsInfo): string {
  // Basic HTML template
  let html = `
<!DOCTYPE html>
<html>
<head>
  <title>Video Resizer Debug Report</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; margin: 0; padding: 20px; color: #333; }
    h1 { color: #2563eb; }
    h2 { color: #3b82f6; margin-top: 20px; }
    .section { background: #f9fafb; border-radius: 8px; padding: 12px; margin-bottom: 12px; }
    .info-row { display: flex; margin-bottom: 8px; }
    .info-label { font-weight: bold; width: 220px; }
    .info-value { font-family: monospace; }
    .error { color: #dc2626; }
    .warning { color: #f59e0b; }
    .success { color: #059669; }
  </style>
</head>
<body>
  <h1>Video Resizer Debug Report</h1>
  `;
  
  // Request Processing Section
  html += `
  <div class="section">
    <h2>Request Processing</h2>`;
  
  // Add processing time
  html += `
    <div class="info-row">
      <div class="info-label">Processing Time:</div>
      <div class="info-value">${diagnosticsInfo.processingTimeMs || 0} ms</div>
    </div>`;
  
  // Add transform source
  if (diagnosticsInfo.transformSource) {
    html += `
    <div class="info-row">
      <div class="info-label">Transform Source:</div>
      <div class="info-value">${diagnosticsInfo.transformSource}</div>
    </div>`;
  }
  
  // Add path match
  if (diagnosticsInfo.pathMatch) {
    html += `
    <div class="info-row">
      <div class="info-label">Path Pattern Match:</div>
      <div class="info-value">${diagnosticsInfo.pathMatch}</div>
    </div>`;
  }
  
  // Add video ID
  if (diagnosticsInfo.videoId) {
    html += `
    <div class="info-row">
      <div class="info-label">Video ID:</div>
      <div class="info-value">${diagnosticsInfo.videoId}</div>
    </div>`;
  }
  
  html += `
  </div>`;
  
  // Client Detection Section
  html += `
  <div class="section">
    <h2>Client Detection</h2>`;
  
  // Add client hints support
  html += `
    <div class="info-row">
      <div class="info-label">Client Hints:</div>
      <div class="info-value">${diagnosticsInfo.clientHints ? 'Supported' : 'Not supported'}</div>
    </div>`;
  
  // Add device type
  if (diagnosticsInfo.deviceType) {
    html += `
    <div class="info-row">
      <div class="info-label">Device Type:</div>
      <div class="info-value">${diagnosticsInfo.deviceType}</div>
    </div>`;
  }
  
  // Add network quality
  if (diagnosticsInfo.networkQuality) {
    html += `
    <div class="info-row">
      <div class="info-label">Network Quality:</div>
      <div class="info-value">${diagnosticsInfo.networkQuality}</div>
    </div>`;
  }
  
  // Add browser capabilities
  if (diagnosticsInfo.browserCapabilities) {
    const capabilities = diagnosticsInfo.browserCapabilities;
    
    html += `
    <div class="info-row">
      <div class="info-label">Browser Capabilities:</div>
      <div class="info-value">
        <ul style="margin: 0; padding-left: 20px;">`;
    
    for (const [key, value] of Object.entries(capabilities)) {
      html += `
          <li>${key}: ${value}</li>`;
    }
    
    html += `
        </ul>
      </div>
    </div>`;
  }
  
  html += `
  </div>`;
  
  // Transform Parameters Section
  if (diagnosticsInfo.transformParams) {
    html += `
  <div class="section">
    <h2>Transform Parameters</h2>`;
    
    for (const [key, value] of Object.entries(diagnosticsInfo.transformParams)) {
      if (value !== null && value !== undefined) {
        html += `
    <div class="info-row">
      <div class="info-label">${key}:</div>
      <div class="info-value">${value}</div>
    </div>`;
      }
    }
    
    html += `
  </div>`;
  }
  
  // Caching Section
  html += `
  <div class="section">
    <h2>Caching</h2>`;
  
  // Add cacheability
  html += `
    <div class="info-row">
      <div class="info-label">Cacheability:</div>
      <div class="info-value">${diagnosticsInfo.cacheability ? 'Enabled' : 'Disabled'}</div>
    </div>`;
  
  // Add cache TTL
  if (diagnosticsInfo.cacheTtl !== undefined) {
    html += `
    <div class="info-row">
      <div class="info-label">Cache TTL:</div>
      <div class="info-value">${diagnosticsInfo.cacheTtl} seconds</div>
    </div>`;
  }
  
  html += `
  </div>`;
  
  // Errors & Warnings Section
  if ((diagnosticsInfo.errors && diagnosticsInfo.errors.length > 0) || 
      (diagnosticsInfo.warnings && diagnosticsInfo.warnings.length > 0)) {
    
    html += `
  <div class="section">
    <h2>Errors & Warnings</h2>`;
    
    // Add errors
    if (diagnosticsInfo.errors && diagnosticsInfo.errors.length > 0) {
      html += `
    <div class="info-row">
      <div class="info-label">Errors:</div>
      <div class="info-value">
        <ul style="margin: 0; padding-left: 20px;" class="error">`;
      
      for (const error of diagnosticsInfo.errors) {
        html += `
          <li>${error}</li>`;
      }
      
      html += `
        </ul>
      </div>
    </div>`;
    }
    
    // Add warnings
    if (diagnosticsInfo.warnings && diagnosticsInfo.warnings.length > 0) {
      html += `
    <div class="info-row">
      <div class="info-label">Warnings:</div>
      <div class="info-value">
        <ul style="margin: 0; padding-left: 20px;" class="warning">`;
      
      for (const warning of diagnosticsInfo.warnings) {
        html += `
          <li>${warning}</li>`;
      }
      
      html += `
        </ul>
      </div>
    </div>`;
    }
    
    html += `
  </div>`;
  }
  
  // Request Headers Section
  if (diagnosticsInfo.requestHeaders) {
    html += `
  <div class="section">
    <h2>Request Headers</h2>`;
    
    for (const [key, value] of Object.entries(diagnosticsInfo.requestHeaders)) {
      html += `
    <div class="info-row">
      <div class="info-label">${key}:</div>
      <div class="info-value">${value}</div>
    </div>`;
    }
    
    html += `
  </div>`;
  }
  
  // Close HTML
  html += `
</body>
</html>`;
  
  return html;
}
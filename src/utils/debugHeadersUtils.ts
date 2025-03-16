/**
 * Utilities for adding debug information to response headers
 */
import { TransformParams } from '../domain/strategies/TransformationStrategy';
import { VideoSize } from './clientHints';

/**
 * Interface for debug information
 */
export interface DebugInfo {
  isEnabled: boolean;
  isVerbose?: boolean;
  includeHeaders?: boolean;
  includePerformance?: boolean;
}

/**
 * Interface for diagnostics information
 */
export interface DiagnosticsInfo {
  processingTimeMs?: number;
  transformSource?: string;
  deviceType?: string;
  networkQuality?: string;
  responsiveSize?: VideoSize;
  requestHeaders?: Record<string, string>;
  transformParams?: TransformParams;
  pathMatch?: string;
  videoId?: string;
  cacheability?: boolean;
  cacheTtl?: number;
  clientHints?: boolean;
  browserCapabilities?: Record<string, boolean>;
  errors?: string[];
  warnings?: string[];
  // New fields for content negotiation and service architecture
  videoFormat?: string;
  estimatedBitrate?: number;
  // Original URL for debug view
  originalUrl?: string;
  // Caching method (cf-object or cache-api)
  cachingMethod?: string;
  // Strategy-specific fields
  transformationType?: string;
  videoQuality?: string;
  videoCompression?: string;
  playbackSettings?: Record<string, boolean | string>;
  imageFormat?: string;
  frameTimestamp?: string;
  startTime?: string;
  duration?: string;
}

/**
 * Add debug headers to a Response
 * @param response The response to enhance
 * @param debugInfo Debug configuration
 * @param diagnosticsInfo Diagnostics information
 * @returns The enhanced response with debug headers
 */
export function addDebugHeaders(
  response: Response,
  debugInfo: DebugInfo,
  diagnosticsInfo: DiagnosticsInfo
): Response {
  // If debug is not enabled, return original response
  if (!debugInfo.isEnabled) {
    return response;
  }

  // Create a new response with the same body but new headers
  const headers = new Headers(response.headers);
  
  // Basic debug headers
  headers.set('X-Video-Resizer-Debug', 'true');
  headers.set('X-Video-Resizer-Version', '1.0.0');
  
  // Add processing time if available
  if (diagnosticsInfo.processingTimeMs !== undefined) {
    headers.set('X-Processing-Time-Ms', diagnosticsInfo.processingTimeMs.toString());
  }
  
  // Add transformation source
  if (diagnosticsInfo.transformSource) {
    headers.set('X-Transform-Source', diagnosticsInfo.transformSource);
  }
  
  // Add device detection info
  if (diagnosticsInfo.deviceType) {
    headers.set('X-Device-Type', diagnosticsInfo.deviceType);
  }
  
  // Add network quality info
  if (diagnosticsInfo.networkQuality) {
    headers.set('X-Network-Quality', diagnosticsInfo.networkQuality);
  }
  
  // Add video details
  if (diagnosticsInfo.videoId) {
    headers.set('X-Video-ID', diagnosticsInfo.videoId);
  }
  
  if (diagnosticsInfo.pathMatch) {
    headers.set('X-Path-Match', diagnosticsInfo.pathMatch);
  }
  
  // Add cache info
  if (diagnosticsInfo.cacheability !== undefined) {
    headers.set('X-Cache-Enabled', diagnosticsInfo.cacheability.toString());
  }
  
  if (diagnosticsInfo.cacheTtl !== undefined) {
    headers.set('X-Cache-TTL', diagnosticsInfo.cacheTtl.toString());
  }
  
  // Add caching method info
  if (diagnosticsInfo.cachingMethod) {
    headers.set('X-Cache-Method', diagnosticsInfo.cachingMethod);
  }
  
  // Add client capability detection results
  if (diagnosticsInfo.clientHints !== undefined) {
    headers.set('X-Client-Hints-Available', diagnosticsInfo.clientHints.toString());
  }
  
  // If verbose mode is enabled, add more detailed headers
  if (debugInfo.isVerbose) {
    // Include responsive sizing info if available
    if (diagnosticsInfo.responsiveSize) {
      headers.set('X-Responsive-Width', diagnosticsInfo.responsiveSize.width.toString());
      headers.set('X-Responsive-Height', diagnosticsInfo.responsiveSize.height.toString());
      headers.set('X-Responsive-Method', diagnosticsInfo.responsiveSize.source);
    }
    
    // Include transform parameters in a JSON-encoded header
    if (diagnosticsInfo.transformParams) {
      headers.set('X-Transform-Params', JSON.stringify(diagnosticsInfo.transformParams));
    }
    
    // Include browser capabilities
    if (diagnosticsInfo.browserCapabilities) {
      headers.set('X-Browser-Capabilities', JSON.stringify(diagnosticsInfo.browserCapabilities));
    }
    
    // Include content negotiation info
    if (diagnosticsInfo.videoFormat) {
      headers.set('X-Video-Format', diagnosticsInfo.videoFormat);
    }
    
    if (diagnosticsInfo.estimatedBitrate !== undefined) {
      headers.set('X-Estimated-Bitrate', diagnosticsInfo.estimatedBitrate.toString());
    }
    
    // Include any errors or warnings
    if (diagnosticsInfo.errors && diagnosticsInfo.errors.length > 0) {
      headers.set('X-Debug-Errors', JSON.stringify(diagnosticsInfo.errors));
    }
    
    if (diagnosticsInfo.warnings && diagnosticsInfo.warnings.length > 0) {
      headers.set('X-Debug-Warnings', JSON.stringify(diagnosticsInfo.warnings));
    }
  }
  
  // Include request headers if configured
  if (debugInfo.includeHeaders && diagnosticsInfo.requestHeaders) {
    const requestHeadersJson = JSON.stringify(diagnosticsInfo.requestHeaders);
    // Split long header values if needed (to avoid HTTP header size limits)
    if (requestHeadersJson.length > 500) {
      const chunks = Math.ceil(requestHeadersJson.length / 500);
      for (let i = 0; i < chunks; i++) {
        const chunk = requestHeadersJson.substr(i * 500, 500);
        headers.set(`X-Request-Headers-${i+1}`, chunk);
      }
      headers.set('X-Request-Headers-Count', chunks.toString());
    } else {
      headers.set('X-Request-Headers', requestHeadersJson);
    }
  }
  
  // Return a new response with the updated headers
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

/**
 * Extract request headers into a simple object for debugging
 * @param request The request to extract headers from
 * @returns Object with header name-value pairs
 */
export function extractRequestHeaders(request: Request): Record<string, string> {
  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headers[key] = value;
  });
  return headers;
}

/**
 * Create a debug report HTML page with detailed diagnostic information
 * @param diagnosticsInfo The diagnostics information
 * @returns HTML string with a formatted debug report
 */
export function createDebugReport(diagnosticsInfo: DiagnosticsInfo): string {
  // Create an HTML report with detailed debug information
  return `
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
  
  <div class="section">
    <h2>Request Processing</h2>
    <div class="info-row">
      <div class="info-label">Processing Time:</div>
      <div class="info-value">${diagnosticsInfo.processingTimeMs ?? 'N/A'} ms</div>
    </div>
    <div class="info-row">
      <div class="info-label">Transform Source:</div>
      <div class="info-value">${diagnosticsInfo.transformSource ?? 'N/A'}</div>
    </div>
    <div class="info-row">
      <div class="info-label">Path Pattern Match:</div>
      <div class="info-value">${diagnosticsInfo.pathMatch ?? 'N/A'}</div>
    </div>
    <div class="info-row">
      <div class="info-label">Video ID:</div>
      <div class="info-value">${diagnosticsInfo.videoId ?? 'N/A'}</div>
    </div>
  </div>
  
  <div class="section">
    <h2>Client Detection</h2>
    <div class="info-row">
      <div class="info-label">Device Type:</div>
      <div class="info-value">${diagnosticsInfo.deviceType ?? 'N/A'}</div>
    </div>
    <div class="info-row">
      <div class="info-label">Network Quality:</div>
      <div class="info-value">${diagnosticsInfo.networkQuality ?? 'N/A'}</div>
    </div>
    <div class="info-row">
      <div class="info-label">Client Hints Available:</div>
      <div class="info-value">${diagnosticsInfo.clientHints !== undefined ? 
        (diagnosticsInfo.clientHints ? '<span class="success">Yes</span>' : '<span class="warning">No</span>') : 'N/A'}</div>
    </div>
  </div>
  
  <div class="section">
    <h2>Responsive Sizing</h2>
    ${diagnosticsInfo.responsiveSize ? `
    <div class="info-row">
      <div class="info-label">Width:</div>
      <div class="info-value">${diagnosticsInfo.responsiveSize.width} px</div>
    </div>
    <div class="info-row">
      <div class="info-label">Height:</div>
      <div class="info-value">${diagnosticsInfo.responsiveSize.height} px</div>
    </div>
    <div class="info-row">
      <div class="info-label">Detection Method:</div>
      <div class="info-value">${diagnosticsInfo.responsiveSize.source}</div>
    </div>
    ` : '<div class="info-row">No responsive sizing information available</div>'}
  </div>
  
  <div class="section">
    <h2>Cache Information</h2>
    <div class="info-row">
      <div class="info-label">Cacheability:</div>
      <div class="info-value">${diagnosticsInfo.cacheability !== undefined ? 
        (diagnosticsInfo.cacheability ? '<span class="success">Enabled</span>' : '<span class="warning">Disabled</span>') : 'N/A'}</div>
    </div>
    <div class="info-row">
      <div class="info-label">Cache TTL:</div>
      <div class="info-value">${diagnosticsInfo.cacheTtl !== undefined ? `${diagnosticsInfo.cacheTtl} seconds` : 'N/A'}</div>
    </div>
    <div class="info-row">
      <div class="info-label">Caching Method:</div>
      <div class="info-value">${diagnosticsInfo.cachingMethod || 'N/A'}</div>
    </div>
  </div>
  
  <div class="section">
    <h2>Content Negotiation</h2>
    <div class="info-row">
      <div class="info-label">Video Format:</div>
      <div class="info-value">${diagnosticsInfo.videoFormat ?? 'N/A'}</div>
    </div>
    <div class="info-row">
      <div class="info-label">Estimated Bitrate:</div>
      <div class="info-value">${diagnosticsInfo.estimatedBitrate !== undefined ? `${diagnosticsInfo.estimatedBitrate} kbps` : 'N/A'}</div>
    </div>
  </div>
  
  ${diagnosticsInfo.transformParams ? `
  <div class="section">
    <h2>Transformation Parameters</h2>
    <pre>${JSON.stringify(diagnosticsInfo.transformParams, null, 2)}</pre>
  </div>
  ` : ''}
  
  ${diagnosticsInfo.browserCapabilities ? `
  <div class="section">
    <h2>Browser Capabilities</h2>
    <pre>${JSON.stringify(diagnosticsInfo.browserCapabilities, null, 2)}</pre>
  </div>
  ` : ''}
  
  ${(diagnosticsInfo.errors && diagnosticsInfo.errors.length > 0) ? `
  <div class="section">
    <h2>Errors</h2>
    <ul>
      ${diagnosticsInfo.errors.map(error => `<li class="error">${error}</li>`).join('')}
    </ul>
  </div>
  ` : ''}
  
  ${(diagnosticsInfo.warnings && diagnosticsInfo.warnings.length > 0) ? `
  <div class="section">
    <h2>Warnings</h2>
    <ul>
      ${diagnosticsInfo.warnings.map(warning => `<li class="warning">${warning}</li>`).join('')}
    </ul>
  </div>
  ` : ''}
  
  ${(diagnosticsInfo.requestHeaders && Object.keys(diagnosticsInfo.requestHeaders).length > 0) ? `
  <div class="section">
    <h2>Request Headers</h2>
    <pre>${JSON.stringify(diagnosticsInfo.requestHeaders, null, 2)}</pre>
  </div>
  ` : ''}
  
  <div class="section">
    <p><small>Generated at: ${new Date().toISOString()}</small></p>
  </div>
</body>
</html>
  `;
}
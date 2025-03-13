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
 * @returns HTML string with debug information
 */
export function createDebugReport(diagnosticsInfo: DiagnosticsInfo, env?: any): string {
  // Enhanced HTML template with CDN assets
  let html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Video Resizer Debug Report</title>
  <!-- External CSS -->
  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.0/font/bootstrap-icons.css">
  <style>
    :root {
      --cf-blue: #0051c3;
      --cf-orange: #f6821f;
      --cf-gradient: linear-gradient(90deg, var(--cf-blue), var(--cf-orange));
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
      background-color: #f8f9fa;
      color: #333;
      padding-bottom: 2rem;
    }
    .header {
      background: var(--cf-gradient);
      color: white;
      padding: 1.5rem 0;
      margin-bottom: 2rem;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
    }
    .card {
      border: none;
      border-radius: 10px;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05);
      margin-bottom: 1.5rem;
      overflow: hidden;
      transition: transform 0.3s ease, box-shadow 0.3s ease;
    }
    .card:hover {
      transform: translateY(-5px);
      box-shadow: 0 8px 15px rgba(0, 0, 0, 0.1);
    }
    .card-header {
      background-color: #f1f5f9;
      font-weight: 600;
      display: flex;
      align-items: center;
      padding: 1rem 1.5rem;
      border-bottom: 1px solid rgba(0, 0, 0, 0.05);
    }
    .card-header i {
      margin-right: 0.75rem;
      font-size: 1.25rem;
      color: var(--cf-blue);
    }
    .info-row {
      display: flex;
      flex-wrap: wrap;
      border-bottom: 1px solid rgba(0, 0, 0, 0.05);
      padding: 0.875rem 1.5rem;
    }
    .info-row:last-child {
      border-bottom: none;
    }
    .info-label {
      font-weight: 600;
      width: 200px;
      color: #4b5563;
    }
    .info-value {
      flex: 1;
      font-family: 'SF Mono', 'Menlo', 'Monaco', 'Courier New', monospace;
    }
    .badge {
      font-weight: 500;
      padding: 0.5em 0.75em;
      border-radius: 6px;
    }
    .badge i {
      margin-right: 0.25rem;
    }
    .badge-value {
      font-size: 0.875rem;
    }
    .badge-blue {
      background-color: rgba(37, 99, 235, 0.1);
      color: #2563eb;
    }
    .badge-green {
      background-color: rgba(5, 150, 105, 0.1);
      color: #059669;
    }
    .badge-yellow {
      background-color: rgba(245, 158, 11, 0.1);
      color: #f59e0b;
    }
    .badge-red {
      background-color: rgba(220, 38, 38, 0.1);
      color: #dc2626;
    }
    .badge-purple {
      background-color: rgba(124, 58, 237, 0.1);
      color: #7c3aed;
    }
    pre {
      background-color: #f8fafc;
      border-radius: 6px;
      padding: 1rem;
      font-size: 0.875rem;
      overflow: auto;
      max-height: 300px;
    }
    .feature-card {
      height: 100%;
    }
    .feature-icon {
      width: 48px;
      height: 48px;
      border-radius: 12px;
      background: var(--cf-gradient);
      display: flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 1rem;
      color: white;
      font-size: 1.5rem;
    }
    .section-title {
      color: var(--cf-blue);
      margin-bottom: 1.5rem;
      font-weight: 700;
    }
    .errors-list li, .warnings-list li {
      padding: 0.75rem 1rem;
      border-radius: 6px;
      margin-bottom: 0.5rem;
    }
    .errors-list li {
      background-color: rgba(220, 38, 38, 0.1);
      color: #dc2626;
    }
    .warnings-list li {
      background-color: rgba(245, 158, 11, 0.1);
      color: #f59e0b;
    }
    .footer {
      text-align: center;
      padding: 1rem 0;
      margin-top: 2rem;
      font-size: 0.875rem;
      color: #6b7280;
    }
    .footer img {
      height: 20px;
      margin-left: 0.5rem;
      vertical-align: middle;
    }
    
    /* Animation classes */
    .fade-in {
      animation: fadeIn 0.5s ease forwards;
    }
    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(10px); }
      to { opacity: 1; transform: translateY(0); }
    }
    
    /* Animation delays */
    .delay-1 { animation-delay: 0.1s; }
    .delay-2 { animation-delay: 0.2s; }
    .delay-3 { animation-delay: 0.3s; }
    .delay-4 { animation-delay: 0.4s; }
    .delay-5 { animation-delay: 0.5s; }
  </style>
</head>
<body>
  <div class="header">
    <div class="container">
      <div class="d-flex justify-content-between align-items-center">
        <h1 class="m-0">
          <i class="bi bi-film me-2"></i>Video Resizer Debug
        </h1>
        <div class="text-white-50">
          <i class="bi bi-clock me-1"></i>${new Date().toLocaleString()}
        </div>
      </div>
    </div>
  </div>

  <div class="container">
    <!-- Overview Cards -->
    <div class="row mb-4">
      <div class="col-md-4 fade-in">
        <div class="card feature-card">
          <div class="card-body">
            <div class="feature-icon">
              <i class="bi bi-speedometer2"></i>
            </div>
            <h5>Processing Time</h5>
            <p class="text-muted mb-2">Video processing completed in:</p>
            <h3 class="text-primary">${diagnosticsInfo.processingTimeMs || 0} ms</h3>
          </div>
        </div>
      </div>
      
      <div class="col-md-4 fade-in delay-1">
        <div class="card feature-card">
          <div class="card-body">
            <div class="feature-icon">
              <i class="bi bi-device-hdd"></i>
            </div>
            <h5>Device Detection</h5>
            <p class="text-muted mb-2">Client device detected as:</p>
            <h3 class="text-primary">${diagnosticsInfo.deviceType || 'Unknown'}</h3>
          </div>
        </div>
      </div>
      
      <div class="col-md-4 fade-in delay-2">
        <div class="card feature-card">
          <div class="card-body">
            <div class="feature-icon">
              <i class="bi bi-hdd-stack"></i>
            </div>
            <h5>Cache Status</h5>
            <p class="text-muted mb-2">Content caching:</p>
            <h3 class="${diagnosticsInfo.cacheability ? 'text-success' : 'text-warning'}">
              ${diagnosticsInfo.cacheability ? 'Enabled' : 'Disabled'}
            </h3>
          </div>
        </div>
      </div>
    </div>

    <!-- Main Content -->
    <div class="row">
      <div class="col-lg-8">
        <!-- Request Processing Card -->
        <div class="card fade-in delay-1">
          <div class="card-header">
            <i class="bi bi-arrow-repeat"></i> Request Processing
          </div>
          <div class="card-body p-0">
            <div class="info-row">
              <div class="info-label">Processing Time:</div>
              <div class="info-value">
                <span class="badge badge-blue badge-value">
                  <i class="bi bi-hourglass-split"></i> ${diagnosticsInfo.processingTimeMs || 0} ms
                </span>
              </div>
            </div>
            ${diagnosticsInfo.transformSource ? `
            <div class="info-row">
              <div class="info-label">Transform Source:</div>
              <div class="info-value">
                <span class="badge badge-purple badge-value">
                  <i class="bi bi-shuffle"></i> ${diagnosticsInfo.transformSource}
                </span>
              </div>
            </div>` : ''}
            ${diagnosticsInfo.pathMatch ? `
            <div class="info-row">
              <div class="info-label">Path Pattern Match:</div>
              <div class="info-value">
                <code>${diagnosticsInfo.pathMatch}</code>
              </div>
            </div>` : ''}
            ${diagnosticsInfo.videoId ? `
            <div class="info-row">
              <div class="info-label">Video ID:</div>
              <div class="info-value">
                <span class="badge badge-blue badge-value">
                  <i class="bi bi-camera-video"></i> ${diagnosticsInfo.videoId}
                </span>
              </div>
            </div>` : ''}
          </div>
        </div>

        <!-- Client Detection Card -->
        <div class="card fade-in delay-2">
          <div class="card-header">
            <i class="bi bi-device-hdd"></i> Client Detection
          </div>
          <div class="card-body p-0">
            <div class="info-row">
              <div class="info-label">Client Hints:</div>
              <div class="info-value">
                ${diagnosticsInfo.clientHints 
                  ? '<span class="badge badge-green badge-value"><i class="bi bi-check-circle"></i> Supported</span>' 
                  : '<span class="badge badge-yellow badge-value"><i class="bi bi-exclamation-triangle"></i> Not supported</span>'}
              </div>
            </div>
            ${diagnosticsInfo.deviceType ? `
            <div class="info-row">
              <div class="info-label">Device Type:</div>
              <div class="info-value">
                <span class="badge badge-blue badge-value">
                  <i class="bi bi-${diagnosticsInfo.deviceType === 'mobile' ? 'phone' : diagnosticsInfo.deviceType === 'tablet' ? 'tablet' : 'laptop'}"></i> 
                  ${diagnosticsInfo.deviceType}
                </span>
              </div>
            </div>` : ''}
            ${diagnosticsInfo.networkQuality ? `
            <div class="info-row">
              <div class="info-label">Network Quality:</div>
              <div class="info-value">
                <span class="badge ${
                  diagnosticsInfo.networkQuality === 'high' ? 'badge-green' : 
                  diagnosticsInfo.networkQuality === 'medium' ? 'badge-yellow' : 
                  'badge-red'
                } badge-value">
                  <i class="bi bi-wifi"></i> ${diagnosticsInfo.networkQuality}
                </span>
              </div>
            </div>` : ''}
          </div>
        </div>

        <!-- Browser Capabilities Card -->
        ${diagnosticsInfo.browserCapabilities ? `
        <div class="card fade-in delay-3">
          <div class="card-header">
            <i class="bi bi-browser-chrome"></i> Browser Capabilities
          </div>
          <div class="card-body">
            <div class="row g-2">
              ${Object.entries(diagnosticsInfo.browserCapabilities).map(([key, value]) => `
                <div class="col-md-4 col-sm-6">
                  <div class="card ${value ? 'bg-light-success' : 'bg-light-warning'} mb-2">
                    <div class="card-body py-2 px-3">
                      <div class="d-flex align-items-center">
                        <i class="bi bi-${value ? 'check-circle-fill text-success' : 'x-circle-fill text-warning'} me-2"></i>
                        <span>${key}</span>
                      </div>
                    </div>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        </div>` : ''}

        <!-- Transform Parameters Card -->
        ${diagnosticsInfo.transformParams ? `
        <div class="card fade-in delay-4">
          <div class="card-header">
            <i class="bi bi-sliders"></i> Transform Parameters
          </div>
          <div class="card-body">
            <div class="table-responsive">
              <table class="table table-hover">
                <thead>
                  <tr>
                    <th>Parameter</th>
                    <th>Value</th>
                  </tr>
                </thead>
                <tbody>
                  ${Object.entries(diagnosticsInfo.transformParams)
                    .filter(([_, value]) => value !== null && value !== undefined)
                    .map(([key, value]) => `
                      <tr>
                        <td><strong>${key}</strong></td>
                        <td><code>${value}</code></td>
                      </tr>
                    `).join('')}
                </tbody>
              </table>
            </div>
          </div>
        </div>` : ''}
      </div>

      <div class="col-lg-4">
        <!-- Caching Card -->
        <div class="card fade-in delay-2">
          <div class="card-header">
            <i class="bi bi-hdd-stack"></i> Caching
          </div>
          <div class="card-body p-0">
            <div class="info-row">
              <div class="info-label">Status:</div>
              <div class="info-value">
                ${diagnosticsInfo.cacheability 
                  ? '<span class="badge badge-green badge-value"><i class="bi bi-check-circle"></i> Enabled</span>' 
                  : '<span class="badge badge-yellow badge-value"><i class="bi bi-x-circle"></i> Disabled</span>'}
              </div>
            </div>
            ${diagnosticsInfo.cacheTtl !== undefined ? `
            <div class="info-row">
              <div class="info-label">TTL:</div>
              <div class="info-value">
                <span class="badge badge-blue badge-value">
                  <i class="bi bi-clock-history"></i> ${diagnosticsInfo.cacheTtl} seconds
                </span>
              </div>
            </div>` : ''}
          </div>
        </div>

        <!-- Errors & Warnings Card -->
        ${(diagnosticsInfo.errors && diagnosticsInfo.errors.length > 0) || 
          (diagnosticsInfo.warnings && diagnosticsInfo.warnings.length > 0) ? `
        <div class="card fade-in delay-3">
          <div class="card-header">
            <i class="bi bi-exclamation-diamond"></i> Errors & Warnings
          </div>
          <div class="card-body">
            ${diagnosticsInfo.errors && diagnosticsInfo.errors.length > 0 ? `
            <h6 class="mb-2">Errors (${diagnosticsInfo.errors.length})</h6>
            <ul class="errors-list list-unstyled">
              ${diagnosticsInfo.errors.map(error => `
                <li>
                  <i class="bi bi-exclamation-circle-fill me-2"></i> ${error}
                </li>
              `).join('')}
            </ul>` : ''}
            
            ${diagnosticsInfo.warnings && diagnosticsInfo.warnings.length > 0 ? `
            <h6 class="mb-2 mt-3">Warnings (${diagnosticsInfo.warnings.length})</h6>
            <ul class="warnings-list list-unstyled">
              ${diagnosticsInfo.warnings.map(warning => `
                <li>
                  <i class="bi bi-exclamation-triangle-fill me-2"></i> ${warning}
                </li>
              `).join('')}
            </ul>` : ''}
          </div>
        </div>` : ''}

        <!-- Request Headers Card -->
        ${diagnosticsInfo.requestHeaders ? `
        <div class="card fade-in delay-4">
          <div class="card-header">
            <i class="bi bi-file-earmark-text"></i> Request Headers
          </div>
          <div class="card-body">
            <pre>${JSON.stringify(diagnosticsInfo.requestHeaders, null, 2)}</pre>
          </div>
        </div>` : ''}
      </div>
    </div>

    <!-- Footer with Cloudflare branding -->
    <div class="footer">
      <p>
        Powered by Cloudflare Workers
        <img src="https://www.cloudflare.com/favicon.ico" alt="Cloudflare" />
      </p>
    </div>
  </div>

  <!-- External JS from CDN -->
  <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
</body>
</html>`;
  
  return html;
}
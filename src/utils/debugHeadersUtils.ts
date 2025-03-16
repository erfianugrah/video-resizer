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

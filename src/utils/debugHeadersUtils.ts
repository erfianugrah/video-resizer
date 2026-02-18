/**
 * Unified debug header utilities for video-resizer
 *
 * This file centralizes all debug functionality for adding headers, extracting diagnostics,
 * and handling debug reports. This eliminates duplication between debugHeadersUtils.ts,
 * debugService.ts, and responseBuilder.ts.
 */
import { getCurrentContext } from './legacyLoggerAdapter';
import { addBreadcrumb, getPerformanceMetrics } from './requestContext';
import { createCategoryLogger } from './logger';
import { getCircularReplacer } from './errorHandlingUtils';

// Import the shared DiagnosticsInfo from the types directory
import { DiagnosticsInfo as SharedDiagnosticsInfo } from '../types/diagnostics';

/**
 * Interface for diagnostics information
 */
export type DiagnosticsInfo = SharedDiagnosticsInfo;

/**
 * Interface for debug configuration
 */
export interface DebugInfo {
  isEnabled: boolean;
  isVerbose?: boolean;
  includeHeaders?: boolean;
  includePerformance?: boolean;
}

// Create a category-specific logger for DebugHeadersUtils
const logger = createCategoryLogger('DebugHeadersUtils');
const { debug: logDebug, error: logError } = logger;

/**
 * Add debug headers to a Response
 * This is the primary function for adding debug headers to a response,
 * centralizing logic that was spread across multiple files.
 *
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

  // Log debug header addition
  logDebug('Adding debug headers', {
    isVerbose: debugInfo.isVerbose,
    includeHeaders: debugInfo.includeHeaders,
    includePerformance: debugInfo.includePerformance,
  });

  // Get the request context for performance metrics if available
  const requestContext = getCurrentContext();
  let performanceMetrics;

  if (requestContext && diagnosticsInfo) {
    // Get performance metrics synchronously to avoid timing issues
    try {
      performanceMetrics = getPerformanceMetrics(requestContext);

      // Add performance metrics to diagnostics
      if (performanceMetrics) {
        diagnosticsInfo.performanceMetrics = performanceMetrics;
      }
    } catch (err) {
      logError('Error getting performance metrics', { error: String(err) });
    }
  }

  // Create a new response with the same body but new headers
  const headers = new Headers(response.headers);

  // Basic debug headers
  headers.set('X-Video-Resizer-Debug', 'true');
  headers.set('X-Video-Resizer-Version', '1.0.0');

  // Add request ID if available from context
  if (requestContext?.requestId) {
    headers.set('X-Request-ID', requestContext.requestId);
  }

  // Add processing time if available
  if (diagnosticsInfo.processingTimeMs !== undefined) {
    headers.set('X-Processing-Time-Ms', diagnosticsInfo.processingTimeMs.toString());
  } else if (requestContext) {
    // If no explicit processing time is provided, calculate it from the context
    const endTime = performance.now();
    const processingTimeMs = Math.round(endTime - requestContext.startTime);
    headers.set('X-Processing-Time-Ms', processingTimeMs.toString());
    diagnosticsInfo.processingTimeMs = processingTimeMs;
  }

  // Add breadcrumbs count if available
  if (requestContext?.breadcrumbs) {
    headers.set('X-Breadcrumbs-Count', requestContext.breadcrumbs.length.toString());
  }

  // Add performance metrics if available and requested
  if ((debugInfo.includePerformance || debugInfo.isVerbose) && performanceMetrics) {
    headers.set('X-Total-Duration-Ms', performanceMetrics.totalElapsedMs.toString());

    // Add component timing as JSON if requested
    if (performanceMetrics.componentTiming) {
      headers.set('X-Component-Timing', JSON.stringify(performanceMetrics.componentTiming));

      // Add top components individually
      const topComponents = Object.entries(performanceMetrics.componentTiming)
        .sort(([, timeA], [, timeB]) => Number(timeB) - Number(timeA))
        .slice(0, 3);

      topComponents.forEach(([component, time], index) => {
        headers.set(`X-Component-${index + 1}-Time`, `${component}=${Number(time).toFixed(2)}ms`);
      });
    }
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

  // Add cache version if available
  if (diagnosticsInfo.cacheVersion !== undefined) {
    headers.set('X-Cache-Version', diagnosticsInfo.cacheVersion.toString());
  }

  // Add cache tags info
  if (diagnosticsInfo.cacheTags && diagnosticsInfo.cacheTags.length > 0) {
    // Add as X-Cache-Tags header for debugging
    headers.set('X-Cache-Tags', diagnosticsInfo.cacheTags.join(','));

    // Also expose the actual Cache-Tag to the client when debug is enabled
    // This should match what Cloudflare uses internally
    const cacheTagValue = diagnosticsInfo.cacheTags.join(',');
    if (!headers.has('Cache-Tag')) {
      headers.set('Cache-Tag', cacheTagValue);
    }
  }

  // Add caching method info
  if (diagnosticsInfo.cachingMethod) {
    headers.set('X-Cache-Method', diagnosticsInfo.cachingMethod);
  }

  // Add fallback information if available
  if (diagnosticsInfo.fallbackApplied) {
    headers.set('X-Fallback-Applied', 'true');
    if (diagnosticsInfo.fallbackReason) {
      headers.set('X-Fallback-Reason', diagnosticsInfo.fallbackReason.toString());
    }
  }

  // Add client capability detection results
  if (diagnosticsInfo.clientHints !== undefined) {
    headers.set('X-Client-Hints-Available', diagnosticsInfo.clientHints.toString());
  }

  // If verbose mode is enabled, add more detailed headers
  if (debugInfo.isVerbose) {
    // Include responsive sizing info if available
    if (
      diagnosticsInfo.responsiveSize &&
      typeof diagnosticsInfo.responsiveSize === 'object' &&
      'width' in diagnosticsInfo.responsiveSize &&
      'height' in diagnosticsInfo.responsiveSize &&
      'source' in diagnosticsInfo.responsiveSize
    ) {
      const responsiveSize = diagnosticsInfo.responsiveSize as Record<string, unknown>;
      const width = responsiveSize.width;
      const height = responsiveSize.height;
      const source = responsiveSize.source;
      headers.set('X-Responsive-Width', String(width));
      headers.set('X-Responsive-Height', String(height));
      headers.set('X-Responsive-Method', String(source));
    }

    // Include transform parameters in a JSON-encoded header
    if (diagnosticsInfo.transformParams) {
      // If cdnCgiUrl is available, extract and include the actual transform parameters from it
      if (diagnosticsInfo.cdnCgiUrl) {
        try {
          // Parse the CDN-CGI URL to extract the actual parameters used
          const cdnCgiUrl = diagnosticsInfo.cdnCgiUrl;
          const transformParamsMatch = cdnCgiUrl.match(/\/cdn-cgi\/media\/([^/]+)\//);
          if (transformParamsMatch && transformParamsMatch[1]) {
            const transformParamsString = transformParamsMatch[1];
            const parsedParams: Record<string, string> = {};

            // Parse the comma-separated parameters (e.g., width=640,height=480)
            transformParamsString.split(',').forEach((param) => {
              const [key, value] = param.split('=');
              if (key && value) {
                parsedParams[key] = value;
              }
            });

            // Include both the requested and actual parameters for transparency
            diagnosticsInfo.actualTransformParams = parsedParams;

            // If we have transformation parameters with width and height, add original video dimensions
            // for comparison (if not already set)
            if (!diagnosticsInfo.videoInfo && (parsedParams.width || parsedParams.height)) {
              // Create basic video info if absent
              diagnosticsInfo.videoInfo = diagnosticsInfo.videoInfo || {};

              // If width or height are parameters, assume they might be the original dimensions
              // (this is a heuristic approximation for comparison purposes)
              if (parsedParams.width && !diagnosticsInfo.videoInfo.width) {
                const originalWidth = Number(parsedParams.width) * 2; // Approximate original dimension
                if (!isNaN(originalWidth)) {
                  diagnosticsInfo.videoInfo.width = originalWidth;
                }
              }

              if (parsedParams.height && !diagnosticsInfo.videoInfo.height) {
                const originalHeight = Number(parsedParams.height) * 2; // Approximate original dimension
                if (!isNaN(originalHeight)) {
                  diagnosticsInfo.videoInfo.height = originalHeight;
                }
              }
            }
          }
        } catch (e) {
          // If parsing fails, fall back to the original transform params
          logError('Failed to parse CDN-CGI URL for transform parameters', {
            error: String(e),
            cdnCgiUrl: diagnosticsInfo.cdnCgiUrl?.split('?')[0], // Don't include query parameters for security
          });
        }
      }

      headers.set('X-Transform-Params', JSON.stringify(diagnosticsInfo.transformParams));
      if (diagnosticsInfo.actualTransformParams) {
        headers.set(
          'X-Actual-Transform-Params',
          JSON.stringify(diagnosticsInfo.actualTransformParams)
        );
      }
    }

    // Include browser capabilities
    if (diagnosticsInfo.browserCapabilities) {
      headers.set('X-Browser-Capabilities', JSON.stringify(diagnosticsInfo.browserCapabilities));
    }

    // Include content negotiation info
    if (diagnosticsInfo.videoFormat) {
      headers.set('X-Video-Format', diagnosticsInfo.videoFormat);
    }

    if (
      diagnosticsInfo.estimatedBitrate !== undefined &&
      diagnosticsInfo.estimatedBitrate !== null
    ) {
      headers.set('X-Estimated-Bitrate', diagnosticsInfo.estimatedBitrate.toString());
    }

    // Include any errors or warnings
    if (diagnosticsInfo.errors && diagnosticsInfo.errors.length > 0) {
      headers.set('X-Debug-Errors', JSON.stringify(diagnosticsInfo.errors));
    }

    if (diagnosticsInfo.warnings && diagnosticsInfo.warnings.length > 0) {
      headers.set('X-Debug-Warnings', JSON.stringify(diagnosticsInfo.warnings));
    }

    // Include breadcrumbs data in verbose mode
    if (requestContext?.breadcrumbs) {
      addBreadcrumbHeaders(headers, requestContext.breadcrumbs);
    }
  }

  // Include request headers if configured
  if (debugInfo.includeHeaders && diagnosticsInfo.requestHeaders) {
    addJsonChunkedHeader(headers, 'X-Request-Headers', diagnosticsInfo.requestHeaders);
  }

  // Return a new response with the updated headers
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * Helper function to add breadcrumb information as headers
 * @param headers Headers object to modify
 * @param breadcrumbs Breadcrumbs array
 */
function addBreadcrumbHeaders(headers: Headers, breadcrumbs: unknown[]): void {
  // For large breadcrumb collections, we need to chunk the data
  addJsonChunkedHeader(headers, 'X-Breadcrumbs', breadcrumbs);
}

/**
 * Helper function to add a large JSON object as chunked headers
 * @param headers Headers object to modify
 * @param headerPrefix Prefix for the header name
 * @param data Data to stringify and chunk
 * @param chunkSize Maximum chunk size (default: 500)
 */
function addJsonChunkedHeader(
  headers: Headers,
  headerPrefix: string,
  data: Record<string, unknown> | unknown[],
  chunkSize = 500
): void {
  const json = JSON.stringify(data);

  if (json.length <= chunkSize) {
    // Small enough to include directly
    headers.set(headerPrefix, json);
  } else {
    // Split into chunks
    const chunks = Math.ceil(json.length / chunkSize);
    for (let i = 0; i < chunks; i++) {
      const chunk = json.substring(i * chunkSize, (i + 1) * chunkSize);
      headers.set(`${headerPrefix}-${i + 1}`, chunk);
    }
    headers.set(`${headerPrefix}-Count`, chunks.toString());
  }
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
 * This is moved from debugService.ts to centralize all debug-related functionality
 *
 * @param diagnosticsInfo The diagnostics information
 * @param env Environment with ASSETS binding (optional)
 * @param isError Whether this is an error report (optional)
 * @returns Response with the debug report
 */
export async function createDebugReport(
  diagnosticsInfo: DiagnosticsInfo,
  env?: { ASSETS?: { fetch: (request: Request) => Promise<Response> } },
  isError: boolean = false
): Promise<Response> {
  // Add breadcrumb if we have a request context
  const requestContext = getCurrentContext();
  if (requestContext) {
    addBreadcrumb(requestContext, 'Response', 'Generating debug report', {
      isError,
      debugEnabled: true,
      pageType: isError ? 'error' : 'standard',
      hasDiagnostics: !!diagnosticsInfo,
      diagnosticsSize: Object.keys(diagnosticsInfo || {}).length,
    });
  }

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
          headers: new Headers({ Accept: 'text/html' }),
        })
      );

      if (debugResponse.ok) {
        const html = await debugResponse.text();

        // Safely serialize the diagnostics info without circular references
        // Create a clean copy of diagnostics with important properties preserved
        const cleanDiagnostics = { ...diagnosticsInfo };

        // Make sure critical timing information is included
        if (requestContext) {
          // Always calculate and set processingTimeMs to ensure it's accurate when displayed
          const endTime = performance.now();
          const processingTimeMs = Math.round(endTime - requestContext.startTime);
          cleanDiagnostics.processingTimeMs = processingTimeMs;

          // Also include component timing information if available
          if (requestContext.componentTiming) {
            cleanDiagnostics.componentTiming = requestContext.componentTiming;
          }
        }

        const safeJsonString = JSON.stringify(cleanDiagnostics, getCircularReplacer())
          .replace(/</g, '\\u003c') // Escape < to avoid closing script tags
          .replace(/>/g, '\\u003e') // Escape > to avoid closing script tags
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
          status: isError ? 500 : 200,
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store',
          },
        });
      }
    } catch (error) {
      logError('Error loading debug UI from assets', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
    }
  }

  // Fallback to a simple JSON response if assets aren't available
  return new Response(
    JSON.stringify(
      {
        message: 'Debug UI could not be loaded. Raw diagnostic data is provided below.',
        diagnostics: diagnosticsInfo,
      },
      null,
      2
    ),
    {
      status: isError ? 500 : 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
    }
  );
}

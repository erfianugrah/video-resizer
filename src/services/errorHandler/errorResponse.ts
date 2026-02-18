/**
 * Functions for creating appropriate error responses
 */
import { VideoTransformError, ErrorType } from '../../errors';
import { withErrorHandling, getCircularReplacer } from '../../utils/errorHandlingUtils';
import { getCurrentContext, addBreadcrumb } from '../../utils/requestContext';
import type { DebugInfo, DiagnosticsInfo } from '../../utils/debugHeadersUtils';
import { createCategoryLogger } from '../../utils/logger';
const logger = createCategoryLogger('ErrorHandler');
import { normalizeError } from './normalizeError';
import { fetchOriginalContentFallback } from './fallbackContent';
import { addDebugHeaders } from '../debugService';

/**
 * Implementation of createErrorResponse that might throw errors
 * This is the main entry point for handling errors throughout the application
 */
async function createErrorResponseImpl(
  err: unknown,
  request: Request,
  debugInfo?: DebugInfo,
  diagnosticsInfo?: DiagnosticsInfo,
  env?: {
    ASSETS?: {
      fetch: (request: Request) => Promise<Response>;
    };
  }
): Promise<Response> {
  // Normalize the error
  const normalizedError = normalizeError(err, { originalUrl: request.url });

  // Add breadcrumb for error normalization
  const requestContext = getCurrentContext();
  if (requestContext) {
    addBreadcrumb(requestContext, 'Error', 'Error normalized', {
      errorType: normalizedError.errorType,
      statusCode: normalizedError.statusCode,
      url: request.url,
    });
  }

  // Log error processing request
  logger.error('Error processing request', {
    error: normalizedError.message,
    errorType: normalizedError.errorType,
    statusCode: normalizedError.statusCode,
    context: normalizedError.context,
    stack: normalizedError instanceof Error ? normalizedError.stack : undefined,
    url: request.url,
  });

  // Initialize diagnostics if not provided
  const diagInfo = diagnosticsInfo || {
    errors: [normalizedError.message],
    warnings: [],
    originalUrl: request.url,
    processingTimeMs: 0,
  };

  // Get the original URL if available in diagnostics, otherwise use request URL
  const originalUrl = diagInfo.originalUrl || request.url;

  // Check if we should apply the fallback logic
  // Import configuration manager to check if fallback is enabled
  // Using dynamic import to allow for mocking in tests
  let caching;
  let fallbackConfig;

  try {
    const { VideoConfigurationManager } = await import('../../config');
    const config = VideoConfigurationManager.getInstance();
    caching = config.getCachingConfig();
    fallbackConfig = caching?.fallback;
  } catch (configError) {
    // If there's an error loading the config, log it and check for mocked config in tests
    console.error({
      context: 'ErrorResponse',
      operation: 'generateErrorResponse',
      message: 'Error loading video configuration',
      error:
        configError instanceof Error
          ? { name: configError.name, message: configError.message, stack: configError.stack }
          : String(configError),
    });

    try {
      // This is to support the mocked import in tests
      const config = await import('../../config');
      const configManager = config.VideoConfigurationManager.getInstance();
      caching = configManager.getCachingConfig();
      fallbackConfig = caching?.fallback;
    } catch (secondConfigError) {
      console.error({
        context: 'ErrorResponse',
        operation: 'generateErrorResponse',
        message: 'Failed to load configuration after retry',
        error:
          secondConfigError instanceof Error
            ? {
                name: secondConfigError.name,
                message: secondConfigError.message,
                stack: secondConfigError.stack,
              }
            : String(secondConfigError),
      });
      // Set default values when config cannot be loaded (especially in tests)
      caching = { method: 'unknown' };
      fallbackConfig = { enabled: false };
    }
  }

  // Log the configuration to help with debugging
  logger.debug('Caching config loaded', {
    method: caching?.method,
    debug: caching?.debug,
    fallbackEnabled: fallbackConfig?.enabled,
    badRequestOnly: fallbackConfig?.badRequestOnly,
    preserveHeaders: fallbackConfig?.preserveHeaders?.length || 0,
  });

  // If fallback is enabled, try to fetch original content
  if (fallbackConfig?.enabled) {
    const isServerError = normalizedError.statusCode >= 500 && normalizedError.statusCode < 600;

    // Apply fallback based on configuration and error type
    // Either badRequestOnly is false (handle all errors) OR
    // It's a 400 error OR it's a 500 error (server error)
    if (!fallbackConfig.badRequestOnly || normalizedError.statusCode === 400 || isServerError) {
      // Log fallback attempt
      logger.debug('Attempting fallback for error', {
        statusCode: normalizedError.statusCode,
        isServerError,
        errorType: normalizedError.errorType,
        badRequestOnly: fallbackConfig.badRequestOnly,
        maxRetries: fallbackConfig.maxRetries || 0,
      });

      const fallbackResponse = await fetchOriginalContentFallback(
        originalUrl,
        normalizedError,
        request
      );

      // If fallback was successful, use it instead of error response
      if (fallbackResponse) {
        // Add debug headers if debug is enabled
        if (debugInfo?.isEnabled) {
          // Add the fallback information to diagnostics
          diagInfo.warnings = diagInfo.warnings || [];
          diagInfo.warnings.push('Returned original content due to transformation failure');
          diagInfo.fallbackApplied = true;
          diagInfo.fallbackReason = normalizedError.message;

          return addDebugHeaders(fallbackResponse, debugInfo, diagInfo);
        }

        return fallbackResponse;
      }
    }
  }

  // Check if this is a debug view request
  const url = new URL(request.url);
  const isDebugView =
    url.searchParams.has('debug') &&
    (url.searchParams.get('debug') === 'view' || url.searchParams.get('debug') === 'true');

  // Return debug HTML if requested and debug is enabled
  if (isDebugView && debugInfo?.isEnabled) {
    // Add error to diagnostics
    diagInfo.errors = diagInfo.errors || [];
    if (!diagInfo.errors.includes(normalizedError.message)) {
      diagInfo.errors.push(normalizedError.message);
    }

    // Use the ASSETS binding for the Astro-based debug UI
    if (env?.ASSETS) {
      // Create a new URL for the debug.html page
      const debugUrl = new URL(request.url);
      debugUrl.pathname = '/debug.html';

      // Fetch the debug HTML page
      const debugResponse = await env.ASSETS.fetch(
        new Request(debugUrl.toString(), {
          method: 'GET',
          headers: new Headers({ Accept: 'text/html' }),
        })
      );

      if (debugResponse.ok) {
        const html = await debugResponse.text();

        const safeJsonString = JSON.stringify(diagInfo, getCircularReplacer())
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
              console.log('Debug data loaded from worker (error):', typeof window.DIAGNOSTICS_DATA);
            </script>`
          );
        } else {
          htmlWithData = html.replace(
            '<body',
            `<body data-debug="true" data-error="true"><script type="text/javascript">
              // Pre-load diagnostic data
              window.DIAGNOSTICS_DATA = ${safeJsonString};
              console.log('Debug data loaded from worker (error):', typeof window.DIAGNOSTICS_DATA);
            </script>`
          );
        }

        return new Response(htmlWithData, {
          status: normalizedError.statusCode,
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store',
            'X-Error-Type': normalizedError.errorType,
          },
        });
      }
    }

    // Fallback to a simple error response with the diagnostics info as JSON
    return new Response(
      `<html><body><h1>Error</h1><p>${normalizedError.message}</p><h2>Debug Data</h2><pre>${JSON.stringify(diagInfo, null, 2)}</pre></body></html>`,
      {
        status: normalizedError.statusCode,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
          'X-Error-Type': normalizedError.errorType,
        },
      }
    );
  }

  // Add debug headers if debug is enabled
  if (debugInfo?.isEnabled) {
    const response = normalizedError.toResponse();
    return addDebugHeaders(response, debugInfo, diagInfo);
  }

  // Return a normal error response
  return normalizedError.toResponse();
}

/**
 * Create an appropriate error response based on the error type
 * This is the main entry point for handling errors throughout the application
 */
export const createErrorResponse = withErrorHandling<
  [
    unknown,
    Request,
    DebugInfo?,
    DiagnosticsInfo?,
    { ASSETS?: { fetch: (request: Request) => Promise<Response> } }?,
  ],
  Response
>(
  createErrorResponseImpl,
  {
    functionName: 'createErrorResponse',
    component: 'ErrorHandlerService',
    logErrors: true,
  },
  {
    operation: 'create_error_response',
  }
);

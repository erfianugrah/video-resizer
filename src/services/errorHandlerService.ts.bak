/**
 * Service for handling errors consistently across the application
 */
import { VideoTransformError, ErrorType, ProcessingError } from '../errors';
import { getCurrentContext } from '../utils/legacyLoggerAdapter';
import { createLogger, debug as pinoDebug, error as pinoError } from '../utils/pinoLogger';
import type { DebugInfo, DiagnosticsInfo } from '../utils/debugHeadersUtils';
import { 
  logErrorWithContext, 
  withErrorHandling, 
  tryOrNull,
  tryOrDefault
} from '../utils/errorHandlingUtils';
import { RequestContext, addBreadcrumb } from '../utils/requestContext';
import { parseErrorMessage, isDurationLimitError, adjustDuration, storeTransformationLimit } from '../utils/transformationUtils';
import { fetchVideo } from './videoStorageService';
import { VideoConfigurationManager } from '../config';
import { prepareVideoTransformation } from './TransformationService';
import { cacheResponse } from './cacheManagementService';
import { VideoTransformContext } from '../domain/commands/TransformVideoCommand';

/**
 * Helper functions for consistent logging throughout this file
 * These helpers handle context availability and fallback gracefully
 */

/**
 * Log a debug message with proper context handling
 */
function logDebug(category: string, message: string, data?: Record<string, unknown>) {
  const requestContext = getCurrentContext();
  if (requestContext) {
    const logger = createLogger(requestContext);
    pinoDebug(requestContext, logger, category, message, data);
  } else {
    // Fall back to console as a last resort
    console.debug(`[${category}] ${message}`, data || {});
  }
}

/**
 * Log an error message with proper context handling
 */
function logError(category: string, message: string, data?: Record<string, unknown>) {
  const requestContext = getCurrentContext();
  if (requestContext) {
    const logger = createLogger(requestContext);
    pinoError(requestContext, logger, category, message, data);
  } else {
    // Fall back to console as a last resort
    console.error(`[${category}] ${message}`, data || {});
  }
}

/**
 * Implementation of normalizeError that might throw errors
 */
function normalizeErrorImpl(err: unknown, context: Record<string, unknown> = {}): VideoTransformError {
  // If it's already a VideoTransformError, return it
  if (err instanceof VideoTransformError) {
    return err;
  }
  
  // If it's another type of Error, convert it
  if (err instanceof Error) {
    return ProcessingError.fromError(err, ErrorType.UNKNOWN_ERROR, context);
  }
  
  // If it's a string or other value, create a new error
  const message = typeof err === 'string' ? err : 'Unknown error occurred';
  return new VideoTransformError(message, ErrorType.UNKNOWN_ERROR, context);
}

/**
 * Convert any error to a VideoTransformError
 * Uses standardized error handling for consistent logging
 * This is a utility function to ensure consistent error handling across the application
 */
export const normalizeError = tryOrDefault<
  [unknown, Record<string, unknown>?],
  VideoTransformError
>(
  normalizeErrorImpl,
  {
    functionName: 'normalizeError',
    component: 'ErrorHandlerService',
    logErrors: true
  },
  new VideoTransformError('Error normalization failed', ErrorType.UNKNOWN_ERROR, {})
);

/**
 * Implementation of fetchOriginalContentFallback that might throw errors
 * 
 * @param originalUrl - The original URL before transformation attempt
 * @param error - The error that occurred during transformation
 * @param request - The original request
 * @param retryCount - Current retry count for server errors (default 0)
 * @returns A response with the original content, or null if fallback should not be applied
 */
async function fetchOriginalContentFallbackImpl(
  originalUrl: string, 
  error: VideoTransformError, 
  request: Request,
  retryCount: number = 0
): Promise<Response | null> {
  // Import configuration manager to check if fallback is enabled
  const { VideoConfigurationManager } = await import('../config');
  const config = VideoConfigurationManager.getInstance();
  const caching = config.getCachingConfig();
  const fallbackConfig = caching?.fallback;
  
  // Log configuration loaded for fallback
  logDebug('ErrorHandlerService', 'Configuration loaded for fallback', {
    errorStatus: error.statusCode,
    errorType: error.errorType,
    cachingMethod: caching?.method,
    fallbackEnabled: fallbackConfig?.enabled,
    badRequestOnly: fallbackConfig?.badRequestOnly,
    maxRetries: fallbackConfig?.maxRetries || 0,
    currentRetry: retryCount
  });
  
  // Check if fallback is enabled in config
  if (!fallbackConfig || !fallbackConfig.enabled) {
    logDebug('ErrorHandlerService', 'Fallback disabled in config, skipping');
    return null;
  }
  
  // Log the fallback URL attempt for debugging
  logDebug('ErrorHandlerService', 'Preparing fallback with original URL', {
    originalUrl,
    fallbackEnabled: true,
    errorStatus: error.statusCode,
    errorType: error.errorType
  });
  
  // For server errors (5xx), retry the transformation if we haven't reached max retries
  const isServerError = error.statusCode >= 500 && error.statusCode < 600;
  const maxRetries = fallbackConfig.maxRetries || 0;
  
  if (isServerError && retryCount < maxRetries) {
    // Implement retry logic for server errors
    logDebug('ErrorHandlerService', 'Server error detected, retrying transformation', {
      errorStatus: error.statusCode,
      errorType: error.errorType,
      retryCount: retryCount,
      maxRetries: maxRetries
    });
    
    try {
      // First determine video options from the request
      const { determineVideoOptions } = await import('../handlers/videoOptionsService');
      
      // Get URL for determining options
      const url = new URL(request.url);
      const params = url.searchParams;
      const path = url.pathname;
      
      // Determine video options
      const videoOptions = determineVideoOptions(request, params, path);
      
      // Get the path patterns
      const { VideoConfigurationManager } = await import('../config');
      const pathPatterns = VideoConfigurationManager.getInstance().getPathPatterns();
      
      // Now import the transformation service
      const { transformVideo } = await import('./videoTransformationService');
      
      // Create debug info object
      const debugInfo = {
        isEnabled: false, // Enable debugging only if explicitly needed
        isVerbose: false,
        includeTiming: true,
        includeHeaders: true
      };
      
      // Create a minimal env object for transformVideo
      const env = { 
        ASSETS: undefined // No ASSETS binding required for retry
      };
      
      // Attempt to transform the video again using the service
      const transformedResponse = await transformVideo(request, videoOptions, pathPatterns, debugInfo, env);
      
      if (transformedResponse && transformedResponse.ok) {
        logDebug('ErrorHandlerService', 'Retry transformation successful', {
          retryCount: retryCount + 1,
          status: transformedResponse.status
        });
        
        // Add retry info header
        const headers = new Headers(transformedResponse.headers);
        headers.set('X-Retry-Count', (retryCount + 1).toString());
        
        return new Response(transformedResponse.body, {
          status: transformedResponse.status,
          statusText: transformedResponse.statusText,
          headers
        });
      }
      
      // If still failing, retry with increased retry count or fall back
      if (retryCount + 1 < maxRetries) {
        logDebug('ErrorHandlerService', 'Retry failed, attempting again', {
          retryCount: retryCount + 1,
          maxRetries: maxRetries
        });
        
        // Recursively call with increased retry count
        return fetchOriginalContentFallbackImpl(originalUrl, error, request, retryCount + 1);
      }
      
      logDebug('ErrorHandlerService', 'Maximum retries reached, falling back to original content', {
        retryCount: retryCount,
        maxRetries: maxRetries
      });
    } catch (retryError) {
      logError('ErrorHandlerService', 'Error during retry attempt', {
        error: retryError instanceof Error ? retryError.message : String(retryError),
        retryCount: retryCount
      });
    }
  }
  
  // Only apply fallback for 400 Bad Request errors if badRequestOnly is true
  if (fallbackConfig.badRequestOnly && error.statusCode !== 400) {
    // Skip fallback for non-400 errors when badRequestOnly is true
    logDebug('ErrorHandlerService', 'Error not eligible for fallback', {
      errorStatus: error.statusCode,
      badRequestOnly: fallbackConfig.badRequestOnly,
      isServerError: isServerError
    });
    return null;
  }

  logDebug('ErrorHandlerService', 'Fetching original content as fallback', {
    originalUrl,
    errorType: error.errorType,
    errorMessage: error.message,
    config: {
      enabled: fallbackConfig.enabled,
      badRequestOnly: fallbackConfig.badRequestOnly
    }
  });

  // Create a new request for the original content
  const originalRequest = new Request(originalUrl, {
    method: request.method,
    headers: request.headers,
    redirect: 'follow'
  });

  // Log detailed information about the original request before fetching
  logDebug('ErrorHandlerService', 'Original request details for fallback', {
    originalUrl,
    method: request.method,
    headersIncluded: Array.from(request.headers.keys()),
    hasRange: request.headers.has('Range'),
    rangeValue: request.headers.get('Range'),
    isConditional: request.headers.has('If-None-Match') || request.headers.has('If-Modified-Since'),
    requestId: Math.random().toString(36).substring(2, 10)
  });

  // Fetch the original content
  const response = await fetch(originalRequest);
  
  // Log detailed response information
  logDebug('ErrorHandlerService', 'Original content response details', {
    status: response.status,
    statusText: response.statusText,
    contentType: response.headers.get('Content-Type'),
    contentLength: response.headers.get('Content-Length'),
    isError: !response.ok,
    errorCategory: !response.ok ? Math.floor(response.status / 100) * 100 : undefined,
    cacheStatus: response.headers.get('CF-Cache-Status'),
    etag: response.headers.get('ETag'),
    headersReceived: Array.from(response.headers.keys())
  });

  // Create new headers
  const headers = new Headers();
  
  // Determine which headers to preserve
  const preserveHeaders = fallbackConfig.preserveHeaders || 
    ['Content-Type', 'Content-Length', 'Content-Range', 'Accept-Ranges'];
  
  // Copy preserved headers from original response
  preserveHeaders.forEach((headerName: string) => {
    const headerValue = response.headers.get(headerName);
    if (headerValue) {
      headers.set(headerName, headerValue);
    }
  });
  
  // Import error parsing utility
  const { parseErrorMessage } = await import('../utils/transformationUtils');
  
  // Check if the error message is from Cloudflare's API
  const parsedError = parseErrorMessage(error.message);
  const fallbackReason = parsedError.specificError || error.message;
  
  // Add fallback-specific headers
  headers.set('X-Fallback-Applied', 'true');
  headers.set('X-Fallback-Reason', fallbackReason);
  headers.set('X-Original-Error-Type', error.errorType);
  headers.set('X-Original-Status-Code', error.statusCode.toString());
  
  // Add more specific headers if available
  if (parsedError.errorType) {
    headers.set('X-Error-Type', parsedError.errorType);
  }
  
  if (parsedError.parameter) {
    headers.set('X-Invalid-Parameter', parsedError.parameter);
  }
  
  // Legacy headers for backward compatibility
  if (parsedError.errorType === 'file_size_limit') {
    headers.set('X-Video-Too-Large', 'true');
  }
  
  // Cache the original fallback content in Cache API with its own cache key
  // This will allow future requests to fall back to this cached original if transformation fails again
  const cacheOriginalContent = async (originalResponse: Response, originalUrl: string) => {
    // Create a fallback cache key - transform the URL to indicate it's a fallback
    // This creates a separate cache entry for the original content
    const fallbackCacheKey = new URL(originalUrl);
    fallbackCacheKey.searchParams.set('__fb', '1'); // Add fallback marker
    
    // Clone the response for caching
    // Create new headers for the cache entry
    const cacheHeaders = new Headers(originalResponse.headers);
    
    // Add cache tags for fallback content to enable purging
    // Format: "video-resizer,fallback:true,source:path"
    const source = new URL(originalUrl).pathname;
    const cacheTags = `video-resizer,fallback:true,source:${source}`;
    cacheHeaders.set('Cache-Tag', cacheTags);
    
    // Create the response to cache with the enhanced headers
    const responseToCache = new Response(originalResponse.clone().body, {
      status: originalResponse.status,
      statusText: originalResponse.statusText,
      headers: cacheHeaders
    });
    
    try {
      // Use Cache API directly - we don't want to use KV for these potentially large files
      const cache = caches.default;
      
      // Create a request with the fallback cache key for storing
      const fallbackRequest = new Request(fallbackCacheKey.toString(), {
        method: 'GET',
        headers: request.headers
      });
      
      // Store in Cache API
      await cache.put(fallbackRequest, responseToCache);
      
      logDebug('ErrorHandlerService', 'Cached original content for future fallbacks', {
        originalUrl,
        fallbackCacheKey: fallbackCacheKey.toString(),
        status: originalResponse.status,
        contentType: originalResponse.headers.get('Content-Type'),
        contentLength: originalResponse.headers.get('Content-Length')
      });
      
      return true;
    } catch (cacheError) {
      logError('ErrorHandlerService', 'Failed to cache original content', {
        error: cacheError instanceof Error ? cacheError.message : String(cacheError),
        originalUrl,
        fallbackCacheKey: fallbackCacheKey.toString()
      });
      return false;
    }
  };
  
  // Check if we should try the Cache API for a previously cached original
  const checkForCachedOriginal = async (): Promise<Response | null> => {
    try {
      // Create a fallback cache key to check
      const fallbackCacheKey = new URL(originalUrl);
      fallbackCacheKey.searchParams.set('__fb', '1'); // Add fallback marker
      
      // Create a request with the fallback cache key
      const fallbackRequest = new Request(fallbackCacheKey.toString(), {
        method: 'GET',
        headers: request.headers
      });
      
      // Try to find in Cache API
      const cache = caches.default;
      const cachedFallback = await cache.match(fallbackRequest);
      
      if (cachedFallback) {
        logDebug('ErrorHandlerService', 'Found cached original content for fallback', {
          fallbackCacheKey: fallbackCacheKey.toString(),
          status: cachedFallback.status,
          contentType: cachedFallback.headers.get('Content-Type'),
          contentLength: cachedFallback.headers.get('Content-Length')
        });
        
        return cachedFallback;
      }
      
      return null;
    } catch (checkError) {
      logError('ErrorHandlerService', 'Error checking for cached original', {
        error: checkError instanceof Error ? checkError.message : String(checkError),
        originalUrl
      });
      return null;
    }
  };
  
  // If this is a retry, attempt to use a previously cached original first
  if (retryCount > 0) {
    const cachedOriginal = await checkForCachedOriginal();
    if (cachedOriginal) {
      // Use the cached original with our custom headers
      const cachedHeaders = new Headers(cachedOriginal.headers);
      
      // Copy over all our custom headers
      Array.from(headers.entries()).forEach(([key, value]) => {
        cachedHeaders.set(key, value);
      });
      
      // Add specific header to indicate we're using a cached original
      cachedHeaders.set('X-Fallback-Cache-Hit', 'true');
      
      // Expose the Cache-Tag in the response headers if it exists
      const cacheTag = cachedOriginal.headers.get('Cache-Tag');
      if (cacheTag) {
        cachedHeaders.set('Cache-Tag', cacheTag);
      } else {
        // If no cache tag exists, create one for consistency
        const source = new URL(originalUrl).pathname;
        const fallbackCacheTag = `video-resizer,fallback:true,source:${source}`;
        cachedHeaders.set('Cache-Tag', fallbackCacheTag);
      }
      
      logDebug('ErrorHandlerService', 'Using cached original content for fallback', {
        originalUrl,
        retryCount,
        status: cachedOriginal.status,
        contentType: cachedOriginal.headers.get('Content-Type')
      });
      
      return new Response(cachedOriginal.body, {
        status: cachedOriginal.status,
        statusText: cachedOriginal.statusText,
        headers: cachedHeaders
      });
    }
  }
  
  // Get execution context if available for background processing
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ctx = (request as any).executionCtx || (request as any).ctx;
  
  // Cache the original content for future fallbacks
  if (ctx && typeof ctx.waitUntil === 'function') {
    // Store in background with waitUntil
    logDebug('ErrorHandlerService', 'Caching original content in background', {
      originalUrl,
      hasExecutionContext: true
    });
    
    ctx.waitUntil(cacheOriginalContent(response, originalUrl));
  } else {
    // No execution context, try to cache directly but don't block response
    logDebug('ErrorHandlerService', 'No execution context, will attempt direct caching', {
      originalUrl
    });
    
    // Start the caching process without awaiting it
    Promise.resolve().then(() => cacheOriginalContent(response, originalUrl))
      .catch(error => {
        logError('ErrorHandlerService', 'Error in direct caching of original', {
          error: error instanceof Error ? error.message : String(error)
        });
      });
  }
  
  // Add Cache-Control header to prevent caching of fallback response
  headers.set('Cache-Control', 'no-store');
  
  // Add cache tag to the response headers for tracking and purging capabilities
  const source = new URL(originalUrl).pathname;
  const cacheTags = `video-resizer,fallback:true,source:${source}`;
  headers.set('Cache-Tag', cacheTags);

  // Log successful fallback
  logDebug('ErrorHandlerService', 'Successfully fetched fallback content', {
    status: response.status,
    contentType: response.headers.get('Content-Type'),
    preservedHeaders: preserveHeaders
  });
  
  logDebug('ErrorHandlerService', 'Successfully fetched original content', {
    originalUrl,
    status: response.status,
    contentType: response.headers.get('Content-Type'),
    size: response.headers.get('Content-Length')
  });

  // Return new response with modified headers
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

/**
 * Fetch the original content when transformation fails
 * This provides graceful degradation by falling back to the original content
 * For server errors (5xx), it will attempt to retry the transformation before falling back
 * 
 * @param originalUrl - The original URL before transformation attempt
 * @param error - The error that occurred during transformation
 * @param request - The original request
 * @param retryCount - Current retry count for server errors (default 0)
 * @returns A response with the original content, or null if fallback should not be applied
 */
export const fetchOriginalContentFallback = withErrorHandling<
  [string, VideoTransformError, Request, number?],
  Response | null
>(
  fetchOriginalContentFallbackImpl,
  {
    functionName: 'fetchOriginalContentFallback',
    component: 'ErrorHandlerService',
    logErrors: true
  },
  {
    operation: 'fetch_original_content_fallback'
  }
);

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
      fetch: (request: Request) => Promise<Response> 
    } 
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
      url: request.url
    });
  }
  
  // Log error processing request
  logError('ErrorHandlerService', 'Error processing request', {
    error: normalizedError.message,
    errorType: normalizedError.errorType,
    statusCode: normalizedError.statusCode,
    context: normalizedError.context,
    stack: normalizedError instanceof Error ? normalizedError.stack : undefined,
    url: request.url
  });
  
  // Initialize diagnostics if not provided
  const diagInfo = diagnosticsInfo || {
    errors: [normalizedError.message],
    warnings: [],
    originalUrl: request.url,
    processingTimeMs: 0
  };

  // Get the original URL if available in diagnostics, otherwise use request URL
  const originalUrl = diagInfo.originalUrl || request.url;
  
  // Check if we should apply the fallback logic
  // Import configuration manager to check if fallback is enabled
  const { VideoConfigurationManager } = await import('../config');
  const config = VideoConfigurationManager.getInstance();
  const caching = config.getCachingConfig();
  const fallbackConfig = caching?.fallback;
  
  // Log the configuration to help with debugging
  logDebug('FallbackHandler', 'Caching config loaded', {
    method: caching?.method,
    debug: caching?.debug,
    fallbackEnabled: fallbackConfig?.enabled,
    badRequestOnly: fallbackConfig?.badRequestOnly,
    preserveHeaders: fallbackConfig?.preserveHeaders?.length || 0
  });
  
  // If fallback is enabled, try to fetch original content
  if (fallbackConfig?.enabled) {
    const isServerError = normalizedError.statusCode >= 500 && normalizedError.statusCode < 600;
    
    // Apply fallback based on configuration and error type
    // Either badRequestOnly is false (handle all errors) OR
    // It's a 400 error OR it's a 500 error (server error)
    if (!fallbackConfig.badRequestOnly || normalizedError.statusCode === 400 || isServerError) {
      // Log fallback attempt
      logDebug('ErrorHandlerService', 'Attempting fallback for error', {
        statusCode: normalizedError.statusCode,
        isServerError,
        errorType: normalizedError.errorType,
        badRequestOnly: fallbackConfig.badRequestOnly,
        maxRetries: fallbackConfig.maxRetries || 0
      });
      
      const fallbackResponse = await fetchOriginalContentFallback(originalUrl, normalizedError, request);
      
      // If fallback was successful, use it instead of error response
      if (fallbackResponse) {
        // Add debug headers if debug is enabled
        if (debugInfo?.isEnabled) {
          // Add the fallback information to diagnostics
          diagInfo.warnings = diagInfo.warnings || [];
          diagInfo.warnings.push('Returned original content due to transformation failure');
          diagInfo.fallbackApplied = true;
          diagInfo.fallbackReason = normalizedError.message;
          
          // Import debug service functions dynamically to avoid circular dependencies
          const { addDebugHeaders } = await import('./debugService');
          return addDebugHeaders(fallbackResponse, debugInfo, diagInfo);
        }
        
        return fallbackResponse;
      }
    }
  }
  
  // Check if this is a debug view request
  const url = new URL(request.url);
  const isDebugView = url.searchParams.has('debug') && 
                    (url.searchParams.get('debug') === 'view' || 
                      url.searchParams.get('debug') === 'true');
  
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
          headers: new Headers({ 'Accept': 'text/html' })
        })
      );
      
      if (debugResponse.ok) {
        const html = await debugResponse.text();
        
        // Safely serialize the diagnostics info without circular references
        const getCircularReplacer = () => {
          const seen = new WeakSet();
          return (key: any, value: any) => {
            // If the value is an object and not null
            if (typeof value === 'object' && value !== null) {
              // If we've seen this object before, return '[Circular]'
              if (seen.has(value)) {
                return '[Circular]';
              }
              // Otherwise, add it to our set of seen objects
              seen.add(value);
            }
            return value;
          };
        };
        
        const safeJsonString = JSON.stringify(diagInfo, getCircularReplacer())
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
            'X-Error-Type': normalizedError.errorType
          }
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
          'X-Error-Type': normalizedError.errorType
        }
      }
    );
  }
  
  // Add debug headers if debug is enabled
  if (debugInfo?.isEnabled) {
    // Import debug service functions dynamically to avoid circular dependencies
    const { addDebugHeaders } = await import('./debugService');
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
  [unknown, Request, DebugInfo?, DiagnosticsInfo?, { ASSETS?: { fetch: (request: Request) => Promise<Response> } }?],
  Response
>(
  createErrorResponseImpl,
  {
    functionName: 'createErrorResponse',
    component: 'ErrorHandlerService',
    logErrors: true
  },
  {
    operation: 'create_error_response'
  }
);

/**
 * Handles transformation errors, including fallback logic and retries
 * 
 * @param params Error handling parameters
 * @returns Response with appropriate error handling or fallback content
 */
export async function handleTransformationError({
  errorResponse,
  originalRequest,
  context,
  requestContext,
  diagnosticsInfo,
  fallbackOriginUrl,
  cdnCgiUrl,
  source
}: {
  errorResponse: Response;
  originalRequest: Request;
  context: VideoTransformContext;
  requestContext: RequestContext;
  diagnosticsInfo: DiagnosticsInfo;
  fallbackOriginUrl: string | null;
  cdnCgiUrl: string;
  source?: string;
}): Promise<Response> {
  // Get logger from context or create one if needed
  const logger = context.logger || createLogger(requestContext);

  const errorText = await errorResponse.text();
  const parsedError = parseErrorMessage(errorText);
  const status = errorResponse.status;
  const isServerError = status >= 500 && status < 600;
  const isFileSizeError = parsedError.errorType === 'file_size_limit' || errorText.includes('file size limit');

  // Log the initial error
  logErrorWithContext(`Transformation proxy returned ${status}`, { message: errorText }, { requestId: requestContext.requestId, url: cdnCgiUrl }, 'handleTransformationError');
  addBreadcrumb(requestContext, 'Error', 'Transformation Proxy Error', { status, errorText: errorText.substring(0, 100), parsedError });

  // --- Duration Limit Retry Logic ---
  if (isDurationLimitError(errorText) && context.options?.duration) {
    const originalDuration = context.options.duration;
    // Extract the exact upper limit from the error message if possible
    const limitMatch = errorText.match(/between \d+\w+ and ([\d.]+)(\w+)/);
    let adjustedDuration: string | null = null;
    
    if (limitMatch && limitMatch.length >= 3) {
      // Use exactly what the error tells us is the maximum
      const maxValue = parseFloat(limitMatch[1]);
      const unit = limitMatch[2];
      // Use the exact value from the error message
      const exactValue = Math.floor(maxValue); // Just convert to integer for clean values
      if (exactValue > 0) {
        adjustedDuration = `${exactValue}${unit}`;
        // Store this limit for future use
        storeTransformationLimit('duration', 'max', exactValue);
        
        pinoDebug(requestContext, logger, 'handleTransformationError', 'Extracted exact duration limit', { 
          maxValue, 
          unit, 
          exactValue, 
          adjustedDuration,
          originalDuration,
          errorMessage: errorText.substring(0, 100)
        });
      }
    }
    
    // If we couldn't extract the limit from the error, fall back to the standard adjustment
    if (!adjustedDuration) {
      adjustedDuration = adjustDuration(originalDuration);
      pinoDebug(requestContext, logger, 'handleTransformationError', 'Using standard duration adjustment', { 
        originalDuration, 
        adjustedDuration 
      });
    }

    if (adjustedDuration && adjustedDuration !== originalDuration) {
      pinoDebug(requestContext, logger, 'handleTransformationError', 'Attempting retry with adjusted duration', { originalDuration, adjustedDuration });
      addBreadcrumb(requestContext, 'Retry', 'Adjusting duration', { originalDuration, adjustedDuration });

      const adjustedOptions = { ...context.options, duration: adjustedDuration };
      try {
        const transformResult = await prepareVideoTransformation(
          context.request, adjustedOptions, context.pathPatterns, context.debugInfo, context.env
        );
        const adjustedCdnCgiUrl = transformResult.cdnCgiUrl;

        const retryResponse = await cacheResponse(originalRequest, async () => fetch(adjustedCdnCgiUrl));

        if (retryResponse.ok) {
          pinoDebug(requestContext, logger, 'handleTransformationError', 'Retry successful', { adjustedDuration });
          addBreadcrumb(requestContext, 'Retry', 'Duration adjustment successful', { status: retryResponse.status });
          
          // Add adjustment headers and return
          const headers = new Headers(retryResponse.headers);
          headers.set('X-Duration-Adjusted', 'true');
          headers.set('X-Original-Duration', originalDuration);
          headers.set('X-Adjusted-Duration', adjustedDuration);
          headers.set('X-Duration-Limit-Applied', 'true');
          
          return new Response(retryResponse.body, { 
            status: retryResponse.status, 
            statusText: retryResponse.statusText, 
            headers 
          });
        } else {
          logErrorWithContext('Retry with adjusted duration failed', new Error(`Status: ${retryResponse.status}`), { requestId: requestContext.requestId, url: adjustedCdnCgiUrl }, 'handleTransformationError');
          addBreadcrumb(requestContext, 'Retry', 'Duration adjustment failed', { status: retryResponse.status });
        }
      } catch (retryError) {
        logErrorWithContext('Error during duration retry logic', retryError, { requestId: requestContext.requestId }, 'handleTransformationError');
        addBreadcrumb(requestContext, 'Error', 'Duration retry preparation failed', { error: retryError instanceof Error ? retryError.message : String(retryError) });
      }
    }
  }

  // --- Find matched path pattern with its origin and auth for pattern-specific fallback ---
  const url = new URL(originalRequest.url);
  const path = url.pathname;
  let matchedPattern = null;
  
  // Find matching path pattern for potential pattern-specific auth
  try {
    // Import pathUtils to find the matching pattern
    const { findMatchingPathPattern } = await import('../utils/pathUtils');
    matchedPattern = findMatchingPathPattern(path, context.pathPatterns);
    
    pinoDebug(requestContext, logger, 'handleTransformationError', 'Found matching pattern for fallback', { 
      hasPattern: !!matchedPattern,
      patternName: matchedPattern?.name,
      hasOriginUrl: !!matchedPattern?.originUrl,
      hasAuth: !!matchedPattern?.auth?.enabled
    });
  } catch (patternError) {
    logErrorWithContext('Error finding matching pattern for fallback', patternError, { path }, 'handleTransformationError');
  }

  // --- Fallback Logic (Pattern-specific, Direct Fetch, or Storage Service) ---
  let fallbackResponse: Response | undefined;
  let patternFetchAttempted = false;
  
  // First priority: Try pattern-specific origin and auth if available
  if (matchedPattern && matchedPattern.originUrl && matchedPattern.auth?.enabled) {
    patternFetchAttempted = true;
    addBreadcrumb(requestContext, 'Fallback', 'Attempting fetch using matched pattern origin/auth', { 
      pattern: matchedPattern.name, 
      origin: matchedPattern.originUrl, 
      authType: matchedPattern.auth.type 
    });
    
    pinoDebug(requestContext, logger, 'handleTransformationError', 'Attempting pattern-specific fallback', { 
      pattern: matchedPattern.name,
      originUrl: matchedPattern.originUrl,
      authType: matchedPattern.auth.type
    });

    try {
      const originToFetch = matchedPattern.originUrl; // Base origin
      const pathSegment = url.pathname; // Original request path
      
      // Refine URL construction with careful path segment handling
      let s3ObjectPath = pathSegment.startsWith('/') ? pathSegment.substring(1) : pathSegment;
      
      if (originToFetch.endsWith('/')) {
        // Already has trailing slash, just append path without leading slash
        s3ObjectPath = s3ObjectPath; // no change needed
      } else if (!s3ObjectPath.startsWith('/')) {
        // Needs slash between base and path
        s3ObjectPath = '/' + s3ObjectPath;
      } else {
        // Base doesn't end with /, path starts with /, remove path's leading slash
        s3ObjectPath = pathSegment.substring(1);
      }
      
      // Construct the full URL
      let finalUrlToFetch = originToFetch + s3ObjectPath;
      
      // Handle different auth types
      if (matchedPattern.auth.type === 'aws-s3-presigned-url') {
        try {
          const { getOrGeneratePresignedUrl, encodePresignedUrl } = await import('../utils/presignedUrlUtils');
          
          // Use pattern name for auth configuration to ensure proper variable naming
          // The problem was we were using remoteAuth which caused the utils to look for REMOTE_ prefixed variables
          // Instead we need to construct a storage config that will look for pattern-specific variables
          // We need to create a custom configuration object with the correct property names
          
          // TypeScript-friendly approach with a Record type
          const storageConfigForUtil: Record<string, any> = {
            remoteUrl: originToFetch
          };
          
          // Create a property key using the pattern's name (e.g., standardAuth instead of remoteAuth)
          // This ensures pattern-specific credentials are used
          const authKey = `${matchedPattern.name}Auth`;
          storageConfigForUtil[authKey] = matchedPattern.auth;
          
          // Log the storage config to help with debugging
          pinoDebug(requestContext, logger, 'handleTransformationError', 'Created pattern-specific storage config for presigned URL', {
            pattern: matchedPattern.name,
            authKey: authKey,
            authType: matchedPattern.auth.type,
            accessKeyVar: matchedPattern.auth.accessKeyVar || `${matchedPattern.name.toUpperCase()}_AWS_ACCESS_KEY_ID`,
            secretKeyVar: matchedPattern.auth.secretKeyVar || `${matchedPattern.name.toUpperCase()}_AWS_SECRET_ACCESS_KEY`
          });
          
          // Generate presigned URL with the pattern's specific auth configuration
          addBreadcrumb(requestContext, 'Fallback', 'Generating presigned URL for pattern fallback', { 
            pattern: matchedPattern.name,
            authKey: authKey
          });
          
          // Ensure we have the correct environment
          const env = context.env || {};
          
          // Get the presigned URL - pass null as patternContext since we'll use the config
          const presignedUrl = await getOrGeneratePresignedUrl(env, finalUrlToFetch, storageConfigForUtil, null);
          
          if (presignedUrl && presignedUrl !== finalUrlToFetch) {
            finalUrlToFetch = presignedUrl; // Use the presigned URL
            addBreadcrumb(requestContext, 'Fallback', 'Using presigned URL for pattern fallback fetch', { 
              pattern: matchedPattern.name 
            });
            
            pinoDebug(requestContext, logger, 'handleTransformationError', 'Generated presigned URL for pattern fallback', {
              pattern: matchedPattern.name,
              urlLength: presignedUrl.length
            });
            
            // Perform the fetch with the presigned URL
            try {
              // Create a new request with the presigned URL
              const presignedRequest = new Request(presignedUrl, {
                method: originalRequest.method,
                headers: originalRequest.headers,
                redirect: 'follow'
              });
              
              // Log the request details
              pinoDebug(requestContext, logger, 'handleTransformationError', 'Fetching with presigned URL', {
                pattern: matchedPattern.name,
                method: originalRequest.method,
                urlLength: presignedUrl.length
              });
              
              // Fetch the content directly using the presigned URL
              fallbackResponse = await fetch(presignedRequest);
              
              // If successful, return immediately - no need to try other options
              if (fallbackResponse && fallbackResponse.ok) {
                pinoDebug(requestContext, logger, 'handleTransformationError', 'Presigned URL fetch successful', {
                  pattern: matchedPattern.name,
                  status: fallbackResponse.status,
                  contentType: fallbackResponse.headers.get('Content-Type')
                });
              }
            } catch (presignedFetchError) {
              logErrorWithContext('Error fetching with presigned URL', presignedFetchError, {
                pattern: matchedPattern.name
              }, 'handleTransformationError');
              
              // Don't throw, continue to other fallback mechanisms
              pinoDebug(requestContext, logger, 'handleTransformationError', 'Presigned URL fetch failed, trying other fallbacks', {
                error: presignedFetchError instanceof Error ? presignedFetchError.message : String(presignedFetchError)
              });
            }
          } else if (!presignedUrl) {
            throw new Error('Failed to generate presigned URL for pattern fallback');
          }
        } catch (presignError) {
          logErrorWithContext('Error generating presigned URL for pattern fallback', presignError, { 
            pattern: matchedPattern.name,
            origin: matchedPattern.originUrl
          }, 'handleTransformationError');
          
          // Continue using the direct URL as fallback
          pinoDebug(requestContext, logger, 'handleTransformationError', 'Continuing with direct pattern URL after presigning failure', {
            pattern: matchedPattern.name,
            url: finalUrlToFetch
          });
        }
      } else if (matchedPattern.auth.type === 'aws-s3') {
        try {
          // For aws-s3 auth, sign the request headers
          addBreadcrumb(requestContext, 'Fallback', 'Using AWS S3 direct auth for pattern fallback', {
            pattern: matchedPattern.name
          });
          
          // Ensure we have the env
          const env = context.env || {};
          const envRecord = env as unknown as Record<string, string | undefined>;
          
          // Get credentials from env using the pattern's specific auth config
          const accessKeyVar = matchedPattern.auth.accessKeyVar || 'AWS_ACCESS_KEY_ID';
          const secretKeyVar = matchedPattern.auth.secretKeyVar || 'AWS_SECRET_ACCESS_KEY';
          const sessionTokenVar = matchedPattern.auth.sessionTokenVar;
          
          const accessKey = envRecord[accessKeyVar] as string;
          const secretKey = envRecord[secretKeyVar] as string;
          const sessionToken = sessionTokenVar ? envRecord[sessionTokenVar] as string : undefined;
          
          if (accessKey && secretKey) {
            // Import AWS client
            const { AwsClient } = await import('aws4fetch');
            
            // Setup AWS client with pattern-specific auth config
            const aws = new AwsClient({
              accessKeyId: accessKey,
              secretAccessKey: secretKey,
              sessionToken,
              service: matchedPattern.auth.service || 's3',
              region: matchedPattern.auth.region || 'us-east-1'
            });
            
            // Create and sign the request
            const signRequest = new Request(finalUrlToFetch, {
              method: originalRequest.method,
              headers: originalRequest.headers
            });
            
            const signedRequest = await aws.sign(signRequest);
            
            // Extract headers for logging
            const authHeader = signedRequest.headers.get('Authorization');
            const hasAuthHeader = !!authHeader;
            
            pinoDebug(requestContext, logger, 'handleTransformationError', 'Signed request for pattern fallback', {
              pattern: matchedPattern.name,
              hasAuthHeader,
              authHeaderPrefix: authHeader ? authHeader.substring(0, 15) + '...' : 'none'
            });
            
            // Perform the fetch with signed request
            fallbackResponse = await fetch(signedRequest);
          } else {
            // Missing credentials, attempt direct fetch without auth
            pinoDebug(requestContext, logger, 'handleTransformationError', 'Missing AWS credentials for pattern fallback, trying direct fetch', {
              pattern: matchedPattern.name,
              url: finalUrlToFetch
            });
            
            // Use original request's method and headers for direct fetch
            const directRequest = new Request(finalUrlToFetch, {
              method: originalRequest.method,
              headers: originalRequest.headers,
              redirect: 'follow' // Important for potential redirects at origin
            });
            
            fallbackResponse = await fetch(directRequest);
          }
        } catch (awsError) {
          logErrorWithContext('Error using AWS S3 auth for pattern fallback', awsError, {
            pattern: matchedPattern.name,
            origin: matchedPattern.originUrl
          }, 'handleTransformationError');
          
          // Try a direct fetch as fallback
          try {
            const directRequest = new Request(finalUrlToFetch, {
              method: originalRequest.method,
              headers: originalRequest.headers,
              redirect: 'follow'
            });
            
            fallbackResponse = await fetch(directRequest);
          } catch (directError) {
            logErrorWithContext('Error with direct fetch after AWS auth failure', directError, {
              pattern: matchedPattern.name,
              url: finalUrlToFetch
            }, 'handleTransformationError');
          }
        }
      } else {
        // For other auth types or no specific auth implementation, try direct fetch
        addBreadcrumb(requestContext, 'Fallback', 'Using direct fetch for pattern origin', {
          pattern: matchedPattern.name,
          authType: matchedPattern.auth.type
        });
        
        // Use original request's method and headers for direct fetch
        const directRequest = new Request(finalUrlToFetch, {
          method: originalRequest.method,
          headers: originalRequest.headers,
          redirect: 'follow' // Important for potential redirects at origin
        });
        
        fallbackResponse = await fetch(directRequest);
      }
      
      // Check if the pattern-specific fetch succeeded
      if (fallbackResponse && fallbackResponse.ok) {
        pinoDebug(requestContext, logger, 'handleTransformationError', 'Pattern-specific fallback successful', {
          pattern: matchedPattern?.name || 'direct',
          status: fallbackResponse.status,
          contentType: fallbackResponse.headers.get('Content-Type')
        });
        
        addBreadcrumb(requestContext, 'Fallback', 'Successfully fetched using pattern origin/auth', {
          pattern: matchedPattern?.name || 'direct',
          status: fallbackResponse.status
        });
        
        // Add pattern-specific fallback header
        const headers = new Headers(fallbackResponse.headers);
        headers.set('X-Fallback-Applied', 'true');
        
        if (matchedPattern) {
          headers.set('X-Pattern-Fallback-Applied', 'true');
          headers.set('X-Pattern-Name', matchedPattern.name);
          
          // Add detailed debugging information
          if (matchedPattern.auth?.type) {
            headers.set('X-Pattern-Auth-Type', matchedPattern.auth.type);
          }
          
          // Add pattern origin info (with domain only for security)
          if (matchedPattern.originUrl) {
            try {
              const originDomain = new URL(matchedPattern.originUrl).hostname;
              headers.set('X-Pattern-Origin-Domain', originDomain);
            } catch (e) {
              // If URL parsing fails, just use a placeholder
              headers.set('X-Pattern-Origin-Domain', 'unknown');
            }
          }
        }
        
        // Add fallback-specific headers
        headers.set('X-Fallback-Reason', parsedError.specificError || errorText.substring(0, 100));
        
        // Add original error information for debugging
        headers.set('X-Original-Error-Status', String(errorResponse.status));
        headers.set('X-Original-Error-Type', parsedError.errorType || 'unknown');
        
        // Add Cache-Control header to prevent caching of fallback response
        headers.set('Cache-Control', 'no-store');
        
        // Ensure correct content type for video playback in browser
        const contentType = fallbackResponse.headers.get('Content-Type');
        if (contentType === 'application/octet-stream' || contentType === 'binary/octet-stream') {
          // Set proper video content type based on the file extension
          const url = new URL(originalRequest.url);
          const path = url.pathname;
          if (path.endsWith('.mp4')) {
            headers.set('Content-Type', 'video/mp4');
          } else if (path.endsWith('.webm')) {
            headers.set('Content-Type', 'video/webm');
          } else if (path.endsWith('.mov')) {
            headers.set('Content-Type', 'video/quicktime');
          } else if (path.endsWith('.avi')) {
            headers.set('Content-Type', 'video/x-msvideo');
          } else if (path.endsWith('.wmv')) {
            headers.set('Content-Type', 'video/x-ms-wmv');
          } else if (path.endsWith('.m4v')) {
            headers.set('Content-Type', 'video/mp4');
          } else if (path.endsWith('.mkv')) {
            headers.set('Content-Type', 'video/x-matroska');
          } else {
            // Default to MP4 if we can't determine from extension
            headers.set('Content-Type', 'video/mp4');
          }
          
          pinoDebug(requestContext, logger, 'handleTransformationError', 'Fixed content type for video playback', {
            original: contentType,
            updated: headers.get('Content-Type'),
            path: path
          });
        }
        
        // Create a response with our custom headers
        const finalResponse = new Response(fallbackResponse.body, {
          status: fallbackResponse.status,
          statusText: fallbackResponse.statusText,
          headers
        });
        
        // Return the response
        return finalResponse;
      } else if (fallbackResponse) {
        // Didn't get an OK response, log the failure
        pinoDebug(requestContext, logger, 'handleTransformationError', 'Pattern-specific fallback returned non-OK status', {
          pattern: matchedPattern.name,
          status: fallbackResponse.status,
          statusText: fallbackResponse.statusText
        });
        
        addBreadcrumb(requestContext, 'Fallback', 'Pattern origin/auth fetch failed with status', {
          pattern: matchedPattern.name,
          status: fallbackResponse.status
        });
        
        // Reset the fallbackResponse to try other fallback mechanisms
        fallbackResponse = undefined;
      }
    } catch (patternFetchError) {
      logErrorWithContext('Error during pattern-specific fallback fetch', patternFetchError, {
        pattern: matchedPattern.name,
        url: matchedPattern.originUrl
      }, 'handleTransformationError');
      
      addBreadcrumb(requestContext, 'Error', 'Pattern-specific fallback fetch error', {
        pattern: matchedPattern.name,
        error: patternFetchError instanceof Error ? patternFetchError.message : 'Unknown'
      });
      
      // Reset the fallbackResponse to try other fallback mechanisms
      fallbackResponse = undefined;
    }
  }

  // Second priority: Basic direct fetch from fallbackOriginUrl or source
  const sourceUrlForDirectFetch = fallbackOriginUrl || source; // Prefer pattern-based fallback URL
  
  // Only attempt direct fetch if pattern-specific fetch wasn't attempted or failed, and we have a direct URL
  if (!fallbackResponse && !patternFetchAttempted && (isServerError || isFileSizeError) && sourceUrlForDirectFetch) {
    pinoDebug(requestContext, logger, 'handleTransformationError', 'Attempting direct source fetch', { 
      sourceUrl: sourceUrlForDirectFetch.substring(0,50), 
      reason: isServerError ? 'Server Error' : 'File Size Error' 
    });
    addBreadcrumb(requestContext, 'Fallback', 'Attempting direct fetch', { 
      reason: isServerError ? 'Server Error' : 'File Size Error' 
    });
    
    try {
      // Use original request's method and headers for direct fetch
      const directRequest = new Request(sourceUrlForDirectFetch, {
        method: originalRequest.method,
        headers: originalRequest.headers,
        redirect: 'follow' // Important for potential redirects at origin
      });
      
      fallbackResponse = await fetch(directRequest);
      
      if (!fallbackResponse.ok) {
        pinoDebug(requestContext, logger, 'handleTransformationError', 'Direct source fetch failed', { status: fallbackResponse.status });
        addBreadcrumb(requestContext, 'Fallback', 'Direct fetch failed', { status: fallbackResponse.status });
        fallbackResponse = undefined; // Reset to trigger storage service fallback
      } else {
        pinoDebug(requestContext, logger, 'handleTransformationError', 'Direct source fetch successful', { status: fallbackResponse.status });
        addBreadcrumb(requestContext, 'Fallback', 'Direct fetch successful', { status: fallbackResponse.status });
      }
    } catch (directFetchError) {
      logErrorWithContext('Error fetching directly from source', directFetchError, { sourceUrl: sourceUrlForDirectFetch }, 'handleTransformationError');
      addBreadcrumb(requestContext, 'Error', 'Direct fetch exception', { error: directFetchError instanceof Error ? directFetchError.message : String(directFetchError) });
      fallbackResponse = undefined;
    }
  }

  // Third priority: Use storage service if all previous attempts failed
  if (!fallbackResponse) {
    pinoDebug(requestContext, logger, 'handleTransformationError', 'Using storage service for fallback');
    addBreadcrumb(requestContext, 'Fallback', 'Using storage service');
    
    try {
      const videoConfigManager = VideoConfigurationManager.getInstance();
      const videoConfig = videoConfigManager.getConfig();
      const storageResult = await fetchVideo(
        new URL(originalRequest.url).pathname,
        videoConfig,
        context.env || {},
        originalRequest
      );

      if (storageResult.sourceType !== 'error') {
        fallbackResponse = storageResult.response;
        pinoDebug(requestContext, logger, 'handleTransformationError', 'Storage service fallback successful', { status: fallbackResponse.status });
        addBreadcrumb(requestContext, 'Fallback', 'Storage service successful', { status: fallbackResponse.status });
      } else {
        logErrorWithContext('Failed to get fallback content via storage service', storageResult.error, { path: new URL(originalRequest.url).pathname }, 'handleTransformationError');
        addBreadcrumb(requestContext, 'Error', 'Storage service fallback failed', { error: storageResult.error?.message });
      }
    } catch (storageError) {
      logErrorWithContext('Error using storage service for fallback', storageError, { path: new URL(originalRequest.url).pathname }, 'handleTransformationError');
      addBreadcrumb(requestContext, 'Error', 'Storage service exception', { error: storageError instanceof Error ? storageError.message : String(storageError) });
    }
  }

  // --- Finalize Fallback Response ---
  if (fallbackResponse) {
    const headers = new Headers(fallbackResponse.headers);
    
    // Add fallback-specific headers
    headers.set('X-Fallback-Applied', 'true');
    headers.set('X-Fallback-Reason', parsedError.specificError || errorText.substring(0, 100));
    headers.set('X-Original-Error-Status', String(status));
    
    if (parsedError.errorType) headers.set('X-Error-Type', parsedError.errorType);
    if (parsedError.parameter) headers.set('X-Invalid-Parameter', parsedError.parameter);
    
    // Add specific headers for file size errors
    if (isFileSizeError || parsedError.errorType === 'file_size_limit' || errorText.includes('file size limit')) {
      headers.set('X-File-Size-Error', 'true');
      headers.set('X-Video-Too-Large', 'true'); // Required for backward compatibility
    }
    
    if (isServerError) headers.set('X-Server-Error-Fallback', 'true');
    
    // Add pattern info if a pattern was matched but direct fetch was used
    if (matchedPattern && patternFetchAttempted) {
      headers.set('X-Pattern-Fallback-Attempted', 'true');
      headers.set('X-Pattern-Name', matchedPattern.name);
      
      // Add more detailed information for debugging
      if (matchedPattern.auth?.type) {
        headers.set('X-Pattern-Auth-Type', matchedPattern.auth.type);
      }
      
      // Add pattern origin info (with domain only for security)
      if (matchedPattern.originUrl) {
        try {
          const originDomain = new URL(matchedPattern.originUrl).hostname;
          headers.set('X-Pattern-Origin-Domain', originDomain);
        } catch (e) {
          // If URL parsing fails, just use a placeholder
          headers.set('X-Pattern-Origin-Domain', 'unknown');
        }
      }
    }
    
    // For storage service fallback, add storage source header for backward compatibility
    if (!((isServerError || isFileSizeError) && sourceUrlForDirectFetch && fallbackResponse.url === sourceUrlForDirectFetch)) {
      // If we didn't use direct fetch, assume it came from storage service
      headers.set('X-Storage-Source', 'remote');
    } else {
      // Indicate if direct source was successfully used for fallback
      headers.set('X-Direct-Source-Used', 'true');
    }

    headers.set('Cache-Control', 'no-store'); // Ensure fallback isn't cached

    return new Response(fallbackResponse.body, {
      status: fallbackResponse.status,
      statusText: fallbackResponse.statusText,
      headers
    });
  }

  // If all fallbacks fail, return a generic error response
  logErrorWithContext('All fallback mechanisms failed', new Error('No fallback content available'), { requestId: requestContext.requestId }, 'handleTransformationError');
  addBreadcrumb(requestContext, 'Error', 'All fallbacks failed');
  
  // Return a generic 500
  return new Response(`Transformation failed and fallback could not be retrieved. Original error status: ${status}`, {
    status: 500,
    headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' }
  });
}
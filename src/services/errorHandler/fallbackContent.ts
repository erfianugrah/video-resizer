/**
 * Functions for fetching original content when transformation fails
 */
import { VideoTransformError } from '../../errors';
import { withErrorHandling } from '../../utils/errorHandlingUtils';
import { parseErrorMessage } from '../../utils/transformationUtils';
import { createCategoryLogger } from '../../utils/logger';
const logger = createCategoryLogger('ErrorHandler');

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
      context: 'FallbackContent',
      operation: 'renderFallbackContent',
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
        context: 'FallbackContent',
        operation: 'renderFallbackContent',
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

      // Return null when config cannot be loaded
      return null;
    }
  }

  // Log configuration loaded for fallback
  logger.debug('Configuration loaded for fallback', {
    errorStatus: error.statusCode,
    errorType: error.errorType,
    cachingMethod: caching?.method,
    fallbackEnabled: fallbackConfig?.enabled,
    badRequestOnly: fallbackConfig?.badRequestOnly,
    maxRetries: fallbackConfig?.maxRetries || 0,
    currentRetry: retryCount,
  });

  // Check if fallback is enabled in config
  if (!fallbackConfig || !fallbackConfig.enabled) {
    logger.debug('Fallback disabled in config, skipping');
    return null;
  }

  // Log the fallback URL attempt for debugging
  logger.debug('Preparing fallback with original URL', {
    originalUrl,
    fallbackEnabled: true,
    errorStatus: error.statusCode,
    errorType: error.errorType,
  });

  // For server errors (5xx), retry the transformation if we haven't reached max retries
  const isServerError = error.statusCode >= 500 && error.statusCode < 600;
  const maxRetries = fallbackConfig.maxRetries || 0;

  if (isServerError && retryCount < maxRetries) {
    // Implement retry logic for server errors
    logger.debug('Server error detected, retrying transformation', {
      errorStatus: error.statusCode,
      errorType: error.errorType,
      retryCount: retryCount,
      maxRetries: maxRetries,
    });

    try {
      // First determine video options from the request
      const { determineVideoOptions } = await import('../../handlers/videoOptionsService');

      // Get URL for determining options
      const url = new URL(request.url);
      const params = url.searchParams;
      const path = url.pathname;

      // Determine video options
      const videoOptions = determineVideoOptions(request, params, path);

      // Get the path patterns
      const { VideoConfigurationManager } = await import('../../config');
      const pathPatterns = VideoConfigurationManager.getInstance().getPathPatterns();

      // Now import the transformation service
      const { transformVideo } = await import('../videoTransformationService');

      // Create debug info object
      const debugInfo = {
        isEnabled: false, // Enable debugging only if explicitly needed
        isVerbose: false,
        includeTiming: true,
        includeHeaders: true,
      };

      // Create a minimal env object for transformVideo
      const env = {
        ASSETS: undefined, // No ASSETS binding required for retry
      };

      // Attempt to transform the video again using the service
      const transformedResponse = await transformVideo(
        request,
        videoOptions,
        pathPatterns,
        debugInfo,
        env
      );

      if (transformedResponse && transformedResponse.ok) {
        logger.debug('Retry transformation successful', {
          retryCount: retryCount + 1,
          status: transformedResponse.status,
        });

        // Add retry info header
        const headers = new Headers(transformedResponse.headers);
        headers.set('X-Retry-Count', (retryCount + 1).toString());

        return new Response(transformedResponse.body, {
          status: transformedResponse.status,
          statusText: transformedResponse.statusText,
          headers,
        });
      }

      // If still failing, retry with increased retry count or fall back
      if (retryCount + 1 < maxRetries) {
        logger.debug('Retry failed, attempting again', {
          retryCount: retryCount + 1,
          maxRetries: maxRetries,
        });

        // Recursively call with increased retry count
        return fetchOriginalContentFallbackImpl(originalUrl, error, request, retryCount + 1);
      }

      logger.debug('Maximum retries reached, falling back to original content', {
        retryCount: retryCount,
        maxRetries: maxRetries,
      });
    } catch (retryError) {
      logger.error('Error during retry attempt', {
        error: retryError instanceof Error ? retryError.message : String(retryError),
        retryCount: retryCount,
      });
    }
  }

  // Only apply fallback for 400 Bad Request errors if badRequestOnly is true
  if (fallbackConfig.badRequestOnly && error.statusCode !== 400) {
    // Skip fallback for non-400 errors when badRequestOnly is true
    logger.debug('Error not eligible for fallback', {
      errorStatus: error.statusCode,
      badRequestOnly: fallbackConfig.badRequestOnly,
      isServerError: isServerError,
    });
    return null;
  }

  logger.debug('Fetching original content as fallback', {
    originalUrl,
    errorType: error.errorType,
    errorMessage: error.message,
    config: {
      enabled: fallbackConfig.enabled,
      badRequestOnly: fallbackConfig.badRequestOnly,
    },
  });

  // Create a new request for the original content
  const originalRequest = new Request(originalUrl, {
    method: request.method,
    headers: request.headers,
    redirect: 'follow',
  });

  // Log detailed information about the original request before fetching
  logger.debug('Original request details for fallback', {
    originalUrl,
    method: request.method,
    headersIncluded: Array.from(request.headers.keys()),
    hasRange: request.headers.has('Range'),
    rangeValue: request.headers.get('Range'),
    isConditional: request.headers.has('If-None-Match') || request.headers.has('If-Modified-Since'),
    requestId: Math.random().toString(36).substring(2, 10),
  });

  // Fetch the original content
  const response = await fetch(originalRequest);

  // Log detailed response information
  logger.debug('Original content response details', {
    status: response.status,
    statusText: response.statusText,
    contentType: response.headers.get('Content-Type'),
    contentLength: response.headers.get('Content-Length'),
    isError: !response.ok,
    errorCategory: !response.ok ? Math.floor(response.status / 100) * 100 : undefined,
    cacheStatus: response.headers.get('CF-Cache-Status'),
    etag: response.headers.get('ETag'),
    headersReceived: Array.from(response.headers.keys()),
  });

  // Create new headers
  const headers = new Headers();

  // Determine which headers to preserve
  const preserveHeaders = fallbackConfig.preserveHeaders || [
    'Content-Type',
    'Content-Length',
    'Content-Range',
    'Accept-Ranges',
  ];

  // Copy preserved headers from original response
  preserveHeaders.forEach((headerName: string) => {
    const headerValue = response.headers.get(headerName);
    if (headerValue) {
      headers.set(headerName, headerValue);
    }
  });

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
      headers: cacheHeaders,
    });

    try {
      // Use Cache API directly - we don't want to use KV for these potentially large files
      const cache = caches.default;

      // Create a request with the fallback cache key for storing
      const fallbackRequest = new Request(fallbackCacheKey.toString(), {
        method: 'GET',
        headers: request.headers,
      });

      // Store in Cache API
      await cache.put(fallbackRequest, responseToCache);

      logger.debug('Cached original content for future fallbacks', {
        originalUrl,
        fallbackCacheKey: fallbackCacheKey.toString(),
        status: originalResponse.status,
        contentType: originalResponse.headers.get('Content-Type'),
        contentLength: originalResponse.headers.get('Content-Length'),
      });

      return true;
    } catch (cacheError) {
      logger.error('Failed to cache original content', {
        error: cacheError instanceof Error ? cacheError.message : String(cacheError),
        originalUrl,
        fallbackCacheKey: fallbackCacheKey.toString(),
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
        headers: request.headers,
      });

      // Try to find in Cache API
      const cache = caches.default;
      const cachedFallback = await cache.match(fallbackRequest);

      if (cachedFallback) {
        logger.debug('Found cached original content for fallback', {
          fallbackCacheKey: fallbackCacheKey.toString(),
          status: cachedFallback.status,
          contentType: cachedFallback.headers.get('Content-Type'),
          contentLength: cachedFallback.headers.get('Content-Length'),
        });

        return cachedFallback;
      }

      return null;
    } catch (checkError) {
      logger.error('Error checking for cached original', {
        error: checkError instanceof Error ? checkError.message : String(checkError),
        originalUrl,
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

      logger.debug('Using cached original content for fallback', {
        originalUrl,
        retryCount,
        status: cachedOriginal.status,
        contentType: cachedOriginal.headers.get('Content-Type'),
      });

      return new Response(cachedOriginal.body, {
        status: cachedOriginal.status,
        statusText: cachedOriginal.statusText,
        headers: cachedHeaders,
      });
    }
  }

  // Get execution context if available for background processing
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ctx = (request as any).executionCtx || (request as any).ctx;

  // Cache the original content for future fallbacks
  if (ctx && typeof ctx.waitUntil === 'function') {
    // Store in background with waitUntil
    logger.debug('Caching original content in background', {
      originalUrl,
      hasExecutionContext: true,
    });

    ctx.waitUntil(cacheOriginalContent(response, originalUrl));
  } else {
    // No execution context, try to cache directly but don't block response
    logger.debug('No execution context, will attempt direct caching', {
      originalUrl,
    });

    // Start the caching process without awaiting it
    Promise.resolve()
      .then(() => cacheOriginalContent(response, originalUrl))
      .catch((error) => {
        logger.error('Error in direct caching of original', {
          error: error instanceof Error ? error.message : String(error),
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
  logger.debug('Successfully fetched fallback content', {
    status: response.status,
    contentType: response.headers.get('Content-Type'),
    preservedHeaders: preserveHeaders,
  });

  logger.debug('Successfully fetched original content', {
    originalUrl,
    status: response.status,
    contentType: response.headers.get('Content-Type'),
    size: response.headers.get('Content-Length'),
  });

  // Return new response with modified headers
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
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
    logErrors: true,
  },
  {
    operation: 'fetch_original_content_fallback',
  }
);

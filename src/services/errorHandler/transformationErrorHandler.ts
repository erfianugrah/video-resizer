/**
 * Specialized handling for transformation errors
 * Includes background caching of fallback content with streaming support for large files
 */
import { VideoTransformContext } from '../../domain/commands/TransformVideoCommand';
import { RequestContext, addBreadcrumb } from '../../utils/requestContext';
import { logErrorWithContext } from '../../utils/errorHandlingUtils';
import {
  parseErrorMessage,
  isDurationLimitError,
  adjustDuration,
  storeTransformationLimit,
} from '../../utils/transformationUtils';
import { cacheResponse } from '../cacheManagementService';
import { prepareVideoTransformation } from '../TransformationService';
// Import will be done dynamically within the function to allow for mocking in tests
import type { DiagnosticsInfo } from '../../utils/debugHeadersUtils';
import { createCategoryLogger } from '../../utils/logger';
const logger = createCategoryLogger('ErrorHandler');
import { EnvVariables } from '../../config/environmentConfig';
import type { VideoResizerConfig } from '../videoStorage/interfaces';
import { getCacheKV } from '../../utils/flexibleBindings';

/**
 * Helper function to initiate background caching of fallback responses
 * This centralizes the background caching logic to avoid code duplication
 *
 * @param env Cloudflare environment with executionCtx and KV namespace (can be undefined)
 * @param path Path of the video being cached
 * @param fallbackResponse Response to cache in KV
 * @param requestContext Request context for diagnostics and logging
 * @param tagInfo Additional information tags for logs (pattern name, content info)
 */
async function initiateBackgroundCaching(
  env: Partial<EnvVariables> | undefined,
  path: string,
  fallbackResponse: Response,
  requestContext: RequestContext,
  tagInfo?: {
    pattern?: string;
    isLargeVideo?: boolean;
    isFileSizeError?: boolean;
  }
): Promise<void> {
  // Only proceed if we have the necessary environment and response
  const cacheKV = env ? getCacheKV(env) : null;
  if (
    !env ||
    !env.executionCtx?.waitUntil ||
    !cacheKV ||
    !fallbackResponse.body ||
    !fallbackResponse.ok
  ) {
    return;
  }

  // CRITICAL: Skip KV caching for file size error fallbacks
  // These are videos that exceed the 256MB transformation limit
  if (tagInfo?.isFileSizeError) {
    logger.debug('Skipping KV storage for file size error fallback', {
      path,
      reason: 'File exceeds transformation size limit',
    });
    addBreadcrumb(requestContext, 'KVCache', 'Skipped - file size error fallback');
    return;
  }

  // CRITICAL: Skip KV caching for partial/range responses
  // These are incomplete video segments that should never be cached
  const statusCode = fallbackResponse.status;
  const contentRange = fallbackResponse.headers.get('Content-Range');
  if (statusCode === 206 || contentRange) {
    logger.debug('Skipping KV storage for partial content response', {
      path,
      status: statusCode,
      contentRange,
      reason: 'Partial/range response should not be cached',
    });
    addBreadcrumb(requestContext, 'KVCache', 'Skipped - partial content response');
    return;
  }

  try {
    // Log context based on whether this is a large video or pattern fallback
    const contextType = tagInfo?.isLargeVideo
      ? 'large video'
      : tagInfo?.pattern
        ? `pattern fallback (${tagInfo.pattern})`
        : 'fallback video';

    // Get content length to check file size
    const contentLengthHeader = fallbackResponse.headers.get('Content-Length');
    const contentLength = contentLengthHeader ? parseInt(contentLengthHeader, 10) : 0;

    // For extremely large files, we'll still process them using the streams API
    if (contentLength > 100 * 1024 * 1024) {
      // 100MB threshold
      logger.debug(
        `Processing large ${contextType} (${Math.round(contentLength / 1024 / 1024)}MB) with streams API`,
        {
          path,
          pattern: tagInfo?.pattern,
          contentLength,
          status: fallbackResponse.status,
          isLargeVideo: tagInfo?.isLargeVideo,
        }
      );

      addBreadcrumb(requestContext, 'KVCache', `Using streaming for large ${contextType}`, {
        path,
        pattern: tagInfo?.pattern,
        contentLength,
        isLargeVideo: tagInfo?.isLargeVideo,
        sizeMB: Math.round(contentLength / 1024 / 1024),
      });
    }

    // Import the background chunking storage function
    const { streamFallbackToKV } = await import('../../services/videoStorage/fallbackStorage');

    // Get a fresh clone for KV storage - this is separate from the response we send to the client
    const fallbackClone = fallbackResponse.clone();

    // Log the KV storage attempt
    logger.debug(`Initiating background KV storage for ${contextType}`, {
      path,
      pattern: tagInfo?.pattern,
      contentType: fallbackResponse.headers.get('Content-Type'),
      contentLength,
      status: fallbackResponse.status,
      isLargeVideo: tagInfo?.isLargeVideo,
    });

    // Add breadcrumb for tracking
    addBreadcrumb(requestContext, 'KVCache', `Starting background storage for ${contextType}`, {
      path,
      pattern: tagInfo?.pattern,
      contentLength,
      isLargeVideo: tagInfo?.isLargeVideo,
    });

    // Import VideoConfigurationManager to get configuration
    const { VideoConfigurationManager } = await import('../../config');
    const videoConfigManager = VideoConfigurationManager.getInstance();
    const videoConfig = videoConfigManager.getConfig();

    // Use waitUntil to store in the background
    env.executionCtx.waitUntil(
      streamFallbackToKV(env, path, fallbackClone, videoConfig).catch((storeError) => {
        // Log any errors that occur during background storage
        logErrorWithContext(
          `Error during background KV storage for ${contextType}`,
          storeError,
          {
            path,
            pattern: tagInfo?.pattern,
            requestId: requestContext.requestId,
            isLargeVideo: tagInfo?.isLargeVideo,
          },
          'handleTransformationError'
        );
      })
    );
  } catch (importError) {
    // Log error but don't let it affect the user response
    logErrorWithContext(
      `Failed to initialize background KV storage for ${tagInfo?.isLargeVideo ? 'large video' : 'fallback'}`,
      importError,
      {
        requestId: requestContext.requestId,
        pattern: tagInfo?.pattern,
      },
      'handleTransformationError'
    );
  }
}

/**
 * Handles transformation errors, including fallback logic and retries
 *
 * Triggers fallback for:
 * - Server errors (5xx)
 * - File size errors (413)
 * - 256MiB limit errors
 *
 * Note: 404 errors are now handled by retryWithAlternativeOrigins in TransformVideoCommand
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
  source,
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
  const errorText = await errorResponse.text();
  const parsedError = parseErrorMessage(errorText);
  const status = errorResponse.status;
  const isServerError = status >= 500 && status < 600;
  const isFileSizeError =
    parsedError?.errorType === 'file_size_limit' || errorText.includes('file size limit');

  // Log the initial error - pass errorText directly as the error
  logErrorWithContext(
    `Transformation proxy returned ${status}`,
    errorText || `HTTP ${status} error from transformation proxy`,
    { requestId: requestContext.requestId, url: cdnCgiUrl, status, parsedError },
    'handleTransformationError'
  );
  addBreadcrumb(requestContext, 'Error', 'Transformation Proxy Error', {
    status,
    errorText: errorText.substring(0, 100),
    parsedError,
  });

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

        logger.debug('Extracted exact duration limit', {
          maxValue,
          unit,
          exactValue,
          adjustedDuration,
          originalDuration,
          errorMessage: errorText.substring(0, 100),
        });
      }
    }

    // If we couldn't extract the limit from the error, fall back to the standard adjustment
    if (!adjustedDuration) {
      adjustedDuration = adjustDuration(originalDuration);
      logger.debug('Using standard duration adjustment', {
        originalDuration,
        adjustedDuration,
      });
    }

    if (adjustedDuration && adjustedDuration !== originalDuration) {
      logger.debug('Attempting retry with adjusted duration', {
        originalDuration,
        adjustedDuration,
      });
      addBreadcrumb(requestContext, 'Retry', 'Adjusting duration', {
        originalDuration,
        adjustedDuration,
      });

      const adjustedOptions = { ...context.options, duration: adjustedDuration };
      try {
        const transformResult = await prepareVideoTransformation(
          context.request,
          adjustedOptions,
          context.pathPatterns ?? [],
          context.debugInfo,
          context.env
        );
        const adjustedCdnCgiUrl = transformResult.cdnCgiUrl;

        const retryResponse = await cacheResponse(originalRequest, async () =>
          fetch(adjustedCdnCgiUrl)
        );

        if (retryResponse.ok) {
          logger.debug('Retry successful', { adjustedDuration });
          addBreadcrumb(requestContext, 'Retry', 'Duration adjustment successful', {
            status: retryResponse.status,
          });

          // Add adjustment headers and return
          const headers = new Headers(retryResponse.headers);
          headers.set('X-Duration-Adjusted', 'true');
          headers.set('X-Original-Duration', originalDuration);
          headers.set('X-Adjusted-Duration', adjustedDuration);
          headers.set('X-Duration-Limit-Applied', 'true');

          return new Response(retryResponse.body, {
            status: retryResponse.status,
            statusText: retryResponse.statusText,
            headers,
          });
        } else {
          logErrorWithContext(
            'Retry with adjusted duration failed',
            new Error(`Status: ${retryResponse.status}`),
            { requestId: requestContext.requestId, url: adjustedCdnCgiUrl },
            'handleTransformationError'
          );
          addBreadcrumb(requestContext, 'Retry', 'Duration adjustment failed', {
            status: retryResponse.status,
          });
        }
      } catch (retryError) {
        logErrorWithContext(
          'Error during duration retry logic',
          retryError,
          { requestId: requestContext.requestId },
          'handleTransformationError'
        );
        addBreadcrumb(requestContext, 'Error', 'Duration retry preparation failed', {
          error: retryError instanceof Error ? retryError.message : String(retryError),
        });
      }
    }
  }

  // Note: Pattern-based fallback has been removed as 404 errors are now handled
  // by retryWithAlternativeOrigins in TransformVideoCommand

  // --- Fallback Logic (for non-404 errors only) ---
  let fallbackResponse: Response | undefined;
  const url = new URL(originalRequest.url);
  const path = url.pathname;

  // Second priority: Basic direct fetch from fallbackOriginUrl or source
  const sourceUrlForDirectFetch = fallbackOriginUrl || source; // Prefer pattern-based fallback URL

  // Check if this is specifically a "video too large" error
  const is256MiBSizeError =
    isFileSizeError &&
    (errorText.includes('256MiB') ||
      errorText.includes('256 MiB') ||
      parsedError?.specificError?.includes('256MiB'));

  // Check if we have a valid URL to fetch from (not just an origin type like "r2" or "remote")
  const hasValidDirectFetchUrl =
    sourceUrlForDirectFetch &&
    (sourceUrlForDirectFetch.startsWith('http://') ||
      sourceUrlForDirectFetch.startsWith('https://'));

  // Only attempt direct fetch if we don't already have a successful fallbackResponse, and we have a direct URL
  // We should attempt direct fetch for server errors, file size errors, but NOT 404s
  // 404s are handled by retryWithAlternativeOrigins in TransformVideoCommand
  if (
    !fallbackResponse &&
    (isServerError || isFileSizeError || is256MiBSizeError) &&
    hasValidDirectFetchUrl
  ) {
    // If it's specifically a 256MiB size error, log it differently
    if (is256MiBSizeError) {
      logger.debug(
        'Video exceeds 256MiB limit, attempting direct source fetch with range support',
        {
          sourceUrl: sourceUrlForDirectFetch,
        }
      );
      addBreadcrumb(requestContext, 'Fallback', 'Attempting direct fetch for large video', {
        reason: 'Video exceeds 256MiB size limit',
      });
    } else {
      const reason = isServerError ? 'Server Error' : 'File Size Error';
      logger.debug('Attempting direct source fetch', {
        sourceUrl: sourceUrlForDirectFetch,
        reason,
      });
      addBreadcrumb(requestContext, 'Fallback', 'Attempting direct fetch', {
        reason,
      });
    }

    try {
      // Use original request's method and headers for direct fetch
      const directRequest = new Request(sourceUrlForDirectFetch, {
        method: originalRequest.method,
        headers: originalRequest.headers,
        redirect: 'follow', // Important for potential redirects at origin
      });

      // For large videos that exceed 256MiB, handle differently to avoid cache API
      if (is256MiBSizeError) {
        // Fetch but don't use cache API for these large files
        fallbackResponse = await fetch(directRequest);

        if (!fallbackResponse.ok) {
          logger.debug('Direct source fetch failed for large video', {
            status: fallbackResponse.status,
          });
          addBreadcrumb(requestContext, 'Fallback', 'Direct fetch failed for large video', {
            status: fallbackResponse.status,
          });
          fallbackResponse = undefined; // Reset to trigger storage service fallback
        } else {
          // Check if origin supports range requests
          const hasRangeSupport = fallbackResponse.headers.get('Accept-Ranges') === 'bytes';

          logger.debug('Direct source fetch successful for large video', {
            status: fallbackResponse.status,
            contentLength: fallbackResponse.headers.get('Content-Length'),
            hasRangeSupport: hasRangeSupport,
          });

          // If origin doesn't support range requests, we could implement streaming
          // using utilities similar to those in kvStorage/streamingHelpers.ts

          addBreadcrumb(requestContext, 'Fallback', 'Direct fetch successful for large video', {
            status: fallbackResponse.status,
            streamedDirectly: true,
            hasRangeSupport: hasRangeSupport,
          });

          // NOTE: We don't cache large videos that exceed the 256MiB limit
          // They are served directly without KV storage
        }
      } else {
        // Normal fetch for other cases
        fallbackResponse = await fetch(directRequest);

        if (!fallbackResponse.ok) {
          logger.debug('Direct source fetch failed', {
            status: fallbackResponse.status,
          });
          addBreadcrumb(requestContext, 'Fallback', 'Direct fetch failed', {
            status: fallbackResponse.status,
          });
          fallbackResponse = undefined; // Reset to trigger storage service fallback
        } else {
          logger.debug('Direct source fetch successful', {
            status: fallbackResponse.status,
          });
          addBreadcrumb(requestContext, 'Fallback', 'Direct fetch successful', {
            status: fallbackResponse.status,
          });

          // Also store regular fallback videos in KV cache in the background
          // This handles the non-large video case but with the same chunking support
          // CRITICAL: Only clone and cache if it's NOT a file size error
          if (fallbackResponse.body && !(isFileSizeError || is256MiBSizeError)) {
            // Get the path from the original request
            const path = new URL(originalRequest.url).pathname;

            // Clone the response before initiating background caching to preserve the body
            const responseForCaching = fallbackResponse.clone();

            // Use our centralized helper function for background caching
            await initiateBackgroundCaching(context.env, path, responseForCaching, requestContext, {
              isFileSizeError: false,
            });
          }
        }
      }
    } catch (directFetchError) {
      logErrorWithContext(
        'Error fetching directly from source',
        directFetchError,
        { sourceUrl: sourceUrlForDirectFetch },
        'handleTransformationError'
      );
      addBreadcrumb(requestContext, 'Error', 'Direct fetch exception', {
        error:
          directFetchError instanceof Error ? directFetchError.message : String(directFetchError),
      });
      fallbackResponse = undefined;
    }
  }

  // Log if direct fetch was skipped due to invalid URL
  if (
    !fallbackResponse &&
    (isServerError || isFileSizeError || is256MiBSizeError) &&
    !hasValidDirectFetchUrl
  ) {
    logger.debug('Skipping direct fetch - no valid URL available', {
      sourceUrlForDirectFetch,
      isValidUrl: hasValidDirectFetchUrl,
      errorType: isServerError ? 'Server Error' : 'File Size Error',
    });
    addBreadcrumb(requestContext, 'Fallback', 'Direct fetch skipped - invalid URL');
  }

  // Third priority: Use storage service if all previous attempts failed
  if (!fallbackResponse) {
    logger.debug('Using storage service for fallback');
    addBreadcrumb(requestContext, 'Fallback', 'Using storage service');

    try {
      // Import VideoConfigurationManager and fetchVideoWithOrigins dynamically
      const { VideoConfigurationManager } = await import('../../config');
      const { fetchVideoWithOrigins } = await import('../videoStorage/fetchVideoWithOrigins');

      const videoConfigManager = VideoConfigurationManager.getInstance();
      const videoConfig = videoConfigManager.getConfig();

      // Use fetchVideoWithOrigins to leverage the Origins system for better fallback
      const storageResult = await fetchVideoWithOrigins(
        new URL(originalRequest.url).pathname,
        videoConfig,
        context.env || {},
        originalRequest,
        undefined // No exclusions needed here
      );

      if (storageResult.sourceType !== 'error') {
        fallbackResponse = storageResult.response;
        logger.debug('Storage service fallback successful', {
          status: fallbackResponse.status,
        });
        addBreadcrumb(requestContext, 'Fallback', 'Storage service successful', {
          status: fallbackResponse.status,
        });
      } else {
        logErrorWithContext(
          'Failed to get fallback content via storage service',
          storageResult.error,
          { path: new URL(originalRequest.url).pathname },
          'handleTransformationError'
        );
        addBreadcrumb(requestContext, 'Error', 'Storage service fallback failed', {
          error: storageResult.error?.message,
        });
      }
    } catch (storageError) {
      logErrorWithContext(
        'Error using storage service for fallback',
        storageError,
        { path: new URL(originalRequest.url).pathname },
        'handleTransformationError'
      );
      addBreadcrumb(requestContext, 'Error', 'Storage service exception', {
        error: storageError instanceof Error ? storageError.message : String(storageError),
      });
    }
  }

  // --- Finalize Fallback Response ---
  if (fallbackResponse) {
    const headers = new Headers(fallbackResponse.headers);

    // Add fallback-specific headers
    headers.set('X-Fallback-Applied', 'true');
    headers.set('X-Fallback-Reason', parsedError?.specificError || errorText.substring(0, 100));
    headers.set('X-Original-Error-Status', String(status));

    if (parsedError?.errorType) headers.set('X-Error-Type', parsedError.errorType);
    if (parsedError?.parameter) headers.set('X-Invalid-Parameter', parsedError.parameter);

    // Add specific headers for file size errors
    if (
      isFileSizeError ||
      parsedError?.errorType === 'file_size_limit' ||
      errorText.includes('file size limit')
    ) {
      headers.set('X-File-Size-Error', 'true');
      headers.set('X-Video-Too-Large', 'true'); // Required for backward compatibility
    }

    // Add specific header for 256MiB size errors
    if (is256MiBSizeError) {
      headers.set('X-Video-Exceeds-256MiB', 'true');
      headers.set('X-Direct-Stream', 'true');
    }

    if (isServerError) headers.set('X-Server-Error-Fallback', 'true');

    // Pattern-based fallback has been removed - 404s are handled by retryWithAlternativeOrigins

    // For storage service fallback, add storage source header for backward compatibility
    if (
      !(
        (isServerError || isFileSizeError) &&
        sourceUrlForDirectFetch &&
        fallbackResponse.url === sourceUrlForDirectFetch
      )
    ) {
      // If we didn't use direct fetch, assume it came from storage service
      headers.set('X-Storage-Source', 'remote');
    } else {
      // Indicate if direct source was successfully used for fallback
      headers.set('X-Direct-Source-Used', 'true');
    }

    // For ALL fallbacks, set bypass headers using the centralized utility
    const { setBypassHeaders } = await import('../../utils/bypassHeadersUtils');

    // Set bypass headers with appropriate options
    setBypassHeaders(headers, {
      videoExceedsSize: is256MiBSizeError,
      isFallback: true,
      fileSizeError:
        isFileSizeError ||
        parsedError?.errorType === 'file_size_limit' ||
        errorText.includes('file size limit'),
    });

    // For large videos specifically, add some browser cache hints to improve playback
    if (is256MiBSizeError) {
      // Also allow some browser-side caching with private directive
      headers.append('Cache-Control', 'private, max-age=3600');

      logger.debug('Setting up large video response for direct streaming (bypassing Cache API)', {
        contentLength: headers.get('Content-Length'),
        contentType: headers.get('Content-Type'),
        acceptRanges: headers.get('Accept-Ranges'),
        sizeExceeds256MiB: true,
      });
    } else {
      // Log regular fallback
      logger.debug('Fallback streaming with direct response (bypassing Cache API)', {
        contentLength: headers.get('Content-Length'),
        contentType: headers.get('Content-Type'),
        acceptRanges: headers.get('Accept-Ranges'),
      });
    }

    return new Response(fallbackResponse.body, {
      status: fallbackResponse.status,
      statusText: fallbackResponse.statusText,
      headers,
    });
  }

  // If all fallbacks fail, return an error response with the actual proxy error
  logErrorWithContext(
    'All fallback mechanisms failed',
    new Error('No fallback content available'),
    {
      requestId: requestContext.requestId,
      originalError: errorText,
      originalStatus: status,
    },
    'handleTransformationError'
  );
  addBreadcrumb(requestContext, 'Error', 'All fallbacks failed');

  // Return the actual error from the transformation proxy
  const finalErrorResponse = {
    error: parsedError?.errorType || 'transformation_failed',
    message:
      parsedError?.specificError ||
      errorText ||
      `Media transformation failed with status ${status}`,
    statusCode: status,
    details: {
      originalError: errorText,
      parsedError: parsedError,
      fallbackAttempted: true,
      fallbackFailed: true,
    },
  };

  return new Response(JSON.stringify(finalErrorResponse), {
    status: status || 500,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'X-Error-Type': parsedError?.errorType || 'transformation_failed',
      'X-Original-Error': errorText.substring(0, 200), // Include in header for diagnostics
      'X-Fallback-Failed': 'true',
    },
  });
}

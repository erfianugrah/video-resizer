/**
 * Main video handling entry point
 * Using service-oriented architecture for better separation of concerns
 */
import { determineVideoOptions } from './videoOptionsService';
import { transformVideo } from '../services/videoTransformationService';
import { isCdnCgiMediaPath } from '../utils/pathUtils';
import { videoConfig } from '../config/videoConfig';
import { EnvironmentConfig, EnvVariables } from '../config/environmentConfig';
import { createRequestContext, addBreadcrumb } from '../utils/requestContext';
import { createLogger, info, debug, error } from '../utils/pinoLogger';
import { initializeLegacyLogger } from '../utils/legacyLoggerAdapter';
import { ResponseBuilder } from '../utils/responseBuilder';

/**
 * Main handler for video requests
 * @param request The incoming request
 * @param config Environment configuration
 * @returns A response with the processed video
 */
export async function handleVideoRequest(
  request: Request, 
  config: EnvironmentConfig, 
  env?: EnvVariables
): Promise<Response> {
  // Create request context and logger
  const context = createRequestContext(request);
  const logger = createLogger(context);
  
  // Initialize legacy logger for backward compatibility
  initializeLegacyLogger(request);
  
  // Parse URL first for the breadcrumb data
  const url = new URL(request.url);
  const path = url.pathname;

  // Add initial breadcrumb
  addBreadcrumb(context, 'Request', 'Request received', {
    url: request.url,
    method: request.method,
    pathname: path,
    search: url.search
  });
  
  try {

    // Check if the request is already a CDN-CGI media request
    if (isCdnCgiMediaPath(path)) {
      info(context, logger, 'VideoHandler', 'Request is already a CDN-CGI media request, passing through');
      return fetch(request);
    }
    
    // Import the cache management service and cache configuration
    const { getCachedResponse, cacheResponse } = await import('../services/cacheManagementService');
    const { CacheConfigurationManager } = await import('../config');

    // Try to get the response from cache first
    addBreadcrumb(context, 'Cache', 'Checking cache', {
      url: request.url,
      method: 'cache-api',
      bypassParams: CacheConfigurationManager.getInstance().getConfig().bypassQueryParameters?.join(',')
    });
    const cachedResponse = await getCachedResponse(request);
    if (cachedResponse) {
      info(context, logger, 'VideoHandler', 'Serving from cache', {
        url: url.toString(),
        cacheControl: cachedResponse.headers.get('Cache-Control'),
      });
      
      // Use ResponseBuilder for consistent response handling including range requests
      const responseBuilder = new ResponseBuilder(cachedResponse, context);
      return await responseBuilder.build();
    }

    // Get path patterns from config or use defaults
    const pathPatterns = config.pathPatterns || videoConfig.pathPatterns;

    // Get URL parameters
    const urlParams = url.searchParams;

    // Determine video options from URL parameters
    addBreadcrumb(context, 'Client', 'Determining video options', {
      hasParams: urlParams.toString().length > 0,
      path: path
    });
    const videoOptions = determineVideoOptions(request, urlParams, path);

    debug(context, logger, 'VideoHandler', 'Processing video request', {
      url: url.toString(),
      path,
      options: videoOptions,
    });

    // Prepare debug information - add context tracking for breadcrumbs
    const debugInfo = {
      isEnabled: context.debugEnabled || config.debug?.enabled,
      isVerbose: context.verboseEnabled || config.debug?.verbose,
      includeHeaders: config.debug?.includeHeaders,
      includePerformance: true,
    };

    // Store original request headers for diagnostics
    if (debugInfo.isEnabled && debugInfo.includeHeaders) {
      context.diagnostics.originalRequestHeaders = Object.fromEntries(
        [...request.headers.entries()]
      );
    }

    // Use the video transformation service
    addBreadcrumb(context, 'Transform', 'Transforming video', {
      options: {
        width: videoOptions.width,
        height: videoOptions.height,
        format: videoOptions.format,
        quality: videoOptions.quality,
        derivative: videoOptions.derivative
      },
      debug: debugInfo.isEnabled
    });
    const response = await transformVideo(request, videoOptions, pathPatterns, debugInfo, env);
    
    // Add final timing information to diagnostics
    context.diagnostics.processingTimeMs = Math.round(performance.now() - context.startTime);
    
    // Store the response in cache if it's cacheable
    if (response.headers.get('Cache-Control')?.includes('max-age=')) {
      // Use a non-blocking cache write to avoid delaying the response
      addBreadcrumb(context, 'Cache', 'Caching response', {
        status: response.status,
        cacheControl: response.headers.get('Cache-Control'),
        contentType: response.headers.get('Content-Type'),
        contentLength: response.headers.get('Content-Length') || undefined,
        cfCacheStatus: response.headers.get('CF-Cache-Status') || undefined
      });
      cacheResponse(request, response.clone()).catch(err => {
        error(context, logger, 'VideoHandler', 'Error caching response', {
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      });
    }

    // Use ResponseBuilder for consistent response handling including range requests
    const responseBuilder = new ResponseBuilder(response, context);
    return await responseBuilder.build();
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    const errorStack = err instanceof Error ? err.stack : undefined;
    
    error(context, logger, 'VideoHandler', 'Error handling video request', {
      error: errorMessage,
      stack: errorStack,
    });

    // Add error to diagnostics
    if (!context.diagnostics.errors) {
      context.diagnostics.errors = [];
    }
    context.diagnostics.errors.push(errorMessage);
    
    // Create error response with ResponseBuilder
    const errorResponse = new Response(`Error processing video: ${errorMessage}`, {
      status: 500,
      headers: {
        'Content-Type': 'text/plain',
        'Cache-Control': 'no-store',
      },
    });
    
    const responseBuilder = new ResponseBuilder(errorResponse, context);
    return await responseBuilder.withDebugInfo().build();
  }
}

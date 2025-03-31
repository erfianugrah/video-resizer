/**
 * Main video handling entry point
 * Using service-oriented architecture for better separation of concerns
 */
import { determineVideoOptions } from './videoOptionsService';
import { transformVideo } from '../services/videoTransformationService';
import { isCdnCgiMediaPath } from '../utils/pathUtils';
import { videoConfig } from '../config/videoConfig';
import { EnvironmentConfig, EnvVariables } from '../config/environmentConfig';
import type { ExecutionContextExt, EnvWithExecutionContext } from '../types/cloudflare';
import { createRequestContext, addBreadcrumb } from '../utils/requestContext';
import { createLogger, info, debug, error } from '../utils/pinoLogger';
import { initializeLegacyLogger } from '../utils/legacyLoggerAdapter';
import { TransformOptions } from '../utils/kvCacheUtils';
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
  env?: EnvVariables,
  ctx?: ExecutionContext
): Promise<Response> {
  // Pass execution context to environment for waitUntil usage in caching
  if (env && ctx) {
    (env as unknown as EnvWithExecutionContext).executionCtx = ctx;
  }
  // Create request context and logger
  const context = createRequestContext(request);
  const logger = createLogger(context);
  
  // Log environment variables received for debugging
  if (env) {
    debug(context, logger, 'VideoHandler', 'Environment variables received', {
      CACHE_ENABLE_KV: env.CACHE_ENABLE_KV || 'not set',
      VIDEO_TRANSFORMATIONS_CACHE: !!env.VIDEO_TRANSFORMATIONS_CACHE,
      VIDEO_TRANSFORMS_KV: !!env.VIDEO_TRANSFORMS_KV,
      ENVIRONMENT: env.ENVIRONMENT || 'not set'
    });
  }
  
  // Import performance tracking functions
  const { startTimedOperation, endTimedOperation } = await import('../utils/requestContext');
  
  // Start timing the entire request processing
  startTimedOperation(context, 'total-request-processing', 'Request');
  
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
    
    // Import the cache services
    const { getCachedResponse, cacheResponse } = await import('../services/cacheManagementService');
    const { CacheConfigurationManager } = await import('../config');
    const { getFromKVCache, storeInKVCache } = await import('../utils/kvCacheUtils');

    // Try to get the response from cache first
    addBreadcrumb(context, 'Cache', 'Checking cache', {
      url: request.url,
      method: 'cache-api',
      bypassParams: CacheConfigurationManager.getInstance().getConfig().bypassQueryParameters?.join(',')
    });
    
    // Time the cache lookup operation
    startTimedOperation(context, 'cache-lookup', 'Cache');
    
    // Check Cloudflare Cache API first
    // Skip this check if debug mode is enabled but still check KV
    const skipCfCache = context.debugEnabled || url.searchParams.has('debug');
    let cachedResponse = null;
    
    if (!skipCfCache) {
      cachedResponse = await getCachedResponse(request);
      if (cachedResponse) {
        info(context, logger, 'VideoHandler', 'Serving from CF cache', {
          url: url.toString(),
          cacheControl: cachedResponse.headers.get('Cache-Control'),
        });
        
        endTimedOperation(context, 'cache-lookup');
        
        // Use ResponseBuilder for consistent response handling including range requests
        const responseBuilder = new ResponseBuilder(cachedResponse, context);
        return await responseBuilder.build();
      }
    } else {
      debug(context, logger, 'VideoHandler', 'Skipping CF cache due to debug mode', {
        debugEnabled: context.debugEnabled,
        hasDebugParam: url.searchParams.has('debug')
      });
    }
    
    // If we get here, Cloudflare cache missed, so check KV cache
    if (env) {
      // Get the path for KV lookup
      const sourcePath = url.pathname;
      
      // Get video options first to use as cache key
      const videoOptions = determineVideoOptions(request, url.searchParams, path);
        
      addBreadcrumb(context, 'Cache', 'Checking KV cache', {
        url: request.url,
        path: sourcePath
      });
      
      // Use type assertion to fix interface compatibility issues
      const kvResponse = await getFromKVCache(env, sourcePath, videoOptions as unknown as TransformOptions);
      
      if (kvResponse) {
        info(context, logger, 'VideoHandler', 'Serving from KV cache', {
          url: url.toString(),
          path: sourcePath,
        });
        
        addBreadcrumb(context, 'Cache', 'KV cache hit', {
          path: sourcePath
        });
        
        endTimedOperation(context, 'cache-lookup');
        
        // Use ResponseBuilder for consistent response handling
        const responseBuilder = new ResponseBuilder(kvResponse, context);
        return await responseBuilder.build();
      }
      
      debug(context, logger, 'VideoHandler', 'KV cache miss', {
        path: sourcePath,
        options: videoOptions
      });
    }
    
    endTimedOperation(context, 'cache-lookup');

    // Get path patterns from config or use defaults
    const pathPatterns = config.pathPatterns || videoConfig.pathPatterns;

    // Get URL parameters
    const urlParams = url.searchParams;

    // Determine video options from URL parameters
    addBreadcrumb(context, 'Client', 'Determining video options', {
      hasParams: urlParams.toString().length > 0,
      path: path
    });
    
    // Time the options determination operation
    startTimedOperation(context, 'options-determination', 'Client');
    const videoOptions = determineVideoOptions(request, urlParams, path);
    endTimedOperation(context, 'options-determination');

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
    
    // Time the video transformation operation
    startTimedOperation(context, 'video-transformation', 'Transform');
    const response = await transformVideo(request, videoOptions, pathPatterns, debugInfo, env);
    endTimedOperation(context, 'video-transformation');
    
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
      
      // Time the cache storage operation
      startTimedOperation(context, 'cache-storage', 'Cache');
      
      // Store in Cloudflare Cache API (edge cache)
      cacheResponse(request, response.clone())
        .then(() => {
          debug(context, logger, 'VideoHandler', 'Stored in CF cache');
        })
        .catch(err => {
          error(context, logger, 'VideoHandler', 'Error caching in CF cache', {
            error: err instanceof Error ? err.message : 'Unknown error',
          });
        });
      
      // Also store in KV cache if environment is available
      if (env && videoOptions) {
        const sourcePath = url.pathname;
        const responseClone = response.clone();
        
        // Use waitUntil if available to store in KV without blocking response
        const envWithCtx = env as unknown as EnvWithExecutionContext;
        if (envWithCtx.executionCtx && typeof envWithCtx.executionCtx.waitUntil === 'function') {
          envWithCtx.executionCtx.waitUntil(
            storeInKVCache(env, sourcePath, responseClone, videoOptions as unknown as TransformOptions)
              .then(success => {
                if (success) {
                  debug(context, logger, 'VideoHandler', 'Stored in KV cache', {
                    path: sourcePath
                  });
                } else {
                  debug(context, logger, 'VideoHandler', 'Failed to store in KV cache', {
                    path: sourcePath
                  });
                }
              })
              .catch(err => {
                error(context, logger, 'VideoHandler', 'Error storing in KV cache', {
                  error: err instanceof Error ? err.message : 'Unknown error',
                  path: sourcePath
                });
              })
              .finally(() => {
                endTimedOperation(context, 'cache-storage');
              })
          );
        } else {
          // No waitUntil available, try to store directly
          storeInKVCache(env, sourcePath, responseClone, videoOptions as unknown as TransformOptions)
            .then(success => {
              if (success) {
                debug(context, logger, 'VideoHandler', 'Stored in KV cache', {
                  path: sourcePath
                });
              } else {
                debug(context, logger, 'VideoHandler', 'Failed to store in KV cache', {
                  path: sourcePath
                });
              }
            })
            .catch(err => {
              error(context, logger, 'VideoHandler', 'Error storing in KV cache', {
                error: err instanceof Error ? err.message : 'Unknown error',
                path: sourcePath
              });
            })
            .finally(() => {
              endTimedOperation(context, 'cache-storage');
            });
        }
      } else {
        endTimedOperation(context, 'cache-storage');
      }
    }

    // Use ResponseBuilder for consistent response handling including range requests
    startTimedOperation(context, 'response-building', 'Response');
    const responseBuilder = new ResponseBuilder(response, context);
    const result = await responseBuilder.build();
    endTimedOperation(context, 'response-building');
    
    // End the total request timing
    endTimedOperation(context, 'total-request-processing');
    
    return result;
  } catch (err: unknown) {
    // Record error timing
    startTimedOperation(context, 'error-handling', 'Error');
    
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
    const result = await responseBuilder.withDebugInfo().build();
    
    // End error handling timing
    endTimedOperation(context, 'error-handling');
    
    // End the total request timing
    endTimedOperation(context, 'total-request-processing');
    
    return result;
  }
}

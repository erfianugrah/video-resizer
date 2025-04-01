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
  // Create request context and logger, pass execution context for waitUntil operations
  const context = createRequestContext(request, ctx);
  
  // Import performance tracking functions and context management
  const { startTimedOperation, endTimedOperation, setCurrentContext } = await import('../utils/requestContext');
  
  // Set the current request context for the global context manager
  setCurrentContext(context);
  
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
    
    // Start a separate timed operation for CF cache check
    startTimedOperation(context, 'cf-cache-lookup', 'Cache');
    
    if (!skipCfCache) {
      addBreadcrumb(context, 'Cache', 'Checking CF cache', {
        url: request.url,
        method: 'cache-api'
      });
      
      cachedResponse = await getCachedResponse(request);
      
      // End CF cache lookup timing
      endTimedOperation(context, 'cf-cache-lookup');
      
      if (cachedResponse) {
        // Get cache details from headers if available
        const cacheControl = cachedResponse.headers.get('Cache-Control') || 'unknown';
        const cacheStatus = cachedResponse.headers.get('CF-Cache-Status') || 'unknown';
        const cfRay = cachedResponse.headers.get('CF-Ray') || 'unknown';
        const contentType = cachedResponse.headers.get('Content-Type') || 'unknown';
        const contentLength = cachedResponse.headers.get('Content-Length') || 'unknown';
        
        info(context, logger, 'VideoHandler', 'Serving from CF cache', {
          url: url.toString(),
          cacheControl: cacheControl,
          cacheStatus: cacheStatus,
          cfRay: cfRay,
          contentType: contentType,
          contentLength: contentLength,
          fromCfCache: true // Explicit flag to indicate CF cache hit
        });
        
        addBreadcrumb(context, 'Cache', 'CF cache hit', {
          url: url.toString(),
          cacheStatus: cacheStatus,
          contentType: contentType,
          contentLength: contentLength
        });
        
        endTimedOperation(context, 'cache-lookup');
        
        // Use ResponseBuilder for consistent response handling including range requests
        const responseBuilder = new ResponseBuilder(cachedResponse, context);
        return await responseBuilder.build();
      } else {
        // Log CF cache miss
        addBreadcrumb(context, 'CacheManagementService', 'CF cache miss', {
          url: url.toString(),
          duration: endTimedOperation(context, 'cf-cache-lookup')
        });
        
        debug(context, logger, 'VideoHandler', 'CF cache miss', {
          url: url.toString()
        });
      }
    } else {
      // Skip CF cache due to debug mode
      endTimedOperation(context, 'cf-cache-lookup');
      
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
        
      // Start a separate timed operation for KV cache check
      startTimedOperation(context, 'kv-cache-lookup', 'KVCache');
      
      addBreadcrumb(context, 'Cache', 'Checking KV cache', {
        url: request.url,
        path: sourcePath,
        options: JSON.stringify(videoOptions)
      });
      
      debug(context, logger, 'KVCacheUtils', 'Checking KV cache for video', {
        sourcePath: sourcePath,
        derivative: videoOptions.derivative,
        hasQuery: url.search.length > 0
      });
      
      // Use type assertion to fix interface compatibility issues
      const kvResponse = await getFromKVCache(env, sourcePath, videoOptions as unknown as TransformOptions);
      
      if (kvResponse) {
        // End KV cache lookup timing
        endTimedOperation(context, 'kv-cache-lookup');
        
        // Get cache details from headers if available
        const cacheAge = kvResponse.headers.get('X-KV-Cache-Age') || 'unknown';
        const cacheTtl = kvResponse.headers.get('X-KV-Cache-TTL') || 'unknown';
        const cacheKey = kvResponse.headers.get('X-KV-Cache-Key') || sourcePath;
        const contentLength = kvResponse.headers.get('Content-Length') || 'unknown';
        const contentType = kvResponse.headers.get('Content-Type') || 'unknown';
        
        // Log detailed information about the cache hit
        info(context, logger, 'VideoHandler', 'Serving from KV cache', {
          url: url.toString(),
          path: sourcePath,
          cacheAge: cacheAge,
          cacheTtl: cacheTtl,
          cacheKey: cacheKey,
          contentType: contentType,
          contentLength: contentLength,
          derivative: videoOptions.derivative,
          fromKvCache: true // Explicit flag to indicate KV cache hit
        });
        
        addBreadcrumb(context, 'Cache', 'KV cache hit', {
          path: sourcePath,
          cacheAge: cacheAge,
          contentType: contentType,
          size: contentLength
        });
        
        // End overall cache lookup timing
        endTimedOperation(context, 'cache-lookup');
        
        // Use ResponseBuilder for consistent response handling
        const responseBuilder = new ResponseBuilder(kvResponse, context);
        return await responseBuilder.build();
      }
      
      // End KV cache lookup timing
      endTimedOperation(context, 'kv-cache-lookup');
      
      addBreadcrumb(context, 'KVCache', 'KV cache miss', {
        sourcePath: sourcePath,
        derivative: videoOptions.derivative
      });
      
      debug(context, logger, 'VideoHandler', 'KV cache miss', {
        path: sourcePath,
        url: url.toString(),
        derivative: videoOptions.derivative,
        quality: videoOptions.quality,
        noCache: true // Explicit flag to indicate cache miss
      });
    }
    
    endTimedOperation(context, 'cache-lookup');

    // Get path patterns from config or use defaults - use let instead of const
    let pathPatterns = config.pathPatterns || videoConfig.pathPatterns;
    
    // Log the path patterns to see what we have at this point
    debug(context, logger, 'VideoHandler', 'Path patterns from config', {
      source: config.pathPatterns ? 'environment-config' : 'default-config',
      patternCount: pathPatterns.length,
      patterns: pathPatterns.map(p => ({
        name: p.name,
        matcher: p.matcher,
        processPath: p.processPath
      }))
    });
    
    // Also check VideoConfigurationManager to see what patterns it has
    try {
      const { VideoConfigurationManager } = await import('../config/VideoConfigurationManager');
      const videoConfigManager = VideoConfigurationManager.getInstance();
      const managerPatterns = videoConfigManager.getPathPatterns();
      
      debug(context, logger, 'VideoHandler', 'Path patterns from VideoConfigurationManager', {
        patternCount: managerPatterns.length,
        patterns: managerPatterns.map(p => ({
          name: p.name,
          matcher: p.matcher,
          processPath: p.processPath
        }))
      });
      
      // Use the patterns from VideoConfigurationManager if available
      if (managerPatterns.length > 0) {
        pathPatterns = managerPatterns;
        debug(context, logger, 'VideoHandler', 'Using path patterns from VideoConfigurationManager');
      }
      
      // Add breadcrumb for path patterns
      addBreadcrumb(context, 'Configuration', 'Path patterns for request', {
        patternCount: pathPatterns.length,
        patternNames: pathPatterns.map(p => p.name)
      });
    } catch (err) {
      error(context, logger, 'VideoHandler', 'Error getting path patterns from VideoConfigurationManager', {
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined
      });
    }

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
        
        // Check if this is an IMQuery request and capture parameters
        const imwidth = url.searchParams.get('imwidth');
        const imheight = url.searchParams.get('imheight');
        
        // Create customData to store the IMQuery parameters for use in the cache key
        const customData: Record<string, unknown> = {};
        if (imwidth) customData.imwidth = imwidth;
        if (imheight) customData.imheight = imheight;
        
        // Add IMQuery detection to videoOptions custom data
        const videoOptionsWithIMQuery: TransformOptions = {
          ...videoOptions,
          customData: Object.keys(customData).length > 0 ? customData : undefined
        };
        
        // Log the IMQuery detection for debugging
        if (Object.keys(customData).length > 0) {
          debug(context, logger, 'VideoHandler', 'Including IMQuery parameters in cache key', {
            imwidth,
            imheight,
            derivative: videoOptions.derivative
          });
        }
        
        // Use waitUntil if available to store in KV without blocking response
        const envWithCtx = env as unknown as EnvWithExecutionContext;
        if (envWithCtx.executionCtx && typeof envWithCtx.executionCtx.waitUntil === 'function') {
          envWithCtx.executionCtx.waitUntil(
            storeInKVCache(env, sourcePath, responseClone, videoOptionsWithIMQuery)
              .then(success => {
                if (success) {
                  debug(context, logger, 'VideoHandler', 'Stored in KV cache', {
                    path: sourcePath,
                    hasIMQuery: Object.keys(customData).length > 0,
                    derivative: videoOptions.derivative
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
          storeInKVCache(env, sourcePath, responseClone, videoOptionsWithIMQuery)
            .then(success => {
              if (success) {
                debug(context, logger, 'VideoHandler', 'Stored in KV cache', {
                  path: sourcePath,
                  hasIMQuery: Object.keys(customData).length > 0,
                  derivative: videoOptions.derivative
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

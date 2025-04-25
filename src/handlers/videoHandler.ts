/**
 * Video handler for processing video transformation requests
 * 
 * Main entry point for video transformation service
 */
import { determineVideoOptions } from './videoOptionsService';
import { isCdnCgiMediaPath } from '../utils/pathUtils';
import { getEnvironmentConfig, EnvVariables } from '../config/environmentConfig';
import { EnvironmentConfig } from '../config/environmentConfig';
import { VideoConfigurationManager } from '../config/VideoConfigurationManager';
import type { ExecutionContextExt, EnvWithExecutionContext } from '../types/cloudflare';
import { createRequestContext, addBreadcrumb } from '../utils/requestContext';
import { createLogger, info, debug, error } from '../utils/pinoLogger';
import { initializeLegacyLogger } from '../utils/legacyLoggerAdapter';
import { TransformOptions } from '../utils/kvCacheUtils';
import { ResponseBuilder } from '../utils/responseBuilder';
import { logErrorWithContext, withErrorHandling } from '../utils/errorHandlingUtils';

/**
 * Main handler for video requests
 * @param request The incoming request
 * @param config Environment configuration
 * @returns A response with the processed video
 */
export const handleVideoRequest = withErrorHandling<
  [Request, EnvironmentConfig, EnvVariables | undefined, ExecutionContext | undefined],
  Response
>(
  async function handleVideoRequestImpl(
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
    
    try {
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
      addBreadcrumb(context, 'Request', 'Started total-request-processing', {
        url: url.toString(),
        path: path,
        elapsedMs: 0
      });
      
      // Create breadcrumb for tracking request details
      addBreadcrumb(context, 'Request', 'Request received', {
        method: request.method,
        url: url.toString(),
        path: path,
        search: url.search,
      });
      
      // Set up videoConfig with the singleton instance
      const videoConfig = VideoConfigurationManager.getInstance(); 
      
      // If path is already a CDN-CGI media path, passthrough directly to the CDN
      if (isCdnCgiMediaPath(path)) {
        info(context, logger, 'VideoHandler', 'Request is already a CDN-CGI media request, passing through');
        return fetch(request);
      }
      
      // Import the cache services
      const { getCachedResponse, cacheResponse } = await import('../services/cacheManagementService');
      const { CacheConfigurationManager } = await import('../config');
      const { getFromKVCache, storeInKVCache } = await import('../utils/kvCacheUtils');

      // Try to get the response from KV cache
      addBreadcrumb(context, 'Cache', 'Checking KV cache', {
        url: request.url,
        bypassParams: CacheConfigurationManager.getInstance().getConfig().bypassQueryParameters?.join(',')
      });
      
      // Time the cache lookup operation
      startTimedOperation(context, 'cache-lookup', 'Cache');
      
      // Only check KV cache if available and not in debug mode
      const skipCache = url.searchParams.has('debug');
      let kvResponse: Response | null = null;
      
      // Start timing operations
      startTimedOperation(context, 'kv-cache-lookup', 'KVCache');
      
      // Prepare KV cache check if env is available and not skipped
      if (env && !skipCache) {
        const sourcePath = url.pathname;
        const videoOptions = determineVideoOptions(request, url.searchParams, path);
        
        // Get KV cache configuration
        const { CacheConfigurationManager } = await import('../config/CacheConfigurationManager');
        const cacheConfig = CacheConfigurationManager.getInstance();
        const kvCacheEnabled = cacheConfig.isKVCacheEnabled();
        
        // Only check KV cache if it's enabled in config
        if (kvCacheEnabled) {
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
          
          try {
            // Check KV cache with request for range handling support
            kvResponse = await getFromKVCache(env, sourcePath, videoOptions as unknown as TransformOptions, request);
          } catch (err) {
            debug(context, logger, 'KVCacheUtils', 'Error checking KV cache', {
              error: err instanceof Error ? err.message : String(err),
              sourcePath
            });
          }
        } else {
          debug(context, logger, 'KVCacheUtils', 'Skipping KV cache (disabled by configuration)', {
            sourcePath: sourcePath,
            enableKVCache: false
          });
        }
      } else if (skipCache) {
        debug(context, logger, 'VideoHandler', 'Skipping KV cache due to debug mode', {
          debugEnabled: context.debugEnabled,
          hasDebugParam: url.searchParams.has('debug')
        });
      }
      
      endTimedOperation(context, 'kv-cache-lookup');
      
      // If KV cache hit, return the response
      if (kvResponse) {
        // Get cache details from headers
        const cacheAge = kvResponse.headers.get('X-KV-Cache-Age') || 'unknown';
        const cacheTtl = kvResponse.headers.get('X-KV-Cache-TTL') || 'unknown';
        const cacheKey = kvResponse.headers.get('X-KV-Cache-Key') || url.pathname;
        const contentLength = kvResponse.headers.get('Content-Length') || 'unknown';
        const contentType = kvResponse.headers.get('Content-Type') || 'unknown';
        
        // Log the KV cache hit
        info(context, logger, 'VideoHandler', 'Serving from KV cache', {
          url: url.toString(),
          path: url.pathname,
          cacheAge: cacheAge,
          cacheTtl: cacheTtl,
          cacheKey: cacheKey,
          contentType: contentType,
          contentLength: contentLength,
          fromKvCache: true
        });
        
        addBreadcrumb(context, 'Cache', 'KV cache hit', {
          path: url.pathname,
          cacheAge: cacheAge,
          contentType: contentType,
          size: contentLength
        });
        
        // End overall cache lookup timing
        endTimedOperation(context, 'cache-lookup');
        
        // Ensure debug configuration is applied to the context
        const { DebugConfigurationManager } = await import('../config/DebugConfigurationManager');
        const debugConfig = DebugConfigurationManager.getInstance();
        
        // Override context debug flags with current configuration
        context.debugEnabled = debugConfig.isDebugEnabled() || context.debugEnabled;
        context.verboseEnabled = debugConfig.isVerboseEnabled() || context.verboseEnabled;
        
        debug(context, logger, 'ResponseBuilder', 'Building KV cached response with debug configuration', {
          debugEnabled: context.debugEnabled,
          verboseEnabled: context.verboseEnabled
        });
        
        // Create a new response with the same body but mutable headers
        const headers = new Headers(kvResponse.headers);
        headers.set('X-Cache-Source', 'KV');
        headers.set('X-Cache-Status', 'HIT');
        const mutableResponse = new Response(kvResponse.body, {
          status: kvResponse.status,
          statusText: kvResponse.statusText,
          headers: headers
        });
        
        // Return the KV cached response with debug headers
        const responseBuilder = new ResponseBuilder(mutableResponse, context);
        return await responseBuilder.withDebugInfo().build();
      }
      
      // If no cache hit, proceed with transformation
      // Log KV cache miss if we attempted lookup
      if (env && !skipCache) {
        addBreadcrumb(context, 'KVCache', 'KV cache miss', {
          path: url.pathname
        });
      }
      
      endTimedOperation(context, 'cache-lookup');

      // Get path patterns from config or use defaults - use let instead of const
      let pathPatterns = config.pathPatterns || videoConfig.getPathPatterns();
      
      // Log the path patterns to see what we have at this point
      debug(context, logger, 'VideoHandler', 'Path patterns from config', {
        source: config.pathPatterns ? 'environment-config' : 'default-config',
        patternCount: pathPatterns.length,
        patterns: pathPatterns.map((p: any) => ({
          name: p.name,
          matcher: p.matcher,
          processPath: p.processPath
        }))
      });
      
      // Also check VideoConfigurationManager to see what patterns it has
      try {
        const managerPatterns = videoConfig.getPathPatterns();
        debug(context, logger, 'VideoHandler', 'Path patterns from VideoConfigurationManager', {
          patternCount: managerPatterns.length,
          patterns: managerPatterns.map((p: any) => {
            return {
              name: p.name,
              matcher: p.matcher,
              processPath: p.processPath
            };
          })
        });
        
        // Use manager patterns if they exist and we didn't get any patterns from config
        if (managerPatterns.length > 0 && (!pathPatterns || pathPatterns.length === 0)) {
          pathPatterns = managerPatterns;
          debug(context, logger, 'VideoHandler', 'Using path patterns from VideoConfigurationManager');
        }
        
        // Log the final path patterns being used
        addBreadcrumb(context, 'Configuration', 'Path patterns for request', {
          patternCount: pathPatterns.length,
          patterns: pathPatterns.map((p: any) => p.name).join(', ')
        });
      } catch (err) {
        error(context, logger, 'VideoHandler', 'Error getting path patterns from manager', {
          error: err instanceof Error ? err.message : String(err)
        });
      }
      
      // Get video options from path and query parameters
      const videoOptions = determineVideoOptions(request, url.searchParams, path);
      
      // Configure debug options
      const debugInfo = {
        isEnabled: context.debugEnabled,
        isVerbose: context.verboseEnabled,
        includeHeaders: true,
        includePerformance: true,
        debug: context.debugEnabled
      };
      
      // Time the video transformation operation
      startTimedOperation(context, 'video-transformation', 'Transform');
      // Transform the video
      const response = await transformVideo(request, videoOptions as any, pathPatterns, debugInfo, env);
      endTimedOperation(context, 'video-transformation');
      
      // Add final timing information to diagnostics
      context.diagnostics.processingTimeMs = Math.round(performance.now() - context.startTime);
      
      // Initialize finalResponse - this will be our final response to return
      let finalResponse = response;
      
      // If derivative is present, make a more educated guess about video info
      if (context.diagnostics.derivative && videoOptions?.width && videoOptions?.height) {
        context.diagnostics.videoInfo = context.diagnostics.videoInfo || {};
        
        // Use the requested width/height as an estimate for original dimensions,
        // but only if they're reasonably sized (larger videos are more likely to be original dimensions)
        if (videoOptions.width > 640 && !context.diagnostics.videoInfo.width) {
          context.diagnostics.videoInfo.width = videoOptions.width;
        }
        
        if (videoOptions.height > 480 && !context.diagnostics.videoInfo.height) {
          context.diagnostics.videoInfo.height = videoOptions.height;
        }
      }
      
      // Store the response in KV cache if it's cacheable and not in debug mode
      if (response.headers.get('Cache-Control')?.includes('max-age=') && !skipCache) {
        // Use a non-blocking cache write to avoid delaying the response
        addBreadcrumb(context, 'Cache', 'Preparing to store in KV cache', {
          status: response.status,
          cacheControl: response.headers.get('Cache-Control'),
          contentType: response.headers.get('Content-Type'),
          contentLength: response.headers.get('Content-Length') || undefined
        });
        
        // Time the cache storage operation
        startTimedOperation(context, 'cache-storage', 'Cache');
        
        // Also store in KV cache if environment is available and not in debug mode
        if (env && videoOptions && !skipCache) {
          // Get KV cache configuration
          const { CacheConfigurationManager } = await import('../config/CacheConfigurationManager');
          const cacheConfig = CacheConfigurationManager.getInstance();
          const kvCacheEnabled = cacheConfig.isKVCacheEnabled();
          
          // Only proceed with KV cache if it's enabled in config
          if (kvCacheEnabled) {
            const sourcePath = url.pathname;
            const responseClone = response.clone();
            
            // Use derivative-based caching instead of specific IMQuery dimensions
            // This ensures better cache reuse when multiple imwidth/imheight values map to the same derivative
            
            // Add IMQuery detection to logs but don't use for cache key
            const imwidth = url.searchParams.get('imwidth');
            const imheight = url.searchParams.get('imheight');
            const hasIMRef = url.searchParams.has('imref');
            const hasIMQueryParams = !!(imwidth || imheight || hasIMRef);
            
            // Ensure we're using a derivative-based cache key for IMQuery requests
            // This provides better cache hit rates by normalizing requests with slight dimension differences
            let videoOptionsWithIMQuery = videoOptions;
            if (hasIMQueryParams) {
              if (videoOptions.derivative) {
                debug(context, logger, 'VideoHandler', 'Using derivative-based caching for IMQuery request', {
                  imwidth,
                  imheight,
                  hasIMRef,
                  derivative: videoOptions.derivative,
                  cacheType: 'derivative-based'
                });
                
                // For IMQuery requests, include only the derivative, width and height in cache key
                // This ensures consistent cache keys regardless of custom parameters
                videoOptionsWithIMQuery = {
                  derivative: videoOptions.derivative,
                  width: videoOptions.width,
                  height: videoOptions.height,
                  // Keep mode in case this is a video/frame/spritesheet request
                  mode: videoOptions.mode
                };
                
                addBreadcrumb(context, 'Cache', 'Using optimized IMQuery cache key', {
                  derivative: videoOptions.derivative,
                  originalParams: Object.keys(videoOptions).length,
                  optimizedParams: Object.keys(videoOptionsWithIMQuery).length
                });
              } else {
                debug(context, logger, 'VideoHandler', 'IMQuery request without mapped derivative', {
                  imwidth,
                  imheight,
                  hasIMRef,
                  cacheType: 'dimension-based'
                });
              }
            }
            
            // Use waitUntil if available to store in KV without blocking response
            const envWithCtx = env as unknown as EnvWithExecutionContext;
            if (envWithCtx.executionCtx && typeof envWithCtx.executionCtx.waitUntil === 'function') {
              envWithCtx.executionCtx.waitUntil(
                storeInKVCache(env, sourcePath, responseClone, videoOptionsWithIMQuery as unknown as TransformOptions)
                  .then(success => {
                    if (success) {
                      debug(context, logger, 'VideoHandler', 'Stored in KV cache', {
                        path: sourcePath,
                        hasIMQuery: !!(imwidth || imheight),
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
              storeInKVCache(env, sourcePath, responseClone, videoOptionsWithIMQuery as unknown as TransformOptions)
                .then(success => {
                  if (success) {
                    debug(context, logger, 'VideoHandler', 'Stored in KV cache', {
                      path: sourcePath,
                      hasIMQuery: !!(imwidth || imheight),
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
            // KV cache is disabled in config
            debug(context, logger, 'VideoHandler', 'Skipping KV cache storage (disabled by configuration)', {
              enableKVCache: false
            });
            endTimedOperation(context, 'cache-storage');
          }
        } else {
          endTimedOperation(context, 'cache-storage');
        }
      } else if (skipCache && response.headers.get('Cache-Control')?.includes('max-age=')) {
        // Log that we're skipping cache storage due to debug parameter
        debug(context, logger, 'VideoHandler', 'Skipping cache storage due to debug parameter', {
          debugEnabled: context.debugEnabled,
          hasDebugParam: url.searchParams.has('debug'),
          debugParamValue: url.searchParams.get('debug')
        });
      }

      // Use ResponseBuilder for consistent response handling including range requests
      startTimedOperation(context, 'response-building', 'Response');
      
      // Ensure debug configuration is applied to the context
      const { DebugConfigurationManager } = await import('../config/DebugConfigurationManager');
      const debugConfig = DebugConfigurationManager.getInstance();
      
      // Override context debug flags with current configuration
      context.debugEnabled = debugConfig.isDebugEnabled() || context.debugEnabled;
      context.verboseEnabled = debugConfig.isVerboseEnabled() || context.verboseEnabled;
      
      debug(context, logger, 'ResponseBuilder', 'Building response with debug configuration', {
        debugEnabled: context.debugEnabled,
        verboseEnabled: context.verboseEnabled
      });
      
      // Check if we should add cache tags to the final response
      if (finalResponse.ok && finalResponse.status < 300) {
        try {
          // Import necessary functions
          const { CacheConfigurationManager } = await import('../config/CacheConfigurationManager');
          const { generateCacheTags } = await import('../services/videoStorageService');
          
          // Check if cache tags are enabled in configuration
          const cacheConfigMgr = CacheConfigurationManager.getInstance();
          if (cacheConfigMgr.getConfig().enableCacheTags) {
            const url = new URL(request.url);
            
            // Generate tags using the video options
            // Cast videoOptions to match the expected type with index signature
            const tags = generateCacheTags(url.pathname, videoOptions as any, finalResponse.headers);
            if (tags.length > 0) {
              debug(context, logger, 'VideoHandler', 'Applying cache tags to final response', {
                tagCount: tags.length
              });
              
              // Clone the response to modify headers
              const newHeaders = new Headers(finalResponse.headers);
              newHeaders.set('Cache-Tag', tags.join(','));
              
              finalResponse = new Response(finalResponse.body, {
                status: finalResponse.status,
                statusText: finalResponse.statusText,
                headers: newHeaders
              });
              
              addBreadcrumb(context, 'Cache', 'Applied Cache-Tags to final response', {
                count: tags.length,
                firstTags: tags.slice(0, 3).join(',')
              });
            }
          }
        } catch (tagError) {
          // Fallback to original response if applying tags fails
          error(context, logger, 'VideoHandler', 'Failed to apply cache tags', {
            error: tagError instanceof Error ? tagError.message : String(tagError)
          });
        }
      }
      
      const responseBuilder = new ResponseBuilder(finalResponse, context);
      const result = await responseBuilder.withDebugInfo().build();
      endTimedOperation(context, 'response-building');
      
      // End the total request timing
      endTimedOperation(context, 'total-request-processing');
      
      return result;
    } catch (err: unknown) {
      // Record error timing
      startTimedOperation(context, 'error-handling', 'Error');
      
      // Use standardized error handling
      logErrorWithContext('Error handling video request', err, {
        url: request.url,
        path: new URL(request.url).pathname,
        requestId: context.requestId
      }, 'VideoHandler');

      // Add error to diagnostics
      if (!context.diagnostics.errors) {
        context.diagnostics.errors = [];
      }
      context.diagnostics.errors.push(err instanceof Error ? err.message : 'Unknown error');
      
      // Add storage diagnostics for better debugging
      try {
        const { VideoConfigurationManager } = await import('../config/VideoConfigurationManager');
        const configManager = VideoConfigurationManager.getInstance();
        context.diagnostics.storageDiagnostics = configManager.getStorageDiagnostics(env as Record<string, unknown>);
      } catch (diagError) {
        // If diagnostics fail, don't block error handling
        error(context, logger, 'VideoHandler', 'Failed to add storage diagnostics', {
          error: diagError instanceof Error ? diagError.message : 'Unknown error'
        });
      }
      
      // Create error response with ResponseBuilder
      const errorResponse = new Response(`Error processing video: ${err instanceof Error ? err.message : 'Unknown error'}`, {
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
  },
  {
    functionName: 'handleVideoRequest',
    component: 'VideoHandler',
    logErrors: true
  }
);

/**
 * Dynamically import the video transformation function to avoid circular dependencies
 */
async function transformVideo(
  request: Request, 
  options: Record<string, unknown>, 
  pathPatterns: any[], 
  debugInfo: any, 
  env?: EnvVariables
): Promise<Response> {
  // Import the transformation function with dynamic import
  const { transformVideo: transform } = await import('../services/videoTransformationService');
  
  // Call the transform function directly
  return transform(request, options, pathPatterns, debugInfo, env);
}
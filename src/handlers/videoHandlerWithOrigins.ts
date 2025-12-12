/**
 * Video handler with Origins-based resolution
 * 
 * This handler uses the Origins system to resolve video paths to the appropriate sources,
 * providing a more intuitive and flexible configuration model than the legacy system.
 */

import { EnvironmentConfig, EnvVariables } from '../config/environmentConfig';
import { VideoConfigurationManager } from '../config/VideoConfigurationManager';
import { TransformOptions } from '../utils/kvCacheUtils';
import { OriginResolver } from '../services/origins/OriginResolver';
import { createRequestContext, addBreadcrumb, 
         startTimedOperation, endTimedOperation, setCurrentContext } from '../utils/requestContext';
import { createLogger, info, debug, error, warn } from '../utils/pinoLogger';
import { initializeLegacyLogger } from '../utils/legacyLoggerAdapter';
import { logErrorWithContext, withErrorHandling } from '../utils/errorHandlingUtils';
import { ResponseBuilder } from '../utils/responseBuilder';
import { determineVideoOptions } from './videoOptionsService';
import { isCdnCgiMediaPath } from '../utils/pathUtils';
import type { EnvWithExecutionContext } from '../types/cloudflare';
import type { WorkerEnvironment } from '../domain/commands/TransformVideoCommand';
import type { Origin, VideoOptions } from '../services/videoStorage/interfaces';
import { getCacheKV, getVersionKV } from '../utils/flexibleBindings';

// In-flight transformation tracking to prevent duplicate origin fetches
const inFlightTransformations = new Map<string, Promise<Response>>();

/**
 * Main handler for video requests using the Origins system
 * 
 * @param request The incoming request
 * @param config Environment configuration
 * @param env Environment variables including KV bindings
 * @param ctx Execution context
 * @returns Response with the processed video
 */
export const handleVideoRequestWithOrigins = withErrorHandling<
  [Request, EnvironmentConfig, EnvVariables | undefined, ExecutionContext | undefined],
  Response
>(
  async function handleVideoRequestWithOriginsImpl(
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
    
    // Set the current request context for the global context manager
    setCurrentContext(context);
    
    const logger = createLogger(context);
    
    try {
      // Log environment variables received for debugging
      if (env) {
        const cacheKV = getCacheKV(env);
        debug(context, logger, 'VideoHandlerWithOrigins', 'Environment variables received', {
          CACHE_ENABLE_KV: env.CACHE_ENABLE_KV || 'not set',
          CACHE_KV_AVAILABLE: !!cacheKV,
          CACHE_KV_NAME: env.CACHE_KV_NAME || 'not set',
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
      addBreadcrumb(context, 'Request', 'Started processing with Origins handler', {
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
        info(context, logger, 'VideoHandlerWithOrigins', 'Request is already a CDN-CGI media request, passing through');
        return fetch(request);
      }
      
      // Import the cache services
      const { cacheResponse } = await import('../services/cacheManagementService');
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
      
      // Prepare video options early for both cache check and speculative fetch
      const sourcePath = url.pathname;
      const initialVideoOptions = determineVideoOptions(request, url.searchParams, path);
      const cachedFilename = initialVideoOptions.filename || null;
      
      // Start speculative origin resolution while checking cache
      const speculativeOriginPromise: Promise<any> | null = null;
      let originMatch: any = null;
      let sourceResolution: any = null;
      
      // We need to resolve the origin first to get origin-specific options
      // This ensures cache keys match between storage and retrieval
      const originResolver = new OriginResolver(videoConfig.getConfig());
      originMatch = originResolver.matchOriginWithCaptures(path);
      
      if (originMatch) {
        sourceResolution = originResolver.resolvePathToSource(path);
        
        // Apply origin-specific options to initial video options for consistent cache keys
        if (originMatch.origin.quality && !initialVideoOptions.quality) {
          initialVideoOptions.quality = originMatch.origin.quality;
        }
        
        if (originMatch.origin.videoCompression && !initialVideoOptions.compression) {
          initialVideoOptions.compression = originMatch.origin.videoCompression;
        }
        
        debug(context, logger, 'VideoHandlerWithOrigins', 'Applied origin options for cache lookup', {
          origin: originMatch.origin.name,
          compression: initialVideoOptions.compression,
          quality: initialVideoOptions.quality
        });
      }
      
      // Get the current cache version for KV cache lookup
      // This ensures we use the correct version when checking cache
      if (env) {
        const { getCacheKeyVersion } = await import('../services/cacheVersionService');
        const { generateKVKey } = await import('../services/kvStorage/keyUtils');
        
        // Generate the exact same cache key that KV storage will use
        // This ensures version tracking matches the actual cache keys
        const versionCacheKey = generateKVKey(path, initialVideoOptions);
        
        // Get the current version (will be 1 if not found)
        const currentVersion = await getCacheKeyVersion(env, versionCacheKey) || 1;
        initialVideoOptions.version = currentVersion;
        
        debug(context, logger, 'VideoHandlerWithOrigins', 'Retrieved cache version for lookup', {
          versionCacheKey,
          version: currentVersion,
          path,
          derivative: initialVideoOptions.derivative
        });
      }
      
      // No need for speculative origin resolution since we already resolved it
      
      // Prepare KV cache check if env is available and not skipped
      if (env && !skipCache) {
        // Get KV cache configuration
        const { CacheConfigurationManager } = await import('../config/CacheConfigurationManager');
        const cacheConfig = CacheConfigurationManager.getInstance();
        const kvCacheEnabled = cacheConfig.isKVCacheEnabled();
        
        // Only check KV cache if it's enabled in config
        if (kvCacheEnabled) {
          addBreadcrumb(context, 'Cache', 'Checking KV cache', {
            url: request.url,
            path: sourcePath,
            options: JSON.stringify(initialVideoOptions)
          });
          
          debug(context, logger, 'KVCacheUtils', 'Checking KV cache for video', {
            sourcePath: sourcePath,
            derivative: initialVideoOptions.derivative,
            hasQuery: url.search.length > 0
          });
          
          try {
            // Check KV cache with request for range handling support
            kvResponse = await getFromKVCache(env, sourcePath, initialVideoOptions as unknown as TransformOptions, request);
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
        debug(context, logger, 'VideoHandlerWithOrigins', 'Skipping KV cache due to debug mode', {
          debugEnabled: context.debugEnabled,
          hasDebugParam: url.searchParams.has('debug')
        });
      }
      
      endTimedOperation(context, 'kv-cache-lookup');
      
      // If KV cache hit, return the response
      if (kvResponse) {
        // Cancel speculative origin resolution if we have a cache hit
        if (speculativeOriginPromise) {
          debug(context, logger, 'VideoHandlerWithOrigins', 'Cancelling speculative origin resolution due to cache hit', {
            path: url.pathname
          });
        }
        
        // Get cache details from headers
        const cacheAge = kvResponse.headers.get('X-KV-Cache-Age') || 'unknown';
        const cacheTtl = kvResponse.headers.get('X-KV-Cache-TTL') || 'unknown';
        const cacheKey = kvResponse.headers.get('X-KV-Cache-Key') || url.pathname;
        const contentLength = kvResponse.headers.get('Content-Length') || 'unknown';
        const contentType = kvResponse.headers.get('Content-Type') || 'unknown';
        
        // Log the KV cache hit
        info(context, logger, 'VideoHandlerWithOrigins', 'Serving from KV cache', {
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
        headers.set('X-Handler', 'Origins');
        const mutableResponse = new Response(kvResponse.body, {
          status: kvResponse.status,
          statusText: kvResponse.statusText,
          headers: headers
        });
        
        // Return the KV cached response with debug headers
        // Force audio content type for audio mode to avoid browsers treating it as video
        let adjustedResponse: Response = mutableResponse;
        if (cachedFilename && cachedFilename.endsWith('.m4a')) {
          const h = new Headers(mutableResponse.headers);
          h.set('Content-Type', 'audio/mp4');
          adjustedResponse = new Response(mutableResponse.body, {
            status: mutableResponse.status,
            statusText: mutableResponse.statusText,
            headers: h
          });
        }

        const responseBuilder = new ResponseBuilder(adjustedResponse, context);
        const builtResponse = await responseBuilder
          .withFilename(cachedFilename)
          .withDebugInfo()
          .build();
        endTimedOperation(context, 'total-request-processing');
        return builtResponse;
      }
      
      // If no cache hit, proceed with transformation using Origins
      // Log KV cache miss if we attempted lookup
      if (env && !skipCache) {
        addBreadcrumb(context, 'KVCache', 'KV cache miss', {
          path: url.pathname
        });
        
        // After cache miss, check if version was incremented and update our options
        const versionKV = getVersionKV(env);
        if (versionKV) {
          const { getCacheKeyVersion } = await import('../services/cacheVersionService');
          const { generateKVKey } = await import('../services/kvStorage/keyUtils');
          
          // Generate the same cache key that was used in the lookup
          const updatedCacheKey = generateKVKey(path, initialVideoOptions);
          
          // Get the potentially updated version after cache miss
          const updatedVersion = await getCacheKeyVersion(env, updatedCacheKey) || 1;
          
          // If version was incremented, update our options
          if (updatedVersion > (initialVideoOptions.version || 1)) {
            debug(context, logger, 'VideoHandlerWithOrigins', 'Version was incremented after cache miss', {
              oldVersion: initialVideoOptions.version || 1,
              newVersion: updatedVersion,
              cacheKey: updatedCacheKey
            });
            
            // Update initial video options with new version
            initialVideoOptions.version = updatedVersion;
            
            // Update context diagnostics
            if (context.diagnostics.transformOptions && typeof context.diagnostics.transformOptions === 'object') {
              (context.diagnostics.transformOptions as any).version = updatedVersion;
            }
          }
        }
      }
      
      endTimedOperation(context, 'cache-lookup');

      // Origin resolution already done before cache check, no need to do it again
      
      if (!originMatch) {
        // No matching origin found
        debug(context, logger, 'VideoHandlerWithOrigins', 'No matching origin for path', {
          path: path,
          originCount: videoConfig.getOrigins().length,
          origins: videoConfig.getOrigins().map(o => o.name)
        });
        
        // Return error response
        const errorResponse = new Response(
          `No matching origin found for path: ${path}`, 
          { 
            status: 404, 
            headers: { 
              'Content-Type': 'text/plain',
              'Cache-Control': 'no-store',
              'X-Handler': 'Origins',
              'X-Error': 'NoMatchingOrigin'
            } 
          }
        );
        
        const responseBuilder = new ResponseBuilder(errorResponse, context);
        return await responseBuilder.withDebugInfo().build();
      }
      
      // Found a matching origin - add to context
      context.diagnostics.origin = {
        name: originMatch.origin.name,
        matcher: originMatch.origin.matcher,
        capturedParams: originMatch.captures
      };
      
      addBreadcrumb(context, 'Origins', 'Matched origin', {
        origin: originMatch.origin.name,
        matcher: originMatch.origin.matcher,
        captures: JSON.stringify(originMatch.captures)
      });
      
      debug(context, logger, 'VideoHandlerWithOrigins', 'Matched origin for request', {
        origin: originMatch.origin.name,
        path: path,
        captures: originMatch.captures
      });
      
      // Check if we have source resolution (either from speculative or just resolved)
      if (!sourceResolution) {
        // No valid source found in the origin
        debug(context, logger, 'VideoHandlerWithOrigins', 'No valid source found in origin', {
          origin: originMatch.origin.name,
          sourceCount: originMatch.origin.sources.length,
          sources: originMatch.origin.sources.map((s: any) => s.type)
        });
        
        // Return error response
        const errorResponse = new Response(
          `No valid source found in origin: ${originMatch.origin.name}`, 
          { 
            status: 500, 
            headers: { 
              'Content-Type': 'text/plain',
              'Cache-Control': 'no-store',
              'X-Handler': 'Origins',
              'X-Error': 'NoValidSource'
            } 
          }
        );
        
        const responseBuilder = new ResponseBuilder(errorResponse, context);
        return await responseBuilder.withDebugInfo().build();
      }
      
      // Add source resolution to context
      context.diagnostics.sourceInfo = {
        type: sourceResolution.originType,
        resolvedPath: sourceResolution.resolvedPath,
        url: sourceResolution.sourceUrl
      };
      
      addBreadcrumb(context, 'Origins', 'Resolved source', {
        sourceType: sourceResolution.originType,
        resolvedPath: sourceResolution.resolvedPath,
        url: sourceResolution.sourceUrl
      });
      
      debug(context, logger, 'VideoHandlerWithOrigins', 'Resolved path to source', {
        sourceType: sourceResolution.originType,
        resolvedPath: sourceResolution.resolvedPath,
        url: sourceResolution.sourceUrl
      });
      
      // Get video options from path and query parameters
      const videoOptions = determineVideoOptions(request, url.searchParams, path);
      
      // Add origin-specific options if available
      if (originMatch.origin.quality && !videoOptions.quality) {
        videoOptions.quality = originMatch.origin.quality;
      }
      
      // Only apply videoCompression if not already set by derivative or explicit parameter
      if (originMatch.origin.videoCompression && !videoOptions.compression) {
        videoOptions.compression = originMatch.origin.videoCompression;
      }
      
      // CRITICAL: Use the updated version from initialVideoOptions which includes any increment from cache miss
      // This ensures CDN requests use the incremented version (v=2, v=3, etc) for cache busting
      videoOptions.version = initialVideoOptions.version || 1;
      
      debug(context, logger, 'VideoHandlerWithOrigins', 'Using cache version for transformation', {
        version: videoOptions.version,
        initialVersion: initialVideoOptions.version,
        path,
        hadCacheMiss: !kvResponse
      });
      
      // Configure debug options
      const debugInfo = {
        isEnabled: context.debugEnabled,
        isVerbose: context.verboseEnabled,
        includeHeaders: true,
        includePerformance: true,
        debug: context.debugEnabled
      };

      // CRITICAL: Pre-check video size to avoid transformation timeout for large videos
      // Perform HEAD request to get Content-Length before attempting transformation
      let shouldBypassTransformation = false;
      let videoSizeInBytes: number | null = null;

      if (sourceResolution.sourceUrl &&
          (sourceResolution.sourceUrl.startsWith('http://') ||
           sourceResolution.sourceUrl.startsWith('https://'))) {

        debug(context, logger, 'VideoHandlerWithOrigins', 'Checking video size before transformation', {
          sourceUrl: sourceResolution.sourceUrl,
          origin: originMatch.origin.name
        });

        addBreadcrumb(context, 'SizeCheck', 'Performing HEAD request for Content-Length', {
          url: sourceResolution.sourceUrl
        });

        // Import HTTP utilities for size checking
        const { getContentLength, exceedsTransformationLimit, CDN_CGI_SIZE_LIMIT } =
          await import('../utils/httpUtils');

        // Get Content-Length with 5 second timeout
        videoSizeInBytes = await getContentLength(sourceResolution.sourceUrl, {
          timeout: 5000,
          headers: request.headers
        });

        if (videoSizeInBytes !== null) {
          const sizeInMB = Math.round(videoSizeInBytes / 1024 / 1024);
          const limitInMB = Math.round(CDN_CGI_SIZE_LIMIT / 1024 / 1024);

          debug(context, logger, 'VideoHandlerWithOrigins', 'Retrieved video size', {
            sizeBytes: videoSizeInBytes,
            sizeMB: sizeInMB,
            limitMB: limitInMB,
            exceedsLimit: exceedsTransformationLimit(videoSizeInBytes)
          });

          addBreadcrumb(context, 'SizeCheck', 'Video size retrieved', {
            sizeMB: sizeInMB,
            exceedsLimit: exceedsTransformationLimit(videoSizeInBytes)
          });

          // Check if video exceeds transformation limit
          if (exceedsTransformationLimit(videoSizeInBytes)) {
            shouldBypassTransformation = true;

            logger.warn({
              msg: 'Video exceeds CDN-CGI size limit, bypassing transformation',
              sizeMB: sizeInMB,
              limitMB: limitInMB,
              sourceUrl: sourceResolution.sourceUrl,
              origin: originMatch.origin.name,
              requestId: context.requestId
            });

            addBreadcrumb(context, 'SizeCheck', 'Bypassing transformation - video too large', {
              sizeMB: sizeInMB,
              limitMB: limitInMB,
              reason: 'Exceeds 256 MiB transformation limit'
            });
          }
        } else {
          debug(context, logger, 'VideoHandlerWithOrigins', 'Could not retrieve Content-Length, proceeding with transformation', {
            sourceUrl: sourceResolution.sourceUrl,
            reason: 'HEAD request failed or no Content-Length header'
          });

          addBreadcrumb(context, 'SizeCheck', 'Content-Length unavailable', {
            reason: 'Will attempt transformation'
          });
        }
      }

      // If size check indicates bypass, stream directly from source
      if (shouldBypassTransformation) {
        debug(context, logger, 'VideoHandlerWithOrigins', 'Streaming directly from source without transformation', {
          sourceUrl: sourceResolution.sourceUrl,
          sizeMB: videoSizeInBytes ? Math.round(videoSizeInBytes / 1024 / 1024) : 'unknown'
        });

        addBreadcrumb(context, 'DirectStream', 'Fetching directly from origin', {
          sourceUrl: sourceResolution.sourceUrl,
          bypassReason: 'Video exceeds transformation size limit'
        });

        // Time the direct fetch operation
        startTimedOperation(context, 'direct-fetch-large-video', 'DirectFetch');

        try {
          // Fetch directly from source with original request headers (including Range)
          const directResponse = await fetch(sourceResolution.sourceUrl, {
            method: request.method,
            headers: request.headers,
            redirect: 'follow'
          });

          if (!directResponse.ok) {
            logger.error({
              msg: 'Direct fetch failed for large video',
              status: directResponse.status,
              sourceUrl: sourceResolution.sourceUrl,
              requestId: context.requestId
            });

            addBreadcrumb(context, 'DirectStream', 'Direct fetch failed', {
              status: directResponse.status
            });

            // Fall through to transformation attempt as fallback
          } else {
            // Success - add bypass headers and return
            const headers = new Headers(directResponse.headers);
            headers.set('X-Video-Size-Bypass', 'true');
            headers.set('X-Video-Exceeds-256MiB', 'true');
            headers.set('X-Direct-Stream', 'true');
            headers.set('X-Bypass-Cache-API', 'true');
            headers.set('X-Handler', 'Origins');
            headers.set('X-Origin', originMatch.origin.name);

            if (videoSizeInBytes !== null) {
              headers.set('X-Original-Content-Length', videoSizeInBytes.toString());
            }

            const finalResponse = new Response(directResponse.body, {
              status: directResponse.status,
              statusText: directResponse.statusText,
              headers
            });

            debug(context, logger, 'VideoHandlerWithOrigins', 'Successfully streamed large video directly', {
              status: directResponse.status,
              contentType: directResponse.headers.get('Content-Type'),
              hasRangeSupport: directResponse.headers.get('Accept-Ranges') === 'bytes',
              sizeMB: videoSizeInBytes ? Math.round(videoSizeInBytes / 1024 / 1024) : 'unknown'
            });

            addBreadcrumb(context, 'DirectStream', 'Direct streaming successful', {
              status: directResponse.status,
              bypassedTransformation: true
            });

            endTimedOperation(context, 'direct-fetch-large-video');

            // Add processing time to diagnostics
            context.diagnostics.processingTimeMs = Math.round(performance.now() - context.startTime);

            // Build response with debug info
            const responseBuilder = new ResponseBuilder(finalResponse, context);
            return await responseBuilder.withDebugInfo().build();
          }
        } catch (error) {
          logger.error({
            msg: 'Error during direct fetch for large video',
            error: error instanceof Error ? error.message : String(error),
            sourceUrl: sourceResolution.sourceUrl,
            requestId: context.requestId
          });

          addBreadcrumb(context, 'DirectStream', 'Direct fetch error', {
            error: error instanceof Error ? error.message : String(error)
          });

          // Fall through to transformation attempt as fallback
        } finally {
          endTimedOperation(context, 'direct-fetch-large-video');
        }
      }

      // Generate a unique key for this transformation to enable request coalescing
      const transformKey = `${originMatch.origin.name}:${sourceResolution.resolvedPath}:${JSON.stringify({
        width: videoOptions.width,
        height: videoOptions.height,
        derivative: videoOptions.derivative,
        quality: videoOptions.quality,
        compression: videoOptions.compression,
        format: videoOptions.format,
        mode: videoOptions.mode
      })}`;
      
      // Check if there's already an in-flight transformation for this exact request
      const existingTransform = inFlightTransformations.get(transformKey);
      
      let response: Response;
      
      if (existingTransform) {
        // Join the existing transformation to avoid duplicate origin fetches
        debug(context, logger, 'VideoHandlerWithOrigins', 'Joining existing transformation request', {
          transformKey: transformKey.substring(0, 100), // Log first 100 chars
          inFlightCount: inFlightTransformations.size
        });
        
        addBreadcrumb(context, 'Transform', 'Coalescing with existing transformation', {
          origin: originMatch.origin.name,
          path: sourceResolution.resolvedPath
        });
        
        // Time the coalesced wait
        startTimedOperation(context, 'video-transformation-coalesced', 'Transform');
        
        try {
          response = await existingTransform;
          
          debug(context, logger, 'VideoHandlerWithOrigins', 'Successfully joined existing transformation', {
            origin: originMatch.origin.name,
            status: response.status
          });
        } finally {
          endTimedOperation(context, 'video-transformation-coalesced');
        }
      } else {
        // This is the first request for this transformation
        debug(context, logger, 'VideoHandlerWithOrigins', 'Initiating new transformation', {
          transformKey: transformKey.substring(0, 100), // Log first 100 chars
          origin: originMatch.origin.name,
          path: sourceResolution.resolvedPath
        });
        
        // Time the video transformation operation
        startTimedOperation(context, 'video-transformation', 'Transform');
        
        // Create the transformation promise
        const transformPromise = transformVideoWithOrigins(
          request, 
          videoOptions as any, 
          originMatch.origin,
          sourceResolution,
          debugInfo, 
          env
        );
        
        // Store it for potential reuse by concurrent requests
        inFlightTransformations.set(transformKey, transformPromise);
        
        try {
          response = await transformPromise;
          
          debug(context, logger, 'VideoHandlerWithOrigins', 'Transformation completed successfully', {
            origin: originMatch.origin.name,
            status: response.status,
            contentType: response.headers.get('Content-Type')
          });
        } finally {
          // Clean up the in-flight transformation
          inFlightTransformations.delete(transformKey);
          endTimedOperation(context, 'video-transformation');
          
          debug(context, logger, 'VideoHandlerWithOrigins', 'Cleaned up in-flight transformation', {
            remainingInFlight: inFlightTransformations.size
          });
        }
      }
      
      // Add final timing information to diagnostics
      context.diagnostics.processingTimeMs = Math.round(performance.now() - context.startTime);
      
      // CRITICAL: Clone response ONLY for coalesced requests to avoid stream locking
      // When request coalescing occurs, multiple requests share the same Response object.
      // The ResponseBuilder needs to read the body stream, which can only be done once.
      // Only clone for requests that joined an existing transformation to minimize memory usage.
      // The first request (that initiated the transformation) uses the original response.
      let finalResponse = response;
      if (existingTransform) {
        finalResponse = response.clone();
        debug(context, logger, 'VideoHandlerWithOrigins', 'Cloned response for coalesced request', {
          origin: originMatch.origin.name,
          status: response.status,
          reason: 'Avoiding stream lock on shared response'
        });
      }
      
      // Check if we should store in KV cache (not in debug mode and KV is enabled)
      if (env && videoOptions && !skipCache) {
        const { CacheConfigurationManager } = await import('../config/CacheConfigurationManager');
        const cacheConfig = CacheConfigurationManager.getInstance();
        const kvCacheEnabled = cacheConfig.isKVCacheEnabled();
        
        if (kvCacheEnabled && ctx) {
          // Prepare KV storage options
          const sourcePath = url.pathname;
          const imwidth = url.searchParams.get('imwidth');
          const imheight = url.searchParams.get('imheight');
          const hasIMRef = url.searchParams.has('imref');
          const hasIMQueryParams = !!(imwidth || imheight || hasIMRef);
          
          let videoOptionsForKV = videoOptions;
          if (hasIMQueryParams && videoOptions.derivative) {
            // Use optimized cache key for IMQuery requests
            videoOptionsForKV = {
              derivative: videoOptions.derivative,
              width: videoOptions.width,
              height: videoOptions.height,
              mode: videoOptions.mode,
              version: videoOptions.version // Preserve version for proper cache tracking
            };
          }
          
          // Add origin TTL if available
          const originTtl = response.headers.get('X-Origin-TTL');
          if (originTtl) {
            videoOptionsForKV = {
              ...videoOptionsForKV,
              customData: {
                ...(videoOptionsForKV.customData || {}),
                originTtl: parseInt(originTtl, 10)
              }
            };
          }
          
          // Clone the response for KV storage (to avoid consuming the body)
          // IMPORTANT: Use finalResponse which may be a clone for coalesced requests
          const responseForKV = finalResponse.clone();
          
          // Store in KV asynchronously using waitUntil to avoid blocking the response
          ctx.waitUntil(
            (async () => {
              try {
                debug(context, logger, 'VideoHandlerWithOrigins', 'Storing response in KV (background)', {
                  path: sourcePath,
                  hasIMQuery: hasIMQueryParams,
                  derivative: videoOptions.derivative
                });
                
                const storedInKV = await storeInKVCache(env, sourcePath, responseForKV, videoOptionsForKV as unknown as TransformOptions);
                
                if (storedInKV) {
                  debug(context, logger, 'VideoHandlerWithOrigins', 'Successfully stored in KV (background)', {
                    path: sourcePath
                  });
                } else {
                  debug(context, logger, 'VideoHandlerWithOrigins', 'KV storage failed (background)', {
                    path: sourcePath
                  });
                }
              } catch (err) {
                error(context, logger, 'VideoHandlerWithOrigins', 'Error storing in KV (background)', {
                  error: err instanceof Error ? err.message : String(err),
                  path: sourcePath
                });
              }
            })()
          );
        }
      }
      
      // Handle range requests on the response
      if (request.headers.has('Range') && finalResponse.headers.get('Content-Type')?.includes('video/')) {
        // Import the centralized bypass headers utility
        const { hasBypassHeaders } = await import('../utils/bypassHeadersUtils');
        
        // Check if this is a fallback response, large video, or any other bypass flag
        // For these cases, we want to completely avoid Cache API operations
        const bypassCacheApi = hasBypassHeaders(finalResponse.headers) || 
                               finalResponse.headers.get('X-Video-Too-Large') === 'true' ||
                               finalResponse.headers.get('X-Fallback-Applied') === 'true';
        
        // For fallbacks or large videos, completely skip Cache API - but still handle range requests directly
        if (bypassCacheApi) {
          // Identify the reason for bypass (helpful for debugging)
          const bypassReason = finalResponse.headers.get('X-Video-Exceeds-256MiB') === 'true' ? 
                               'VideoTooLarge' : 
                               finalResponse.headers.get('X-Fallback-Applied') === 'true' ?
                               'FallbackContent' : 'CacheAPIBypass';
          
          // Log this bypass for debugging
          addBreadcrumb(context, 'RangeRequest', 'Using direct streaming (bypassing Cache API)', {
            contentLength: finalResponse.headers.get('Content-Length'),
            contentType: finalResponse.headers.get('Content-Type'),
            bypassReason,
            hasRangeSupport: finalResponse.headers.get('Accept-Ranges') === 'bytes'
          });
          
          debug(context, logger, 'VideoHandlerWithOrigins', 'Direct streaming video response without Cache API', {
            contentLength: finalResponse.headers.get('Content-Length'),
            contentType: finalResponse.headers.get('Content-Type'),
            hasRangeSupport: finalResponse.headers.get('Accept-Ranges') === 'bytes',
            bypassReason
          });
          
          // For fallbacks, we still need to handle range requests, but directly without Cache API
          const rangeHeader = request.headers.get('Range');
          // IMPORTANT: Only process range requests if the response is NOT already a 206 Partial Content
          // If the origin already handled the range request, we should pass it through as-is
          if (rangeHeader && finalResponse.headers.get('Accept-Ranges') === 'bytes' && finalResponse.status !== 206) {
            try {
              // Use the centralized range request handler
              const { handleRangeRequest } = await import('../utils/streamUtils');
              
              // Log the range request attempt
              debug(context, logger, 'VideoHandlerWithOrigins', 'Processing range request for direct stream', {
                rangeHeader,
                contentLength: finalResponse.headers.get('Content-Length'),
                bypassReason
              });
              
              // Handle the range request with appropriate options
              const rangeResponse = await handleRangeRequest(finalResponse, rangeHeader, {
                bypassCacheAPI: true,
                preserveHeaders: true,
                handlerTag: 'VideoHandlerWithOrigins-Direct-Stream',
                fallbackApplied: finalResponse.headers.get('X-Fallback-Applied') === 'true'
              });
              
              // Only replace if we got a valid range response (status 206)
              if (rangeResponse.status === 206) {
                finalResponse = rangeResponse;
                
                // Log the successful range request handling
                addBreadcrumb(context, 'RangeRequest', 'Range request handled for direct stream', {
                  contentRange: finalResponse.headers.get('Content-Range'),
                  contentLength: finalResponse.headers.get('Content-Length'),
                  range: rangeHeader
                });
                
                debug(context, logger, 'VideoHandlerWithOrigins', 'Created 206 Partial Content response for direct stream', {
                  status: 206,
                  contentRange: finalResponse.headers.get('Content-Range'),
                  contentLength: finalResponse.headers.get('Content-Length')
                });
              }
            } catch (rangeError) {
              // Log error but continue with the full response
              error(context, logger, 'VideoHandlerWithOrigins', 'Error handling range request for direct stream', {
                error: rangeError instanceof Error ? rangeError.message : String(rangeError),
                range: rangeHeader
              });
              
              // Keep the original response if range handling fails
              // This is better than returning a broken response
            }
          } else if (rangeHeader && finalResponse.status === 206) {
            // The origin already handled the range request and returned a 206 response
            // We should pass it through as-is without additional processing
            debug(context, logger, 'VideoHandlerWithOrigins', 'Origin already returned 206 Partial Content, passing through as-is', {
              rangeHeader,
              contentRange: finalResponse.headers.get('Content-Range'),
              contentLength: finalResponse.headers.get('Content-Length'),
              bypassReason
            });
            
            addBreadcrumb(context, 'RangeRequest', 'Origin handled range request directly', {
              status: 206,
              contentRange: finalResponse.headers.get('Content-Range'),
              rangeHeader
            });
          }
        } else {
          // This is a regular (not fallback/large) video - use Cache API for range handling
          const { handleRangeRequestForInitialAccess } = await import('../utils/httpUtils');
          // Note: For regular videos we still use the Cache API method which stores the response for future range requests
          
          addBreadcrumb(context, 'RangeRequest', 'Processing range request for initial access', {
            range: request.headers.get('Range'),
            contentLength: finalResponse.headers.get('Content-Length'),
            contentType: finalResponse.headers.get('Content-Type')
          });
          
          startTimedOperation(context, 'initial-range-handling', 'RangeRequest');
          
          try {
            // Process range request on first access
            finalResponse = await handleRangeRequestForInitialAccess(response, request);
            
            // Log the result
            addBreadcrumb(context, 'RangeRequest', 'Range request handled for initial access', {
              originalStatus: response.status,
              newStatus: finalResponse.status,
              contentRange: finalResponse.headers.get('Content-Range'),
              contentLength: finalResponse.headers.get('Content-Length')
            });
          } catch (err) {
            // Log error but continue with the full response
            error(context, logger, 'VideoHandlerWithOrigins', 'Error handling range request for initial access', {
              error: err instanceof Error ? err.message : String(err),
              range: request.headers.get('Range')
            });
          }
          
          endTimedOperation(context, 'initial-range-handling');
        }
      }
      
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
      
      // Create a single ResponseBuilder instance for finalResponse - this is CRITICAL
      // to avoid "ReadableStream is disturbed" errors when multiple ResponseBuilder instances
      // try to use the same response body
      const responseBuilder = new ResponseBuilder(finalResponse, context);
      
      // Set the default handler information
      responseBuilder.withHeaders({
        'X-Handler': 'Origins',
        'X-Origin': originMatch.origin.name,
        'X-Source-Type': sourceResolution.originType
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
              debug(context, logger, 'VideoHandlerWithOrigins', 'Applying cache tags to final response', {
                tagCount: tags.length
              });
              
              // Add cache tags to the existing ResponseBuilder
              responseBuilder.withHeaders({
                'Cache-Tag': tags.join(',')
              });
              
              addBreadcrumb(context, 'Cache', 'Applied Cache-Tags to final response', {
                count: tags.length,
                firstTags: tags.slice(0, 3).join(',')
              });
            }
          }
        } catch (tagError) {
          // Log error but continue with the response
          error(context, logger, 'VideoHandlerWithOrigins', 'Failed to apply cache tags', {
            error: tagError instanceof Error ? tagError.message : String(tagError)
          });
        }
      }
      
      // Ensure audio responses present correct content type for inline playback
      let adjustedFinal = finalResponse;
      if ((videoOptions.mode === 'audio') || (videoOptions.format && (videoOptions.format as string).toLowerCase() === 'm4a')) {
        const h = new Headers(finalResponse.headers);
        h.set('Content-Type', 'audio/mp4');
        adjustedFinal = new Response(finalResponse.body, {
          status: finalResponse.status,
          statusText: finalResponse.statusText,
          headers: h
        });
      }
      
      // Add debug info and build the response with a single ResponseBuilder instance
      const result = await responseBuilder
        .withFilename(videoOptions.filename)
        .withDebugInfo()
        .build();
      endTimedOperation(context, 'response-building');
      
      // End the total request timing
      endTimedOperation(context, 'total-request-processing');
      
      return result;
    } catch (err: unknown) {
      // Record error timing
      startTimedOperation(context, 'error-handling', 'Error');
      
      // Use standardized error handling
      logErrorWithContext('Error handling video request with Origins', err, {
        url: request.url,
        path: new URL(request.url).pathname,
        requestId: context.requestId
      }, 'VideoHandlerWithOrigins');

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
        context.diagnostics.originsDiagnostics = configManager.getOriginsDiagnostics();
      } catch (diagError) {
        // If diagnostics fail, don't block error handling
        error(context, logger, 'VideoHandlerWithOrigins', 'Failed to add storage diagnostics', {
          error: diagError instanceof Error ? diagError.message : 'Unknown error'
        });
      }
      
      // Create error response with ResponseBuilder
      const errorResponse = new Response(
        `Error processing video with Origins: ${err instanceof Error ? err.message : 'Unknown error'}`, 
        {
          status: 500,
          headers: {
            'Content-Type': 'text/plain',
            'Cache-Control': 'no-store',
            'X-Handler': 'Origins',
            'X-Error': 'InternalError'
          },
        }
      );
      
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
    functionName: 'handleVideoRequestWithOrigins',
    component: 'VideoHandlerWithOrigins',
    logErrors: true
  }
);

/**
 * Dynamically import and call the video transformation function with origin information
 * 
 * @param request The incoming request
 * @param options Video transformation options
 * @param origin The matched origin
 * @param sourceResolution The resolved source
 * @param debugInfo Debug options
 * @param env Environment variables
 * @returns Response with transformed video
 */
async function transformVideoWithOrigins(
  request: Request, 
  options: VideoOptions, 
  origin: Origin,
  sourceResolution: any,
  debugInfo: any, 
  env?: EnvVariables
): Promise<Response> {
  // Import request context utilities
  const { getCurrentContext } = await import('../utils/requestContext');
  
  // Get current context if available
  const context = getCurrentContext ? getCurrentContext() : null;
  const logger = context ? createLogger(context) : console as any;
  
  // Log only if we have a context
  if (context) {
    debug(context, logger, 'VideoHandlerWithOrigins', 'Transforming video with Origins', {
      origin: origin.name,
      sourceType: sourceResolution.originType,
      resolvedPath: sourceResolution.resolvedPath,
      url: sourceResolution.sourceUrl
    });
  } else {
    console.debug('Transforming video with Origins:', {
      origin: origin.name,
      sourceType: sourceResolution.originType,
      resolvedPath: sourceResolution.resolvedPath
    });
  }
  
  // Import the transformation command
  const { TransformVideoCommand } = await import('../domain/commands/TransformVideoCommand');
  
  try {
    // Create the transform command with origins context
    const command = new TransformVideoCommand({
      origin,
      sourceResolution,
      options,
      request,
      env: env as unknown as WorkerEnvironment,
      debugMode: debugInfo.isEnabled
    });
    
    // Execute the command
    return await command.execute();
  } catch (err) {
    // Handle transformation errors
    const { handleTransformationError } = await import('../services/errorHandlerService');
    
    if (context) {
      error(context, logger, 'VideoHandlerWithOrigins', 'Error transforming video with Origins', {
        error: err instanceof Error ? err.message : 'Unknown error',
        origin: origin.name,
        sourceType: sourceResolution.originType
      });
    } else {
      console.error({
        context: 'VideoHandlerWithOrigins',
        operation: 'transformVideoWithOrigins',
        message: 'Error transforming video with Origins',
        error: err instanceof Error ? { name: err.name, message: err.message, stack: err.stack } : String(err),
        origin: origin.name,
        sourceType: sourceResolution.originType
      });
    }
    
    // Create a basic error response
    const errorMessage = err instanceof Error ? err.message : 'Unknown transformation error';
    const errorResponse = new Response(`Error transforming video with Origins: ${errorMessage}`, {
      status: 500,
      headers: {
        'Content-Type': 'text/plain',
        'Cache-Control': 'no-store',
        'X-Error': 'OriginsTransformationError',
        'X-Origin': origin.name,
        'X-Source-Type': sourceResolution.originType,
        'X-Handler': 'Origins'
      }
    });
    
    // If we have a context, use it. Otherwise create a minimal one.
    let responseCtx = context;
    if (!responseCtx) {
      responseCtx = {
        requestId: `origins-error-${Date.now()}`,
        url: request.url,
        startTime: performance.now(),
        breadcrumbs: [],
        componentTiming: {},
        diagnostics: {
          errors: [errorMessage],
          originalUrl: request.url
        },
        debugEnabled: false,
        verboseEnabled: false
      };
    }
    
    // Build final response with debug info
    const responseBuilder = new ResponseBuilder(errorResponse, responseCtx);
    return await responseBuilder.build();
  }
}

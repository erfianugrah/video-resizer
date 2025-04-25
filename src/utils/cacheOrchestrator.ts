/**
 * Cache orchestrator for video-resizer
 * 
 * This utility implements a versioned KV caching system for video-resizer
 */

import { EnvVariables } from '../config/environmentConfig';
import { getFromKVCache, storeInKVCache, TransformOptions } from './kvCacheUtils';
import { createLogger, debug as pinoDebug } from '../utils/pinoLogger';
import { getCurrentContext } from '../utils/legacyLoggerAdapter';
import { addBreadcrumb } from '../utils/requestContext';
import { generateBaseKVKey } from '../services/kvStorageService';
import { getCurrentVersion, incrementVersion } from '../services/versionManagerService';
import { CacheConfigurationManager } from '../config/CacheConfigurationManager';
import { parseRangeHeader, createUnsatisfiableRangeResponse } from '../utils/httpUtils';

/**
 * Cache orchestrator that uses versioned KV caching
 * 
 * Order of operations:
 * 1. Check KV storage with current version
 * 2. If cache miss, increment version and add to request URL
 * 3. Execute handler with version parameter to generate response
 * 4. Store result in KV with the new version
 * 
 * @param request - Original request
 * @param env - Environment variables
 * @param handler - Function to execute if cache miss occurs
 * @param options - Transformation options for KV cache
 * @returns Response from cache or handler
 */
export async function withCaching(
  request: Request,
  env: EnvVariables,
  handler: (requestToUse: Request) => Promise<Response>,
  options?: TransformOptions
): Promise<Response> {
  const requestContext = getCurrentContext();
  
  // Helper for logging
  const logDebug = (message: string, data?: Record<string, unknown>) => {
    if (requestContext) {
      const logger = createLogger(requestContext);
      pinoDebug(requestContext, logger, 'CacheOrchestrator', message, data);
    } else {
      console.debug(`CacheOrchestrator: ${message}`, data || {});
    }
  };
  
  // Helper for adding breadcrumbs
  const addCacheBreadcrumb = (action: string, data: Record<string, unknown>) => {
    if (requestContext) {
      addBreadcrumb(requestContext, 'VersionedCache', action, data);
    }
  };

  // Skip cache for non-GET requests or if bypass parameters are present
  const url = new URL(request.url);
  const cacheConfig = CacheConfigurationManager.getInstance();
  
  const shouldBypass = cacheConfig.shouldBypassCache(url);
  const isNotGet = request.method !== 'GET';
  const kvCacheEnabled = cacheConfig.isKVCacheEnabled();
  const skipCache = isNotGet || shouldBypass;
  
  if (skipCache) {
    logDebug('Bypassing cache', { 
      method: request.method, 
      shouldBypass,
      url: request.url
    });
    return handler(request);
  }
  
  try {
    // Only continue if we have valid options and environment
    if (!options || !env.VIDEO_TRANSFORMATIONS_CACHE || !kvCacheEnabled) {
      logDebug('Missing options or KV namespace, executing handler directly', {
        hasOptions: !!options,
        hasKVNamespace: !!env.VIDEO_TRANSFORMATIONS_CACHE,
        kvCacheEnabled
      });
      return handler(request);
    }
    
    const sourcePath = url.pathname;
    
    // Add IMQuery parameters to options for cache key generation
    const imwidth = url.searchParams.get('imwidth');
    const imheight = url.searchParams.get('imheight');
    
    const customData: Record<string, unknown> = {};
    if (imwidth) customData.imwidth = imwidth;
    if (imheight) customData.imheight = imheight;
    
    const lookupOptions: TransformOptions = {
      ...options,
      customData: Object.keys(customData).length > 0 ? customData : undefined
    };
    
    // Log if using IMQuery parameters
    if (Object.keys(customData).length > 0) {
      logDebug('Including IMQuery parameters in cache key', {
        imwidth,
        imheight,
        derivative: options.derivative
      });
    }
    
    // Step 1: Generate base key for version lookup
    const baseKey = generateBaseKVKey(sourcePath, lookupOptions);
    
    // Step 2: Get current version for this key
    const currentVersion = await getCurrentVersion(env, baseKey);
    logDebug('Current version for key', { baseKey, currentVersion });
    
    // Step 3: Try to get cached response with current version
    const cachedResponse = await getFromKVCache(env, sourcePath, lookupOptions, request);
    
    if (cachedResponse) {
      logDebug('KV cache hit with current version', { 
        baseKey, 
        version: currentVersion,
        contentType: cachedResponse.headers.get('content-type')
      });
      
      addCacheBreadcrumb('Cache hit with current version', {
        baseKey,
        version: currentVersion,
        url: request.url
      });
      
      return cachedResponse;
    }
    
    // Step 4: Cache miss for current version
    logDebug('Cache miss for current version, incrementing version', { 
      baseKey, 
      currentVersion,
      sourcePath 
    });
    
    // Step 5: Increment the version
    const newVersion = await incrementVersion(env, baseKey);
    
    // Step 6: Add version parameter to request URL for cache busting
    const versionedUrl = new URL(request.url);
    versionedUrl.searchParams.set('v', newVersion.toString());
    
    logDebug('Using versioned URL for cache busting', { 
      originalUrl: url.toString(),
      versionedUrl: versionedUrl.toString(),
      newVersion,
      baseKey
    });
    
    addCacheBreadcrumb('Cache miss, using incremented version', {
      baseKey,
      oldVersion: currentVersion,
      newVersion,
      versionedUrl: versionedUrl.toString()
    });
    
    // Step 7: Create a new request with the versioned URL
    const versionedRequest = new Request(versionedUrl.toString(), {
      method: request.method,
      headers: request.headers,
      redirect: request.redirect,
      cf: request.cf
    });
    
    // Step 8: Execute handler with versioned request
    const response = await handler(versionedRequest);
    
    // Step 9: Store response in KV with the new version
    if (response.ok && response.status !== 304) {
      const contentType = response.headers.get('content-type') || '';
      const isVideoOrImage = /^(video|image)\//.test(contentType);
      
      if (isVideoOrImage) {
        // Clone the response to avoid consuming it
        const responseClone = response.clone();
        
        // Store in KV with the new version
        // Execute in background using waitUntil if available
        const ctx = (env as any).executionCtx || requestContext?.executionContext;
        
        if (ctx && typeof ctx.waitUntil === 'function') {
          ctx.waitUntil(
            storeInKVCache(env, sourcePath, responseClone, lookupOptions)
              .then((success: boolean) => {
                logDebug('Background KV storage completed', {
                  success,
                  baseKey,
                  version: newVersion
                });
              })
              .catch((err: Error) => {
                logDebug('Error in background KV storage', {
                  error: err instanceof Error ? err.message : String(err)
                });
              })
          );
          
          logDebug('Scheduled background KV storage', { baseKey, version: newVersion });
        } else {
          // Store synchronously if waitUntil is not available
          await storeInKVCache(env, sourcePath, responseClone, lookupOptions);
        }
        
        addCacheBreadcrumb('Stored response with new version', {
          baseKey,
          version: newVersion,
          contentType
        });
      }
    }
    
    // Step 10: Check if original request has Range header and handle range slicing
    if (request.headers.has('Range') && response.ok) {
      try {
        const rangeHeader = request.headers.get('Range');
        const contentLength = parseInt(response.headers.get('content-length') || '0', 10);
        
        // Log detailed information about the range request
        logDebug('Processing range request from media proxy response', { 
          baseKey, 
          range: rangeHeader,
          contentLength,
          contentType: response.headers.get('content-type'),
          url: request.url
        });
        
        // Clone the response to ensure we don't consume it
        const responseToSlice = response.clone();
        
        // Get the response as array buffer
        const buffer = await responseToSlice.arrayBuffer();
        const totalSize = buffer.byteLength;
        
        const range = parseRangeHeader(rangeHeader, totalSize);
        
        if (range) {
          // Valid range request - create a 206 Partial Content response
          const slicedBody = buffer.slice(range.start, range.end + 1);
          const rangeHeaders = new Headers(response.headers);
          rangeHeaders.set('Content-Range', `bytes ${range.start}-${range.end}/${range.total}`);
          rangeHeaders.set('Content-Length', slicedBody.byteLength.toString());
          
          // Add debug headers to verify range handling
          rangeHeaders.set('X-Range-Handled-By', 'Cache-Orchestrator');
          rangeHeaders.set('X-Range-Request', rangeHeader || '');
          rangeHeaders.set('X-Range-Bytes', `${range.start}-${range.end}/${range.total}`);
          
          logDebug('Serving ranged response from media proxy', { 
            baseKey,
            range: rangeHeader,
            start: range.start,
            end: range.end,
            total: range.total,
            sliceSize: slicedBody.byteLength,
            bytesSent: range.end - range.start + 1
          });
          
          // Add breadcrumb for range response
          addCacheBreadcrumb('Serving partial content from media proxy', {
            contentRange: `bytes ${range.start}-${range.end}/${range.total}`,
            contentLength: slicedBody.byteLength,
            rangeRequest: rangeHeader || ''
          });
          
          return new Response(slicedBody, { 
            status: 206, 
            statusText: 'Partial Content',
            headers: rangeHeaders 
          });
        } else {
          // Invalid or unsatisfiable range - return 416
          logDebug('Unsatisfiable range requested for media proxy response', {
            baseKey,
            range: rangeHeader,
            totalSize,
            contentType: response.headers.get('content-type')
          });
          
          // Add breadcrumb for unsatisfiable range
          addCacheBreadcrumb('Unsatisfiable range requested', {
            contentType: response.headers.get('content-type'),
            totalSize,
            range: rangeHeader
          });
          
          return createUnsatisfiableRangeResponse(totalSize);
        }
      } catch (err) {
        logDebug('Error processing range request, falling back to full response', {
          baseKey,
          error: err instanceof Error ? err.message : String(err),
          range: request.headers.get('Range')
        });
        
        // Add error breadcrumb
        addCacheBreadcrumb('Range processing error', {
          error: err instanceof Error ? err.message : 'Unknown error',
          range: request.headers.get('Range')
        });
      }
    }
    
    // Return the original response if no range processing was done
    return response;
  } catch (err) {
    logDebug('Error in versioned cache flow', {
      error: err instanceof Error ? err.message : String(err),
      url: request.url
    });
    
    // Fallback to handler directly if caching fails
    return handler(request);
  }
}
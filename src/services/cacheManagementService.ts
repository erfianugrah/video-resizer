/**
 * Service for managing cache behavior for video responses
 * Supports both Cache API and Cloudflare cf object caching methods
 */
import { CacheConfig } from '../utils/cacheUtils';
import { CacheConfigurationManager } from '../config';
import { determineCacheControl } from '../utils/cacheControlUtils';
import { generateCacheTags, shouldBypassCache } from './videoStorageService';
import { createLogger, debug as pinoDebug, warn as pinoWarn } from '../utils/pinoLogger';
import { getCurrentContext } from '../utils/legacyLoggerAdapter';
import { addBreadcrumb } from '../utils/requestContext';
import { logErrorWithContext, withErrorHandling, tryOrNull } from '../utils/errorHandlingUtils';

/**
 * Helper functions for consistent logging throughout this file
 * These helpers handle context availability and fallback gracefully
 */

/**
 * Log a debug message with proper context handling
 */
function logDebug(message: string, data?: Record<string, unknown>): void {
  const requestContext = getCurrentContext();
  if (requestContext) {
    const logger = createLogger(requestContext);
    pinoDebug(requestContext, logger, 'CacheManagementService', message, data);
  } else {
    // Fall back to console as a last resort
    console.debug(`CacheManagementService: ${message}`, data || {});
  }
}

/**
 * Log a warning message with proper context handling
 */
function logWarn(message: string, data?: Record<string, unknown>): void {
  const requestContext = getCurrentContext();
  if (requestContext) {
    const logger = createLogger(requestContext);
    pinoWarn(requestContext, logger, 'CacheManagementService', message, data);
  } else {
    // Fall back to console as a last resort
    console.warn(`CacheManagementService: ${message}`, data || {});
  }
}

/**
 * Apply cache headers to a response based on configuration and use Cache API if available
 * 
 * @param response - The response to modify
 * @param status - HTTP status code
 * @param cacheConfig - Cache configuration
 * @param source - Content source for tagging
 * @param derivative - Optional derivative name for tagging
 * @returns Modified response with cache headers
 */
export const applyCacheHeaders = withErrorHandling<
  [Response, number, CacheConfig | null | undefined, string | undefined, string | undefined],
  Promise<Response>
>(
  async function applyCacheHeadersImpl(
    response: Response,
    status: number,
    cacheConfig?: CacheConfig | null,
    source?: string,
    derivative?: string
  ): Promise<Response> {
    // Create new headers object
    const newHeaders = new Headers(response.headers);
    
    // Create response init with headers object
    const responseInit: ResponseInit = {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders,
    };
    
    // Get request context for breadcrumbs
    const requestContext = getCurrentContext();
    
    // If no cache config, use default no-cache behavior
    if (!cacheConfig) {
      newHeaders.set('Cache-Control', 'no-store');
      
      if (requestContext) {
        addBreadcrumb(requestContext, 'Cache', 'Using no-cache behavior', {
          status,
          reason: 'No cache configuration',
          cacheControl: 'no-store'
        });
      }
      
      return new Response(response.body, responseInit);
    }
    
    // Get the appropriate cache control header
    const cacheControl = determineCacheControl(status, cacheConfig);
    
    logDebug('Applying cache headers', {
      status,
      cacheControl,
      cacheability: cacheConfig.cacheability,
      source,
      derivative
    });
    
    // Apply cache headers
    if (cacheConfig.cacheability && cacheControl) {
      newHeaders.set('Cache-Control', cacheControl);
      
      // Add breadcrumb for applied cache control
      if (requestContext) {
        // Extract the caching duration from a "max-age=X" directive
        const maxAgeMatch = cacheControl.match(/max-age=(\d+)/);
        const maxAgeTtl = maxAgeMatch ? parseInt(maxAgeMatch[1], 10) : undefined;
        
        addBreadcrumb(requestContext, 'Cache', 'Applied cacheable headers', {
          status,
          cacheControl,
          maxAgeTtl,
          statusCategory: Math.floor(status / 100) * 100,
          isCacheable: true
        });
      }
    } else {
      newHeaders.set('Cache-Control', 'no-store');
      
      // Add breadcrumb for non-cacheable response
      if (requestContext) {
        addBreadcrumb(requestContext, 'Cache', 'Applied non-cacheable headers', {
          status,
          cacheControl: 'no-store',
          reason: cacheConfig.cacheability ? 'No valid cacheControl' : 'Cacheability disabled',
          statusCategory: Math.floor(status / 100) * 100,
          isCacheable: false
        });
      }
    }
    
    // Generate cache tags if source is provided - important for purging
    if (source) {
      const options = { derivative };
      const tags = generateCacheTags(source, options, newHeaders);
      
      if (tags.length > 0) {
        newHeaders.set('Cache-Tag', tags.join(','));
        
        // Add breadcrumb for cache tags
        if (requestContext) {
          // Store cache tags in the request context for diagnostics
          if (!requestContext.diagnostics) {
            requestContext.diagnostics = {};
          }
          
          // Add cache tags to diagnostics info
          requestContext.diagnostics.cacheTags = tags;
          
          addBreadcrumb(requestContext, 'Cache', 'Generated cache tags', {
            tagCount: tags.length,
            source,
            derivative: derivative || undefined,
            firstTags: tags.slice(0, 3).join(','), // Include just the first few tags
            hasCustomTags: true
          });
        }
      } else {
        // For backward compatibility with tests 
        const fallbackTag = `video-resizer,source:${source}${derivative ? `,derivative:${derivative}` : ''}`;
        newHeaders.set('Cache-Tag', fallbackTag);
        
        // Add fallback tag to diagnostics
        if (requestContext) {
          // Store fallback cache tag in the request context for diagnostics
          if (!requestContext.diagnostics) {
            requestContext.diagnostics = {};
          }
          
          // Add fallback cache tag as an array to diagnostics
          requestContext.diagnostics.cacheTags = [fallbackTag];
          
          addBreadcrumb(requestContext, 'Cache', 'Using fallback cache tags', {
            source,
            derivative: derivative || undefined,
            tag: fallbackTag,
            reason: 'No tags generated by service'
          });
        }
      }
    }
    
    return new Response(response.body, responseInit);
  },
  {
    functionName: 'applyCacheHeaders',
    component: 'CacheManagementService',
    logErrors: true
  }
);

/**
 * Prepares a response for caching by creating a new response with the same body but with
 * enhanced headers for proper range request support and caching
 * 
 * @param response - The response to prepare for caching
 * @returns A new Response object prepared for caching
 */
export const prepareResponseForCaching = withErrorHandling<
  [Response],
  Promise<Response>
>(
  async function prepareResponseForCachingImpl(
    response: Response
  ): Promise<Response> {
    // Clone the response to avoid consuming it
    const responseClone = response.clone();
    
    // Check if this is a video response that needs range support
    const responseContentType = responseClone.headers.get('content-type') || '';
    const isVideoResponseType = responseContentType.startsWith('video/') || responseContentType.startsWith('audio/');
    
    let enhancedResponse: Response;
    
    if (isVideoResponseType) {
      try {
        // For video content, fully consume the body and create a completely new response
        // This ensures we have full control over the response characteristics
        const arrayBuffer = await responseClone.arrayBuffer();
        
        // Create new headers with range request support
        const headers = new Headers();
        
        // Copy all the original headers
        responseClone.headers.forEach((value, key) => {
          headers.set(key, value);
        });
        
        // Always set Accept-Ranges for video content
        headers.set('Accept-Ranges', 'bytes');
        
        // Ensure Content-Length is properly set
        headers.set('Content-Length', arrayBuffer.byteLength.toString());
        
        // Add ETag if not present (helps with validation)
        if (!headers.has('ETag')) {
          const hashCode = Math.abs(arrayBuffer.byteLength).toString(16);
          headers.set('ETag', `"${hashCode}-${Date.now().toString(36)}"`);
        }
        
        // Set Last-Modified if not present
        if (!headers.has('Last-Modified')) {
          headers.set('Last-Modified', new Date().toUTCString());
        }
        
        logDebug('Creating fully controlled response for range request support', {
          contentType: responseContentType,
          contentLength: arrayBuffer.byteLength,
          status: responseClone.status,
          hasEtag: headers.has('ETag'),
          hasLastModified: headers.has('Last-Modified')
        });
        
        // Create a completely new response with the full body and all headers
        enhancedResponse = new Response(arrayBuffer, {
          status: responseClone.status,
          statusText: responseClone.statusText,
          headers: headers
        });
      } catch (err) {
        // If there's an error consuming the body, log it and continue with the original response
        logDebug('Error creating fully controlled response, falling back to header modification', {
          error: err instanceof Error ? err.message : String(err)
        });
        
        // Fall back to just modifying headers
        const headers = new Headers(responseClone.headers);
        
        // Always set Accept-Ranges for video content
        if (!headers.has('Accept-Ranges')) {
          headers.set('Accept-Ranges', 'bytes');
        }
        
        logDebug('Enhanced response headers for video caching with range support', {
          contentType: responseContentType,
          acceptRanges: headers.get('Accept-Ranges')
        });
        
        // Create a new response with the enhanced headers
        enhancedResponse = new Response(responseClone.body, {
          status: responseClone.status,
          statusText: responseClone.statusText,
          headers: headers
        });
      }
    } else {
      // For non-video content, just use the cloned response as is
      enhancedResponse = responseClone;
    }
    
    return enhancedResponse;
  },
  {
    functionName: 'prepareResponseForCaching',
    component: 'CacheManagementService',
    logErrors: true
  }
);

/**
 * Store a response in the Cloudflare cache 
 * Based on configuration, uses either Cache API or cf object
 * 
 * @param request - The original request
 * @param response - The response to cache
 * @param context - Optional execution context for waitUntil
 * @param isTransformedResponse - Whether this response came from a transformed URL
 * @returns Promise that resolves when caching is complete
 */
export const cacheResponse = withErrorHandling<
  [Request, Response, ExecutionContext | undefined, boolean?],
  Response | null
>(
  async function cacheResponseImpl(
    request: Request, 
    response: Response,
    context?: ExecutionContext,
    isTransformedResponse?: boolean
  ): Promise<Response | null> {
    // Only cache successful GET requests
    if (request.method !== 'GET' || !response.ok) {
      return null;
    }
    
    // Check the content type
    const contentType = response.headers.get('content-type') || '';
    const isError = response.status >= 400;
    
    // Comprehensive list of video MIME types
    const videoMimeTypes = [
      'video/mp4',
      'video/webm',
      'video/ogg',
      'video/x-msvideo', // AVI
      'video/quicktime', // MOV
      'video/x-matroska', // MKV
      'video/x-flv',
      'video/3gpp',
      'video/3gpp2',
      'video/mpeg',
      'application/x-mpegURL', // HLS
      'application/dash+xml'   // DASH
    ];
    
    // Comprehensive list of image MIME types
    const imageMimeTypes = [
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
      'image/avif',
      'image/tiff',
      'image/svg+xml',
      'image/bmp'
    ];
    
    // Check if content type is cacheable
    const isVideoResponse = videoMimeTypes.some(mimeType => contentType.startsWith(mimeType));
    const isImageResponse = imageMimeTypes.some(mimeType => contentType.startsWith(mimeType));
    const isCacheableContent = isVideoResponse || isImageResponse;
    
    // Skip caching for 4xx, 5xx responses or non-video/image content
    if (isError || !isCacheableContent) {
      logDebug('Skipping cache.put for non-cacheable content', {
        url: request.url,
        status: response.status,
        contentType,
        isError,
        isCacheableContent
      });
      return null;
    }
    
    // Get the cache configuration manager
    const cacheConfig = CacheConfigurationManager.getInstance();
    const cacheMethod = cacheConfig.getConfig().method;
    
    // When using cf object caching, we don't need to do anything here
    // as caching is handled by the cf object in fetch
    if (cacheMethod === 'cf') {
      if (cacheConfig.getConfig().debug) {
        logDebug('Using cf object for caching, no explicit cache.put needed', {
          url: request.url,
          status: response.status,
          contentType,
          cacheControl: response.headers.get('Cache-Control')
        });
      }
      return null;
    }
    
    // Get the response Cache-Control header to check if we should cache
    const cacheControl = response.headers.get('Cache-Control');
    if (cacheControl && cacheControl.includes('no-store')) {
      logDebug('Skipping cache.put for no-store response', {
        url: request.url,
        cacheControl
      });
      return null;
    }
    
    // Ensure we properly handle the case of transformed responses
    let cacheRequest = request;
    let responseToCache = response;
    
    if (isTransformedResponse) {
      logDebug('Handling transformed response for caching', {
        originalUrl: request.url,
        contentType: response.headers.get('content-type'),
        isTransformed: true
      });
    }
    
    // Prepare the response with enhanced support for range requests
    let enhancedResponse = await prepareResponseForCaching(responseToCache);
    
    // Get the default cache
    const cache = caches.default;

    // Use a different error handling strategy for waitUntil vs direct operation
    if (context) {
      // If we have an execution context, use waitUntil with specialized error handling
      const cachePutOperation = withErrorHandling(
        async () => {
          // Log detailed request information before cache put
          const requestHeaders: Record<string, string> = {};
          for (const [key, value] of request.headers.entries()) {
            requestHeaders[key] = value;
          }
          
          // Log detailed response information before cache put
          const responseHeaders: Record<string, string> = {};
          for (const [key, value] of enhancedResponse.headers.entries()) {
            responseHeaders[key] = value;
          }
          
          logDebug('Preparing Cache API put operation (waitUntil)', {
            url: request.url,
            method: request.method,
            status: enhancedResponse.status,
            contentType: enhancedResponse.headers.get('Content-Type'),
            contentLength: enhancedResponse.headers.get('Content-Length'),
            cacheControl: enhancedResponse.headers.get('Cache-Control'),
            cacheTag: enhancedResponse.headers.get('Cache-Tag'),
            acceptRanges: enhancedResponse.headers.get('Accept-Ranges'),
            etag: enhancedResponse.headers.get('ETag'),
            lastModified: enhancedResponse.headers.get('Last-Modified'),
            requestHeaders: Object.keys(requestHeaders),
            responseHeaders: Object.keys(responseHeaders),
            requestId: Math.random().toString(36).substring(2, 10),
            timestamp: new Date().toISOString()
          });
          
          // If this is a transformed response, we need special handling to store it correctly
          const putStartTime = Date.now();
          
          if (isTransformedResponse) {
            // Create a new request with the original URL to use as a cache key
            // This is the key to making transformed content available with the original URL
            const cacheKey = new Request(request.url, {
              method: request.method,
              headers: request.headers
            });
            
            // Create a fully controlled response for transformed content
            let transformedBody;
            try {
              // Clone and read the body to ensure we have full control over it
              transformedBody = await enhancedResponse.clone().arrayBuffer();
              
              // Create new headers with proper caching directives
              const headers = new Headers();
              
              // Copy all the original headers
              enhancedResponse.headers.forEach((value, key) => {
                headers.set(key, value);
              });
              
              // Always set Accept-Ranges for video content to support byte-range requests
              headers.set('Accept-Ranges', 'bytes');
              
              // Make sure Content-Length is accurate
              headers.set('Content-Length', transformedBody.byteLength.toString());
              
              // Add strong validation headers
              if (!headers.has('ETag')) {
                const hashCode = Math.abs(transformedBody.byteLength).toString(16);
                headers.set('ETag', `"${hashCode}-${Date.now().toString(36)}"`);
              }
              
              if (!headers.has('Last-Modified')) {
                headers.set('Last-Modified', new Date().toUTCString());
              }
              
              // Ensure Cache-Control header is set, unless specifically no-store
              const currentCacheControl = headers.get('Cache-Control');
              if (!currentCacheControl || currentCacheControl.includes('no-cache')) {
                // Default to 1 day cache for transformed content
                headers.set('Cache-Control', 'public, max-age=86400');
              }
              
              // Add a special header to mark this response as prepared for caching
              headers.set('X-Cache-Prepared', 'true');
              
              // Create a new fully controlled response to store in cache
              const cachableResponse = new Response(transformedBody, {
                status: enhancedResponse.status,
                statusText: enhancedResponse.statusText,
                headers: headers
              });
              
              logDebug('Storing fully controlled transformed response with original URL as key', {
                originalUrl: request.url,
                contentType: headers.get('Content-Type'),
                contentLength: headers.get('Content-Length'),
                cacheControl: headers.get('Cache-Control'),
                acceptRanges: headers.get('Accept-Ranges'),
                etag: headers.get('ETag'),
                lastModified: headers.get('Last-Modified'),
                timestamp: new Date().toISOString()
              });
              
              // Store using the original URL as key but with the transformed content
              await cache.put(cacheKey, cachableResponse.clone());
              
              // Double-check that we successfully stored it by trying to retrieve it immediately
              const verifyResponse = await cache.match(cacheKey);
              
              if (verifyResponse) {
                // Log detailed verification information
                logDebug('Successfully verified transformed response in cache', {
                  originalUrl: request.url,
                  success: true,
                  status: verifyResponse.status,
                  contentType: verifyResponse.headers.get('Content-Type'),
                  contentLength: verifyResponse.headers.get('Content-Length'),
                  cacheControl: verifyResponse.headers.get('Cache-Control'),
                  etag: verifyResponse.headers.get('ETag'),
                  acceptRanges: verifyResponse.headers.get('Accept-Ranges'),
                  timestamp: new Date().toISOString()
                });
                
                // Update the enhanced response to use our fully controlled cachable version
                enhancedResponse = cachableResponse;
              } else {
                logDebug('Failed to verify cached transformed response - will try again with simpler approach', {
                  originalUrl: request.url,
                  timestamp: new Date().toISOString()
                });
                
                // Fallback to simpler approach with minimal manipulation
                const simpleHeaders = new Headers(enhancedResponse.headers);
                simpleHeaders.set('Accept-Ranges', 'bytes');
                simpleHeaders.set('X-Cache-Simple-Fallback', 'true');
                
                // Create a simpler response
                const simpleResponse = new Response(await enhancedResponse.clone().arrayBuffer(), {
                  status: enhancedResponse.status,
                  statusText: enhancedResponse.statusText,
                  headers: simpleHeaders
                });
                
                // Try again with the simpler response
                await cache.put(cacheKey, simpleResponse.clone());
                
                // Verify again
                const secondVerifyResponse = await cache.match(cacheKey);
                logDebug('Second verification attempt for cached transformed response', {
                  originalUrl: request.url,
                  success: !!secondVerifyResponse,
                  approach: 'simple',
                  timestamp: new Date().toISOString()
                });
                
                // Update the enhanced response if successful
                if (secondVerifyResponse) {
                  enhancedResponse = simpleResponse;
                }
              }
            } catch (err) {
              logDebug('Error creating fully controlled response for cache storage, falling back to basic approach', {
                originalUrl: request.url,
                error: err instanceof Error ? err.message : String(err),
                timestamp: new Date().toISOString()
              });
              
              // Fallback to original cache put approach
              await cache.put(cacheKey, enhancedResponse.clone());
              
              // Verify one more time
              const fallbackVerifyResponse = await cache.match(cacheKey);
              logDebug('Fallback cache put verification', {
                originalUrl: request.url,
                success: !!fallbackVerifyResponse,
                approach: 'basic-fallback',
                timestamp: new Date().toISOString()
              });
            }
          } else {
            // Standard cache put for non-transformed responses
            await cache.put(request, enhancedResponse.clone());
          }
          
          const putDuration = Date.now() - putStartTime;
          
          logDebug('Stored response in Cloudflare Cache API (waitUntil)', {
            url: request.url,
            method: 'cache-api',
            status: enhancedResponse.status,
            cacheControl: enhancedResponse.headers.get('Cache-Control'),
            cacheTag: enhancedResponse.headers.get('Cache-Tag'),
            contentType: enhancedResponse.headers.get('Content-Type'),
            contentLength: enhancedResponse.headers.get('Content-Length'),
            acceptRanges: enhancedResponse.headers.get('Accept-Ranges'),
            putDurationMs: putDuration,
            timestamp: new Date().toISOString()
          });
        },
        {
          functionName: 'cachePutOperation',
          component: 'CacheManagementService',
          logErrors: true
        },
        {
          url: request.url,
          method: 'waitUntil',
          status: enhancedResponse.status
        }
      );
      
      // Use waitUntil to execute the cache operation
      context.waitUntil(cachePutOperation());
      
      // Return the enhanced response
      return enhancedResponse;
    } else {
      // Without execution context, wrap the put operation with direct error handling
      const directCachePutOperation = withErrorHandling(
        async () => {
          // Get the request context if available
          const requestContext = getCurrentContext();
          
          // Log detailed request information before cache put
          const requestHeaders: Record<string, string> = {};
          for (const [key, value] of request.headers.entries()) {
            requestHeaders[key] = value;
          }
          
          // Log detailed response information before cache put
          const responseHeaders: Record<string, string> = {};
          for (const [key, value] of enhancedResponse.headers.entries()) {
            responseHeaders[key] = value;
          }
          
          logDebug('Preparing Cache API put operation (direct)', {
            url: request.url,
            method: request.method,
            status: enhancedResponse.status,
            contentType: enhancedResponse.headers.get('Content-Type'),
            contentLength: enhancedResponse.headers.get('Content-Length'),
            cacheControl: enhancedResponse.headers.get('Cache-Control'),
            cacheTag: enhancedResponse.headers.get('Cache-Tag'),
            acceptRanges: enhancedResponse.headers.get('Accept-Ranges'),
            etag: enhancedResponse.headers.get('ETag'),
            lastModified: enhancedResponse.headers.get('Last-Modified'),
            requestHeaders: Object.keys(requestHeaders),
            responseHeaders: Object.keys(responseHeaders),
            requestId: Math.random().toString(36).substring(2, 10),
            timestamp: new Date().toISOString()
          });
          
          // If this is a transformed response, we need special handling to store it correctly
          const putStartTime = Date.now();
          
          if (isTransformedResponse) {
            // Create a new request with the original URL to use as a cache key
            // This is the key to making transformed content available with the original URL
            const cacheKey = new Request(request.url, {
              method: request.method,
              headers: request.headers
            });
            
            // Create a fully controlled response for transformed content
            let transformedBody;
            try {
              // Clone and read the body to ensure we have full control over it
              transformedBody = await enhancedResponse.clone().arrayBuffer();
              
              // Create new headers with proper caching directives
              const headers = new Headers();
              
              // Copy all the original headers
              enhancedResponse.headers.forEach((value, key) => {
                headers.set(key, value);
              });
              
              // Always set Accept-Ranges for video content to support byte-range requests
              headers.set('Accept-Ranges', 'bytes');
              
              // Make sure Content-Length is accurate
              headers.set('Content-Length', transformedBody.byteLength.toString());
              
              // Add strong validation headers
              if (!headers.has('ETag')) {
                const hashCode = Math.abs(transformedBody.byteLength).toString(16);
                headers.set('ETag', `"${hashCode}-${Date.now().toString(36)}"`);
              }
              
              if (!headers.has('Last-Modified')) {
                headers.set('Last-Modified', new Date().toUTCString());
              }
              
              // Ensure Cache-Control header is set, unless specifically no-store
              const currentCacheControl = headers.get('Cache-Control');
              if (!currentCacheControl || currentCacheControl.includes('no-cache')) {
                // Default to 1 day cache for transformed content
                headers.set('Cache-Control', 'public, max-age=86400');
              }
              
              // Add a special header to mark this response as prepared for caching
              headers.set('X-Cache-Prepared', 'true');
              
              // Create a new fully controlled response to store in cache
              const cachableResponse = new Response(transformedBody, {
                status: enhancedResponse.status,
                statusText: enhancedResponse.statusText,
                headers: headers
              });
              
              logDebug('Storing fully controlled transformed response with original URL as key', {
                originalUrl: request.url,
                contentType: headers.get('Content-Type'),
                contentLength: headers.get('Content-Length'),
                cacheControl: headers.get('Cache-Control'),
                acceptRanges: headers.get('Accept-Ranges'),
                etag: headers.get('ETag'),
                lastModified: headers.get('Last-Modified'),
                timestamp: new Date().toISOString()
              });
              
              // Store using the original URL as key but with the transformed content
              await cache.put(cacheKey, cachableResponse.clone());
              
              // Double-check that we successfully stored it by trying to retrieve it immediately
              const verifyResponse = await cache.match(cacheKey);
              
              if (verifyResponse) {
                // Log detailed verification information
                logDebug('Successfully verified transformed response in cache', {
                  originalUrl: request.url,
                  success: true,
                  status: verifyResponse.status,
                  contentType: verifyResponse.headers.get('Content-Type'),
                  contentLength: verifyResponse.headers.get('Content-Length'),
                  cacheControl: verifyResponse.headers.get('Cache-Control'),
                  etag: verifyResponse.headers.get('ETag'),
                  acceptRanges: verifyResponse.headers.get('Accept-Ranges'),
                  timestamp: new Date().toISOString()
                });
                
                // Update the enhanced response to use our fully controlled cachable version
                enhancedResponse = cachableResponse;
              } else {
                logDebug('Failed to verify cached transformed response - will try again with simpler approach', {
                  originalUrl: request.url,
                  timestamp: new Date().toISOString()
                });
                
                // Fallback to simpler approach with minimal manipulation
                const simpleHeaders = new Headers(enhancedResponse.headers);
                simpleHeaders.set('Accept-Ranges', 'bytes');
                simpleHeaders.set('X-Cache-Simple-Fallback', 'true');
                
                // Create a simpler response
                const simpleResponse = new Response(await enhancedResponse.clone().arrayBuffer(), {
                  status: enhancedResponse.status,
                  statusText: enhancedResponse.statusText,
                  headers: simpleHeaders
                });
                
                // Try again with the simpler response
                await cache.put(cacheKey, simpleResponse.clone());
                
                // Verify again
                const secondVerifyResponse = await cache.match(cacheKey);
                logDebug('Second verification attempt for cached transformed response', {
                  originalUrl: request.url,
                  success: !!secondVerifyResponse,
                  approach: 'simple',
                  timestamp: new Date().toISOString()
                });
                
                // Update the enhanced response if successful
                if (secondVerifyResponse) {
                  enhancedResponse = simpleResponse;
                }
              }
            } catch (err) {
              logDebug('Error creating fully controlled response for cache storage, falling back to basic approach', {
                originalUrl: request.url,
                error: err instanceof Error ? err.message : String(err),
                timestamp: new Date().toISOString()
              });
              
              // Fallback to original cache put approach
              await cache.put(cacheKey, enhancedResponse.clone());
              
              // Verify one more time
              const fallbackVerifyResponse = await cache.match(cacheKey);
              logDebug('Fallback cache put verification', {
                originalUrl: request.url,
                success: !!fallbackVerifyResponse,
                approach: 'basic-fallback',
                timestamp: new Date().toISOString()
              });
            }
          } else {
            // Standard cache put for non-transformed responses
            await cache.put(request, enhancedResponse.clone());
          }
          
          const putDuration = Date.now() - putStartTime;
          
          // Add breadcrumb for successful cache store
          if (requestContext) {
            addBreadcrumb(requestContext, 'Cache', 'Stored response in cache', {
              url: request.url,
              method: 'cache-api',
              status: enhancedResponse.status,
              cacheControl: enhancedResponse.headers.get('Cache-Control'),
              contentType: enhancedResponse.headers.get('Content-Type'),
              contentLength: enhancedResponse.headers.get('Content-Length'),
              acceptRanges: enhancedResponse.headers.get('Accept-Ranges'),
              putDurationMs: putDuration
            });
          }
          
          logDebug('Stored response in Cloudflare Cache API', {
            url: request.url,
            method: 'cache-api',
            status: enhancedResponse.status,
            cacheControl: enhancedResponse.headers.get('Cache-Control'),
            cacheTag: enhancedResponse.headers.get('Cache-Tag'),
            contentType: enhancedResponse.headers.get('Content-Type'),
            contentLength: enhancedResponse.headers.get('Content-Length'),
            acceptRanges: enhancedResponse.headers.get('Accept-Ranges'),
            putDurationMs: putDuration,
            timestamp: new Date().toISOString(),
            success: true
          });
        },
        {
          functionName: 'directCachePutOperation',
          component: 'CacheManagementService',
          logErrors: true
        },
        {
          url: request.url,
          method: 'direct',
          status: enhancedResponse.status
        }
      );
      
      await directCachePutOperation();
      
      // Return the enhanced response
      return enhancedResponse;
    }
  },
  {
    functionName: 'cacheResponse',
    component: 'CacheManagementService',
    logErrors: true
  },
  { component: 'Cache API' }
);

/**
 * Try to get a response from the Cloudflare cache
 * Based on configuration, uses either Cache API or returns null (when cf object caching is used)
 * 
 * @param request - The request to check in cache
 * @returns Cached response or null if not found or using cf object caching
 */
export const getCachedResponse = withErrorHandling<
  [Request],
  Promise<Response | null>
>(
  async function getCachedResponseImpl(request: Request): Promise<Response | null> {
    // Only try to cache GET requests
    if (request.method !== 'GET') {
      return null;
    }
    
    // Check if we should bypass cache based on specific cache-control headers or bypass parameters
    const url = new URL(request.url);
    
    // Get cache configuration to check bypass parameters properly
    // Only bypass for specific parameters (debug, nocache, bypass), not for IMQuery parameters
    const cacheConfig = CacheConfigurationManager.getInstance();
    const shouldBypass = cacheConfig.shouldBypassCache(url);
    
    if (shouldBypass) {
      logDebug('Bypassing cache based on specific bypass parameters', {
        url: request.url,
        hasDebugParam: url.searchParams.has('debug'),
        hasBypassParam: url.searchParams.has('bypass'),
        hasNoCacheParam: url.searchParams.has('nocache')
      });
      return null;
    }
    
    // Use the cache configuration for method determination
    const cacheMethod = cacheConfig.getConfig().method;
    
    // When using cf object caching, we don't use explicit cache.match
    // Instead, we rely on Cloudflare's built-in caching with the cf object in fetch
    if (cacheMethod === 'cf') {
      if (cacheConfig.getConfig().debug) {
        logDebug('Using cf object for caching, but still checking Cache API for better range request support', {
          url: request.url,
          method: 'cf-object'
        });
      }
      // Continue checking the Cache API even with cf method and debug mode,
      // this enables proper range request support even when debug is enabled
      // Do NOT return null here as we did before
    }
    
    // Check if this is a range request
    const isRangeRequest = request.headers.has('Range');
    const rangeHeader = request.headers.get('Range');
    
    // Cache API implementation using tryOrNull for safer async operation
    const cacheMatchOperation = withErrorHandling(
      async () => {
        // Get the default cache
        const cache = caches.default;
        
        // Log detailed request information before cache match
        const requestHeaders: Record<string, string> = {};
        for (const [key, value] of request.headers.entries()) {
          requestHeaders[key] = value;
        }
        
        logDebug('Attempting Cache API match operation', {
          url: request.url,
          method: request.method,
          isRangeRequest,
          rangeHeader,
          requestId: Math.random().toString(36).substring(2, 10),
          headersPresent: Object.keys(requestHeaders),
          timestamp: new Date().toISOString()
        });

        // Try to find the response in the cache
        const matchStartTime = Date.now();
        
        // Check for request cache key
        let cachedResponse = await cache.match(request);
        let cacheKeyType = 'original-request';
        
        if (!cachedResponse) {
          // We didn't find anything with the original request as key
          // Try a second lookup with a transformed-focused key (based on CDN URL pattern match)
          // This helps with cases where the response might have been stored with a different key
          const requestUrl = new URL(request.url);
          
          // When we have a path that looks like it could be a CDN-CGI transformed URL, try 
          // a cache lookup with the original URL as well
          if (requestUrl.pathname.includes('/cdn-cgi/media/') || requestUrl.pathname.includes('/cdn-cgi/image/')) {
            const originalPath = requestUrl.pathname.replace(/\/cdn-cgi\/(media|image)\/[^/]+\//, '/');
            
            if (originalPath !== requestUrl.pathname) {
              // Create a new URL with the original path
              const originalUrl = new URL(requestUrl.toString());
              originalUrl.pathname = originalPath;
              
              // Create a new request with this original URL
              const originalRequest = new Request(originalUrl.toString(), {
                method: request.method,
                headers: request.headers
              });
              
              // Try to find in cache with this key instead
              cachedResponse = await cache.match(originalRequest);
              if (cachedResponse) {
                cacheKeyType = 'original-path';
                logDebug('Found cached response using original path key', {
                  transformedPath: requestUrl.pathname,
                  originalPath: originalPath,
                  success: !!cachedResponse
                });
              }
            }
          }
        }
        
        const matchDuration = Date.now() - matchStartTime;
        
        // Add breadcrumb for cache result
        const requestContext = getCurrentContext();
        if (requestContext) {
          if (cachedResponse) {
            addBreadcrumb(requestContext, 'Cache', 'Cache hit', {
              url: request.url,
              method: 'cache-api',
              status: cachedResponse.status,
              isRangeRequest,
              matchDurationMs: matchDuration
            });
          } else {
            addBreadcrumb(requestContext, 'Cache', 'Cache miss', {
              url: request.url,
              method: 'cache-api',
              isRangeRequest,
              matchDurationMs: matchDuration
            });
          }
        }
        
        // Log detailed result of cache match
        if (cachedResponse) {
          // Gather header information from cached response
          const responseHeaders: Record<string, string> = {};
          for (const [key, value] of cachedResponse.headers.entries()) {
            responseHeaders[key] = value;
          }
          
          // Check if this is a response from CDN-CGI transformation
          const isCdnCgiResponse = cachedResponse.headers.has('CF-Media-Transformation') || 
                                 (cachedResponse.url && cachedResponse.url.includes('/cdn-cgi/media/'));
                                 
          logDebug('Cache API match operation result: HIT', {
            url: request.url,
            status: cachedResponse.status,
            statusText: cachedResponse.statusText,
            contentType: cachedResponse.headers.get('Content-Type'),
            contentLength: cachedResponse.headers.get('Content-Length'),
            cfCacheStatus: cachedResponse.headers.get('CF-Cache-Status'),
            etag: cachedResponse.headers.get('ETag'),
            matchDurationMs: matchDuration,
            headersPresent: Object.keys(responseHeaders),
            isCdnCgiResponse
          });
        } else {
          logDebug('Cache API match operation result: MISS', {
            url: request.url,
            matchDurationMs: matchDuration,
            timestamp: new Date().toISOString()
          });
        }
        
        if (cachedResponse) {
          logDebug('Cache hit using Cache API', {
            url: request.url,
            method: 'cache-api',
            status: cachedResponse.status,
            isRangeRequest,
            hasRange: rangeHeader,
            contentType: cachedResponse.headers.get('Content-Type')
          });
          
          // Handle range requests for 200 OK responses from cache
          if (isRangeRequest && cachedResponse.status === 200) {
            try {
              // Dynamically import httpUtils to avoid circular dependencies
              const { parseRangeHeader, createUnsatisfiableRangeResponse } = await import('../utils/httpUtils');
              
              // Clone the cached response to avoid consuming it
              const responseClone = cachedResponse.clone();
              const arrayBuffer = await responseClone.arrayBuffer();
              const totalSize = arrayBuffer.byteLength;
              
              // Log detailed information about the range request
              logDebug('Processing range request from Cache API', { 
                url: request.url,
                range: rangeHeader,
                totalSize,
                contentType: cachedResponse.headers.get('Content-Type')
              });
              
              const range = parseRangeHeader(rangeHeader, totalSize);
              
              if (range) {
                // Valid range request - create a 206 Partial Content response
                const slicedBody = arrayBuffer.slice(range.start, range.end + 1);
                
                // Create new headers from the cached response headers
                const rangeHeaders = new Headers(cachedResponse.headers);
                rangeHeaders.set('Content-Range', `bytes ${range.start}-${range.end}/${range.total}`);
                rangeHeaders.set('Content-Length', slicedBody.byteLength.toString());
                rangeHeaders.set('Accept-Ranges', 'bytes');
                
                // Add debug headers to verify range handling
                rangeHeaders.set('X-Range-Handled-By', 'Cache-API');
                rangeHeaders.set('X-Range-Request', rangeHeader || '');
                rangeHeaders.set('X-Range-Bytes', `${range.start}-${range.end}/${range.total}`);
                
                logDebug('Serving ranged response from Cache API', { 
                  url: request.url,
                  range: rangeHeader,
                  start: range.start,
                  end: range.end,
                  total: range.total,
                  sliceSize: slicedBody.byteLength,
                  bytesSent: range.end - range.start + 1
                });
                
                // Add breadcrumb for range response
                const requestContext = getCurrentContext();
                if (requestContext) {
                  addBreadcrumb(requestContext, 'Cache', 'Serving partial content from Cache API', {
                    url: request.url,
                    contentRange: `bytes ${range.start}-${range.end}/${range.total}`,
                    contentLength: slicedBody.byteLength,
                    rangeRequest: rangeHeader || ''
                  });
                  
                  // Add diagnostic information to request context
                  if (!requestContext.diagnostics) {
                    requestContext.diagnostics = {};
                  }
                  
                  requestContext.diagnostics.rangeRequest = {
                    header: rangeHeader,
                    start: range.start,
                    end: range.end,
                    total: range.total,
                    bytes: range.end - range.start + 1,
                    source: 'cache-api'
                  };
                }
                
                return new Response(slicedBody, { 
                  status: 206, 
                  statusText: 'Partial Content',
                  headers: rangeHeaders 
                });
              } else {
                // Invalid or unsatisfiable range - return 416
                logDebug('Unsatisfiable range requested for Cache API cached item', {
                  url: request.url,
                  range: rangeHeader,
                  totalSize,
                  contentType: cachedResponse.headers.get('Content-Type')
                });
                
                // Add breadcrumb for unsatisfiable range
                const requestContext = getCurrentContext();
                if (requestContext) {
                  addBreadcrumb(requestContext, 'Cache', 'Unsatisfiable range requested', {
                    url: request.url,
                    contentType: cachedResponse.headers.get('Content-Type'),
                    totalSize,
                    range: rangeHeader
                  });
                  
                  // Add diagnostic information to request context
                  if (!requestContext.diagnostics) {
                    requestContext.diagnostics = {};
                  }
                  
                  requestContext.diagnostics.rangeRequest = {
                    header: rangeHeader,
                    error: 'unsatisfiable',
                    total: totalSize,
                    source: 'cache-api'
                  };
                }
                
                return createUnsatisfiableRangeResponse(totalSize);
              }
            } catch (err) {
              logDebug('Error processing range request from Cache API, falling back to full response', {
                url: request.url,
                error: err instanceof Error ? err.message : String(err),
                range: rangeHeader
              });
              
              // Fall back to returning the original cached response
              return cachedResponse;
            }
          }
          
          // If not a range request or already a 206 response, return as-is
          return cachedResponse;
        }
        
        logDebug('Cache miss using Cache API', {
          url: request.url,
          method: 'cache-api',
          isRangeRequest
        });
        return null;
      },
      {
        functionName: 'cacheMatchOperation',
        component: 'CacheManagementService',
        logErrors: true
      },
      {
        url: request.url,
        method: 'cache-api'
      }
    );
    
    return await cacheMatchOperation();
  },
  {
    functionName: 'getCachedResponse',
    component: 'CacheManagementService',
    logErrors: true
  },
  { component: 'Cache API' }
);

/**
 * Create cf object parameters for caching with Cloudflare's fetch API
 * 
 * @param status - HTTP status code
 * @param cacheConfig - Cache configuration
 * @param source - Content source for tagging
 * @param derivative - Optional derivative name for tagging
 * @param contentType - Optional content type for content-based caching decisions
 * @returns Object with cf parameters for fetch
 */
export const createCfObjectParams = tryOrNull<
  [number, CacheConfig | null | undefined, string | undefined, string | undefined, string | undefined],
  Record<string, unknown>
>(
  function createCfObjectParamsImpl(
    status: number,
    cacheConfig?: CacheConfig | null,
    source?: string,
    derivative?: string,
    contentType?: string
  ): Record<string, unknown> {
    // Default cf object - always include baseline parameters
    const cfObject: Record<string, unknown> = {};
    
    // Handle case with no config
    if (!cacheConfig) {
      // Always set cacheEverything to false when no config
      cfObject.cacheEverything = false;
      cfObject.cacheTtl = 0; // Don't cache
      
      logDebug('Created cf object with no caching (no config)', {
        cacheEverything: false,
        cacheTtl: 0
      });
      
      return cfObject;
    }
    
    // Skip caching for error status codes
    const isError = status >= 400;
    if (isError) {
      cfObject.cacheEverything = false;
      cfObject.cacheTtl = 0;
      
      logDebug('Created cf object with no caching (error status)', {
        cacheEverything: false,
        cacheTtl: 0,
        status
      });
      
      return cfObject;
    }
    
    // Check content type restrictions if contentType is provided
    if (contentType) {
      // Comprehensive list of video MIME types
      const videoMimeTypes = [
        'video/mp4',
        'video/webm',
        'video/ogg',
        'video/x-msvideo', // AVI
        'video/quicktime', // MOV
        'video/x-matroska', // MKV
        'video/x-flv',
        'video/3gpp',
        'video/3gpp2',
        'video/mpeg',
        'application/x-mpegURL', // HLS
        'application/dash+xml'   // DASH
      ];
      
      // Comprehensive list of image MIME types
      const imageMimeTypes = [
        'image/jpeg',
        'image/png',
        'image/gif',
        'image/webp',
        'image/avif',
        'image/tiff',
        'image/svg+xml',
        'image/bmp'
      ];
      
      // Check if content type is cacheable
      const isVideoResponse = videoMimeTypes.some(mimeType => contentType.startsWith(mimeType));
      const isImageResponse = imageMimeTypes.some(mimeType => contentType.startsWith(mimeType));
      const isCacheableContent = isVideoResponse || isImageResponse;
      
      // Skip caching for non-cacheable content
      if (!isCacheableContent) {
        cfObject.cacheEverything = false;
        cfObject.cacheTtl = 0;
        
        logDebug('Created cf object with no caching (non-cacheable content type)', {
          cacheEverything: false,
          cacheTtl: 0,
          contentType
        });
        
        return cfObject;
      }
    }
    
    // First, decide whether we should cache at all
    if (!cacheConfig.cacheability) {
      // If not cacheable, set cacheEverything to false and set cacheTtl to 0 for backward compatibility
      cfObject.cacheEverything = false;
      cfObject.cacheTtl = 0;
      return cfObject;
    }
    
    // If we got here, we've decided to cache. Always explicitly set cacheEverything to true
    cfObject.cacheEverything = true;
    
    // Choose between cacheTtl and cacheTtlByStatus based on the config setting
    const useTtlByStatus = cacheConfig.useTtlByStatus !== undefined ? cacheConfig.useTtlByStatus : true;
    
    if (useTtlByStatus) {
      // Use cacheTtlByStatus for more granular control of TTL by status code range
      cfObject.cacheTtlByStatus = {};
      
      // Determine appropriate TTLs based on status code ranges
      if (cacheConfig.ttl.ok > 0) {
        (cfObject.cacheTtlByStatus as Record<string, number>)['200-299'] = cacheConfig.ttl.ok;
      }
      
      if (cacheConfig.ttl.redirects > 0) {
        (cfObject.cacheTtlByStatus as Record<string, number>)['300-399'] = cacheConfig.ttl.redirects;
      }
      
      if (cacheConfig.ttl.clientError > 0) {
        (cfObject.cacheTtlByStatus as Record<string, number>)['400-499'] = cacheConfig.ttl.clientError;
      }
      
      if (cacheConfig.ttl.serverError > 0) {
        (cfObject.cacheTtlByStatus as Record<string, number>)['500-599'] = cacheConfig.ttl.serverError;
      }
    } else {
      // Use cacheTtl for simpler TTL management
      // Determine TTL based on status code
      let ttl = cacheConfig.ttl.ok; // Default to OK TTL
      
      // Adjust TTL based on status code
      const statusGroup = Math.floor(status / 100);
      switch (statusGroup) {
        case 2: ttl = cacheConfig.ttl.ok; break;
        case 3: ttl = cacheConfig.ttl.redirects; break;
        case 4: ttl = cacheConfig.ttl.clientError; break;
        case 5: ttl = cacheConfig.ttl.serverError; break;
      }
      
      cfObject.cacheTtl = ttl;
    }
    
    // Add cache tags if source is provided and cacheability is true
    if (source && cacheConfig.cacheability) {
      // Generate cache tags for the video
      const options = { derivative };
      const tags = generateCacheTags(source, options, undefined);
      
      if (tags.length > 0) {
        // Ensure no tag exceeds 1,024 characters (Cloudflare's limit for API purge compatibility)
        const validTags = tags.map(tag => 
          tag.length > 1024 ? tag.substring(0, 1024) : tag
        );
        
        cfObject.cacheTags = validTags;
        
        // Store cache tags in the diagnostics info
        const requestContext = getCurrentContext();
        if (requestContext) {
          // Initialize diagnostics object if it doesn't exist
          if (!requestContext.diagnostics) {
            requestContext.diagnostics = {};
          }
          
          // Add cache tags to diagnostics info
          requestContext.diagnostics.cacheTags = validTags;
        }
      }
    }
    
    logDebug('Created cf object params for caching', {
      cacheEverything: cfObject.cacheEverything,
      cacheTtlByStatus: cfObject.cacheTtlByStatus,
      cacheTtl: cfObject.cacheTtl,
      cacheTags: cfObject.cacheTags,
      cacheability: cacheConfig?.cacheability
    });
    
    return cfObject;
  },
  {
    functionName: 'createCfObjectParams',
    component: 'CacheManagementService',
    logErrors: true
  },
  {} // Empty default object if there's an error
);
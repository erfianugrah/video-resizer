/**
 * Service for managing cache behavior for video responses
 * Supports both Cache API and Cloudflare cf object caching methods
 * Refactored for ESM syntax and static imports.
 */
import { CacheConfig } from '../utils/cacheUtils';
import { CacheConfigurationManager } from '../config';
import { determineCacheControl } from '../utils/cacheControlUtils';
import { generateCacheTags, shouldBypassCache } from './videoStorageService';
import { createLogger, debug as pinoDebug, warn as pinoWarn } from '../utils/pinoLogger';
import { getCurrentContext } from '../utils/legacyLoggerAdapter';
import { addBreadcrumb } from '../utils/requestContext';
import { logErrorWithContext, withErrorHandling, tryOrNull } from '../utils/errorHandlingUtils';
import { parseRangeHeader, createUnsatisfiableRangeResponse } from '../utils/httpUtils';

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
 * Helper function to store a response in cache with proper Range request support
 * Creates a consistent cache key and ensures the response has the necessary headers
 * Based on Cloudflare's documentation and best practices for video caching
 * 
 * @param cache - Cache instance to use
 * @param url - URL string to use as the cache key
 * @param response - Response to store in cache
 * @param options - Optional extra configuration options
 * @returns Promise that resolves when caching is complete
 */
async function storeInCacheWithRangeSupport(
  cache: Cache,
  url: string,
  response: Response,
  options?: {
    isTransformed?: boolean;
    logPrefix?: string;
  }
): Promise<void> {
  const isTransformed = options?.isTransformed || false;
  const logPrefix = options?.logPrefix || 'CacheHelper';
  
  // Create an extremely minimal cache key for maximum consistency
  // Strip query parameters from the URL to make cache key even more stable
  const urlObj = new URL(url);
  const baseUrl = urlObj.origin + urlObj.pathname;
  
  // According to Cloudflare docs, requests with Range headers won't match
  // cache entries created with requests that don't have Range headers
  // We're using the most minimal cache key possible - just the URL with no headers
  const simpleCacheKey = new Request(baseUrl, { 
    method: 'GET',
    // No headers at all for maximum consistency
  });
  
  // Log the cache key details
  logDebug(`SYNC_CACHE: ${logPrefix}: Using super-simplified cache key`, {
    originalUrl: url,
    simplifiedUrl: baseUrl,
    hasQueryParams: url.includes('?')
  });
  
  // Ensure our response has the headers needed for proper Range request handling
  const headers = new Headers(response.headers);
  
  // Critical for Range request support
  headers.set('Accept-Ranges', 'bytes');
  
  // Remove headers that prevent caching according to Cloudflare docs
  // Set-Cookie header completely prevents caching
  headers.delete('set-cookie');
  
  // Vary: * prevents caching; other complex Vary values can make caching unreliable
  if (headers.get('vary') === '*') {
    headers.delete('vary');
  } else if (headers.has('vary')) {
    // Consider simplifying complex Vary headers for more reliable caching
    const varyValue = headers.get('vary');
    if (varyValue && varyValue.split(',').length > 1) {
      // Simplify to just accept-encoding which is generally safe
      headers.set('vary', 'accept-encoding');
    }
  }
  
  // Create a clean response for caching with full body content
  const body = await response.clone().arrayBuffer();
  
  // Make sure Content-Length is set - this is required for proper Range request handling
  headers.set('Content-Length', body.byteLength.toString());
  
  // Add strong validation headers if missing
  if (!headers.has('ETag')) {
    const hashCode = Math.abs(body.byteLength).toString(16);
    headers.set('ETag', `"${hashCode}-${Date.now().toString(36)}"`);
  }
  
  if (!headers.has('Last-Modified')) {
    headers.set('Last-Modified', new Date().toUTCString());
  }
  
  // Create a clean, cacheable response
  const cachableResponse = new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: headers
  });
  
  // Log what we're about to do
  logDebug(`SYNC_CACHE: ${logPrefix}: Storing response in cache with key ${url}`, {
    isTransformed,
    contentType: headers.get('Content-Type'),
    contentLength: headers.get('Content-Length'),
    acceptRanges: headers.get('Accept-Ranges'),
    hasEtag: headers.has('ETag'),
    hasLastModified: headers.has('Last-Modified')
  });
  
  // Store with the simple cache key
  await cache.put(simpleCacheKey, cachableResponse);
}

/**
 * Store a response in the Cloudflare cache and immediately retrieve it to serve
 * Based on configuration, uses either Cache API or cf object
 * 
 * Implementation details:
 * 1. When using Cache API, operations are performed synchronously to ensure
 *    cache write completes before further processing
 * 2. After successful cache storage, the response is immediately retrieved from cache 
 *    and served to the client - this ensures the response comes directly from the 
 *    cache layer with all cache features (like range request support) properly enabled
 * 3. If the cache match fails after a successful put (rare edge case), we fall back
 *    to returning the original enhanced response to maintain compatibility
 * 4. Special handling for transformed responses ensures consistent cache keys are used
 *    for both put and match operations
 * 
 * All operations have distinctive "SYNC_CACHE:" prefixed log messages for easy tracing.
 * 
 * @param request - The original request
 * @param response - The response to cache
 * @param context - Optional execution context (no longer used for waitUntil with Cache API)
 * @param isTransformedResponse - Whether this response came from a transformed URL
 * @returns Promise that resolves with the response from cache or the original response as fallback
 */
/**
 * Store a response in the Cloudflare cache and immediately retrieve it to serve.
 * Aligns with Cloudflare's pattern: Put with minimal key, Match with original request.
 * Relies on Cloudflare Cache API to handle Range requests automatically during match.
 * Includes fallback for immediate match failure and optional manual range handling.
 *
 * @param request - The original request.
 * @param response - The response to cache.
 * @param context - Optional execution context (influences logging/error handling).
 * @param isTransformedResponse - Whether this response is from a transformed URL.
 * @returns The response served from cache, or the prepared response as fallback.
 */
export const cacheResponse = withErrorHandling<
  [Request, Response, ExecutionContext | undefined, boolean?],
  Response | null
>(
  async function cacheResponseImpl(
    request: Request, 
    response: Response,
    context?: ExecutionContext,
    isTransformedResponse: boolean = false
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

    // Use a different error handling strategy based on context availability
    if (context) {
      // If we have an execution context, run cache operation synchronously with specialized error handling
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
          
          logDebug('SYNC_CACHE: Preparing Cache API put operation (synchronous)', {
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
            // Create an extremely minimal cache key for maximum consistency
            // Strip query parameters from the URL to make cache key even more stable
            const requestUrl = new URL(request.url);
            const baseUrl = requestUrl.origin + requestUrl.pathname;

            // Create the most minimal cache key possible - just the URL, no headers
            const cacheKey = new Request(baseUrl, {
              method: 'GET',
              // No headers at all for maximum consistency
            });
            
            // Log the cache key details
            logDebug('SYNC_CACHE: Using super-simplified cache key for transformed response', {
              originalUrl: request.url,
              simplifiedUrl: baseUrl,
              hasQueryParams: request.url.includes('?')
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
              
              // CRITICAL FIX: Handle Vary header that can prevent cache matches from succeeding

              // Collect all headers for detailed logging before sanitization
              const originalHeaders: Record<string, string> = {};
              enhancedResponse.headers.forEach((value, key) => {
                originalHeaders[key.toLowerCase()] = value;
              });
              
              logDebug('SYNC_CACHE: Original response headers before sanitization', {
                url: request.url,
                originalHeaders,
                hasVary: enhancedResponse.headers.has('vary'),
                varyValue: enhancedResponse.headers.get('vary'),
                contentType: enhancedResponse.headers.get('content-type'),
                status: enhancedResponse.status
              });
              
              // Try even more aggressive header handling - simplify to bare minimum headers
              // Only copy essential headers for caching and proper content delivery
              const essentialHeaders = [
                'content-type',
                'content-length',
                'cache-control',
                'etag',
                'last-modified'
              ];
              
              // Clear all headers and only copy essential ones to ensure clean slate
              const headerKeys: string[] = [];
              for (const [key] of headers.entries()) {
                headerKeys.push(key);
              }
              
              // Delete all non-essential headers
              for (const key of headerKeys) {
                if (!essentialHeaders.includes(key.toLowerCase())) {
                  headers.delete(key);
                }
              }
              
              // Vary: * prevents caching entirely
              if (headers.get('vary') === '*') {
                headers.delete('vary');
                logDebug('SYNC_CACHE: Removed "Vary: *" header that prevents caching', {
                  url: request.url
                });
              } else if (headers.has('vary')) {
                // Complex Vary values make cache matches extremely brittle
                const varyValue = headers.get('vary');
                if (varyValue) {
                  logDebug('SYNC_CACHE: Found complex Vary header that may prevent cache matches', {
                    varyValue,
                    url: request.url
                  });
                  
                  // UPDATED APPROACH: For transformed responses, completely remove Vary
                  // This is the most reliable approach for ensuring consistent cache behavior
                  headers.delete('vary');
                  
                  logDebug('SYNC_CACHE: Removed Vary header completely for maximum cache reliability', {
                    originalVary: varyValue,
                    url: request.url
                  });
                }
              }
              
              // Add mandatory range support headers
              headers.set('accept-ranges', 'bytes');
              
              // Remove other headers that can interfere with caching
              headers.delete('set-cookie'); // Prevents caching entirely
              headers.delete('transfer-encoding'); // Can cause issues with chunked encoding
              
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
              
              // Add special headers to mark this response as prepared for caching
              headers.set('X-Cache-Prepared', 'true');
              headers.set('X-Cache-Sanitized', 'true');
              
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
            // Standard cache put with range request support
            await storeInCacheWithRangeSupport(
              cache,
              request.url,
              enhancedResponse.clone()
            );
          }
          
          const putDuration = Date.now() - putStartTime;
          
          logDebug('SYNC_CACHE: Stored response in Cloudflare Cache API (synchronous)', {
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
      
      // Execute the cache operation synchronously
      await cachePutOperation();
      
      // Now, immediately try to retrieve the response from cache to serve it
      try {
        // Get the default cache instance
        const cache = caches.default;
        
        const originalRequestHasRange = request.headers.has('Range');
        logDebug('SYNC_CACHE: Attempting immediate cache match with multiple key strategies', {
            url: request.url,
            originalMethod: request.method,
            hasRange: originalRequestHasRange,
            rangeHeader: request.headers.get('Range')
        });

        const requestUrl = new URL(request.url);
        
        // Create all cache key variants for maximum hit probability
        // 1. Original request with all headers (handles Range requests properly)
        const originalRequest = request;
        
        // 2. Path-only request with no headers (most minimal key)
        const baseUrl = requestUrl.origin + requestUrl.pathname;
        const pathOnlyKey = new Request(baseUrl, { method: 'GET' });
        
        // 3. Path-only request with Accept header (good for content negotiation)
        const acceptHeader = request.headers.get('Accept');
        const acceptHeadersKey = new Request(baseUrl, { 
          method: 'GET',
          headers: acceptHeader ? { 'Accept': acceptHeader } : undefined
        });
        
        // 4. For transformed URLs, also try matching the original path
        let originalPathKey: Request | null = null;
        if (requestUrl.pathname.includes('/cdn-cgi/media/') || 
            requestUrl.pathname.includes('/cdn-cgi/image/')) {
          const originalPath = requestUrl.pathname.replace(/\/cdn-cgi\/(media|image)\/[^/]+\//, '/');
          
          if (originalPath !== requestUrl.pathname) {
            const originalUrl = new URL(requestUrl.toString());
            originalUrl.pathname = originalPath;
            
            originalPathKey = new Request(originalUrl.toString(), {
              method: request.method,
              headers: request.headers
            });
          }
        }
        
        // Log the cache keys we're trying
        logDebug('SYNC_CACHE: Trying parallel cache match strategies for immediate match', {
          url: request.url,
          originalRequest: true,
          pathOnlyKey: baseUrl,
          acceptHeadersKey: !!acceptHeader,
          originalPathKey: originalPathKey ? originalPathKey.url : null
        });
        
        // Try all cache match strategies simultaneously
        const matchPromises = [
          cache.match(originalRequest).then(response => ({ response, method: 'original-request' })),
          cache.match(pathOnlyKey).then(response => ({ response, method: 'path-only' })),
          cache.match(acceptHeadersKey).then(response => ({ response, method: 'accept-headers' }))
        ];
        
        // Add originalPathKey if it exists
        if (originalPathKey) {
          matchPromises.push(
            cache.match(originalPathKey).then(response => ({ response, method: 'original-path' }))
          );
        }
        
        // Wait for all match attempts and use the first successful one
        const results = await Promise.all(matchPromises);
        
        // Find the first match that succeeded
        const matchResult = results.find(result => result.response !== null);
        
        let matchedResponse = matchResult?.response || null;
        let matchMethod = matchResult?.method || 'none';

        if (matchedResponse) {
            logDebug('SYNC_CACHE: Successfully matched response using ' + matchMethod, {
                url: request.url,
                status: matchedResponse.status, // Expect 206 if Range was handled, 200 otherwise
                contentType: matchedResponse.headers.get('Content-Type'),
                contentLength: matchedResponse.headers.get('Content-Length'),
                contentRange: matchedResponse.headers.get('Content-Range'), // Check if CF added this
                cfCacheStatus: matchedResponse.headers.get('CF-Cache-Status')
            });

            // Check if Cloudflare automatically handled the range request
            if (originalRequestHasRange && matchedResponse.status === 206) {
                logDebug('SYNC_CACHE: Cloudflare Cache API automatically handled Range request', { 
                    url: request.url,
                    contentRange: matchedResponse.headers.get('Content-Range')
                });
                
                const requestContext = getCurrentContext();
                if (requestContext) {
                    addBreadcrumb(requestContext, 'Cache', 'Served partial content (CF Auto)', { 
                        contentRange: matchedResponse.headers.get('Content-Range') 
                    });
                    if (!requestContext.diagnostics) requestContext.diagnostics = {};
                    requestContext.diagnostics.rangeRequest = { 
                        header: request.headers.get('Range'), 
                        source: 'cache-api-auto', 
                        status: 206 
                    };
                }
                // Return the 206 response directly from Cloudflare
                return matchedResponse;
            }

            // --- Fallback: Manual Range Handling (if needed) ---
            // This block executes if the original request had Range, but CF returned 200 OK.
            if (originalRequestHasRange && matchedResponse.status === 200 && 
                matchedResponse.headers.get('Accept-Ranges') === 'bytes') {
                logWarn('SYNC_CACHE: Matched full response (200) but Range was requested. Attempting manual range handling.', { 
                    url: request.url 
                });
                
                const rangeHeader = request.headers.get('Range');
                try {
                    const responseClone = matchedResponse.clone();
                    const arrayBuffer = await responseClone.arrayBuffer();
                    const totalSize = arrayBuffer.byteLength;
                    const range = parseRangeHeader(rangeHeader, totalSize);

                    if (range) {
                        const slicedBody = arrayBuffer.slice(range.start, range.end + 1);
                        const rangeHeaders = new Headers(matchedResponse.headers);
                        rangeHeaders.set('Content-Range', `bytes ${range.start}-${range.end}/${range.total}`);
                        rangeHeaders.set('Content-Length', slicedBody.byteLength.toString());
                        rangeHeaders.set('X-Range-Handled-By', 'Cache-API-Manual-Fallback'); // Debug header

                        logDebug('SYNC_CACHE: Serving MANUALLY ranged response as fallback', { 
                            url: request.url, 
                            range: rangeHeader, 
                            start: range.start, 
                            end: range.end, 
                            total: range.total 
                        });
                        
                        const requestContext = getCurrentContext();
                        if (requestContext) {
                            addBreadcrumb(requestContext, 'Cache', 'Served partial content (Manual Fallback)', { 
                                contentRange: rangeHeaders.get('Content-Range') 
                            });
                            if (!requestContext.diagnostics) requestContext.diagnostics = {};
                            requestContext.diagnostics.rangeRequest = { 
                                header: rangeHeader, 
                                start: range.start, 
                                end: range.end, 
                                total: range.total, 
                                source: 'cache-api-manual-fallback', 
                                status: 206 
                            };
                        }
                        return new Response(slicedBody, { 
                            status: 206, 
                            statusText: 'Partial Content', 
                            headers: rangeHeaders 
                        });
                    } else {
                        logWarn('SYNC_CACHE: Unsatisfiable range for manual fallback', { 
                            url: request.url, 
                            range: rangeHeader, 
                            totalSize 
                        });
                        
                        const requestContext = getCurrentContext();
                        if (requestContext) {
                            addBreadcrumb(requestContext, 'Cache', 'Unsatisfiable range requested (Manual Fallback)', { 
                                range: rangeHeader, 
                                totalSize 
                            });
                            if (!requestContext.diagnostics) requestContext.diagnostics = {};
                            requestContext.diagnostics.rangeRequest = { 
                                header: rangeHeader, 
                                error: 'unsatisfiable', 
                                total: totalSize, 
                                source: 'cache-api-manual-fallback', 
                                status: 416 
                            };
                        }
                        return createUnsatisfiableRangeResponse(totalSize);
                    }
                } catch (rangeError) {
                    logErrorWithContext('SYNC_CACHE: Error during manual range handling fallback', 
                        rangeError, { url: request.url, range: rangeHeader }, 'CacheManagementService');
                    // Fall through to return the original 200 response on error
                }
            }

            // If no range was requested, or if manual handling failed, return the matched response
            return matchedResponse;
        } else {
            // Immediate match failed - this is the fallback scenario
            logWarn('SYNC_CACHE: Cache match failed immediately after put. Falling back to prepared response.', { 
                url: request.url 
            });
            
            const requestContext = getCurrentContext();
            if (requestContext) {
                addBreadcrumb(requestContext, 'Cache', 'Immediate match miss', { 
                    url: request.url
                });
            }
            // Fallback to the prepared response we attempted to put
            return enhancedResponse;
        }
      } catch (matchError) {
        // Handle potential errors during the cache.match operation
        logErrorWithContext(
          'SYNC_CACHE: Error during cache.match immediately after cache.put',
          matchError,
          { 
            url: request.url,
            timestamp: new Date().toISOString()
          },
          'CacheManagementService'
        );
        // Fallback to returning the response object we originally intended to put
        return enhancedResponse;
      }
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
          
          logDebug('SYNC_CACHE: Preparing Cache API put operation (direct)', {
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
            // Create an extremely minimal cache key for maximum consistency
            // Strip query parameters from the URL to make cache key even more stable
            const requestUrl = new URL(request.url);
            const baseUrl = requestUrl.origin + requestUrl.pathname;

            // Create the most minimal cache key possible - just the URL, no headers
            const cacheKey = new Request(baseUrl, {
              method: 'GET',
              // No headers at all for maximum consistency
            });
            
            // Log the cache key details
            logDebug('SYNC_CACHE: Using super-simplified cache key for transformed response', {
              originalUrl: request.url,
              simplifiedUrl: baseUrl,
              hasQueryParams: request.url.includes('?')
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
              
              // CRITICAL FIX: Handle Vary header that can prevent cache matches from succeeding

              // Collect all headers for detailed logging before sanitization
              const originalHeaders: Record<string, string> = {};
              enhancedResponse.headers.forEach((value, key) => {
                originalHeaders[key.toLowerCase()] = value;
              });
              
              logDebug('SYNC_CACHE: Original response headers before sanitization', {
                url: request.url,
                originalHeaders,
                hasVary: enhancedResponse.headers.has('vary'),
                varyValue: enhancedResponse.headers.get('vary'),
                contentType: enhancedResponse.headers.get('content-type'),
                status: enhancedResponse.status
              });
              
              // Try even more aggressive header handling - simplify to bare minimum headers
              // Only copy essential headers for caching and proper content delivery
              const essentialHeaders = [
                'content-type',
                'content-length',
                'cache-control',
                'etag',
                'last-modified'
              ];
              
              // Clear all headers and only copy essential ones to ensure clean slate
              const headerKeys: string[] = [];
              for (const [key] of headers.entries()) {
                headerKeys.push(key);
              }
              
              // Delete all non-essential headers
              for (const key of headerKeys) {
                if (!essentialHeaders.includes(key.toLowerCase())) {
                  headers.delete(key);
                }
              }
              
              // Vary: * prevents caching entirely
              if (headers.get('vary') === '*') {
                headers.delete('vary');
                logDebug('SYNC_CACHE: Removed "Vary: *" header that prevents caching', {
                  url: request.url
                });
              } else if (headers.has('vary')) {
                // Complex Vary values make cache matches extremely brittle
                const varyValue = headers.get('vary');
                if (varyValue) {
                  logDebug('SYNC_CACHE: Found complex Vary header that may prevent cache matches', {
                    varyValue,
                    url: request.url
                  });
                  
                  // UPDATED APPROACH: For transformed responses, completely remove Vary
                  // This is the most reliable approach for ensuring consistent cache behavior
                  headers.delete('vary');
                  
                  logDebug('SYNC_CACHE: Removed Vary header completely for maximum cache reliability', {
                    originalVary: varyValue,
                    url: request.url
                  });
                }
              }
              
              // Add mandatory range support headers
              headers.set('accept-ranges', 'bytes');
              
              // Remove other headers that can interfere with caching
              headers.delete('set-cookie'); // Prevents caching entirely
              headers.delete('transfer-encoding'); // Can cause issues with chunked encoding
              
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
              
              // Add special headers to mark this response as prepared for caching
              headers.set('X-Cache-Prepared', 'true');
              headers.set('X-Cache-Sanitized', 'true');
              
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
            // Standard cache put with range request support
            await storeInCacheWithRangeSupport(
              cache,
              request.url,
              enhancedResponse.clone()
            );
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
          
          logDebug('SYNC_CACHE: Stored response in Cloudflare Cache API', {
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
      
      // Now, immediately try to retrieve the response from cache to serve it
      try {
        // Get the default cache instance
        const cache = caches.default;
        
        const originalRequestHasRange = request.headers.has('Range');
        logDebug('SYNC_CACHE: Attempting immediate cache match with multiple key strategies', {
            url: request.url,
            originalMethod: request.method,
            hasRange: originalRequestHasRange,
            rangeHeader: request.headers.get('Range')
        });

        const requestUrl = new URL(request.url);
        
        // Create all cache key variants for maximum hit probability
        // 1. Original request with all headers (handles Range requests properly)
        const originalRequest = request;
        
        // 2. Path-only request with no headers (most minimal key)
        const baseUrl = requestUrl.origin + requestUrl.pathname;
        const pathOnlyKey = new Request(baseUrl, { method: 'GET' });
        
        // 3. Path-only request with Accept header (good for content negotiation)
        const acceptHeader = request.headers.get('Accept');
        const acceptHeadersKey = new Request(baseUrl, { 
          method: 'GET',
          headers: acceptHeader ? { 'Accept': acceptHeader } : undefined
        });
        
        // 4. For transformed URLs, also try matching the original path
        let originalPathKey: Request | null = null;
        if (requestUrl.pathname.includes('/cdn-cgi/media/') || 
            requestUrl.pathname.includes('/cdn-cgi/image/')) {
          const originalPath = requestUrl.pathname.replace(/\/cdn-cgi\/(media|image)\/[^/]+\//, '/');
          
          if (originalPath !== requestUrl.pathname) {
            const originalUrl = new URL(requestUrl.toString());
            originalUrl.pathname = originalPath;
            
            originalPathKey = new Request(originalUrl.toString(), {
              method: request.method,
              headers: request.headers
            });
          }
        }
        
        // Log the cache keys we're trying
        logDebug('SYNC_CACHE: Trying parallel cache match strategies for immediate match', {
          url: request.url,
          originalRequest: true,
          pathOnlyKey: baseUrl,
          acceptHeadersKey: !!acceptHeader,
          originalPathKey: originalPathKey ? originalPathKey.url : null
        });
        
        // Try all cache match strategies simultaneously
        const matchPromises = [
          cache.match(originalRequest).then(response => ({ response, method: 'original-request' })),
          cache.match(pathOnlyKey).then(response => ({ response, method: 'path-only' })),
          cache.match(acceptHeadersKey).then(response => ({ response, method: 'accept-headers' }))
        ];
        
        // Add originalPathKey if it exists
        if (originalPathKey) {
          matchPromises.push(
            cache.match(originalPathKey).then(response => ({ response, method: 'original-path' }))
          );
        }
        
        // Wait for all match attempts and use the first successful one
        const results = await Promise.all(matchPromises);
        
        // Find the first match that succeeded
        const matchResult = results.find(result => result.response !== null);
        
        let matchedResponse = matchResult?.response || null;
        let matchMethod = matchResult?.method || 'none';

        if (matchedResponse) {
            logDebug('SYNC_CACHE: Successfully matched response using ' + matchMethod, {
                url: request.url,
                status: matchedResponse.status, // Expect 206 if Range was handled, 200 otherwise
                contentType: matchedResponse.headers.get('Content-Type'),
                contentLength: matchedResponse.headers.get('Content-Length'),
                contentRange: matchedResponse.headers.get('Content-Range'), // Check if CF added this
                cfCacheStatus: matchedResponse.headers.get('CF-Cache-Status')
            });

            // Check if Cloudflare automatically handled the range request
            if (originalRequestHasRange && matchedResponse.status === 206) {
                logDebug('SYNC_CACHE: Cloudflare Cache API automatically handled Range request', { 
                    url: request.url,
                    contentRange: matchedResponse.headers.get('Content-Range')
                });
                
                const requestContext = getCurrentContext();
                if (requestContext) {
                    addBreadcrumb(requestContext, 'Cache', 'Served partial content (CF Auto)', { 
                        contentRange: matchedResponse.headers.get('Content-Range') 
                    });
                    if (!requestContext.diagnostics) requestContext.diagnostics = {};
                    requestContext.diagnostics.rangeRequest = { 
                        header: request.headers.get('Range'), 
                        source: 'cache-api-auto', 
                        status: 206 
                    };
                }
                // Return the 206 response directly from Cloudflare
                return matchedResponse;
            }

            // --- Fallback: Manual Range Handling (if needed) ---
            // This block executes if the original request had Range, but CF returned 200 OK.
            if (originalRequestHasRange && matchedResponse.status === 200 && 
                matchedResponse.headers.get('Accept-Ranges') === 'bytes') {
                logWarn('SYNC_CACHE: Matched full response (200) but Range was requested. Attempting manual range handling.', { 
                    url: request.url 
                });
                
                const rangeHeader = request.headers.get('Range');
                try {
                    const responseClone = matchedResponse.clone();
                    const arrayBuffer = await responseClone.arrayBuffer();
                    const totalSize = arrayBuffer.byteLength;
                    const range = parseRangeHeader(rangeHeader, totalSize);

                    if (range) {
                        const slicedBody = arrayBuffer.slice(range.start, range.end + 1);
                        const rangeHeaders = new Headers(matchedResponse.headers);
                        rangeHeaders.set('Content-Range', `bytes ${range.start}-${range.end}/${range.total}`);
                        rangeHeaders.set('Content-Length', slicedBody.byteLength.toString());
                        rangeHeaders.set('X-Range-Handled-By', 'Cache-API-Manual-Fallback'); // Debug header

                        logDebug('SYNC_CACHE: Serving MANUALLY ranged response as fallback', { 
                            url: request.url, 
                            range: rangeHeader, 
                            start: range.start, 
                            end: range.end, 
                            total: range.total 
                        });
                        
                        const requestContext = getCurrentContext();
                        if (requestContext) {
                            addBreadcrumb(requestContext, 'Cache', 'Served partial content (Manual Fallback)', { 
                                contentRange: rangeHeaders.get('Content-Range') 
                            });
                            if (!requestContext.diagnostics) requestContext.diagnostics = {};
                            requestContext.diagnostics.rangeRequest = { 
                                header: rangeHeader, 
                                start: range.start, 
                                end: range.end, 
                                total: range.total, 
                                source: 'cache-api-manual-fallback', 
                                status: 206 
                            };
                        }
                        return new Response(slicedBody, { 
                            status: 206, 
                            statusText: 'Partial Content', 
                            headers: rangeHeaders 
                        });
                    } else {
                        logWarn('SYNC_CACHE: Unsatisfiable range for manual fallback', { 
                            url: request.url, 
                            range: rangeHeader, 
                            totalSize 
                        });
                        
                        const requestContext = getCurrentContext();
                        if (requestContext) {
                            addBreadcrumb(requestContext, 'Cache', 'Unsatisfiable range requested (Manual Fallback)', { 
                                range: rangeHeader, 
                                totalSize 
                            });
                            if (!requestContext.diagnostics) requestContext.diagnostics = {};
                            requestContext.diagnostics.rangeRequest = { 
                                header: rangeHeader, 
                                error: 'unsatisfiable', 
                                total: totalSize, 
                                source: 'cache-api-manual-fallback', 
                                status: 416 
                            };
                        }
                        return createUnsatisfiableRangeResponse(totalSize);
                    }
                } catch (rangeError) {
                    logErrorWithContext('SYNC_CACHE: Error during manual range handling fallback', 
                        rangeError, { url: request.url, range: rangeHeader }, 'CacheManagementService');
                    // Fall through to return the original 200 response on error
                }
            }

            // If no range was requested, or if manual handling failed, return the matched response
            return matchedResponse;
        } else {
            // Immediate match failed - this is the fallback scenario
            logWarn('SYNC_CACHE: Cache match failed immediately after direct put. Falling back to prepared response.', { 
                url: request.url 
            });
            
            const requestContext = getCurrentContext();
            if (requestContext) {
                addBreadcrumb(requestContext, 'Cache', 'Immediate match miss', { 
                    url: request.url
                });
            }
            // Fallback to the prepared response we attempted to put
            return enhancedResponse;
        }
      } catch (matchError) {
        // Handle potential errors during the cache.match operation
        logErrorWithContext(
          'SYNC_CACHE: Error during cache.match immediately after direct cache.put',
          matchError,
          { 
            url: request.url,
            timestamp: new Date().toISOString()
          },
          'CacheManagementService'
        );
        // Fallback to returning the response object we originally intended to put
        return enhancedResponse;
      }
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
 * Retrieves a response from the Cloudflare Cache API, handling range requests.
 * Primarily uses the original request with its headers for matching,
 * letting Cloudflare handle range requests automatically.
 * Includes a fallback manual range handling mechanism for edge cases.
 * 
 * @param request - The incoming request to match in cache.
 * @returns Cached response (possibly 206 Partial Content) or null if not found.
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
    
    // Cache API implementation
    const cacheMatchOperation = withErrorHandling(
      async () => {
        // Get the default cache
        const cache = caches.default;
        
        const matchStartTime = Date.now();
        
        // Log attempt with key details from the request
        logDebug('Attempting Cache API match using ORIGINAL request', {
          url: request.url,
          method: request.method,
          isRangeRequest,
          rangeHeader: rangeHeader || undefined
        });

        // Try multiple cache matching strategies in parallel for better hit rates
        // This is especially important right after cache.put operations where immediate
        // cache availability isn't guaranteed due to Cache API's eventual consistency
        
        const requestUrl = new URL(request.url);
        
        // Create all cache key variants
        // 1. Original request with all headers (handles Range requests properly)
        const originalRequest = request;
        
        // 2. Path-only request with no headers (most minimal key)
        const baseUrl = requestUrl.origin + requestUrl.pathname;
        const pathOnlyKey = new Request(baseUrl, { method: 'GET' });
        
        // 3. Path-only request with Accept header (good for content negotiation)
        const acceptHeader = request.headers.get('Accept');
        const acceptHeadersKey = new Request(baseUrl, { 
          method: 'GET',
          headers: acceptHeader ? { 'Accept': acceptHeader } : undefined
        });
        
        // 4. For transformed URLs, also try matching the original path
        let originalPathKey: Request | null = null;
        if (requestUrl.pathname.includes('/cdn-cgi/media/') || 
            requestUrl.pathname.includes('/cdn-cgi/image/')) {
          const originalPath = requestUrl.pathname.replace(/\/cdn-cgi\/(media|image)\/[^/]+\//, '/');
          
          if (originalPath !== requestUrl.pathname) {
            const originalUrl = new URL(requestUrl.toString());
            originalUrl.pathname = originalPath;
            
            originalPathKey = new Request(originalUrl.toString(), {
              method: request.method,
              headers: request.headers
            });
          }
        }
        
        // Log the cache keys we're trying
        logDebug('Attempting parallel cache matches with multiple key strategies', {
          url: request.url,
          originalRequest: true,
          pathOnlyKey: baseUrl,
          acceptHeadersKey: !!acceptHeader,
          originalPathKey: originalPathKey ? originalPathKey.url : null
        });
        
        // Try all cache match strategies simultaneously
        const matchPromises = [
          cache.match(originalRequest).then(response => ({ response, method: 'original-request' })),
          cache.match(pathOnlyKey).then(response => ({ response, method: 'path-only' })),
          cache.match(acceptHeadersKey).then(response => ({ response, method: 'accept-headers' }))
        ];
        
        // Add originalPathKey if it exists
        if (originalPathKey) {
          matchPromises.push(
            cache.match(originalPathKey).then(response => ({ response, method: 'original-path' }))
          );
        }
        
        // Wait for all match attempts and use the first successful one
        const results = await Promise.all(matchPromises);
        
        // Find the first match that succeeded
        const matchResult = results.find(result => result.response !== null);
        
        let cachedResponse = matchResult?.response || null;
        let matchMethod = matchResult?.method || 'none';
        
        if (cachedResponse) {
          logDebug('Found cached response using parallel matching strategy', {
            url: request.url,
            matchMethod,
            status: cachedResponse.status,
            contentType: cachedResponse.headers.get('Content-Type')
          });
        } else {
          logDebug('No cache match found with any parallel strategy', {
            url: request.url,
            attemptedMethods: results.map(r => r.method).join(',')
          });
        }
        
        const matchDuration = Date.now() - matchStartTime;
        
        // Add breadcrumb for cache result
        const requestContext = getCurrentContext();
        if (requestContext) {
          if (cachedResponse) {
            addBreadcrumb(requestContext, 'Cache', 'Cache hit', {
              url: request.url,
              method: 'cache-api',
              matchMethod,
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
        
        // Handle cache hit
        if (cachedResponse) {
          logDebug('Cache API match result: HIT', {
            url: request.url,
            matchMethod,
            status: cachedResponse.status,
            contentType: cachedResponse.headers.get('Content-Type'),
            contentRange: cachedResponse.headers.get('Content-Range'),
            acceptRanges: cachedResponse.headers.get('Accept-Ranges'),
            matchDurationMs: matchDuration
          });
          
          // Check if this is a 206 Partial Content response - Cloudflare handled the range request
          if (isRangeRequest && cachedResponse.status === 206) {
            logDebug('Cloudflare Cache API automatically handled Range request', { 
              url: request.url,
              contentRange: cachedResponse.headers.get('Content-Range') 
            });
            
            if (requestContext) {
              addBreadcrumb(requestContext, 'Cache', 'Served partial content (CF Auto)', { 
                contentRange: cachedResponse.headers.get('Content-Range') 
              });
              if (!requestContext.diagnostics) requestContext.diagnostics = {};
              requestContext.diagnostics.rangeRequest = { 
                header: rangeHeader, 
                source: 'cache-api-auto', 
                status: 206 
              };
            }
            
            return cachedResponse;
          }
          
          // Manual range handling fallback (if needed)
          if (isRangeRequest && cachedResponse.status === 200 && 
              cachedResponse.headers.get('Accept-Ranges') === 'bytes') {
            logWarn('Cache hit with 200 OK when Range requested. Applying manual range handling.', { 
              url: request.url 
            });
            
            try {
              const responseClone = cachedResponse.clone();
              const arrayBuffer = await responseClone.arrayBuffer();
              const totalSize = arrayBuffer.byteLength;
              const range = parseRangeHeader(rangeHeader, totalSize);
              
              if (range) {
                const slicedBody = arrayBuffer.slice(range.start, range.end + 1);
                const rangeHeaders = new Headers(cachedResponse.headers);
                rangeHeaders.set('Content-Range', `bytes ${range.start}-${range.end}/${range.total}`);
                rangeHeaders.set('Content-Length', slicedBody.byteLength.toString());
                rangeHeaders.set('X-Range-Handled-By', 'Manual-Fallback');
                
                logDebug('Serving MANUALLY ranged response as fallback', { 
                  url: request.url, 
                  range: rangeHeader, 
                  start: range.start, 
                  end: range.end, 
                  total: range.total 
                });
                
                if (requestContext) {
                  addBreadcrumb(requestContext, 'Cache', 'Served partial content (Manual)', { 
                    contentRange: rangeHeaders.get('Content-Range') 
                  });
                  if (!requestContext.diagnostics) requestContext.diagnostics = {};
                  requestContext.diagnostics.rangeRequest = { 
                    header: rangeHeader, 
                    start: range.start, 
                    end: range.end, 
                    total: range.total,
                    source: 'manual-range-handling',
                    status: 206 
                  };
                }
                
                return new Response(slicedBody, { 
                  status: 206, 
                  statusText: 'Partial Content', 
                  headers: rangeHeaders 
                });
              } else {
                // Unsatisfiable range
                logWarn('Unsatisfiable range for cached content', { 
                  url: request.url, 
                  range: rangeHeader, 
                  totalSize 
                });
                
                if (requestContext) {
                  addBreadcrumb(requestContext, 'Cache', 'Unsatisfiable range', { 
                    range: rangeHeader, 
                    totalSize 
                  });
                  if (!requestContext.diagnostics) requestContext.diagnostics = {};
                  requestContext.diagnostics.rangeRequest = { 
                    header: rangeHeader, 
                    error: 'unsatisfiable', 
                    total: totalSize,
                    source: 'manual-range-handling',
                    status: 416
                  };
                }
                
                return createUnsatisfiableRangeResponse(totalSize);
              }
            } catch (rangeError) {
              // Log error but fall through to return the full response
              logErrorWithContext('Error handling range request manually', 
                rangeError, { url: request.url, range: rangeHeader }, 'CacheManagementService');
            }
          }
          
          // If no range handling was needed or manual handling failed, return the response as-is
          return cachedResponse;
        }
        
        // Handle cache miss
        logDebug('Cache API match result: MISS', {
          url: request.url,
          matchDurationMs: matchDuration
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
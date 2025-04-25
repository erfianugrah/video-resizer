/**
 * Utilities for storing and managing cache operations
 * Handles range request support and transformed responses
 */
import { CacheConfig } from './cacheUtils';
import { getCurrentContext } from './legacyLoggerAdapter';
import { addBreadcrumb } from './requestContext';
import { logErrorWithContext, withErrorHandling } from './errorHandlingUtils';
import { parseRangeHeader, createUnsatisfiableRangeResponse } from './httpUtils';
import { createLogger, debug as pinoDebug, warn as pinoWarn } from './pinoLogger';

/**
 * Log a debug message with proper context handling
 */
function logDebug(message: string, data?: Record<string, unknown>): void {
  const requestContext = getCurrentContext();
  if (requestContext) {
    const logger = createLogger(requestContext);
    pinoDebug(requestContext, logger, 'CacheStorageUtils', message, data);
  } else {
    // Fall back to console as a last resort
    console.debug(`CacheStorageUtils: ${message}`, data || {});
  }
}

/**
 * Log a warning message with proper context handling
 */
function logWarn(message: string, data?: Record<string, unknown>): void {
  const requestContext = getCurrentContext();
  if (requestContext) {
    const logger = createLogger(requestContext);
    pinoWarn(requestContext, logger, 'CacheStorageUtils', message, data);
  } else {
    // Fall back to console as a last resort
    console.warn(`CacheStorageUtils: ${message}`, data || {});
  }
}

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
    component: 'CacheStorageUtils',
    logErrors: true
  }
);

/**
 * Helper function to prepare a response for caching with proper Range request support
 * (This function now just prepares the headers without actually storing in cache)
 * 
 * @param url - URL string to use as the cache key (for logging only)
 * @param response - Response to prepare headers for
 * @param options - Optional extra configuration options
 * @returns A prepared response with appropriate headers for range request support
 */
export async function prepareResponseForRangeSupport(
  url: string,
  response: Response,
  options?: {
    isTransformed?: boolean;
    logPrefix?: string;
  }
): Promise<Response> {
  const isTransformed = options?.isTransformed || false;
  const logPrefix = options?.logPrefix || 'CacheHelper';
  
  // Strip query parameters from the URL for logging
  const urlObj = new URL(url);
  const baseUrl = urlObj.origin + urlObj.pathname;
  
  // Log details
  logDebug(`${logPrefix}: Preparing response for range support`, {
    originalUrl: url,
    simplifiedUrl: baseUrl,
    hasQueryParams: url.includes('?')
  });
  
  // Ensure our response has the headers needed for proper Range request handling
  const headers = new Headers(response.headers);
  
  // Critical for Range request support
  headers.set('Accept-Ranges', 'bytes');
  
  // Remove headers that prevent caching
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
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: headers
  });
}

/**
 * Get a list of media MIME types that should be cacheable
 * @returns Object containing arrays of video and image MIME types
 */
export function getCacheableMimeTypes() {
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

  return { videoMimeTypes, imageMimeTypes };
}

/**
 * Check if a content type is cacheable media
 * @param contentType Content type to check
 * @returns boolean indicating if this is a cacheable media content type
 */
export function isCacheableContentType(contentType: string): boolean {
  if (!contentType) return false;
  
  const { videoMimeTypes, imageMimeTypes } = getCacheableMimeTypes();
  
  // Check if content type is cacheable
  const isVideoResponse = videoMimeTypes.some(mimeType => contentType.startsWith(mimeType));
  const isImageResponse = imageMimeTypes.some(mimeType => contentType.startsWith(mimeType));
  
  return isVideoResponse || isImageResponse;
}
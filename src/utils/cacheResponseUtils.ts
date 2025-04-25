/**
 * Utilities for storing responses in cache
 * Handles complex caching scenarios with range requests
 */
import { CacheConfig } from './cacheUtils';
import { CacheConfigurationManager } from '../config';
import { getCurrentContext } from './legacyLoggerAdapter';
import { addBreadcrumb } from './requestContext';
import { logErrorWithContext, withErrorHandling } from './errorHandlingUtils';
import { parseRangeHeader, createUnsatisfiableRangeResponse } from './httpUtils';
import { createLogger, debug as pinoDebug, warn as pinoWarn } from './pinoLogger';
import { prepareResponseForCaching, isCacheableContentType } from './cacheStorageUtils';

/**
 * Log a debug message with proper context handling
 */
function logDebug(message: string, data?: Record<string, unknown>): void {
  const requestContext = getCurrentContext();
  if (requestContext) {
    const logger = createLogger(requestContext);
    pinoDebug(requestContext, logger, 'CacheResponseUtils', message, data);
  } else {
    // Fall back to console as a last resort
    console.debug(`CacheResponseUtils: ${message}`, data || {});
  }
}

/**
 * Log a warning message with proper context handling
 */
function logWarn(message: string, data?: Record<string, unknown>): void {
  const requestContext = getCurrentContext();
  if (requestContext) {
    const logger = createLogger(requestContext);
    pinoWarn(requestContext, logger, 'CacheResponseUtils', message, data);
  } else {
    // Fall back to console as a last resort
    console.warn(`CacheResponseUtils: ${message}`, data || {});
  }
}

/**
 * This function is now simpler, focusing only on preparing responses and handling range requests.
 * It no longer uses the Cache API for caching transformed videos, as we've migrated to using
 * KV exclusively. However, it retains all the critical range request handling functionality.
 *
 * @param request - The original request (may include Range header)
 * @param responseOrFetch - Either a Response object or a function to fetch the resource
 * @param context - Optional execution context for waitUntil (unused now)
 * @returns Response with proper range support
 */
export const cacheResponse = withErrorHandling<
  [Request, Response | ((req: Request) => Promise<Response>), ExecutionContext?],
  Promise<Response>
>(
  async function cacheResponseImpl(
    request: Request,
    responseOrFetch: Response | ((req: Request) => Promise<Response>),
    context?: ExecutionContext
  ): Promise<Response> {
    // Only process GET requests
    if (request.method !== 'GET') {
      logDebug('Not caching non-GET request', { method: request.method });
      
      // If we were given a Response directly, return it
      if (responseOrFetch instanceof Response) {
        return responseOrFetch;
      }
      
      // Otherwise call the fetch function and return its result
      return responseOrFetch(request);
    }
    
    const hasRangeHeader = request.headers.has('Range');
    const rangeHeader = request.headers.get('Range');
    
    logDebug('Starting response preparation for possible range handling', {
      url: request.url,
      hasRangeHeader,
      rangeHeader: rangeHeader || undefined
    });
    
    // Get the response - either use the provided response or call the fetch function
    let response: Response;
    
    if (responseOrFetch instanceof Response) {
      // If we were given a Response directly, use it
      response = responseOrFetch;
      
      // If the response is already a 206 Partial Content, just return it
      if (response.status === 206) {
        logDebug('Received 206 Partial Content response - returning as is', {
          url: request.url,
          contentRange: response.headers.get('Content-Range'),
          isFromCdnCgi: response.url && response.url.includes('/cdn-cgi/')
        });
        
        return response;
      }
    } else {
      // If a range was requested, we need to handle it properly when fetching
      let originRequest: Request;
      
      if (hasRangeHeader) {
        // If we're fetching directly, include the Range header to let origin handle it
        originRequest = request;
        logDebug('Using original request with Range header for fetch', {
          url: request.url,
          rangeHeader
        });
      } else {
        // Just use the original request
        originRequest = request;
      }
      
      // Call the fetch function
      response = await responseOrFetch(originRequest);
      
      // If response is already partial content, return it (origin handled the range)
      if (response.status === 206) {
        logDebug('Origin already handled range request', {
          url: request.url,
          contentRange: response.headers.get('Content-Range'),
          isFromCdnCgi: response.url && response.url.includes('/cdn-cgi/')
        });
        
        return response;
      }
    }
    
    // Only proceed with successful responses
    if (!response.ok) {
      logDebug('Origin returned non-successful response', {
        url: request.url,
        status: response.status
      });
      return response;
    }
    
    // Enhance the response with headers needed for range support
    const enhancedHeaders = new Headers(response.headers);
    
    // Ensure Accept-Ranges is set
    enhancedHeaders.set('Accept-Ranges', 'bytes');
    
    // Ensure Content-Length is set (required for range requests)
    let bodySize: number | undefined;
    if (!enhancedHeaders.has('Content-Length')) {
      try {
        const clone = response.clone();
        const body = await clone.arrayBuffer();
        bodySize = body.byteLength;
        enhancedHeaders.set('Content-Length', bodySize.toString());
        
        logDebug('Added Content-Length header', {
          contentLength: bodySize
        });
      } catch (error) {
        logWarn('Error setting Content-Length header', {
          error: error instanceof Error ? error.message : String(error)
        });
      }
    } else {
      bodySize = parseInt(enhancedHeaders.get('Content-Length') || '0', 10);
    }
    
    // Ensure we have at least one validation header (ETag or Last-Modified)
    if (!enhancedHeaders.has('ETag') && !enhancedHeaders.has('Last-Modified')) {
      const etag = `"${Date.now().toString(36)}"`;
      enhancedHeaders.set('ETag', etag);
      
      logDebug('Added ETag header', {
        etag
      });
    }
    
    // Create enhanced response
    const enhancedResponse = new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: enhancedHeaders
    });
    
    // For range requests, handle them manually
    if (hasRangeHeader) {
      logDebug('Handling range request manually', {
        rangeHeader,
        totalSize: bodySize,
        responseUrl: response.url,
        isCdnCgiResponse: response.url && response.url.includes('/cdn-cgi/')
      });
      
      // Handle the range request using our helper function
      return handleRangeRequest(enhancedResponse, rangeHeader);
    }
    
    // Return the enhanced response
    return enhancedResponse;
  },
  {
    functionName: 'cacheResponse',
    component: 'CacheResponseUtils',
    logErrors: true
  }
);

/**
 * Helper function to handle range requests manually
 * Used as a fallback when Cloudflare's automatic range handling fails
 */
async function handleRangeRequest(
  response: Response,
  rangeHeader: string | null
): Promise<Response> {
  if (!rangeHeader) {
    logDebug('No range header, returning full response', {
      status: response.status,
      contentType: response.headers.get('Content-Type')
    });
    return response;
  }
  
  try {
    // Log what headers we're starting with
    const startTimeMs = Date.now();
    logDebug('Starting manual range handling', {
      rangeHeader,
      responseStatus: response.status,
      responseContentType: response.headers.get('Content-Type'),
      responseContentLength: response.headers.get('Content-Length'),
      responseAcceptRanges: response.headers.get('Accept-Ranges'),
      startTimeMs
    });
    
    // Get the full response body
    const clone = response.clone();
    const body = await clone.arrayBuffer();
    const totalSize = body.byteLength;
    
    // Log that we loaded the body and get metrics
    const bodyLoadTimeMs = Date.now() - startTimeMs;
    logDebug('Loaded full response body', {
      totalSize,
      bodyLoadTimeMs
    });
    
    // Parse the range header
    const range = parseRangeHeader(rangeHeader, totalSize);
    
    if (range) {
      // Create a partial response with the requested range
      const slicedBody = body.slice(range.start, range.end + 1);
      const rangeHeaders = new Headers(response.headers);
      
      // Set range-specific headers
      rangeHeaders.set('Content-Range', `bytes ${range.start}-${range.end}/${totalSize}`);
      rangeHeaders.set('Content-Length', slicedBody.byteLength.toString());
      
      // Add a custom header to mark this as a manually handled range response
      rangeHeaders.set('X-Range-Handled-By', 'Manual-Range-Handler');
      
      // Get all the headers we're setting
      const allSetHeaders = Object.fromEntries([...rangeHeaders.entries()].map(
        ([key, value]) => [key, value]
      ));
      
      // Calculate processing times
      const processTimeMs = Date.now() - startTimeMs;
      
      logDebug('Created manual partial response', {
        start: range.start,
        end: range.end,
        total: totalSize,
        size: slicedBody.byteLength,
        contentRangeHeader: `bytes ${range.start}-${range.end}/${totalSize}`,
        processTimeMs,
        allHeaders: allSetHeaders,
        headerCount: Object.keys(allSetHeaders).length,
        timestamp: new Date().toISOString()
      });
      
      // Add to diagnostics if we have a request context
      const requestContext = getCurrentContext();
      if (requestContext) {
        if (!requestContext.diagnostics) {
          requestContext.diagnostics = {};
        }
        
        // Add range request details to diagnostics
        requestContext.diagnostics.rangeRequest = {
          header: rangeHeader,
          start: range.start,
          end: range.end,
          total: totalSize,
          source: 'manual-range-handling',
          status: 206,
          processTimeMs
        };
      }
      
      return new Response(slicedBody, {
        status: 206,
        statusText: 'Partial Content',
        headers: rangeHeaders
      });
    } else {
      // Unsatisfiable range
      logDebug('Unsatisfiable range', {
        rangeHeader,
        totalSize,
        status: 416,
        processTimeMs: Date.now() - startTimeMs
      });
      
      // Add to diagnostics if we have a request context
      const requestContext = getCurrentContext();
      if (requestContext) {
        if (!requestContext.diagnostics) {
          requestContext.diagnostics = {};
        }
        
        // Add range request details to diagnostics
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
  } catch (error) {
    // Create detailed error report
    const errorDetails = {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      name: error instanceof Error ? error.name : 'Unknown',
      rangeHeader,
      responseStatus: response.status,
      responseType: response.headers.get('Content-Type'),
      processTimeMs: 0,
      timestamp: new Date().toISOString()
    };
    
    logWarn('Error creating manual range response', errorDetails);
    
    // Add to diagnostics if we have a request context
    const requestContext = getCurrentContext();
    if (requestContext) {
      if (!requestContext.diagnostics) {
        requestContext.diagnostics = {};
      }
      
      // Add range request error to diagnostics
      requestContext.diagnostics.rangeRequestError = {
        message: errorDetails.message,
        source: 'manual-range-handling',
        fallback: 'full-response'
      };
    }
    
    // If range handling fails, return the original response
    return response;
  }
}
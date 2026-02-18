/**
 * Range request handler
 *
 * Transforms a full 200 OK response into a 206 Partial Content response
 * when the original request included a Range header. Falls back to the
 * full response gracefully on any error.
 */

import { createCategoryLogger } from '../logger';

const logger = createCategoryLogger('RangeRequestHandler');

/**
 * Process a full response into a 206 Partial Content response for a range request.
 *
 * @param request            - The original client request (must have a Range header)
 * @param responseForClient  - A clone of the full origin response for client delivery
 * @param fullOriginResponse - The original full origin response (used for fallback cloning)
 * @param requestId          - Tracking ID for logging
 * @returns A 206 response if range processing succeeds, otherwise the full response
 */
export async function processRangeResponse(
  request: Request,
  responseForClient: Response,
  fullOriginResponse: Response,
  requestId: string
): Promise<Response> {
  try {
    const { parseRangeHeader } = await import('../httpUtils');

    const contentLength = parseInt(responseForClient.headers.get('Content-Length') || '0', 10);
    const rangeHeader = request.headers.get('Range') || '';

    logger.debug('Processing range request with full response', {
      url: request.url,
      requestId,
      rangeHeader,
      contentLength,
      responseStatus: responseForClient.status,
      contentType: responseForClient.headers.get('Content-Type'),
    });

    if (contentLength > 0) {
      const parsedRange = parseRangeHeader(rangeHeader, contentLength);

      if (parsedRange) {
        try {
          logger.debug('Using streaming for range processing', {
            requestId,
            parsedRange,
            contentLength,
          });

          const { processRangeRequest } = await import('../streamUtils');

          responseForClient = await processRangeRequest(
            responseForClient,
            parsedRange.start,
            parsedRange.end,
            contentLength,
            {
              preserveHeaders: true,
              handlerTag: 'cacheOrchestrator-origin-miss',
              bypassCacheAPI: false,
              fallbackApplied: false,
            }
          );

          logger.debug('Successfully created 206 Partial Content response using streaming', {
            requestId,
            originalRangeHeader: rangeHeader,
            processedRange: `${parsedRange.start}-${parsedRange.end}/${contentLength}`,
          });
        } catch (bufferErr) {
          logger.debug('Error processing buffer for range request, falling back to full response', {
            requestId,
            error: bufferErr instanceof Error ? bufferErr.message : String(bufferErr),
            stack: bufferErr instanceof Error ? bufferErr.stack : undefined,
          });

          try {
            responseForClient = fullOriginResponse.clone();
            const headers = new Headers(responseForClient.headers);
            headers.set('X-Range-Fallback', 'buffer-processing-error');
            responseForClient = new Response(responseForClient.body, {
              status: responseForClient.status,
              statusText: responseForClient.statusText,
              headers,
            });
          } catch (cloneErr) {
            logger.debug(
              'Error cloning response after buffer error, using original full response',
              {
                requestId,
                error: cloneErr instanceof Error ? cloneErr.message : String(cloneErr),
              }
            );
            responseForClient = fullOriginResponse;
          }
        }
      } else {
        // No valid parsed range
        logger.debug('Unable to parse range header, returning full response instead', {
          requestId,
          rangeHeader,
          contentLength,
          fullResponseStatus: responseForClient.status,
        });

        try {
          const headers = new Headers(responseForClient.headers);
          headers.set('X-Range-Fallback', 'invalid-range-header');
          responseForClient = new Response(responseForClient.body, {
            status: responseForClient.status,
            statusText: responseForClient.statusText,
            headers,
          });
        } catch (headerErr) {
          logger.debug('Error adding diagnostic headers, using original response', {
            requestId,
            error: headerErr instanceof Error ? headerErr.message : String(headerErr),
          });
        }
      }
    } else {
      // Content length missing or zero
      logger.debug('Missing or zero content length for range request, keeping full response', {
        requestId,
        contentLengthHeader: responseForClient.headers.get('Content-Length'),
        parsedContentLength: contentLength,
        fullResponseStatus: responseForClient.status,
      });

      try {
        const headers = new Headers(responseForClient.headers);
        headers.set('X-Range-Fallback', 'missing-content-length');
        responseForClient = new Response(responseForClient.body, {
          status: responseForClient.status,
          statusText: responseForClient.statusText,
          headers,
        });
      } catch (headerErr) {
        logger.debug('Error adding diagnostic headers for missing content length', {
          requestId,
          error: headerErr instanceof Error ? headerErr.message : String(headerErr),
        });
      }
    }

    logger.debug('Range request processing complete', {
      url: request.url,
      requestId,
      originalRangeHeader: rangeHeader,
      finalStatus: responseForClient.status,
      finalContentLength: responseForClient.headers.get('Content-Length'),
      finalContentRange: responseForClient.headers.get('Content-Range'),
      hasFallbackHeader: !!responseForClient.headers.get('X-Range-Fallback'),
    });
  } catch (rangeErr) {
    logger.debug('Error creating range response, falling back to full response', {
      requestId,
      error: rangeErr instanceof Error ? rangeErr.message : String(rangeErr),
      stack: rangeErr instanceof Error ? rangeErr.stack : undefined,
      rangeHeader: request.headers.get('Range'),
    });

    try {
      const fallbackResponse = fullOriginResponse.clone();
      const fallbackHeaders = new Headers(fallbackResponse.headers);
      fallbackHeaders.set('X-Range-Error', 'general-processing-failure');
      responseForClient = new Response(fallbackResponse.body, {
        status: fallbackResponse.status,
        statusText: fallbackResponse.statusText,
        headers: fallbackHeaders,
      });
    } catch (cloneErr) {
      logger.debug('Error creating diagnostic fallback response, using original', {
        requestId,
        error: cloneErr instanceof Error ? cloneErr.message : String(cloneErr),
      });
      responseForClient = fullOriginResponse;
    }
  }

  return responseForClient;
}

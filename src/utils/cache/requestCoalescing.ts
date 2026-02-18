/**
 * Request coalescing (single-flight) pattern for origin fetches
 *
 * Prevents multiple concurrent requests for the same resource from each
 * triggering separate origin fetches. When the first request for a given
 * cache key arrives, it initiates the fetch. Subsequent requests for the
 * same key join the existing in-flight promise.
 */

import { BoundedLRUMap } from '../BoundedLRUMap';
import { createCategoryLogger } from '../logger';
import { getCurrentContext, addBreadcrumb } from '../requestContext';

const logger = createCategoryLogger('RequestCoalescing');

/**
 * Interface for in-flight request tracking with metadata
 */
export interface InFlightRequest {
  promise: Promise<Response>;
  startTime: number;
  url: string;
  referenceCount: number;
  derivative?: string;
  requesterId?: string;
  debug?: boolean;
  isRangeRequest?: boolean;
}

/** Result of the coalescing step */
export interface CoalescingResult {
  /** The full origin response (awaited) */
  fullOriginResponse: Response;
  /** Whether this caller was the one that initiated the fetch */
  isFirstRequest: boolean;
  /** Tracking ID for this specific request */
  requestId: string;
}

// ── Module-level state ──────────────────────────────────────────────

/** Per-isolate map of in-flight origin fetches keyed by canonical cache key */
const inFlightOriginFetches = new BoundedLRUMap<string, InFlightRequest>({
  maxSize: 1000,
  ttlMs: 300000, // 5 minutes
  onEvict: (key, value) => {
    logger.warn(`Evicting in-flight request for key: ${key}`, {
      requesterId: value.requesterId,
      startTime: value.startTime,
      age: Date.now() - value.startTime,
    });
  },
});

/** Diagnostic log of which requests were coalesced together */
const coalescedRequestsLog = new BoundedLRUMap<string, string[]>({
  maxSize: 500,
  ttlMs: 600000, // 10 minutes
});

// ── Helpers ─────────────────────────────────────────────────────────

/** Generate a unique request tracking ID */
export function generateRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// ── Main entry point ────────────────────────────────────────────────

/**
 * Execute `handler` with request coalescing.
 *
 * If no in-flight request exists for `cacheKey`, a new one is created and the
 * handler is invoked. If one already exists, this caller joins it instead.
 *
 * @returns CoalescingResult with the response + metadata
 */
export async function executeWithCoalescing(
  cacheKey: string,
  request: Request,
  handler: () => Promise<Response>,
  options?: Record<string, unknown>
): Promise<CoalescingResult> {
  const requestId = generateRequestId();
  const isRangeRequest = request.headers.has('Range');
  const rangeHeaderValue = request.headers.get('Range');
  const url = new URL(request.url);
  const requestContext = getCurrentContext();

  // Check if there is already an in-flight request for this exact resource
  let inFlightRequest = inFlightOriginFetches.get(cacheKey);
  let isFirstRequest = false;

  logger.debug('Request coalescing check', {
    cacheKey,
    requestId,
    hasExistingRequest: !!inFlightRequest,
    url: request.url,
    timestamp: Date.now(),
    isRangeRequest,
    rangeHeaderValue: isRangeRequest ? rangeHeaderValue : undefined,
    activeInFlightCount: inFlightOriginFetches.size,
  });

  // If no in-flight request, create one
  if (!inFlightRequest) {
    isFirstRequest = true;

    // Check concurrency limit
    const MAX_CONCURRENT_ORIGINS = 100;
    if (inFlightOriginFetches.size >= MAX_CONCURRENT_ORIGINS) {
      logger.debug('Origin fetch concurrency limit reached', {
        cacheKey,
        requestId,
        currentInFlightCount: inFlightOriginFetches.size,
        limit: MAX_CONCURRENT_ORIGINS,
      });
      throw new Error(`Origin fetch concurrency limit reached (${MAX_CONCURRENT_ORIGINS})`);
    }

    logger.debug('No existing in-flight request, initiating new origin fetch', {
      cacheKey,
      requestId,
      url: request.url,
      derivative: options?.derivative,
      timestamp: Date.now(),
      isRangeRequest,
      rangeHeaderValue: isRangeRequest ? rangeHeaderValue : undefined,
      currentInFlightCount: inFlightOriginFetches.size,
    });

    if (requestContext) {
      addBreadcrumb(requestContext, 'Origin', 'Initiating new origin fetch', {
        cacheKey,
        requestId,
        url: request.url,
      });
    }

    // Track this request in the coalesced requests log
    coalescedRequestsLog.set(requestId, [requestId]);

    // Create the origin fetch promise
    const originFetchPromise = (async () => {
      let success = false;
      let errorMsg = '';
      let responseStatus = 0;
      const startTime = Date.now();

      try {
        logger.debug('First request: executing handler for origin fetch', {
          cacheKey,
          requestId,
          timestamp: startTime,
        });

        const response = await handler();
        success = true;
        responseStatus = response.status;
        return response;
      } catch (error) {
        errorMsg = error instanceof Error ? error.message : String(error);
        const errorStack = error instanceof Error ? error.stack : undefined;

        logger.debug('Error in origin fetch', {
          cacheKey,
          requestId,
          error: errorMsg,
          stack: errorStack,
          duration: Date.now() - startTime,
        });

        throw error;
      } finally {
        const duration = Date.now() - startTime;
        const coalescedRequestCount = coalescedRequestsLog.get(requestId)?.length || 1;

        logger.debug(`Origin fetch ${success ? 'completed' : 'failed'}`, {
          cacheKey,
          requestId,
          success,
          duration,
          responseStatus: success ? responseStatus : undefined,
          error: !success ? errorMsg : undefined,
          coalescedCount: coalescedRequestCount,
          requestsCoalesced: coalescedRequestCount > 1 ? true : false,
          isRangeRequest,
        });
      }
    })();

    inFlightRequest = {
      promise: originFetchPromise,
      startTime: Date.now(),
      url: request.url,
      referenceCount: 1,
      derivative: options?.derivative?.toString(),
      requesterId: requestId,
      debug: url.searchParams.has('debug'),
      isRangeRequest,
    };

    inFlightOriginFetches.set(cacheKey, inFlightRequest as InFlightRequest);
  } else if (inFlightRequest) {
    // Join the existing request
    inFlightRequest.referenceCount++;

    const initiatorId = inFlightRequest.requesterId || 'unknown';
    if (coalescedRequestsLog.has(initiatorId)) {
      coalescedRequestsLog.get(initiatorId)?.push(requestId);
    }

    logger.debug('Found existing in-flight request, joining to avoid duplicate origin fetch', {
      cacheKey,
      requestId,
      joiningRequestId: inFlightRequest.requesterId,
      url: request.url,
      inFlightAge: Date.now() - inFlightRequest.startTime,
      newReferenceCount: inFlightRequest.referenceCount,
      isRangeRequest,
      initiatorIsRange: inFlightRequest.isRangeRequest,
    });

    if (requestContext) {
      addBreadcrumb(requestContext, 'Origin', 'Joining existing in-flight request', {
        cacheKey,
        requestId,
        joiningRequestId: inFlightRequest.requesterId,
        url: request.url,
        coalesced: true,
      });
    }
  }

  // Wait for the origin fetch to complete
  let fullOriginResponse: Response;
  try {
    if (!inFlightRequest) {
      throw new Error('InFlightRequest unexpectedly became undefined');
    }

    fullOriginResponse = await inFlightRequest.promise;

    if (!isFirstRequest) {
      logger.debug('Successfully coalesced request with existing fetch', {
        cacheKey,
        requestId,
        joiningRequestId: inFlightRequest.requesterId,
        responseStatus: fullOriginResponse.status,
        contentType: fullOriginResponse.headers.get('content-type'),
        coalesceLatency: Date.now() - inFlightRequest.startTime,
        isRangeRequest,
      });
    }
  } catch (error) {
    logger.debug('Error in coalesced fetch request', {
      cacheKey,
      requestId,
      joiningRequestId: inFlightRequest?.requesterId,
      error: error instanceof Error ? error.message : String(error),
      isFirstRequest,
      isRangeRequest,
    });
    throw error;
  } finally {
    // Decrement reference count and clean up if last reference
    if (inFlightRequest) {
      inFlightRequest.referenceCount--;

      logger.debug('Decremented reference count for in-flight request', {
        cacheKey,
        requestId,
        newReferenceCount: inFlightRequest.referenceCount,
        isFirstRequest,
      });

      if (inFlightRequest.referenceCount === 0) {
        inFlightOriginFetches.delete(cacheKey);

        logger.debug('Removed in-flight request from tracking map (last reference released)', {
          cacheKey,
          requestId,
          duration: Date.now() - inFlightRequest.startTime,
          activeFetchesRemaining: inFlightOriginFetches.size,
        });

        if (inFlightRequest.requesterId) {
          coalescedRequestsLog.delete(inFlightRequest.requesterId);
        }
      }
    }
  }

  return { fullOriginResponse, isFirstRequest, requestId };
}

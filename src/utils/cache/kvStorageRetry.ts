/**
 * KV storage with retry logic
 *
 * Stores responses in KV cache with automatic retry for transient errors
 * (rate limits, conflicts). Supports both waitUntil (background) and
 * direct (blocking) execution modes.
 */

import { EnvVariables } from '../../config/environmentConfig';
import { storeInKVCache } from '../kvCacheUtils';
import { getCurrentContext, addBreadcrumb } from '../requestContext';
import { createCategoryLogger } from '../logger';

const logger = createCategoryLogger('KVStorageRetry');

/** Options controlling the KV storage operation */
export interface KVStorageOptions {
  /** The source pathname (URL path) */
  sourcePath: string;
  /** The response to store (must have an unconsumed body) */
  responseForKV: Response;
  /** A clone of the client response, used for retry cloning */
  responseForClient: Response;
  /** Cache / transformation options (derivative, version, IMQuery, etc.) */
  options: Record<string, unknown>;
  /** Canonical cache key (for logging) */
  cacheKey: string;
  /** Request tracking ID (for logging) */
  requestId: string;
  /** IMQuery custom data to include in the cache key */
  customData: Record<string, unknown>;
}

/**
 * Store a response in KV with retry logic.
 *
 * The caller decides whether to run this via `waitUntil` or directly;
 * this function is always async and returns when all attempts are done.
 *
 * @param env       - Worker environment bindings
 * @param opts      - Storage options
 * @param maxRetries - Maximum number of attempts (default 3)
 */
export async function storeResponseInKV(
  env: EnvVariables,
  opts: KVStorageOptions,
  maxRetries = 3
): Promise<void> {
  const { sourcePath, responseForKV, responseForClient, options, cacheKey, requestId, customData } =
    opts;

  // Build options that include IMQuery parameters
  const optionsWithIMQuery: typeof options = {
    ...options,
    customData: Object.keys(customData).length > 0 ? customData : undefined,
  };

  let attemptCount = 0;
  let success = false;
  let lastError: Error | null = null;
  const kvStartTime = Date.now();

  while (attemptCount < maxRetries && !success) {
    try {
      attemptCount++;

      const attemptOptions = {
        ...optionsWithIMQuery,
        diagnosticsInfo: {
          ...((optionsWithIMQuery.diagnosticsInfo as Record<string, unknown>) || {}),
          requestId,
          attemptNumber: attemptCount,
          timestamp: Date.now(),
        },
      };

      if (attemptCount > 1) {
        logger.debug(`Retry attempt ${attemptCount} for KV storage`, {
          cacheKey,
          requestId,
          previousError: lastError?.message,
          timeSinceFirstAttempt: Date.now() - kvStartTime,
        });
      }

      // Use the original response on the first attempt; clone for retries
      let responseToStore: Response;
      if (attemptCount === 1) {
        responseToStore = responseForKV;
      } else {
        try {
          responseToStore = responseForClient.clone();
        } catch (cloneErr) {
          logger.debug('Error cloning response for retry storage', {
            cacheKey,
            requestId,
            error: cloneErr instanceof Error ? cloneErr.message : String(cloneErr),
            attemptCount,
          });
          break; // Can't retry without a valid response
        }
      }

      success = await storeInKVCache(env, sourcePath, responseToStore, attemptOptions);

      if (success) {
        const hasIMQuery = Object.keys(customData).length > 0;
        logger.debug(
          `Successfully stored video in KV cache${attemptCount > 1 ? ' after retries' : ''}`,
          {
            sourcePath,
            requestId,
            hasIMQuery,
            attemptCount,
            duration: Date.now() - kvStartTime,
            cacheKey,
          }
        );

        const reqContext = getCurrentContext();
        if (reqContext) {
          addBreadcrumb(reqContext, 'Cache', 'Stored full video in KV cache', {
            sourcePath,
            hasIMQuery,
            requestId,
            attemptCount,
          });
        }
      } else {
        logger.debug('KV storage operation reported failure', {
          requestId,
          cacheKey,
          attemptCount,
        });
        break;
      }
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      const isRateLimitError =
        lastError.message.includes('429') ||
        lastError.message.includes('409') ||
        lastError.message.includes('rate limit') ||
        lastError.message.includes('conflict');

      logger.debug('Error during KV storage attempt', {
        cacheKey,
        requestId,
        error: lastError.message,
        stack: lastError.stack,
        attemptCount,
        isRateLimitError,
        willRetry: isRateLimitError && attemptCount < maxRetries,
      });

      if (!isRateLimitError || attemptCount >= maxRetries) {
        break;
      }

      // Exponential backoff: 100ms, 200ms, 400ms, ... capped at 1s
      const backoffMs = Math.min(100 * Math.pow(2, attemptCount - 1), 1000);
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }
  }

  if (!success) {
    logger.debug('All KV storage attempts failed', {
      cacheKey,
      requestId,
      attempts: attemptCount,
      finalError: lastError?.message,
      duration: Date.now() - kvStartTime,
    });
  }
}

/**
 * Initiate KV storage, choosing between waitUntil (background) and
 * direct (fire-and-forget) execution based on execution context availability.
 */
export function initiateKVStorage(env: EnvVariables, opts: KVStorageOptions): void {
  const { cacheKey, requestId } = opts;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ctx = (env as any).executionCtx || (env as any).ctx;

  if (ctx && typeof ctx.waitUntil === 'function') {
    ctx.waitUntil(storeResponseInKV(env, opts, 3));
  } else {
    // Fire-and-forget with fewer retries
    storeResponseInKV(env, opts, 2).catch((err) => {
      logger.debug('Unexpected error in direct KV storage flow', {
        cacheKey,
        requestId,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }
}

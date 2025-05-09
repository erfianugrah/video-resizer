import { EnvVariables } from '../../config/environmentConfig';
import { TransformationMetadata } from './interfaces';
import { logDebug } from './logging';
import { storeCacheKeyVersion, getNextCacheKeyVersion } from '../cacheVersionService';
import { CacheConfigurationManager } from '../../config';
import { checkAndRefreshTtl } from '../../utils/kvTtlRefreshUtils';
import { getCurrentContext } from '../../utils/legacyLoggerAdapter';

/**
 * Helper function to handle version increment with retries
 */
export async function handleVersionIncrement(
  env: EnvVariables,
  key: string,
  version: number,
  ttl?: number
): Promise<void> {
  // Use waitUntil if available for non-blocking operation with retry
  if ('executionCtx' in env && (env as any).executionCtx?.waitUntil) {
    (env as any).executionCtx.waitUntil(
      (async () => {
        const maxRetries = 3;
        let attemptCount = 0;
        let success = false;
        let lastError: Error | null = null;
        
        while (attemptCount < maxRetries && !success) {
          try {
            attemptCount++;
            await storeCacheKeyVersion(env, key, version, ttl);
            success = true;
            
            // Only log if we needed retries
            if (attemptCount > 1) {
              logDebug('[GET_VIDEO] Successfully incremented version after retries', {
                key,
                version,
                attempts: attemptCount
              });
            }
          } catch (err) {
            lastError = err instanceof Error ? err : new Error(String(err));
            const isRateLimitError = 
              lastError.message.includes('429') || 
              lastError.message.includes('409') || 
              lastError.message.includes('rate limit') ||
              lastError.message.includes('conflict');
            
            if (!isRateLimitError || attemptCount >= maxRetries) {
              logDebug('[GET_VIDEO] Error incrementing version', {
                key,
                error: lastError.message,
                attempts: attemptCount
              });
              return;
            }
            
            // Exponential backoff
            const backoffMs = Math.min(200 * Math.pow(2, attemptCount - 1), 2000);
            await new Promise(resolve => setTimeout(resolve, backoffMs));
          }
        }
      })()
    );
  } else {
    // Direct incrementation with retry
    const maxRetries = 3;
    let attemptCount = 0;
    let success = false;
    let lastError: Error | null = null;
    
    while (attemptCount < maxRetries && !success) {
      try {
        attemptCount++;
        await storeCacheKeyVersion(env, key, version, ttl);
        success = true;
        
        // Only log if we needed retries
        if (attemptCount > 1) {
          logDebug('[GET_VIDEO] Successfully incremented version after retries (direct)', {
            key,
            version,
            attempts: attemptCount
          });
        }
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        const isRateLimitError = 
          lastError.message.includes('429') || 
          lastError.message.includes('409') || 
          lastError.message.includes('rate limit') ||
          lastError.message.includes('conflict');
        
        if (!isRateLimitError || attemptCount >= maxRetries) {
          logDebug('[GET_VIDEO] Error incrementing version (direct)', {
            key,
            error: lastError.message,
            attempts: attemptCount
          });
          break;
        }
        
        // Exponential backoff
        const backoffMs = Math.min(200 * Math.pow(2, attemptCount - 1), 2000);
        await new Promise(resolve => setTimeout(resolve, backoffMs));
      }
    }
  }
}

/**
 * Helper function to refresh cache TTL on access
 */
export function refreshCacheTtl(
  namespace: KVNamespace,
  key: string,
  metadata: TransformationMetadata,
  env?: EnvVariables
): void {
  const requestContext = getCurrentContext();
  if (!requestContext?.executionContext) return;
  
  // Use the optimized TTL refresh mechanism which avoids re-storing the entire value
  checkAndRefreshTtl(
    namespace,
    key,
    metadata,
    env,
    requestContext.executionContext
  ).catch(err => {
    // Log any errors but don't fail the response
    logDebug('[GET_VIDEO] Error during TTL refresh', {
      key,
      error: err instanceof Error ? err.message : String(err)
    });
  });
}
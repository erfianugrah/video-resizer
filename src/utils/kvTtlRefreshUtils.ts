/**
 * KV TTL Refresh Utilities
 * 
 * This module provides utilities for efficiently refreshing TTL on KV cache items
 * without re-storing the entire video content.
 */

import { addBreadcrumb } from './requestContext';
import { getCurrentContext } from './legacyLoggerAdapter';
import { CacheConfigurationManager } from '../config/CacheConfigurationManager';
import { EnvVariables } from '../config/environmentConfig';
import { createCategoryLogger } from './logger';

// Create a category-specific logger for KVTtlRefreshUtils
const logger = createCategoryLogger('KVTtlRefreshUtils');
const { debug: logDebug } = logger;

/**
 * Parameters for TTL refresh operation
 */
export interface TtlRefreshParams {
  namespace: KVNamespace;
  key: string;
  metadata: Record<string, any>;
  originalTtl: number;
  elapsedTime: number;
  remainingTime: number;
  env?: EnvVariables;
  executionCtx?: ExecutionContext;
  _fromWaitUntil?: boolean; // Flag for testing
}

/**
 * Refreshes TTL for a KV key by updating only the metadata's expiresAt field
 * This avoids having to re-store the entire item's value, making it more efficient
 * especially for large video files.
 * 
 * Requirements for refresh (configured in worker-config.json):
 * 1. More than minElapsedPercent of the original TTL has elapsed (default 10%)
 * 2. More than minRemainingSeconds remaining on the current TTL (default 60s)
 * 
 * @param params - Parameters for the TTL refresh operation
 * @returns Promise<boolean> - True if TTL refresh was successful, false otherwise
 */
export async function refreshKeyTtl({
  namespace,
  key,
  metadata,
  originalTtl,
  elapsedTime,
  remainingTime,
  env,
  executionCtx
}: TtlRefreshParams): Promise<boolean> {
  // Get TTL refresh configuration
  const cacheConfig = CacheConfigurationManager.getInstance().getConfig();
  const minElapsedPercent = cacheConfig.ttlRefresh?.minElapsedPercent ?? 10;
  const minRemainingSeconds = cacheConfig.ttlRefresh?.minRemainingSeconds ?? 60;
  
  // Calculate elapsed percentage threshold
  const minElapsedTime = originalTtl * (minElapsedPercent / 100);
  
  // Skip refresh if criteria not met
  if (elapsedTime < minElapsedTime || remainingTime < minRemainingSeconds) {
    logDebug('Skipping TTL refresh - criteria not met', {
      key,
      elapsedTime: `${elapsedTime}s (${Math.round(elapsedTime / originalTtl * 100)}%)`,
      remainingTime: `${remainingTime}s`,
      minElapsedThreshold: `${Math.round(minElapsedTime)}s (${minElapsedPercent}%)`,
      minRemainingThreshold: `${minRemainingSeconds}s`
    });
    return false;
  }

  // Log the TTL refresh operation
  logDebug('Refreshing KV cache TTL', {
    key,
    originalTtl: `${originalTtl}s`,
    elapsedTime: `${elapsedTime}s`,
    remainingTime: `${remainingTime}s`
  });

  // Check if indefinite storage is enabled
  const useIndefiniteStorage = cacheConfig.storeIndefinitely === true;
  
  // Skip refresh for indefinite storage items when the refreshIndefiniteStorage flag is disabled
  if (useIndefiniteStorage && cacheConfig.refreshIndefiniteStorage !== true) {
    logDebug('Skipping TTL refresh for indefinitely stored item', { key });
    return true; // Return success without doing any KV operations
  }
  
  // Update metadata with new expiresAt
  const updatedMetadata = { ...metadata };
  
  // Even with indefinite storage, we still want to set the expiresAt for browser cache countdown
  // This ensures Cache-Control headers have a proper max-age that counts down
  updatedMetadata.expiresAt = Date.now() + (originalTtl * 1000);
  
  // Mark that we're using indefinite storage for diagnostics
  updatedMetadata.storeIndefinitely = useIndefiniteStorage;
  
  logDebug('Updated expiresAt for cache TTL countdown', { 
    key, 
    expiresAt: new Date(updatedMetadata.expiresAt).toISOString(),
    useIndefiniteStorage
  });

  // Get request context for breadcrumb
  const requestContext = getCurrentContext();
  if (requestContext) {
    if (useIndefiniteStorage) {
      addBreadcrumb(requestContext, 'KV', 'Refreshing cache metadata (indefinite storage)', {
        key,
        indefiniteStorage: true
      });
    } else {
      addBreadcrumb(requestContext, 'KV', 'Refreshing cache TTL', {
        key,
        originalTtl,
        newExpiresAt: updatedMetadata.expiresAt ? new Date(updatedMetadata.expiresAt).toISOString() : 'undefined'
      });
    }
  }

  // Retry logic with exponential backoff
  const maxRetries = 3;
  let attemptCount = 0;
  let success = false;
  let lastError: Error | null = null;

  while (attemptCount < maxRetries && !success) {
    try {
      attemptCount++;
      
      // Check if indefinite storage is enabled from the already retrieved config
      const useIndefiniteStorage = cacheConfig.storeIndefinitely === true;
      
      // Store with metadata only - more efficient for value-less operations
      // Use empty string as KV doesn't accept null values, but we're only updating metadata
      if (useIndefiniteStorage) {
        // When using indefinite storage, don't set expirationTtl to keep item indefinitely
        await namespace.put(key, '', { metadata: updatedMetadata });
        logDebug('Refreshed KV TTL for indefinitely stored item', { key });
      } else {
        // Normal case with TTL
        await namespace.put(key, '', { 
          metadata: updatedMetadata, 
          expirationTtl: originalTtl 
        });
      }
      
      success = true;
      
      // Log success with retry info if needed
      if (useIndefiniteStorage) {
        if (attemptCount > 1) {
          logDebug('Successfully refreshed KV metadata for indefinite storage after retries', { 
            key, 
            attempts: attemptCount,
            indefiniteStorage: true
          });
        } else {
          logDebug('Successfully refreshed KV metadata for indefinite storage', { 
            key, 
            indefiniteStorage: true
          });
        }
      } else {
        if (attemptCount > 1) {
          logDebug('Successfully refreshed KV TTL after retries', { 
            key, 
            attempts: attemptCount,
            newExpiresAt: updatedMetadata.expiresAt ? new Date(updatedMetadata.expiresAt).toISOString() : 'undefined' 
          });
        } else {
          logDebug('Successfully refreshed KV TTL', { 
            key, 
            newExpiresAt: updatedMetadata.expiresAt ? new Date(updatedMetadata.expiresAt).toISOString() : 'undefined' 
          });
        }
      }
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      const isRateLimitError = 
        lastError.message.includes('429') || 
        lastError.message.includes('409') || 
        lastError.message.includes('rate limit') ||
        lastError.message.includes('conflict');
      
      if (!isRateLimitError || attemptCount >= maxRetries) {
        logDebug('Error refreshing KV TTL', {
          key,
          error: lastError.message,
          attempts: attemptCount
        });
        return false;
      }
      
      // Log the retry attempt
      logDebug('KV rate limit hit during TTL refresh, retrying with backoff', {
        key,
        attempt: attemptCount,
        maxRetries,
        error: lastError.message
      });
      
      // Exponential backoff: 200ms, 400ms, 800ms, etc.
      const backoffMs = Math.min(200 * Math.pow(2, attemptCount - 1), 2000);
      await new Promise(resolve => setTimeout(resolve, backoffMs));
    }
  }

  return success;
}

/**
 * Check if a KV item needs TTL refresh and perform the refresh if necessary
 * 
 * @param namespace - KV namespace to use
 * @param key - Cache key to refresh
 * @param metadata - Metadata from the KV item
 * @param env - Environment variables (optional)
 * @param executionCtx - Execution context (optional)
 * @returns Promise<boolean> - True if TTL refresh was performed, false otherwise
 */
export async function checkAndRefreshTtl(
  namespace: KVNamespace,
  key: string,
  metadata: Record<string, any>,
  env?: EnvVariables,
  executionCtx?: ExecutionContext
): Promise<boolean> {
  // Skip if no metadata or critical fields missing
  if (!metadata || !metadata.createdAt) {
    return false;
  }

  // Calculate TTL values
  const now = Date.now();
  const originalTtl = metadata.expiresAt ? 
    Math.floor((metadata.expiresAt - metadata.createdAt) / 1000) : 
    CacheConfigurationManager.getInstance().getConfig().defaultMaxAge;
  
  const elapsedTime = Math.floor((now - metadata.createdAt) / 1000);
  const remainingTime = metadata.expiresAt ? Math.floor((metadata.expiresAt - now) / 1000) : 0;

  // Use waitUntil if available to perform refresh in background
  if (executionCtx?.waitUntil) {
    // Start background refresh
    executionCtx.waitUntil(
      refreshKeyTtl({
        namespace,
        key,
        metadata,
        originalTtl,
        elapsedTime,
        remainingTime,
        env,
        executionCtx,
        _fromWaitUntil: true, // Flag for testing
      })
    );
    // Return true to indicate refresh was initiated
    return true;
  } else {
    // Perform refresh synchronously if waitUntil not available
    return refreshKeyTtl({
      namespace,
      key,
      metadata,
      originalTtl,
      elapsedTime,
      remainingTime,
      env,
      executionCtx
    });
  }
}
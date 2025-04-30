/**
 * PresignedUrlCacheService
 * 
 * Service for caching AWS S3 presigned URLs to improve performance
 * and reduce the number of AWS SDK calls for repeated requests.
 */

import { getCurrentContext } from '../utils/legacyLoggerAdapter';
import { createLogger, debug as pinoDebug, error as pinoError } from '../utils/pinoLogger';
import { addBreadcrumb } from '../utils/requestContext';
import { EnvVariables } from '../config/environmentConfig';
import { 
  logErrorWithContext, 
  withErrorHandling, 
  tryOrNull, 
  tryOrDefault 
} from '../utils/errorHandlingUtils';
import { 
  getCacheKeyVersion, 
  getNextCacheKeyVersion, 
  storeCacheKeyVersion 
} from './cacheVersionService';

/**
 * Helper functions for consistent logging throughout this file
 */
function logDebug(message: string, data?: Record<string, unknown>): void {
  const requestContext = getCurrentContext();
  if (requestContext) {
    const logger = createLogger(requestContext);
    pinoDebug(requestContext, logger, 'PresignedUrlCacheService', message, data);
  } else {
    console.debug(`PresignedUrlCacheService: ${message}`, data || {});
  }
}

/**
 * Interface for presigned URL cache entry
 */
export interface PresignedUrlCacheEntry {
  url: string;                        // The presigned URL
  originalUrl: string;                // The original URL without signing
  createdAt: number;                  // When the URL was generated
  expiresAt: number;                  // When the URL will expire
  path: string;                       // The asset path
  storageType: string;                // Origin type or pattern name
  authType: string;                   // Auth type (aws-s3-presigned-url)
  region?: string;                    // AWS region
  service?: string;                   // AWS service (typically s3)
  version?: number;                   // Cache version for invalidation
}

/**
 * Generate a key for the presigned URL cache
 * 
 * @param path The path to the asset
 * @param options The configuration options
 * @returns A cache key string
 */
function generatePresignedUrlKeyImpl(
  path: string,
  options: {
    storageType: string; // Can be 'remote', 'fallback', or a pattern name
    authType: string;
    region?: string;
    service?: string;
  }
): string {
  // Remove leading slashes for consistency
  const normalizedPath = path.replace(/^\/+/, '');
  
  // Create a base key with path and storage type
  let key = `presigned:${options.storageType}:${normalizedPath}`;
  
  // Add auth type, region, and service for specificity
  key += `:auth=${options.authType}`;
  if (options.region) key += `:region=${options.region}`;
  if (options.service) key += `:service=${options.service}`;
  
  // Sanitize the key for KV storage
  return key.replace(/[^\w:/=.*-]/g, '-');
}

/**
 * Generate a key for the presigned URL cache with error handling
 */
export const generatePresignedUrlKey = tryOrDefault<
  [string, {
    storageType: string; // Now more flexible
    authType: string;
    region?: string;
    service?: string;
  }],
  string
>(
  generatePresignedUrlKeyImpl,
  {
    functionName: 'generatePresignedUrlKey',
    component: 'PresignedUrlCacheService',
    logErrors: true
  },
  'presigned:error:fallback-key' // Default fallback key if generation fails
);

/**
 * Store a presigned URL in cache
 * 
 * @param namespace KV namespace for storage
 * @param path Path to the asset
 * @param presignedUrl The presigned URL to cache
 * @param originalUrl The original URL before signing
 * @param options Configuration options
 * @returns Success status
 */
async function storePresignedUrlImpl(
  namespace: KVNamespace,
  path: string,
  presignedUrl: string,
  originalUrl: string,
  options: {
    storageType: string; // Can be 'remote', 'fallback', or a pattern name
    expiresInSeconds: number;
    authType: string;
    region?: string;
    service?: string;
    env?: EnvVariables;
  }
): Promise<boolean> {
  // Generate a key for this presigned URL
  const key = generatePresignedUrlKey(path, options);
  
  const now = Date.now();
  const expiresAt = now + (options.expiresInSeconds * 1000);
  
  // Get version from cache version service if available
  let version = 1;
  if (options.env?.VIDEO_CACHE_KEY_VERSIONS) {
    try {
      version = await getNextCacheKeyVersion(options.env, key, false);
    } catch (err) {
      logDebug('Error getting next cache version', {
        key,
        error: err instanceof Error ? err.message : String(err)
      });
    }
  }
  
  // Create entry for the cached URL
  const entry: PresignedUrlCacheEntry = {
    url: presignedUrl,
    originalUrl,
    createdAt: now,
    expiresAt,
    path,
    storageType: options.storageType,
    authType: options.authType,
    region: options.region,
    service: options.service,
    version
  };
  
  // Use a slightly shorter TTL than the actual expiration to prevent serving expired URLs
  // Buffer factor of 0.9 means we expire 10% earlier than the actual URL expiration
  const bufferFactor = 0.9;
  const ttl = Math.floor(options.expiresInSeconds * bufferFactor);
  
  // Store with retry logic for rate limits
  const maxRetries = 3;
  let attemptCount = 0;
  let success = false;
  let lastError: Error | null = null;
  
  while (attemptCount < maxRetries && !success) {
    try {
      attemptCount++;
      await namespace.put(key, JSON.stringify(entry), { expirationTtl: ttl });
      success = true;
      
      // Log retries if needed
      if (attemptCount > 1) {
        logDebug('KV put succeeded after retries', {
          key,
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
        throw lastError;
      }
      
      // Log the retry attempt
      logDebug('KV rate limit hit, retrying with backoff', {
        key,
        attempt: attemptCount,
        maxRetries,
        error: lastError.message
      });
      
      // Add breadcrumb for retry operation
      const requestContext = getCurrentContext();
      if (requestContext) {
        addBreadcrumb(requestContext, 'KV', 'Retrying KV operation after rate limit', {
          key,
          attempt: attemptCount,
          maxRetries,
          error: lastError.message
        });
      }
      
      // Exponential backoff: 200ms, 400ms, 800ms, etc.
      const backoffMs = Math.min(200 * Math.pow(2, attemptCount - 1), 2000);
      await new Promise(resolve => setTimeout(resolve, backoffMs));
    }
  }
  
  // Store version if needed
  if (options.env?.VIDEO_CACHE_KEY_VERSIONS) {
    try {
      const versionTtl = ttl * 2; // Longer TTL for version
      await storeCacheKeyVersion(options.env, key, version, versionTtl);
    } catch (err) {
      // Log error but continue - version storage not critical
      logDebug('Error storing version', {
        key,
        version,
        error: err instanceof Error ? err.message : String(err)
      });
    }
  }
  
  // Log success
  logDebug('Stored presigned URL in cache', {
    key,
    path,
    expiresIn: options.expiresInSeconds,
    ttl,
    version
  });
  
  // Add breadcrumb for successful KV storage
  const requestContext = getCurrentContext();
  if (requestContext) {
    addBreadcrumb(requestContext, 'KV', 'Stored presigned URL in KV cache', {
      key,
      path,
      expiresIn: options.expiresInSeconds,
      ttl,
      version
    });
  }
  
  return true;
}

/**
 * Store a presigned URL in cache with error handling
 */
export const storePresignedUrl = withErrorHandling<
  [
    KVNamespace,
    string,
    string,
    string,
    {
      storageType: string; // Can be 'remote', 'fallback', or a pattern name
      expiresInSeconds: number;
      authType: string;
      region?: string;
      service?: string;
      env?: EnvVariables;
    }
  ],
  Promise<boolean>
>(
  storePresignedUrlImpl,
  {
    functionName: 'storePresignedUrl',
    component: 'PresignedUrlCacheService',
    logErrors: true
  },
  { operationType: 'write' }
);

/**
 * Retrieve a presigned URL from cache
 * 
 * @param namespace KV namespace for storage
 * @param path Path to the asset
 * @param options Configuration options
 * @returns Cached entry or null if not found
 */
async function getPresignedUrlImpl(
  namespace: KVNamespace,
  path: string,
  options: {
    storageType: string; // Can be 'remote', 'fallback', or a pattern name
    authType: string;
    region?: string;
    service?: string;
    env?: EnvVariables;
  }
): Promise<PresignedUrlCacheEntry | null> {
  // Generate a key for this presigned URL
  const key = generatePresignedUrlKey(path, options);
  
  // Get the cached entry
  const cachedData = await namespace.get(key);
  if (!cachedData) {
    logDebug('Presigned URL not found in cache', { key, path });
    return null;
  }
  
  try {
    const entry = JSON.parse(cachedData) as PresignedUrlCacheEntry;
    const now = Date.now();
    
    // Check if already expired
    if (entry.expiresAt <= now) {
      logDebug('Cached presigned URL is expired', {
        key,
        expiresAt: new Date(entry.expiresAt).toISOString(),
        now: new Date(now).toISOString()
      });
      return null;
    }
    
    // Get version from env if available
    if (options.env?.VIDEO_CACHE_KEY_VERSIONS && !entry.version) {
      try {
        const version = await getCacheKeyVersion(options.env, key);
        if (version) {
          entry.version = version;
        }
      } catch (err) {
        // Log error but continue - version info not critical
        logDebug('Error getting cache version', {
          key,
          error: err instanceof Error ? err.message : String(err)
        });
      }
    }
    
    // Log success
    const remainingSeconds = Math.floor((entry.expiresAt - now) / 1000);
    logDebug('Retrieved presigned URL from cache', {
      key,
      remainingSeconds,
      expiresAt: new Date(entry.expiresAt).toISOString(),
      age: Math.floor((now - entry.createdAt) / 1000) + 's',
      version: entry.version
    });
    
    // Add breadcrumb for successful KV retrieval
    const requestContext = getCurrentContext();
    if (requestContext) {
      addBreadcrumb(requestContext, 'KV', 'Retrieved presigned URL from KV cache', {
        key,
        path,
        remainingSeconds,
        age: Math.floor((now - entry.createdAt) / 1000) + 's'
      });
    }
    
    return entry;
  } catch (err) {
    logDebug('Error parsing cached presigned URL', {
      key,
      error: err instanceof Error ? err.message : String(err)
    });
    return null;
  }
}

/**
 * Retrieve a presigned URL from cache with error handling
 */
export const getPresignedUrl = withErrorHandling<
  [
    KVNamespace,
    string,
    {
      storageType: string; // Can be 'remote', 'fallback', or a pattern name
      authType: string;
      region?: string;
      service?: string;
      env?: EnvVariables;
    }
  ],
  Promise<PresignedUrlCacheEntry | null>
>(
  getPresignedUrlImpl,
  {
    functionName: 'getPresignedUrl',
    component: 'PresignedUrlCacheService',
    logErrors: true
  },
  { operationType: 'read' }
);

/**
 * Check if a presigned URL is about to expire
 * 
 * @param entry The cache entry to check
 * @param thresholdSeconds Threshold in seconds before expiration
 * @returns True if the URL is expiring soon
 */
export function isUrlExpiring(
  entry: PresignedUrlCacheEntry,
  thresholdSeconds: number = 300
): boolean {
  const now = Date.now();
  const remainingSeconds = Math.floor((entry.expiresAt - now) / 1000);
  return remainingSeconds <= thresholdSeconds;
}

/**
 * Type definition for URL generation function
 */
export type UrlGeneratorFunction = (path: string) => Promise<string>;

/**
 * Refresh a presigned URL if it's close to expiration
 * This should be called using waitUntil to avoid blocking
 * 
 * @param namespace KV namespace for storage
 * @param entry The cache entry to refresh
 * @param options Configuration options
 * @returns Success status
 */
async function refreshPresignedUrlImpl(
  namespace: KVNamespace,
  entry: PresignedUrlCacheEntry,
  options: {
    thresholdSeconds?: number;
    env?: EnvVariables;
    generateUrlFn: UrlGeneratorFunction;
  }
): Promise<boolean> {
  const threshold = options.thresholdSeconds || 300; // Default 5 minutes
  
  if (!isUrlExpiring(entry, threshold)) {
    return false; // Not expiring soon, no need to refresh
  }
  
  try {
    // Calculate expiration time based on original duration
    const originalDuration = Math.floor((entry.expiresAt - entry.createdAt) / 1000);
    
    // Generate new presigned URL
    const newUrl = await options.generateUrlFn(entry.path);
    
    // Store the new URL
    await storePresignedUrl(
      namespace,
      entry.path,
      newUrl,
      entry.originalUrl,
      {
        storageType: entry.storageType,
        expiresInSeconds: originalDuration,
        authType: entry.authType,
        region: entry.region,
        service: entry.service,
        env: options.env
      }
    );
    
    logDebug('Refreshed expiring presigned URL', {
      path: entry.path,
      storageType: entry.storageType,
      originalExpiration: new Date(entry.expiresAt).toISOString(),
      newDuration: originalDuration
    });
    
    return true;
  } catch (err) {
    logDebug('Error refreshing presigned URL', {
      path: entry.path,
      error: err instanceof Error ? err.message : String(err)
    });
    return false;
  }
}

/**
 * Refresh a presigned URL with error handling
 */
export const refreshPresignedUrl = withErrorHandling<
  [
    KVNamespace,
    PresignedUrlCacheEntry,
    {
      thresholdSeconds?: number;
      env?: EnvVariables;
      generateUrlFn: UrlGeneratorFunction;
    }
  ],
  Promise<boolean>
>(
  refreshPresignedUrlImpl,
  {
    functionName: 'refreshPresignedUrl',
    component: 'PresignedUrlCacheService',
    logErrors: true
  },
  { operationType: 'refresh' }
);
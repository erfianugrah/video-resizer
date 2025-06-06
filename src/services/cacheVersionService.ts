/**
 * Service for managing cache key versions
 * Enables cache busting for the media proxy
 */

import { getCurrentContext } from '../utils/legacyLoggerAdapter';
import { createLogger, debug as pinoDebug } from '../utils/pinoLogger';
import { addBreadcrumb } from '../utils/requestContext';
import { EnvVariables } from '../config/environmentConfig';
import { logErrorWithContext, withErrorHandling } from '../utils/errorHandlingUtils';
import { cacheConfig } from '../config/CacheConfigurationManager';

/**
 * Log a debug message with proper context handling
 */
function logDebug(message: string, data?: Record<string, unknown>): void {
  const requestContext = getCurrentContext();
  if (requestContext) {
    const logger = createLogger(requestContext);
    pinoDebug(requestContext, logger, 'CacheVersionService', message, data);
  } else {
    console.debug(`CacheVersionService: ${message}`, data || {});
  }
}

/**
 * Generate a consistent version key from a cache key
 * @param cacheKey The original cache key
 * @returns A sanitized version key
 */
export function createVersionKey(cacheKey: string): string {
  // Ensure the key is valid for KV storage (no control chars, etc)
  // Replace all special characters including colons with dashes
  // and limit the length to a reasonable size
  return `version-${cacheKey.replace(/[^\w\/.-]/g, '-').substring(0, 512)}`;
}

/**
 * Metadata structure for version tracking
 */
interface VersionMetadata {
  version: number;
  createdAt?: number;
  updatedAt?: number;
}

/**
 * Get the current version for a cache key
 * @param env Environment variables with KV binding
 * @param cacheKey The cache key to get version for
 * @returns The current version number or null if not found
 */
export const getCacheKeyVersion = withErrorHandling<
  [EnvVariables | undefined, string],
  Promise<number | null>
>(
  async function getCacheKeyVersionImpl(env: EnvVariables | undefined, cacheKey: string): Promise<number | null> {
    // Check if versioning is disabled in configuration
    if (!cacheConfig.isVersioningEnabled()) {
      logDebug('Cache versioning is disabled by configuration');
      return 1; // Return a constant version (1) when disabled
    }

    // Support flexible binding names
    const versionBindingName = env?.VERSION_KV_NAME || 'VIDEO_CACHE_KEY_VERSIONS';
    const versionKV = env && env[versionBindingName] as KVNamespace | undefined;
    
    if (!versionKV) {
      logDebug('Version KV namespace not available', {
        attemptedBinding: versionBindingName,
        hasVersionKvName: !!env?.VERSION_KV_NAME
      });
      return null;
    }

    const versionKey = createVersionKey(cacheKey);
    
    // Get value with metadata
    const { value, metadata } = await versionKV.getWithMetadata<VersionMetadata>(versionKey);
    
    // Version is stored in metadata
    if (!metadata || typeof metadata.version !== 'number') {
      logDebug('No version metadata found for cache key', { cacheKey, versionKey });
      return null;
    }
    
    logDebug('Found cache key version', { cacheKey, version: metadata.version });
    
    // Add breadcrumb for tracking
    const requestContext = getCurrentContext();
    if (requestContext) {
      addBreadcrumb(requestContext, 'Cache', 'Retrieved cache key version', {
        cacheKey,
        versionKey,
        version: metadata.version
      });
    }
    
    return metadata.version;
  },
  {
    functionName: 'getCacheKeyVersion',
    component: 'CacheVersionService',
    logErrors: true
  }
);

/**
 * Store a cache key version
 * @param env Environment variables with KV binding
 * @param cacheKey The cache key to store version for
 * @param version The version number to store
 * @param ttl Optional TTL in seconds
 * @returns true if successful, false otherwise
 */
export const storeCacheKeyVersion = withErrorHandling<
  [EnvVariables | undefined, string, number, number?],
  Promise<boolean>
>(
  async function storeCacheKeyVersionImpl(
    env: EnvVariables | undefined,
    cacheKey: string,
    version: number,
    ttl?: number
  ): Promise<boolean> {
    // Check if versioning is disabled in configuration
    if (!cacheConfig.isVersioningEnabled()) {
      logDebug('Cache versioning is disabled by configuration, skipping version storage');
      return true; // Return success but don't actually store anything
    }

    // Support flexible binding names
    const versionBindingName = env?.VERSION_KV_NAME || 'VIDEO_CACHE_KEY_VERSIONS';
    const versionKV = env && env[versionBindingName] as KVNamespace | undefined;
    
    if (!versionKV) {
      logDebug('Version KV namespace not available', {
        attemptedBinding: versionBindingName,
        hasVersionKvName: !!env?.VERSION_KV_NAME
      });
      return false;
    }

    const versionKey = createVersionKey(cacheKey);
    const now = Date.now();
    
    // Create metadata with version and timestamps
    const metadata: VersionMetadata = {
      version,
      createdAt: now,
      updatedAt: now
    };
    
    // Store with empty value and version in metadata
    // This is faster to retrieve and more efficient
    const options: KVNamespacePutOptions = {
      metadata,
      // Add TTL if provided
      ...(ttl ? { expirationTtl: ttl } : {})
    };
    
    // Store an empty string as the value, with metadata containing the version
    await versionKV.put(versionKey, '', options);
    
    logDebug('Stored cache key version in metadata', { 
      cacheKey, 
      versionKey, 
      version,
      ttl: ttl || 'none' 
    });
    
    // Add breadcrumb for tracking
    const requestContext = getCurrentContext();
    if (requestContext) {
      addBreadcrumb(requestContext, 'Cache', 'Stored cache key version', {
        cacheKey,
        versionKey,
        version,
        ttl: ttl || 'none'
      });
    }
    
    return true;
  },
  {
    functionName: 'storeCacheKeyVersion',
    component: 'CacheVersionService',
    logErrors: true
  }
);

/**
 * Get next version for a cache key, incrementing if exists
 * @param env Environment variables with KV binding
 * @param cacheKey The cache key to get next version for
 * @param forceIncrement Whether to force incrementing the version (for cache misses)
 * @returns The next version number (1 if no previous version)
 */
export const getNextCacheKeyVersion = withErrorHandling<
  [EnvVariables | undefined, string, boolean?],
  Promise<number>
>(
  async function getNextCacheKeyVersionImpl(
    env: EnvVariables | undefined, 
    cacheKey: string,
    forceIncrement: boolean = false
  ): Promise<number> {
    // Check if versioning is disabled in configuration
    if (!cacheConfig.isVersioningEnabled()) {
      logDebug('Cache versioning is disabled by configuration, returning version 1');
      return 1; // Return constant version when disabled
    }

    if (!env) {
      logDebug('Environment variables not available, returning version 1');
      return 1;
    }
    
    const currentVersion = await getCacheKeyVersion(env, cacheKey);
    
    // If no version exists, start with 1
    if (!currentVersion) {
      logDebug('Generated first cache key version', { 
        cacheKey, 
        currentVersion: 'none',
        nextVersion: 1 
      });
      return 1;
    }
    
    // Only increment if forceIncrement is true (explicit cache miss)
    // Do NOT automatically increment just because the version is > 1
    const shouldIncrement = forceIncrement;
    const nextVersion = shouldIncrement ? currentVersion + 1 : currentVersion;
    
    logDebug('Generated next cache key version', { 
      cacheKey, 
      currentVersion,
      nextVersion,
      forceIncrement,
      shouldIncrement,
      versionChanged: currentVersion !== nextVersion,
      reasonForIncrement: shouldIncrement ? 'Explicit cache miss/force increment' : undefined,
      reasonForNoIncrement: !shouldIncrement ? 'No explicit cache miss' : undefined
    });
    
    return nextVersion;
  },
  {
    functionName: 'getNextCacheKeyVersion',
    component: 'CacheVersionService',
    logErrors: true
  }
);
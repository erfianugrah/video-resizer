/**
 * Version Manager Service for versioned KV caching
 * 
 * This service tracks and manages version numbers for cache keys to enable controlled invalidation
 */

import { EnvVariables } from '../config/environmentConfig';
import { createLogger, debug as pinoDebug } from '../utils/pinoLogger';
import { getCurrentContext } from '../utils/legacyLoggerAdapter';
import { withErrorHandling } from '../utils/errorHandlingUtils';

/**
 * Helper for logging debug messages
 */
function logDebug(message: string, data?: Record<string, unknown>): void {
  const requestContext = getCurrentContext();
  if (requestContext) {
    const logger = createLogger(requestContext);
    pinoDebug(requestContext, logger, 'VersionManager', message, data);
  } else {
    console.debug(`VersionManager: ${message}`, data || {});
  }
}

/**
 * Get the current version for a cache key
 * 
 * @param env - Environment with KV namespace binding
 * @param cacheKey - The base cache key (without version)
 * @returns Current version number (defaults to 1 if not found)
 */
export const getCurrentVersion = withErrorHandling<
  [EnvVariables, string],
  Promise<number>
>(
  async function getCurrentVersionImpl(
    env: EnvVariables,
    cacheKey: string
  ): Promise<number> {
    const versionKV = env.VIDEO_CACHE_KEY_VERSIONS;
    
    if (!versionKV) {
      logDebug('Version KV namespace not available, defaulting to version 1');
      return 1;
    }
    
    const version = await versionKV.get(cacheKey);
    
    if (version === null) {
      logDebug('No version found for key, defaulting to version 1', { cacheKey });
      return 1;
    }
    
    const versionNumber = parseInt(version, 10);
    logDebug('Found version for key', { cacheKey, version: versionNumber });
    
    return versionNumber;
  },
  {
    functionName: 'getCurrentVersion',
    component: 'VersionManager',
    logErrors: true
  },
  { defaultValue: 1 } // Default to version 1 if error occurs
);

/**
 * Increment the version for a cache key
 * 
 * @param env - Environment with KV namespace binding
 * @param cacheKey - The base cache key (without version)
 * @returns New version number after increment
 */
export const incrementVersion = withErrorHandling<
  [EnvVariables, string],
  Promise<number>
>(
  async function incrementVersionImpl(
    env: EnvVariables,
    cacheKey: string
  ): Promise<number> {
    const versionKV = env.VIDEO_CACHE_KEY_VERSIONS;
    
    if (!versionKV) {
      logDebug('Version KV namespace not available, defaulting to version 1');
      return 1;
    }
    
    const currentVersion = await getCurrentVersion(env, cacheKey);
    const newVersion = currentVersion + 1;
    
    await versionKV.put(cacheKey, newVersion.toString());
    logDebug('Incremented version for key', { cacheKey, oldVersion: currentVersion, newVersion });
    
    return newVersion;
  },
  {
    functionName: 'incrementVersion',
    component: 'VersionManager',
    logErrors: true
  },
  { defaultValue: 1 } // Default to version 1 if error occurs
);

/**
 * Reset the version for a cache key to 1
 * 
 * @param env - Environment with KV namespace binding
 * @param cacheKey - The base cache key (without version)
 * @returns Success boolean
 */
export const resetVersion = withErrorHandling<
  [EnvVariables, string],
  Promise<boolean>
>(
  async function resetVersionImpl(
    env: EnvVariables,
    cacheKey: string
  ): Promise<boolean> {
    const versionKV = env.VIDEO_CACHE_KEY_VERSIONS;
    
    if (!versionKV) {
      logDebug('Version KV namespace not available');
      return false;
    }
    
    await versionKV.put(cacheKey, '1');
    logDebug('Reset version for key to 1', { cacheKey });
    
    return true;
  },
  {
    functionName: 'resetVersion',
    component: 'VersionManager',
    logErrors: true
  },
  { defaultValue: false } // Default to false if error occurs
);
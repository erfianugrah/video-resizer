/**
 * Utilities for managing cache configuration for videos
 */
import { CacheConfigurationManager, cacheConfig } from '../config/CacheConfigurationManager';
import { getCurrentContext } from '../utils/requestContext';
import { tryOrDefault, tryOrNull, logErrorWithContext } from './errorHandlingUtils';
import { createCategoryLogger } from './logger';

// Create a category-specific logger for CacheUtils
const logger = createCategoryLogger('CacheUtils');

/**
 * Helper for logging debug messages
 * Using tryOrDefault for safe logging with error handling
 */
const logDebug = tryOrDefault<[string, Record<string, unknown>?], void>(
  (message: string, data?: Record<string, unknown>) => {
    logger.debug(message, data);
  },
  {
    functionName: 'logDebug',
    component: 'CacheUtils',
    logErrors: false, // Avoid recursive error logging for the logger itself
  },
  undefined // No return value needed
);

/**
 * Cache configuration interface
 */
export interface CacheConfig {
  cacheability: boolean;
  videoCompression: string;
  /**
   * Choose whether to use status-based TTLs or a single TTL for all statuses
   * When true, cacheTtlByStatus will be used; when false, cacheTtl will be used
   */
  useTtlByStatus?: boolean;
  ttl: {
    ok: number;
    redirects: number;
    clientError: number;
    serverError: number;
  };
}

/**
 * Implementation of determineCacheConfig that might throw errors
 */
function determineCacheConfigImpl(url: string): CacheConfig {
  // Default empty cache config - only used if no profiles match and no fallback is available
  const defaultCacheConfig: CacheConfig = {
    cacheability: false,
    videoCompression: 'off',
    ttl: {
      ok: 0,
      redirects: 0,
      clientError: 0,
      serverError: 0,
    },
  };

  // Get cache profiles from configuration manager
  const cacheSettings = cacheConfig.getConfig();
  const profiles = cacheSettings.profiles;

  if (!profiles) {
    logDebug('No cache profiles found in configuration, using default empty config');
    return defaultCacheConfig;
  }

  // Extract the path from the URL for pattern matching
  const path = new URL(url).pathname;

  // Try to match against each profile using regex patterns
  for (const [profileName, profile] of Object.entries(profiles)) {
    if (profileName === 'default') continue; // Skip default for now, we'll use it as fallback

    try {
      if (profile.regex) {
        const regex = new RegExp(profile.regex);
        if (regex.test(path)) {
          // Convert profile to CacheConfig format
          const config: CacheConfig = {
            cacheability: profile.cacheability,
            videoCompression: profile.videoCompression,
            useTtlByStatus: profile.useTtlByStatus,
            ttl: profile.ttl,
          };

          logDebug(`Matched cache profile: ${profileName}`, {
            path,
            regex: profile.regex,
            cacheability: profile.cacheability,
          });

          return config;
        }
      }
    } catch (error) {
      // Log with standardized error handling
      logErrorWithContext(
        `Error matching regex for profile ${profileName}`,
        error,
        {
          regex: profile.regex,
          url,
          path,
        },
        'CacheUtils'
      );
    }
  }

  // If we didn't match any specific profile, use the default profile if available
  if (profiles.default) {
    logDebug('Using default cache profile for path', { path });

    return {
      cacheability: profiles.default.cacheability,
      videoCompression: profiles.default.videoCompression,
      useTtlByStatus: profiles.default.useTtlByStatus,
      ttl: profiles.default.ttl,
    };
  }

  // Return empty config as last resort if nothing matched
  return defaultCacheConfig;
}

/**
 * Determine cache configuration based on URL by matching against configured profiles
 * Using tryOrDefault for safe cache configuration determination with proper error handling
 *
 * @param url - The full URL to check
 * @returns Cache configuration object
 */
export const determineCacheConfig = tryOrDefault<[string], CacheConfig>(
  determineCacheConfigImpl,
  {
    functionName: 'determineCacheConfig',
    component: 'CacheUtils',
    logErrors: true,
  },
  {
    // Safe default if determination fails completely
    cacheability: false,
    videoCompression: 'off',
    ttl: {
      ok: 0,
      redirects: 0,
      clientError: 0,
      serverError: 0,
    },
  }
);

/**
 * Implementation of shouldCache that might throw errors
 */
function shouldCacheImpl(config: CacheConfig): boolean {
  return config?.cacheability === true;
}

/**
 * Determines if a response should be cached based on the configuration
 * Using tryOrDefault for safe cache decision with proper error handling
 *
 * @param config - The cache configuration
 * @returns boolean indicating if the response should be cached
 */
export const shouldCache = tryOrDefault<[CacheConfig], boolean>(
  shouldCacheImpl,
  {
    functionName: 'shouldCache',
    component: 'CacheUtils',
    logErrors: false, // Low importance function, avoid excessive logging
  },
  false // Default to not caching if there's an error determining status
);

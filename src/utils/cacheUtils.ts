/**
 * Utilities for managing cache configuration for videos
 */
import { CacheConfigurationManager, cacheConfig } from '../config/CacheConfigurationManager';
import { createLogger, debug as pinoDebug } from '../utils/pinoLogger';
import { getCurrentContext } from '../utils/legacyLoggerAdapter';

/**
 * Helper for logging debug messages
 */
function logDebug(message: string, data?: Record<string, unknown>): void {
  const requestContext = getCurrentContext();
  if (requestContext) {
    const logger = createLogger(requestContext);
    pinoDebug(requestContext, logger, 'CacheUtils', message, data);
  } else {
    console.debug(`CacheUtils: ${message}`, data || {});
  }
}

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
 * Determine cache configuration based on URL by matching against configured profiles
 * @param url - The full URL to check
 * @returns Cache configuration object
 */
export function determineCacheConfig(url: string): CacheConfig {
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

  try {
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
              ttl: profile.ttl
            };
            
            logDebug(`Matched cache profile: ${profileName}`, {
              path,
              regex: profile.regex,
              cacheability: profile.cacheability
            });
            
            return config;
          }
        }
      } catch (error) {
        // Log but continue trying other profiles
        logDebug(`Error matching regex for profile ${profileName}`, {
          error: error instanceof Error ? error.message : String(error),
          regex: profile.regex
        });
      }
    }
    
    // If we didn't match any specific profile, use the default profile if available
    if (profiles.default) {
      logDebug('Using default cache profile for path', { path });
      
      return {
        cacheability: profiles.default.cacheability,
        videoCompression: profiles.default.videoCompression,
        useTtlByStatus: profiles.default.useTtlByStatus,
        ttl: profiles.default.ttl
      };
    }
  } catch (error) {
    logDebug('Error determining cache configuration from profiles', {
      error: error instanceof Error ? error.message : String(error),
      url
    });
  }

  // Return empty config as last resort if nothing matched
  return defaultCacheConfig;
}

/**
 * Determines if a response should be cached based on the configuration
 * @param config - The cache configuration
 * @returns boolean indicating if the response should be cached
 */
export function shouldCache(config: CacheConfig): boolean {
  return config?.cacheability === true;
}
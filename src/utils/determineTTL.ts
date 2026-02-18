/**
 * Streamlined TTL determination function that only uses path patterns for TTL configuration
 * This version eliminates the redundant "profiles" section in the configuration
 */

import { getCurrentContext } from './requestContext';
import { VideoConfigurationManager } from '../config/VideoConfigurationManager';
import { createCategoryLogger } from './logger';

// Create a category-specific logger for TTLDetermination
const logger = createCategoryLogger('TTLDetermination');
const { debug: logDebug } = logger;

/**
 * Determine the TTL for a cached response using a simplified approach
 * This function only looks at path patterns in the video config, eliminating
 * redundancy and confusion with the separate profiles system
 *
 * @param response - The response to cache
 * @param config - Global cache configuration
 * @returns TTL in seconds
 */
export function determineTTL(response: Response, config: any): number {
  // Get status and category
  const status = response.status;
  const statusCategory = Math.floor(status / 100);

  // Get request context to access URL path
  const requestContext = getCurrentContext();
  const url = requestContext?.url ? new URL(requestContext.url) : null;
  const path = url?.pathname || '';

  // Initialize ttlConfig as null
  let ttlConfig = null;

  // Try to match against path patterns
  try {
    const videoConfig = VideoConfigurationManager.getInstance().getConfig();

    if (videoConfig?.pathPatterns && Array.isArray(videoConfig.pathPatterns)) {
      // First look for specific path pattern matches
      for (const pattern of videoConfig.pathPatterns) {
        // Skip the default pattern, we'll use it as fallback
        if (pattern.name === 'default') continue;

        if (pattern.matcher && pattern.ttl) {
          try {
            const regex = new RegExp(pattern.matcher);
            if (regex.test(path)) {
              ttlConfig = pattern.ttl;
              logDebug('Using TTL from specific path pattern', {
                path,
                patternName: pattern.name || 'unnamed',
                ttl: ttlConfig,
                source: 'path-pattern',
              });
              break;
            }
          } catch (err) {
            // If regex is invalid, log and continue
            logDebug('Invalid regex in path pattern', {
              patternName: pattern.name || 'unnamed',
              matcher: pattern.matcher,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
      }

      // If no specific pattern matched, look for the default pattern
      if (!ttlConfig) {
        const defaultPattern = videoConfig.pathPatterns.find((p) => p.name === 'default');
        if (defaultPattern?.ttl) {
          ttlConfig = defaultPattern.ttl;
          logDebug('Using default path pattern TTL', {
            path,
            ttl: ttlConfig,
            source: 'default-path-pattern',
          });
        }
      }
    }
  } catch (err) {
    // Handle any errors in path pattern matching
    logDebug('Error matching path patterns for TTL', {
      path,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Fallback to global cache settings if no path pattern matched
  // Default TTLs from configuration or hardcoded values
  let defaultTTLs = {
    ok: 300, // 5 minutes
    redirects: 300, // 5 minutes
    clientError: 60, // 1 minute
    serverError: 10, // 10 seconds
  };

  // Try to use global TTL from config if available
  if (config.ttl) {
    defaultTTLs = { ...defaultTTLs, ...config.ttl };
    if (!ttlConfig) {
      logDebug('Using global cache TTL settings', {
        ttl: config.ttl,
        source: 'global-config',
      });
    }
  }

  // Determine TTL based on status code using the found configuration
  switch (statusCategory) {
    case 2: // Success
      return ttlConfig?.ok || config.ttl?.ok || defaultTTLs.ok;
    case 3: // Redirect
      return ttlConfig?.redirects || config.ttl?.redirects || defaultTTLs.redirects;
    case 4: // Client error
      return ttlConfig?.clientError || config.ttl?.clientError || defaultTTLs.clientError;
    case 5: // Server error
      return ttlConfig?.serverError || config.ttl?.serverError || defaultTTLs.serverError;
    default:
      return ttlConfig?.clientError || config.ttl?.clientError || defaultTTLs.clientError;
  }
}

/**
 * Configuration storage operations
 */
import { ConfigurationError } from '../../errors';
import { ConfigEnvironment, WorkerConfiguration } from './schemas';
import { validateConfig } from './validation';
import { createLogger, debug as pinoDebug, error as pinoError } from '../../utils/pinoLogger';
import { getCurrentContext } from '../../utils/legacyLoggerAdapter';
import { logErrorWithContext } from '../../utils/errorHandlingUtils';
import { ConfigurationCache } from './caching';

// Constants
const CONFIG_KEY = 'worker-config';

/**
 * Store configuration to KV storage
 * @param env Environment with KV namespace
 * @param config Configuration to store
 * @param cache Cache to update with new configuration
 * @param metrics Metrics for tracking KV operations
 * @returns True if storage was successful, false otherwise
 */
export async function storeToKV(
  env: ConfigEnvironment,
  config: WorkerConfiguration,
  cache: ConfigurationCache,
  metrics: Record<string, number | boolean>
): Promise<boolean> {
  const requestContext = getCurrentContext();
  const logger = requestContext ? createLogger(requestContext) : null;
  
  if (!env.VIDEO_CONFIGURATION_STORE) {
    if (logger && requestContext) {
      pinoError(requestContext, logger, 'ConfigurationService', 'KV namespace not available for storing config', {
        environment: env.ENVIRONMENT || 'unknown'
      });
    }
    metrics.kvErrorCount = (metrics.kvErrorCount as number) + 1;
    return false;
  }
  
  // Validate config before storing
  try {
    validateConfig(config);
  } catch (error) {
    if (logger && requestContext) {
      pinoError(requestContext, logger, 'ConfigurationService', 'Invalid configuration for storage', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
    metrics.validationErrorCount = (metrics.validationErrorCount as number) + 1;
    return false;
  }
  
  // Update lastUpdated timestamp
  const updatedConfig = {
    ...config,
    lastUpdated: new Date().toISOString()
  };
  
  // Track KV store metrics
  metrics.kvStoreCount = (metrics.kvStoreCount as number) + 1;
  
  try {
    // Store configuration in KV
    await env.VIDEO_CONFIGURATION_STORE.put(
      CONFIG_KEY,
      JSON.stringify(updatedConfig),
      { expirationTtl: 86400 * 30 } // 30 days expiration
    );
    
    // Update metrics
    metrics.kvStoreSuccessCount = (metrics.kvStoreSuccessCount as number) + 1;
    metrics.lastConfigUpdateTimestamp = Date.now();
    
    // Update cache with new configuration
    cache.set(CONFIG_KEY, updatedConfig);
    
    if (logger && requestContext) {
      pinoDebug(requestContext, logger, 'ConfigurationService', 'Configuration stored successfully', {
        version: updatedConfig.version,
        updatedAt: updatedConfig.lastUpdated
      });
    }
    
    return true;
  } catch (error) {
    // Update metrics for failure
    metrics.kvStoreFailCount = (metrics.kvStoreFailCount as number) + 1;
    metrics.kvErrorCount = (metrics.kvErrorCount as number) + 1;
    
    if (logger && requestContext) {
      pinoError(requestContext, logger, 'ConfigurationService', 'Failed to store configuration to KV', {
        error: error instanceof Error ? error.message : String(error),
        key: CONFIG_KEY
      });
    }
    
    return false;
  }
}

/**
 * Create a new configuration with updated version
 * @param config Base configuration to update
 * @param updates Updates to apply to the configuration
 * @returns Updated configuration with new version and timestamp
 */
export function createUpdatedConfiguration(
  config: WorkerConfiguration,
  updates: Partial<WorkerConfiguration>
): WorkerConfiguration {
  // Create a deep copy of the current config
  const baseConfig = JSON.parse(JSON.stringify(config));
  
  // Apply updates deeply
  const newConfig = deepMerge(baseConfig, updates);
  
  // Update version (increment patch version)
  const versionParts = newConfig.version.split('.');
  if (versionParts.length === 3) {
    const patch = parseInt(versionParts[2], 10);
    versionParts[2] = isNaN(patch) ? '1' : (patch + 1).toString();
    newConfig.version = versionParts.join('.');
  }
  
  // Update timestamp
  newConfig.lastUpdated = new Date().toISOString();
  
  return newConfig;
}

/**
 * Deep merge two objects
 * @param target Target object to merge into
 * @param source Source object to merge from
 * @returns Merged object
 */
function deepMerge(target: any, source: any): any {
  const output = { ...target };
  
  // Handle null or undefined source
  if (source === null || source === undefined) {
    return output;
  }
  
  // Loop through source properties and merge
  Object.keys(source).forEach(key => {
    if (source[key] instanceof Object && key in target && target[key] instanceof Object) {
      // Recursively merge objects
      output[key] = deepMerge(target[key], source[key]);
    } else {
      // Directly copy non-object values or for keys not in target
      output[key] = source[key];
    }
  });
  
  return output;
}
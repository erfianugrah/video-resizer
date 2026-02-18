/**
 * Storage-related methods extracted from VideoConfigurationManager
 *
 * Provides helpers for reading storage configuration and running
 * storage diagnostics.
 */
import type { VideoConfiguration } from './videoConfigSchemas';

/** Default storage configuration used when none is provided. */
const DEFAULT_STORAGE_CONFIG = {
  priority: ['r2', 'remote', 'fallback'] as const,
  r2: {
    enabled: false,
    bucketBinding: 'VIDEOS_BUCKET',
  },
  fetchOptions: {
    userAgent: 'Cloudflare-Video-Resizer/1.0',
  },
};

/**
 * Get storage configuration for video sources.
 *
 * @returns Storage configuration or default if not set
 */
export function getStorageConfig(config: VideoConfiguration) {
  if (!config.storage) {
    try {
      // Try to log the missing config once, not on every call
      const logWarning = () => {
        import('../utils/logger')
          .then(({ logWarn: warn }) => {
            warn('VideoConfigurationManager', 'Storage configuration not found, using defaults');
          })
          .catch(() => {
            console.warn({
              context: 'VideoConfigurationManager',
              operation: 'loadConfig',
              message: 'Storage configuration not found, using defaults',
            });
          });
      };

      // Only log once by using a function we define and call immediately
      logWarning();
    } catch {
      // Silent catch - don't fail getting config if logging fails
    }

    return DEFAULT_STORAGE_CONFIG;
  }

  // Return the stored configuration
  return config.storage;
}

/**
 * Get diagnostics for storage configuration.
 * Provides detailed information about storage configuration status
 * including R2 bucket availability and any configuration inconsistencies.
 */
export function getStorageDiagnostics(config: VideoConfiguration, env?: Record<string, unknown>) {
  const storageConfig = getStorageConfig(config);
  const r2Config = storageConfig.r2 || { enabled: false, bucketBinding: 'VIDEOS_BUCKET' };

  // Check if the R2 bucket is available
  const hasBucket = !!(env && r2Config.bucketBinding && env[r2Config.bucketBinding]);
  const r2Enabled = r2Config.enabled === true;

  // Detect configuration inconsistencies
  const inconsistencies: string[] = [];
  if (r2Enabled && !hasBucket) {
    inconsistencies.push('R2 enabled but bucket binding not available');
  }
  if (!r2Enabled && hasBucket) {
    inconsistencies.push('R2 bucket available but not enabled in configuration');
  }

  // Determine remoteUrl availability
  const hasRemoteUrl = !!(storageConfig as any).remoteUrl;

  // Check if remote auth is properly configured
  const remoteAuth = (storageConfig as any).remoteAuth || { enabled: false };
  const remoteAuthConfigured = remoteAuth.enabled === true;
  const remoteAuthInconsistent = remoteAuthConfigured && !hasRemoteUrl;
  if (remoteAuthInconsistent) {
    inconsistencies.push('Remote auth enabled but no remoteUrl configured');
  }

  return {
    storage: {
      r2: {
        enabled: r2Enabled,
        hasBucket,
        bucketBinding: r2Config.bucketBinding,
        available: r2Enabled && hasBucket,
      },
      remote: {
        enabled: hasRemoteUrl,
        url: hasRemoteUrl ? (storageConfig as any).remoteUrl : null,
        authConfigured: remoteAuthConfigured,
        available: hasRemoteUrl,
      },
      priority: storageConfig.priority || [],
      inconsistencies,
      status: inconsistencies.length > 0 ? 'warning' : 'ok',
    },
  };
}

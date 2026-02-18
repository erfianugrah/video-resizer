/**
 * VideoConfigurationManager
 *
 * A centralized configuration manager for video transformation with Zod schema validation.
 * This manager provides type-safe access to video transformation settings, path patterns,
 * derivatives, and default values.
 *
 * Schemas are defined in ./videoConfigSchemas.ts
 * Origins helpers are in ./videoConfigOrigins.ts
 * Storage helpers are in ./videoConfigStorage.ts
 *
 * @example
 * ```typescript
 * import { VideoConfigurationManager } from '../config';
 *
 * // Get the singleton instance
 * const config = VideoConfigurationManager.getInstance();
 *
 * // Access configuration
 * const derivative = config.getDerivative('mobile');
 * const isValidFit = config.isValidOption('fit', 'cover');
 * ```
 */
import { z } from 'zod';
import { ConfigurationError } from '../errors';
import { videoConfig as defaultConfig } from './videoConfig';
import { convertLegacyConfigToOrigins } from './originConverters';
import { Origin } from '../services/videoStorage/interfaces';

// Schemas (extracted)
import {
  PathPatternSchema,
  VideoConfigSchema,
  type VideoConfiguration,
} from './videoConfigSchemas';

// Re-export schemas so existing consumers keep working
export { PathPatternSchema, VideoConfigSchema, type VideoConfiguration };

// Extracted helpers
import {
  getOrigins as _getOrigins,
  shouldUseOrigins as _shouldUseOrigins,
  generateOriginsFromLegacy as _generateOriginsFromLegacy,
  getOriginByName as _getOriginByName,
  addOrigin as _addOrigin,
  getOriginsDiagnostics as _getOriginsDiagnostics,
} from './videoConfigOrigins';

import {
  getStorageConfig as _getStorageConfig,
  getStorageDiagnostics as _getStorageDiagnostics,
} from './videoConfigStorage';

/**
 * VideoConfigurationManager class for managing and validating video configuration
 */
export class VideoConfigurationManager {
  private static instance: VideoConfigurationManager;
  private config: VideoConfiguration;

  /**
   * Private constructor to enforce singleton pattern
   */
  private constructor(initialConfig: unknown = defaultConfig) {
    try {
      // Ensure we're starting with defaultConfig if nothing is provided
      const configToUse = initialConfig || defaultConfig;

      // Auto-generate Origins from legacy config if not already present
      let configWithOrigins = configToUse as any;
      if (!configWithOrigins.origins && configWithOrigins.pathPatterns) {
        try {
          // Generate Origins from path patterns
          configWithOrigins = {
            ...configWithOrigins,
            origins: convertLegacyConfigToOrigins(configWithOrigins),
          };

          console.debug({
            context: 'VideoConfigurationManager',
            operation: 'loadConfig',
            message: 'Auto-generated Origins from legacy config',
            originCount: configWithOrigins.origins.length,
          });
        } catch (conversionError) {
          console.warn({
            context: 'VideoConfigurationManager',
            operation: 'loadConfig',
            message: 'Failed to auto-generate Origins',
            error:
              conversionError instanceof Error
                ? {
                    name: conversionError.name,
                    message: conversionError.message,
                    stack: conversionError.stack,
                  }
                : String(conversionError),
          });
        }
      }

      // Validate and parse the configuration
      this.config = VideoConfigSchema.parse(configWithOrigins);

      // Normalize valid options to ensure new modes/formats from defaults are present
      const mergeUnique = (a: string[], b: string[]) =>
        Array.from(new Set([...(a || []), ...(b || [])]));

      this.config.validOptions.mode = mergeUnique(
        defaultConfig.validOptions.mode,
        this.config.validOptions.mode
      );

      this.config.validOptions.format = mergeUnique(
        defaultConfig.validOptions.format,
        this.config.validOptions.format
      );
    } catch (error) {
      if (error instanceof z.ZodError) {
        const issues = error.errors
          .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
          .join(', ');

        throw ConfigurationError.invalidValue(
          'videoConfig',
          initialConfig,
          'Valid video configuration',
          { additionalInfo: `Validation errors: ${issues}` }
        );
      }

      throw ConfigurationError.invalidValue(
        'videoConfig',
        initialConfig,
        'Valid video configuration'
      );
    }
  }

  /**
   * Get the singleton instance
   */
  public static getInstance(initialConfig?: unknown): VideoConfigurationManager {
    if (!VideoConfigurationManager.instance) {
      VideoConfigurationManager.instance = new VideoConfigurationManager(initialConfig);
    }
    return VideoConfigurationManager.instance;
  }

  /**
   * Reset the instance (useful for testing)
   */
  public static resetInstance(): void {
    VideoConfigurationManager.instance = undefined as unknown as VideoConfigurationManager;
  }

  /**
   * Get the entire video configuration object
   */
  public getConfig(): VideoConfiguration {
    return this.config;
  }

  // ---------------------------------------------------------------------------
  // Derivatives
  // ---------------------------------------------------------------------------

  /**
   * Get a derivative configuration by name
   *
   * @param name - The name of the derivative to retrieve
   * @returns The derivative configuration object
   * @throws ConfigurationError if the derivative doesn't exist
   */
  public getDerivative(name: string) {
    if (!this.config.derivatives[name]) {
      throw ConfigurationError.missingProperty(`derivatives.${name}`, {
        parameters: { derivativeName: name },
      });
    }
    return this.config.derivatives[name];
  }

  // ---------------------------------------------------------------------------
  // Path patterns
  // ---------------------------------------------------------------------------

  /**
   * Get all configured path patterns
   */
  public getPathPatterns() {
    return this.config.pathPatterns || [];
  }

  /**
   * Add a new path pattern to the configuration
   */
  public addPathPattern(pattern: z.infer<typeof PathPatternSchema>) {
    try {
      // Convert legacy cacheTtl to ttl structure if needed
      if (pattern.cacheTtl && !pattern.ttl) {
        pattern = {
          ...pattern,
          ttl: {
            ok: pattern.cacheTtl,
            redirects: Math.floor(pattern.cacheTtl / 10),
            clientError: 60,
            serverError: 10,
          },
        };
      }

      const validatedPattern = PathPatternSchema.parse(pattern);

      if (!this.config.pathPatterns) {
        this.config.pathPatterns = [];
      }

      this.config.pathPatterns.push(validatedPattern);
      return validatedPattern;
    } catch (error) {
      if (error instanceof z.ZodError) {
        const issues = error.errors
          .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
          .join(', ');

        throw ConfigurationError.patternError(`Invalid path pattern: ${issues}`, pattern.name, {
          parameters: { pattern },
        });
      }

      throw ConfigurationError.patternError('Invalid path pattern', pattern.name, {
        parameters: { pattern },
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Valid options & defaults
  // ---------------------------------------------------------------------------

  /**
   * Get all valid options for a specific parameter
   */
  public getValidOptions(param: keyof VideoConfiguration['validOptions']) {
    const validOptionsObject = this.config.validOptions as Record<string, unknown[]>;
    return validOptionsObject[param as string];
  }

  /**
   * Check if a value is valid for a given parameter
   */
  public isValidOption(param: string, value: unknown): boolean {
    const validOptionsObject = this.config.validOptions as Record<string, unknown[]>;
    const validOptions = validOptionsObject[param];

    if (!validOptions) {
      return false;
    }

    return validOptions.some((option) => option === value);
  }

  /**
   * Get default video option value
   */
  public getDefaultOption<K extends keyof VideoConfiguration['defaults']>(
    option: K
  ): VideoConfiguration['defaults'][K] {
    return this.config.defaults[option];
  }

  /**
   * Get all default options
   */
  public getDefaults() {
    return this.config.defaults;
  }

  /**
   * Get parameter mapping (our param name -> CDN param name)
   */
  public getParamMapping() {
    return this.config.paramMapping;
  }

  /**
   * Get CDN-CGI configuration
   */
  public getCdnCgiConfig() {
    return this.config.cdnCgi;
  }

  // ---------------------------------------------------------------------------
  // Storage (delegated to videoConfigStorage.ts)
  // ---------------------------------------------------------------------------

  /**
   * Get storage configuration for video sources
   */
  public getStorageConfig() {
    return _getStorageConfig(this.config);
  }

  /**
   * Get diagnostics for storage configuration
   */
  public getStorageDiagnostics(env?: Record<string, unknown>) {
    return _getStorageDiagnostics(this.config, env);
  }

  // ---------------------------------------------------------------------------
  // Cache & responsive
  // ---------------------------------------------------------------------------

  /**
   * Get cache configuration
   */
  public getCacheConfig() {
    return this.config.cache || {};
  }

  /**
   * Get responsive configuration
   */
  public getResponsiveConfig() {
    return this.config.responsive;
  }

  /**
   * Get responsive breakpoints mapping
   */
  public getResponsiveBreakpoints() {
    return this.config.responsiveBreakpoints || {};
  }

  /**
   * Get caching method configuration
   */
  public getCachingConfig() {
    if (this.config.caching) {
      return this.config.caching;
    }

    const rootCache = this.getConfig() as any;
    if (rootCache.cache && rootCache.cache.method) {
      return {
        method: rootCache.cache.method,
        debug: rootCache.cache.debug || false,
        fallback: rootCache.cache.fallback || {
          enabled: true,
          badRequestOnly: true,
          preserveHeaders: ['Content-Type', 'Cache-Control', 'Etag'],
        },
      };
    }

    return {
      method: 'kv',
      debug: false,
      fallback: {
        enabled: true,
        badRequestOnly: true,
        preserveHeaders: ['Content-Type', 'Cache-Control', 'Etag'],
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Origins (delegated to videoConfigOrigins.ts)
  // ---------------------------------------------------------------------------

  /**
   * Get all configured origins
   */
  public getOrigins(): Origin[] {
    return _getOrigins(this.config);
  }

  /**
   * Check if Origins are configured and should be used
   */
  public shouldUseOrigins(): boolean {
    return _shouldUseOrigins(this.config);
  }

  /**
   * Auto-convert legacy configuration to Origins format
   */
  public generateOriginsFromLegacy() {
    return _generateOriginsFromLegacy(this.config);
  }

  /**
   * Get origin by name
   */
  public getOriginByName(name: string) {
    return _getOriginByName(this.config, name);
  }

  /**
   * Add a new origin to the configuration
   */
  public addOrigin(origin: unknown) {
    return _addOrigin(this.config, origin);
  }

  /**
   * Get diagnostics for Origins configuration
   */
  public getOriginsDiagnostics() {
    return _getOriginsDiagnostics(this.config, this.getPathPatterns().length);
  }

  // ---------------------------------------------------------------------------
  // Passthrough
  // ---------------------------------------------------------------------------

  /**
   * Get passthrough configuration for non-MP4 files
   */
  public getPassthroughConfig() {
    return (
      this.config.passthrough || {
        enabled: true,
        whitelistedFormats: [],
      }
    );
  }

  // ---------------------------------------------------------------------------
  // Dynamic update
  // ---------------------------------------------------------------------------

  /**
   * Update the configuration (for testing or dynamic reconfiguration)
   */
  public updateConfig(newConfig: Partial<VideoConfiguration>): VideoConfiguration {
    try {
      // Check for duration settings in the update
      const oldDefaultDuration = this.config.defaults.duration;
      const newDefaultDuration = newConfig.defaults?.duration;

      // Capture duration changes for debugging
      const durationChanges = {
        hasNewDefaultDuration: !!newDefaultDuration,
        oldDefaultDuration,
        newDefaultDuration: newDefaultDuration !== undefined ? newDefaultDuration : 'not changed',
        derivativeChanges: {} as Record<string, { old: string | null; new: string | null }>,
      };

      // Check derivative durations if they're being updated
      if (newConfig.derivatives) {
        const oldDerivatives = this.config.derivatives;
        Object.entries(newConfig.derivatives).forEach(([name, newDeriv]) => {
          const oldDeriv = oldDerivatives[name];
          if (oldDeriv && newDeriv && oldDeriv.duration !== newDeriv.duration) {
            durationChanges.derivativeChanges[name] = {
              old: oldDeriv.duration ?? null,
              new: newDeriv.duration ?? null,
            };
          }
        });
      }

      // Log duration changes
      try {
        // Dynamically import to avoid circular dependencies
        import('../utils/logger')
          .then(({ logInfo: info }) => {
            const hasDurationChanges =
              newDefaultDuration !== undefined ||
              Object.keys(durationChanges.derivativeChanges).length > 0;

            if (hasDurationChanges) {
              info('VideoConfigurationManager', 'Duration settings being updated', durationChanges);
            }
          })
          .catch(() => {
            console.info(
              '[VideoConfigurationManager] Duration settings update:',
              JSON.stringify(durationChanges)
            );
          });
      } catch (loggingError) {
        // Ignore logging errors - don't want to fail config updates
      }

      // Merge the new config with the existing one
      const mergedConfig = {
        ...this.config,
        ...newConfig,
        pathPatterns:
          newConfig.pathPatterns !== undefined ? newConfig.pathPatterns : this.config.pathPatterns,
        origins: newConfig.origins !== undefined ? newConfig.origins : this.config.origins,
      };

      // Validate the merged configuration
      this.config = VideoConfigSchema.parse(mergedConfig);

      // Log the final configuration details after update
      try {
        import('../utils/logger')
          .then(({ createCategoryLogger }) => {
            const configLogger = createCategoryLogger('VideoConfigurationManager');
            configLogger.info('Updated configuration duration settings', {
              defaultDuration: this.config.defaults.duration,
              mobileDerivativeDuration: this.config.derivatives.mobile?.duration || 'not set',
              desktopDerivativeDuration: this.config.derivatives.desktop?.duration || 'not set',
            });

            if (newConfig.pathPatterns) {
              configLogger.info('Updated path patterns', {
                patternCount: this.config.pathPatterns?.length || 0,
                patterns: this.config.pathPatterns
                  ? this.config.pathPatterns.map((p) => p.name).join(', ')
                  : 'none',
              });
            }

            if (newConfig.origins) {
              const originsCount = this.getOrigins().length;
              const originsNames =
                this.getOrigins()
                  .map((o) => o.name)
                  .join(', ') || 'none';

              configLogger.info('Updated origins', {
                originsCount,
                origins: originsNames,
              });
            }
          })
          .catch(() => {
            console.info({
              context: 'VideoConfigurationManager',
              operation: 'updateConfig',
              message: 'Updated configuration',
              pathPatternCount: newConfig.pathPatterns
                ? this.config.pathPatterns?.length || 0
                : undefined,
              originsCount: newConfig.origins ? this.getOrigins().length : undefined,
            });
          });
      } catch (loggingError) {
        try {
          import('../utils/errorHandlingUtils')
            .then(({ logErrorWithContext }) => {
              logErrorWithContext('Error logging configuration update', loggingError, {
                component: 'VideoConfigurationManager',
              });
            })
            .catch(() => {
              console.error({
                context: 'VideoConfigurationManager',
                operation: 'updateConfig',
                message: 'Error logging configuration update',
              });
            });
        } catch {
          // Silent failure - don't let logging errors impact configuration
        }
      }

      return this.config;
    } catch (error) {
      if (error instanceof z.ZodError) {
        const issues = error.errors
          .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
          .join(', ');

        throw ConfigurationError.invalidValue(
          'videoConfig',
          newConfig,
          'Valid video configuration',
          { additionalInfo: `Validation errors: ${issues}` }
        );
      }

      throw ConfigurationError.invalidValue('videoConfig', newConfig, 'Valid video configuration');
    }
  }
}

// Export a default instance for easy access
export const configManager = VideoConfigurationManager.getInstance();

/**
 * Update configuration specifically from ConfigurationService KV data
 *
 * @param kvConfig Configuration from KV store
 */
export function updateVideoConfigFromKV(kvConfig: Partial<VideoConfiguration>): void {
  try {
    if (!kvConfig) return;

    const manager = VideoConfigurationManager.getInstance();

    // Log KV configuration update
    import('../utils/logger')
      .then(({ logInfo: info }) => {
        info('VideoConfigManager', 'Updating from KV configuration', {
          hasDerivatives: !!kvConfig.derivatives,
          pathPatternCount: kvConfig.pathPatterns?.length || 0,
          hasDurationSettings: !!kvConfig.defaults?.duration,
        });
      })
      .catch(() => {
        console.log('[VideoConfigManager] Updating from KV configuration');
      });

    // Use the regular update method to apply the changes
    manager.updateConfig(kvConfig);
  } catch (error) {
    console.error({
      context: 'VideoConfigManager',
      operation: 'updateFromKV',
      error:
        error instanceof Error
          ? { name: error.name, message: error.message, stack: error.stack }
          : String(error),
    });
  }
}

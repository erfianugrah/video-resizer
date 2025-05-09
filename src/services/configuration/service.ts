/**
 * Main ConfigurationService class implementation
 */
import { ConfigurationError } from '../../errors';
import { ConfigEnvironment, WorkerConfiguration } from './schemas';
import { createMetrics, getFormattedMetrics } from './metrics';
import { ConfigurationCache } from './caching';
import { loadFromKV, loadBaseConfiguration, getFromKVWithCache } from './loaders';
import { storeToKV, createUpdatedConfiguration } from './storage';
import { getVideoConfig, getCacheConfig, getLoggingConfig, getDebugConfig } from './accessors';
import { convertJsonToConfig, validateConfig } from './validation';
import { createLogger, debug as pinoDebug, error as pinoError } from '../../utils/pinoLogger';
import { getCurrentContext } from '../../utils/legacyLoggerAdapter';
import { logErrorWithContext, withErrorHandling } from '../../utils/errorHandlingUtils';

// Constants
const CONFIG_KEY = 'worker-config';
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes memory cache

/**
 * Configuration Service class for dynamic worker configuration
 * 
 * Features:
 * - Non-blocking initialization for faster cold starts
 * - Memory caching with TTL to reduce KV operations
 * - Background configuration updates using waitUntil
 * - Performance metrics for monitoring and optimization
 */
export class ConfigurationService {
  /**
   * Get performance metrics for the service
   */
  public getPerformanceMetrics(): Record<string, number | string> {
    // Return formatted metrics 
    return getFormattedMetrics({
      ...this.metrics,
      baseInitComplete: this.baseInitComplete,
      isUpdating: this.isUpdating,
      initTimeSinceMs: Date.now() - this.initTimestamp,
      timeSinceLastFetchMs: this.lastFetchTimestamp > 0 
        ? Date.now() - this.lastFetchTimestamp 
        : 0,
      cacheSize: this.memoryCache.size,
      configExists: this.config !== null,
      configVersion: this.config?.version || 'none',
      configLastUpdated: this.config?.lastUpdated || 'none'
    });
  }
  
  // Singleton instance
  private static instance: ConfigurationService;
  private config: WorkerConfiguration | null = null;
  private lastFetchTimestamp: number = 0;
  private readonly CACHE_TTL_MS = CACHE_TTL_MS;
  private readonly CONFIG_KEY = CONFIG_KEY;
  private memoryCache: ConfigurationCache;
  private baseInitComplete = false;
  private kvUpdatePromise: Promise<void> | null = null;
  private isUpdating = false;
  private initTimestamp: number = Date.now();
  
  // Metrics for performance tracking
  private metrics = createMetrics();
  
  /**
   * Private constructor for singleton pattern
   */
  private constructor() {
    this.memoryCache = new ConfigurationCache(this.CACHE_TTL_MS);
  }
  
  /**
   * Get the singleton instance of the ConfigurationService
   */
  public static getInstance(): ConfigurationService {
    if (!ConfigurationService.instance) {
      ConfigurationService.instance = new ConfigurationService();
    }
    return ConfigurationService.instance;
  }
  
  /**
   * Reset the singleton instance (for testing)
   */
  public static resetInstance(): void {
    ConfigurationService.instance = new ConfigurationService();
  }
  
  /**
   * Check if configuration should be refreshed from KV
   */
  private shouldRefreshFromKV(): boolean {
    if (!this.config) {
      // No configuration loaded yet, should refresh
      return true;
    }
    
    if (this.lastFetchTimestamp === 0) {
      // Never fetched from KV before, should refresh
      return true;
    }
    
    // Check if TTL has expired
    const elapsed = Date.now() - this.lastFetchTimestamp;
    return elapsed > this.CACHE_TTL_MS;
  }
  
  /**
   * Initialize the configuration service
   * This method is non-blocking for faster cold starts
   */
  public initialize(env: ConfigEnvironment): void {
    const requestContext = getCurrentContext();
    const logger = requestContext ? createLogger(requestContext) : null;
    
    if (logger && requestContext) {
      pinoDebug(requestContext, logger, 'ConfigurationService', 'Initializing configuration service', {
        environment: env.ENVIRONMENT || 'unknown',
        initTimestamp: this.initTimestamp
      });
    }
    
    // Track metrics for initialization
    this.metrics.lastInitTimestamp = Date.now();
    
    // Apply base configuration synchronously for fast startup
    this.applyBaseConfiguration(env);
    
    // Start KV configuration loading in the background
    // This ensures we don't block the cold start, improving performance
    this.kvUpdatePromise = this.loadAndDistributeKVConfiguration(env)
      .then(() => {
        // Update initialization metrics
        this.metrics.initDurationMs = Date.now() - this.metrics.lastInitTimestamp;
        this.metrics.isInitialized = true;
        
        if (logger && requestContext) {
          pinoDebug(requestContext, logger, 'ConfigurationService', 'Configuration service initialized', {
            durationMs: this.metrics.initDurationMs
          });
        }
      })
      .catch(error => {
        if (logger && requestContext) {
          pinoError(requestContext, logger, 'ConfigurationService', 'Error initializing configuration service', {
            error: error instanceof Error ? error.message : String(error)
          });
        }
      });
  }
  
  /**
   * Apply base configuration from the built-in default configuration
   * This is a synchronous operation to ensure we have a basic configuration
   * available immediately without waiting for KV
   */
  private applyBaseConfiguration(env: ConfigEnvironment): void {
    const requestContext = getCurrentContext();
    const logger = requestContext ? createLogger(requestContext) : null;
    
    try {
      // Load base configuration asynchronously but don't block initialization
      loadBaseConfiguration(env)
        .then(baseConfig => {
          if (baseConfig) {
            if (logger && requestContext) {
              pinoDebug(requestContext, logger, 'ConfigurationService', 'Loaded base configuration', {
                version: baseConfig.version
              });
            }
            
            // If we haven't loaded from KV yet, use this configuration
            if (!this.config) {
              this.config = baseConfig;
              this.baseInitComplete = true;
              
              if (logger && requestContext) {
                pinoDebug(requestContext, logger, 'ConfigurationService', 'Applied base configuration', {
                  version: baseConfig.version
                });
              }
            }
          } else {
            if (logger && requestContext) {
              pinoError(requestContext, logger, 'ConfigurationService', 'Failed to load base configuration');
            }
          }
        })
        .catch(error => {
          if (logger && requestContext) {
            pinoError(requestContext, logger, 'ConfigurationService', 'Error loading base configuration', {
              error: error instanceof Error ? error.message : String(error)
            });
          }
        });
    } catch (error) {
      if (logger && requestContext) {
        pinoError(requestContext, logger, 'ConfigurationService', 'Error applying base configuration', {
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
  }
  
  /**
   * Trigger an update from KV storage
   * This can be used to force a refresh of the configuration
   */
  public async triggerKVUpdate(env: ConfigEnvironment): Promise<void> {
    const requestContext = getCurrentContext();
    const logger = requestContext ? createLogger(requestContext) : null;
    
    if (this.isUpdating) {
      if (logger && requestContext) {
        pinoDebug(requestContext, logger, 'ConfigurationService', 'KV update already in progress, skipping');
      }
      return;
    }
    
    this.isUpdating = true;
    
    try {
      if (logger && requestContext) {
        pinoDebug(requestContext, logger, 'ConfigurationService', 'Triggering KV configuration update');
      }
      
      await this.loadAndDistributeKVConfiguration(env);
      
      if (logger && requestContext) {
        pinoDebug(requestContext, logger, 'ConfigurationService', 'KV configuration updated successfully');
      }
    } catch (error) {
      if (logger && requestContext) {
        pinoError(requestContext, logger, 'ConfigurationService', 'Error updating KV configuration', {
          error: error instanceof Error ? error.message : String(error)
        });
      }
    } finally {
      this.isUpdating = false;
    }
  }
  
  /**
   * Load configuration from KV and distribute to other services
   */
  private async loadAndDistributeKVConfiguration(env: ConfigEnvironment): Promise<void> {
    const requestContext = getCurrentContext();
    const logger = requestContext ? createLogger(requestContext) : null;
    
    // Check if we should refresh from KV
    if (!this.shouldRefreshFromKV()) {
      if (logger && requestContext) {
        pinoDebug(requestContext, logger, 'ConfigurationService', 'Configuration is still fresh, skipping KV fetch', {
          timeSinceLastFetchMs: Date.now() - this.lastFetchTimestamp,
          ttlMs: this.CACHE_TTL_MS
        });
      }
      return;
    }
    
    if (logger && requestContext) {
      pinoDebug(requestContext, logger, 'ConfigurationService', 'Loading configuration from KV');
    }
    
    try {
      // Attempt to load from KV
      const kvConfig = await getFromKVWithCache(env, this.memoryCache, this.metrics);
      
      // Update last fetch timestamp
      this.lastFetchTimestamp = Date.now();
      
      if (!kvConfig) {
        if (logger && requestContext) {
          pinoDebug(requestContext, logger, 'ConfigurationService', 'No configuration found in KV, using base configuration');
        }
        return;
      }
      
      // Update our configuration
      this.config = kvConfig;
      
      // Distribute the configuration to other services
      await this.distributeConfiguration(kvConfig);
      
      if (logger && requestContext) {
        pinoDebug(requestContext, logger, 'ConfigurationService', 'Configuration loaded and distributed', {
          version: kvConfig.version,
          lastUpdated: kvConfig.lastUpdated
        });
      }
    } catch (error) {
      if (logger && requestContext) {
        pinoError(requestContext, logger, 'ConfigurationService', 'Error loading configuration from KV', {
          error: error instanceof Error ? error.message : String(error)
        });
      }
      throw error;
    }
  }
  
  /**
   * Distribute configuration to other services
   * This method is responsible for any specific distribution logic
   */
  private async distributeConfiguration(config: WorkerConfiguration): Promise<void> {
    const requestContext = getCurrentContext();
    const logger = requestContext ? createLogger(requestContext) : null;
    
    try {
      // Import other configuration managers that need updates
      const { VideoConfigurationManager } = await import('../../config/VideoConfigurationManager');
      const { CacheConfigurationManager } = await import('../../config/CacheConfigurationManager');
      const { LoggingConfigurationManager } = await import('../../config/LoggingConfigurationManager');
      const { DebugConfigurationManager } = await import('../../config/DebugConfigurationManager');
      
      // Update video configuration
      try {
        VideoConfigurationManager.getInstance().updateConfig(config.video);
      } catch (videoError) {
        if (logger && requestContext) {
          pinoError(requestContext, logger, 'ConfigurationService', 'Error updating video configuration', {
            error: videoError instanceof Error ? videoError.message : String(videoError)
          });
        }
        this.metrics.distributionErrorCount = (this.metrics.distributionErrorCount as number) + 1;
      }
      
      // Update cache configuration
      try {
        CacheConfigurationManager.getInstance().updateConfig(config.cache);
      } catch (cacheError) {
        if (logger && requestContext) {
          pinoError(requestContext, logger, 'ConfigurationService', 'Error updating cache configuration', {
            error: cacheError instanceof Error ? cacheError.message : String(cacheError)
          });
        }
        this.metrics.distributionErrorCount = (this.metrics.distributionErrorCount as number) + 1;
      }
      
      // Update logging configuration
      try {
        LoggingConfigurationManager.getInstance().updateConfig(config.logging);
      } catch (loggingError) {
        if (logger && requestContext) {
          pinoError(requestContext, logger, 'ConfigurationService', 'Error updating logging configuration', {
            error: loggingError instanceof Error ? loggingError.message : String(loggingError)
          });
        }
        this.metrics.distributionErrorCount = (this.metrics.distributionErrorCount as number) + 1;
      }
      
      // Update debug configuration
      try {
        DebugConfigurationManager.getInstance().updateConfig(config.debug);
      } catch (debugError) {
        if (logger && requestContext) {
          pinoError(requestContext, logger, 'ConfigurationService', 'Error updating debug configuration', {
            error: debugError instanceof Error ? debugError.message : String(debugError)
          });
        }
        this.metrics.distributionErrorCount = (this.metrics.distributionErrorCount as number) + 1;
      }
      
      // Update metrics
      this.metrics.configDistributionCount = (this.metrics.configDistributionCount as number) + 1;
      
      if (logger && requestContext) {
        pinoDebug(requestContext, logger, 'ConfigurationService', 'Configuration distributed to all services', {
          version: config.version
        });
      }
    } catch (error) {
      if (logger && requestContext) {
        pinoError(requestContext, logger, 'ConfigurationService', 'Error distributing configuration', {
          error: error instanceof Error ? error.message : String(error)
        });
      }
      this.metrics.distributionErrorCount = (this.metrics.distributionErrorCount as number) + 1;
      throw error;
    }
  }
  
  /**
   * Load configuration with error handling
   * This is a wrapper for loadAndDistributeKVConfiguration with error handling
   */
  public loadConfiguration = withErrorHandling<
    [ConfigEnvironment],
    WorkerConfiguration | null
  >(
    async (env: ConfigEnvironment): Promise<WorkerConfiguration | null> => {
      if (this.kvUpdatePromise) {
        // Wait for any pending updates to complete
        await this.kvUpdatePromise;
      }
      
      // Trigger a KV update if needed
      await this.loadAndDistributeKVConfiguration(env);
      
      return this.config;
    },
    {
      functionName: 'loadConfiguration',
      component: 'ConfigurationService',
      logErrors: true
    }
  );
  
  /**
   * Store configuration to KV with error handling
   * This validates and stores the configuration to KV
   */
  public storeConfiguration = withErrorHandling<
    [ConfigEnvironment, Partial<WorkerConfiguration>],
    boolean
  >(
    async (env: ConfigEnvironment, updates: Partial<WorkerConfiguration>): Promise<boolean> => {
      const requestContext = getCurrentContext();
      const logger = requestContext ? createLogger(requestContext) : null;
      
      // Ensure we have a base configuration
      if (!this.config) {
        if (logger && requestContext) {
          pinoError(requestContext, logger, 'ConfigurationService', 'No base configuration available for update');
        }
        
        throw new ConfigurationError('No base configuration available for update');
      }
      
      // Create updated configuration
      const updatedConfig = createUpdatedConfiguration(this.config, updates);
      
      // Validate the updated configuration
      validateConfig(updatedConfig);
      
      if (logger && requestContext) {
        pinoDebug(requestContext, logger, 'ConfigurationService', 'Storing updated configuration', {
          version: updatedConfig.version,
          previousVersion: this.config.version
        });
      }
      
      // Store to KV
      const success = await storeToKV(env, updatedConfig, this.memoryCache, this.metrics);
      
      if (success) {
        // Update local configuration
        this.config = updatedConfig;
        
        // Distribute updated configuration
        await this.distributeConfiguration(updatedConfig);
        
        if (logger && requestContext) {
          pinoDebug(requestContext, logger, 'ConfigurationService', 'Updated configuration stored and distributed', {
            version: updatedConfig.version
          });
        }
      }
      
      return success;
    },
    {
      functionName: 'storeConfiguration',
      component: 'ConfigurationService',
      logErrors: true
    }
  );
  
  /**
   * Get video configuration
   */
  public getVideoConfig = withErrorHandling<
    [],
    any | null
  >(
    (): any | null => {
      return getVideoConfig(this.config);
    },
    {
      functionName: 'getVideoConfig',
      component: 'ConfigurationService',
      logErrors: true
    }
  );
  
  /**
   * Get cache configuration
   */
  public getCacheConfig = withErrorHandling<
    [],
    any | null
  >(
    (): any | null => {
      return getCacheConfig(this.config);
    },
    {
      functionName: 'getCacheConfig',
      component: 'ConfigurationService',
      logErrors: true
    }
  );
  
  /**
   * Get logging configuration
   */
  public getLoggingConfig = withErrorHandling<
    [],
    any | null
  >(
    (): any | null => {
      return getLoggingConfig(this.config);
    },
    {
      functionName: 'getLoggingConfig',
      component: 'ConfigurationService',
      logErrors: true
    }
  );
  
  /**
   * Get debug configuration
   */
  public getDebugConfig = withErrorHandling<
    [],
    any | null
  >(
    (): any | null => {
      return getDebugConfig(this.config);
    },
    {
      functionName: 'getDebugConfig',
      component: 'ConfigurationService',
      logErrors: true
    }
  );
}

/**
 * Get global configuration metrics
 * This is exported as a standalone function for use by monitoring tools
 */
export function getConfigurationMetrics(): Record<string, number | string> {
  return ConfigurationService.getInstance().getPerformanceMetrics();
}
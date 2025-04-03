/**
 * ConfigurationService
 * 
 * Service for managing dynamic worker configuration via KV storage
 * Allows for configuration to be updated without redeploying the worker
 * 
 * Features:
 * - Non-blocking initialization for faster cold starts
 * - Memory caching with TTL to reduce KV operations
 * - Background configuration updates using waitUntil
 * - Performance metrics for monitoring and optimization
 */

import { z } from 'zod';
import { VideoConfigSchema } from '../config/VideoConfigurationManager';
import { CacheConfigSchema } from '../config/CacheConfigurationManager';
import { LoggingConfigSchema } from '../config/LoggingConfigurationManager';
import { DebugConfigSchema } from '../config/DebugConfigurationManager';
import { ConfigurationError } from '../errors';
import { createLogger, debug as pinoDebug, error as pinoError } from '../utils/pinoLogger';
import { getCurrentContext } from '../utils/legacyLoggerAdapter';
import { logErrorWithContext, withErrorHandling, tryOrNull } from '../utils/errorHandlingUtils';

// Configuration version schema
const ConfigVersionSchema = z.object({
  version: z.string(),
  lastUpdated: z.string().datetime(),
});

// Complete worker configuration schema
export const WorkerConfigurationSchema = z.object({
  // Version info
  ...ConfigVersionSchema.shape,
  
  // Config sections
  video: VideoConfigSchema,
  cache: CacheConfigSchema,
  logging: LoggingConfigSchema,
  debug: DebugConfigSchema,
});

// Export type for configuration
export type WorkerConfiguration = z.infer<typeof WorkerConfigurationSchema>;

/**
 * Helper for logging debug messages
 */
function logDebug(message: string, data?: Record<string, unknown>): void {
  const requestContext = getCurrentContext();
  if (requestContext) {
    const logger = createLogger(requestContext);
    pinoDebug(requestContext, logger, 'ConfigurationService', message, data);
  } else {
    console.debug(`ConfigurationService: ${message}`, data || {});
  }
}

/**
 * Configuration Service class for dynamic worker configuration
 * 
 * Features:
 * - Fast, non-blocking initialization
 * - Memory caching for KV data
 * - Background configuration updates
 * - Performance metrics tracking
 * - Centralized configuration access
 */
export class ConfigurationService {
  /**
   * Get performance metrics for monitoring and diagnostics
   * @returns Object containing performance metrics
   */
  public getPerformanceMetrics(): Record<string, number | string> {
    const now = Date.now();
    const uptime = now - this.initTimestamp;
    const cacheHitRatio = this.metrics.cacheHits / 
      (this.metrics.cacheHits + this.metrics.cacheMisses || 1);
    
    return {
      // Basic metrics
      uptime: uptime,
      coldStartTimeMs: this.metrics.coldStartTime,
      
      // KV operation metrics
      kvFetchCount: this.metrics.kvFetchCount,
      kvFetchTotalTimeMs: this.metrics.kvFetchTotalTime,
      kvFetchErrorCount: this.metrics.kvFetchErrors,
      lastKVFetchDurationMs: this.metrics.lastKVFetchDuration,
      averageKVFetchDurationMs: this.metrics.averageKVFetchDuration,
      
      // Cache metrics
      cacheHits: this.metrics.cacheHits,
      cacheMisses: this.metrics.cacheMisses,
      cacheHitRatio: cacheHitRatio.toString(),
      
      // Update metrics
      configUpdateCount: this.metrics.configUpdateCount,
      backgroundUpdateCount: this.metrics.backgroundUpdates,
      lastUpdateTimestamp: this.metrics.lastUpdateTime.toString(),
      lastUpdateDurationMs: this.metrics.lastUpdateDuration,
      timeSinceLastUpdateMs: this.metrics.lastUpdateTime ? 
        (now - this.metrics.lastUpdateTime).toString() : "-1",
      
      // Status metrics
      isInitialized: this.baseInitComplete ? "true" : "false",
      isUpdating: this.isUpdating ? "true" : "false",
      hasConfiguration: this.config ? "true" : "false",
      configVersion: this.config?.version || 'unknown',
      configLastUpdated: this.config?.lastUpdated || 'unknown',
    };
  }
  private static instance: ConfigurationService;
  private config: WorkerConfiguration | null = null;
  private lastFetchTimestamp: number = 0;
  private readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes memory cache
  private readonly CONFIG_KEY = 'worker-config';
  private memoryCache = new Map<string, {data: any, timestamp: number}>();
  private baseInitComplete = false;
  private kvUpdatePromise: Promise<void> | null = null;
  private isUpdating = false;
  private initTimestamp: number = Date.now();
  
  // Performance metrics
  private metrics = {
    coldStartTime: 0,
    kvFetchCount: 0,
    kvFetchTotalTime: 0,
    kvFetchErrors: 0,
    configUpdateCount: 0,
    lastKVFetchDuration: 0,
    cacheHits: 0,
    cacheMisses: 0,
    backgroundUpdates: 0,
    lastUpdateTime: 0,
    lastUpdateDuration: 0,
    averageKVFetchDuration: 0
  };
  
  /**
   * Private constructor to enforce singleton pattern
   */
  private constructor() {}
  
  /**
   * Get singleton instance
   */
  public static getInstance(): ConfigurationService {
    if (!ConfigurationService.instance) {
      ConfigurationService.instance = new ConfigurationService();
    }
    return ConfigurationService.instance;
  }
  
  /**
   * Reset the instance (useful for testing)
   */
  public static resetInstance(): void {
    ConfigurationService.instance = undefined as unknown as ConfigurationService;
  }
  
  /**
   * Check if configuration needs to be refreshed from KV
   */
  private shouldRefreshFromKV(): boolean {
    const now = Date.now();
    return !this.config || (now - this.lastFetchTimestamp) > this.CACHE_TTL_MS;
  }
  
  /**
   * Fast initialization with immediate defaults + wrangler config
   * This method initializes configuration without blocking on KV operations
   * 
   * @param env Environment with KV bindings
   */
  public initialize(env: { VIDEO_CONFIGURATION_STORE?: KVNamespace; ENVIRONMENT?: string }): void {
    if (this.baseInitComplete) return;
    
    const startTime = performance.now();
    
    try {
      // Mark as initialized immediately to prevent multiple initializations
      this.baseInitComplete = true;
      
      // Apply immediate configuration from environment and defaults
      // This happens asynchronously but we don't need to wait for it
      this.applyBaseConfiguration(env);
      
      // Record cold start metrics
      this.metrics.coldStartTime = performance.now() - startTime;
      
      logDebug('Fast initialization complete', {
        coldStartTimeMs: this.metrics.coldStartTime.toFixed(2),
        environment: env.ENVIRONMENT || 'unknown',
        hasKvBinding: !!env.VIDEO_CONFIGURATION_STORE
      });
      
      // Trigger async KV loading without blocking
      // Use setTimeout to ensure this runs after the current execution context
      setTimeout(() => {
        this.triggerKVUpdate(env).catch(error => {
          logErrorWithContext(
            'Background configuration update failed',
            error,
            { environment: env.ENVIRONMENT || 'unknown' },
            'ConfigurationService'
          );
        });
      }, 0);
    } catch (error) {
      // Log but don't fail - we'll continue with default configuration
      logErrorWithContext(
        'Error during fast initialization',
        error,
        { environment: env.ENVIRONMENT || 'unknown' },
        'ConfigurationService'
      );
    }
  }
  
  /**
   * Apply base configuration from environment and defaults
   * This is the immediate configuration applied during fast initialization
   * 
   * @param env Environment with potential configuration overrides
   */
  private applyBaseConfiguration(env: { ENVIRONMENT?: string }): void {
    logDebug('Applying base configuration', {
      environment: env.ENVIRONMENT || 'unknown',
      timestamp: new Date().toISOString()
    });
    
    // Import dynamically to avoid circular dependencies
    import('../config').then(({ 
      initializeConfiguration, 
      ConfigProvider,
      VideoConfigurationManager,
      CacheConfigurationManager,
      LoggingConfigurationManager,
      DebugConfigurationManager 
    }) => {
      // Initialize the configuration system with environment variables
      const config = initializeConfiguration(env);
      
      logDebug('Base configuration applied', {
        hasVideoConfig: !!config.videoConfig,
        hasCacheConfig: !!config.cacheConfig,
        hasLoggingConfig: !!config.loggingConfig,
        hasDebugConfig: !!config.debugConfig
      });
      
      // Log critical configuration values to help debug duration issues
      const videoConfig = VideoConfigurationManager.getInstance();
      const defaults = videoConfig.getDefaults();
      
      logDebug('Video configuration initialized with defaults', {
        width: defaults.width,
        height: defaults.height,
        fit: defaults.fit,
        audio: defaults.audio,
        duration: defaults.duration,
        quality: defaults.quality,
        compression: defaults.compression
      });
      
      // Check if duration is properly set - important for video transformation limits
      if (defaults.duration) {
        logDebug('Duration limit found in config', {
          duration: defaults.duration
        });
      } else {
        logDebug('No duration limit found in default config', {
          duration: 'not set'
        });
      }
      
    }).catch(error => {
      logErrorWithContext(
        'Error during base configuration initialization',
        error,
        { environment: env.ENVIRONMENT || 'unknown' },
        'ConfigurationService'
      );
    });
  }
  
  /**
   * Non-blocking KV update trigger
   * Starts a background update process if one is not already running
   * 
   * @param env Environment with KV bindings
   * @returns Promise that resolves when update is complete
   */
  public async triggerKVUpdate(env: { VIDEO_CONFIGURATION_STORE?: KVNamespace; ENVIRONMENT?: string }): Promise<void> {
    // If already updating, return existing promise
    if (this.isUpdating && this.kvUpdatePromise) {
      return this.kvUpdatePromise;
    }
    
    // Set updating flag and create new promise
    this.isUpdating = true;
    this.kvUpdatePromise = this.loadAndDistributeKVConfiguration(env)
      .finally(() => {
        this.isUpdating = false;
        this.kvUpdatePromise = null;
        this.lastFetchTimestamp = Date.now();
        this.metrics.backgroundUpdates++;
      });
      
    return this.kvUpdatePromise;
  }
  
  /**
   * Memory-cached KV access with metrics tracking
   * Gets data from KV with an in-memory cache layer to reduce KV operations
   * 
   * @param env Environment with KV bindings
   * @param key Key to fetch from KV
   * @param ttl Time-to-live for cache entry in milliseconds (default: 5 minutes)
   * @returns The data from KV or cache, or null if not found or on error
   */
  private async getFromKVWithCache(
    env: { VIDEO_CONFIGURATION_STORE?: KVNamespace },
    key: string,
    ttl: number = this.CACHE_TTL_MS
  ): Promise<any> {
    if (!env.VIDEO_CONFIGURATION_STORE) {
      logErrorWithContext(
        'No VIDEO_CONFIGURATION_STORE KV namespace binding found for cached operation',
        new ConfigurationError('Missing KV namespace binding'),
        { key },
        'ConfigurationService'
      );
      return null;
    }
    
    const cacheKey = `kv:${key}`;
    const now = Date.now();
    const cached = this.memoryCache.get(cacheKey);
    
    // Return from cache if valid
    if (cached && (now - cached.timestamp < ttl)) {
      this.metrics.cacheHits++;
      
      logDebug('Using cached KV data', {
        key,
        cacheAge: `${((now - cached.timestamp) / 1000).toFixed(1)}s`,
        ttl: `${(ttl / 1000).toFixed(0)}s`,
        cacheHits: this.metrics.cacheHits,
        cacheMisses: this.metrics.cacheMisses
      });
      
      return cached.data;
    }
    
    // Cache miss - fetch from KV with metrics
    this.metrics.cacheMisses++;
    this.metrics.kvFetchCount++;
    
    const fetchStartTime = performance.now();
    
    try {
      // Use a wrapped KV fetch operation to handle errors properly
      const fetchConfigFromKV = withErrorHandling<
        [KVNamespace, string],
        Promise<string | null>
      >(
        async (store, k) => await store.get(k),
        {
          functionName: 'fetchFromKVCache',
          component: 'ConfigurationService',
          logErrors: true
        },
        { key }
      );
      
      // Fetch from KV
      const kvData = await fetchConfigFromKV(env.VIDEO_CONFIGURATION_STORE, key);
      
      // Calculate and record fetch duration
      const fetchDuration = performance.now() - fetchStartTime;
      this.metrics.kvFetchTotalTime += fetchDuration;
      this.metrics.lastKVFetchDuration = fetchDuration;
      
      logDebug('KV fetch operation completed', {
        key,
        durationMs: fetchDuration.toFixed(2),
        found: !!kvData,
        dataSize: kvData?.length || 0
      });
      
      // Try to parse JSON if data exists
      let parsedData = null;
      
      if (kvData) {
        try {
          parsedData = JSON.parse(kvData);
          
          // Update cache with parsed data
          this.memoryCache.set(cacheKey, {
            data: parsedData,
            timestamp: now
          });
          
          logDebug('Cached KV data in memory', {
            key,
            dataSize: kvData.length,
            cacheTtl: `${(ttl / 1000).toFixed(0)}s`
          });
        } catch (parseError) {
          logErrorWithContext(
            'Error parsing KV data as JSON',
            parseError,
            { key, dataSize: kvData.length },
            'ConfigurationService'
          );
          
          // Don't cache parse errors
          return null;
        }
      }
      
      return parsedData;
    } catch (error) {
      this.metrics.kvFetchErrors++;
      
      logErrorWithContext(
        `Failed to fetch ${key} from KV with cache`,
        error,
        { key },
        'ConfigurationService'
      );
      
      return null;
    }
  }
  
  /**
   * Load and distribute KV configuration to all managers
   * This is the core function for background configuration updates
   * 
   * @param env Environment with KV bindings
   */
  private async loadAndDistributeKVConfiguration(env: { VIDEO_CONFIGURATION_STORE?: KVNamespace; ENVIRONMENT?: string }): Promise<void> {
    try {
      const startTime = performance.now();
      logDebug('Starting background KV configuration update');
      
      // Get configuration from KV with caching
      const kvConfig = await this.getFromKVWithCache(env, this.CONFIG_KEY);
      
      if (kvConfig) {
        // Validate configuration
        try {
          const validatedConfig = WorkerConfigurationSchema.parse(kvConfig);
          
          // Store in instance state
          this.config = validatedConfig;
          
          // Update all configuration managers
          await this.distributeConfiguration(validatedConfig)
          
          // Update metrics
          this.metrics.configUpdateCount++;
          this.metrics.lastUpdateTime = Date.now();
          this.metrics.lastUpdateDuration = performance.now() - startTime;
          
          // Update average KV fetch duration
          if (this.metrics.kvFetchCount > 0) {
            this.metrics.averageKVFetchDuration = this.metrics.kvFetchTotalTime / this.metrics.kvFetchCount;
          }
          
          logDebug('Successfully updated configuration from KV', {
            version: validatedConfig.version,
            lastUpdated: validatedConfig.lastUpdated,
            updateCount: this.metrics.configUpdateCount,
            durationMs: this.metrics.lastUpdateDuration.toFixed(2),
            cacheHits: this.metrics.cacheHits,
            cacheMisses: this.metrics.cacheMisses
          });
        } catch (validationError) {
          logErrorWithContext(
            'Invalid configuration from KV',
            validationError,
            { configVersion: kvConfig.version || 'unknown' },
            'ConfigurationService'
          );
        }
      } else {
        logDebug('No configuration found in KV during background update');
      }
    } catch (error) {
      logErrorWithContext(
        'Failed to load and distribute KV configuration',
        error,
        {},
        'ConfigurationService'
      );
    }
  }
  
  /**
   * Distribute configuration to individual managers
   * 
   * @param config Worker configuration to distribute
   */
  private async distributeConfiguration(config: WorkerConfiguration): Promise<void> {
    try {
      // Dynamic imports to avoid circular dependencies
      const { 
        VideoConfigurationManager,
        CacheConfigurationManager,
        LoggingConfigurationManager,
        DebugConfigurationManager
      } = await import('../config');
      
      // Update video configuration manager
      if (config.video) {
        try {
          // Use the dedicated function for updating from KV to ensure proper logging
          const { updateVideoConfigFromKV } = await import('../config/VideoConfigurationManager');
          updateVideoConfigFromKV(config.video);
        } catch (error) {
          // Log error but don't fail the overall process
          logErrorWithContext(
            'Error updating video configuration',
            error,
            { component: 'VideoConfigurationManager' },
            'ConfigurationService'
          );
        }
      }
      
      // Update cache configuration manager
      if (config.cache) {
        const cacheManager = CacheConfigurationManager.getInstance();
        cacheManager.updateConfig(config.cache);
      }
      
      // Update logging configuration manager
      if (config.logging) {
        const loggingManager = LoggingConfigurationManager.getInstance();
        loggingManager.updateConfig(config.logging);
      }
      
      // Update debug configuration manager
      if (config.debug) {
        const debugManager = DebugConfigurationManager.getInstance();
        debugManager.updateConfig(config.debug);
      }
      
      // Set duration limits from configuration
      this.setDurationLimitsFromConfig(config);
      
      logDebug('Configuration distributed to all managers', {
        version: config.version,
        hasVideoConfig: !!config.video,
        hasCacheConfig: !!config.cache,
        hasLoggingConfig: !!config.logging,
        hasDebugConfig: !!config.debug
      });
    } catch (error) {
      logErrorWithContext(
        'Error distributing configuration to managers',
        error,
        { configVersion: config.version || 'unknown' },
        'ConfigurationService'
      );
    }
  }
  
  /**
   * Load configuration from KV store or memory cache
   * Optimized version that uses memory caching and prefetching
   * 
   * @param env Environment with KV bindings
   * @returns The loaded configuration
   */
  public loadConfiguration = withErrorHandling<
    [{
      VIDEO_CONFIGURATION_STORE?: KVNamespace;
      ENVIRONMENT?: string;
    }],
    Promise<WorkerConfiguration | null>
  >(
    async function loadConfigurationImpl(env: {
      VIDEO_CONFIGURATION_STORE?: KVNamespace;
      ENVIRONMENT?: string;
    }): Promise<WorkerConfiguration | null> {
      const startTime = performance.now();
      const requestContext = getCurrentContext();
      const self = ConfigurationService.getInstance(); // Get instance
      
      // Initialize if not already done
      if (!self.baseInitComplete) {
        self.initialize(env);
      }
      
      logDebug('Starting configuration load process', {
        hasContext: !!requestContext,
        timestamp: new Date().toISOString(),
        cacheStatus: self.config ? 'available' : 'empty'
      });
      
      // Check if we need to refresh from KV
      if (!self.shouldRefreshFromKV()) {
        const cacheAge = (Date.now() - self.lastFetchTimestamp) / 1000;
        logDebug('Using cached configuration', { 
          cacheAge: `${cacheAge.toFixed(2)}s`,
          cacheTtl: `${(self.CACHE_TTL_MS / 1000).toFixed(0)}s`,
          configVersion: self.config?.version,
          lastUpdated: self.config?.lastUpdated
        });
        return self.config;
      }
      
      // Check if KV namespace exists
      if (!env.VIDEO_CONFIGURATION_STORE) {
        logErrorWithContext('No VIDEO_CONFIGURATION_STORE KV namespace binding found', 
          new ConfigurationError('Missing KV namespace binding'),
          {
            environment: env.ENVIRONMENT || 'unknown'
          },
          'ConfigurationService'
        );
        return null;
      }
      
      // Load from KV using cached access
      logDebug('Fetching configuration from KV with caching', {
        key: self.CONFIG_KEY,
        environment: env.ENVIRONMENT || 'unknown'
      });
      
      // Get configuration from KV with caching
      const kvStartTime = performance.now();
      const kvConfig = await self.getFromKVWithCache(env, self.CONFIG_KEY);
      const kvDuration = performance.now() - kvStartTime;
      
      if (!kvConfig) {
        logDebug('No configuration found in KV store', {
          key: self.CONFIG_KEY,
          environment: env.ENVIRONMENT || 'unknown'
        });
        return null;
      }
      
      try {
        // Validation happens in getFromKVWithCache already
        self.config = kvConfig as WorkerConfiguration;
        
        // Update timestamp if not already set by getFromKVWithCache
        if (self.lastFetchTimestamp === 0) {
          self.lastFetchTimestamp = Date.now();
        }
        
        const totalDuration = performance.now() - startTime;
        
        // Extract important duration settings for monitoring the issue
        const defaultDuration = self.config.video?.defaults?.duration || 'not set';
        const derivativeDurations = Object.entries(self.config.video?.derivatives || {}).reduce(
          (acc, [name, config]) => {
            acc[name] = config.duration || 'not set';
            return acc;
          },
          {} as Record<string, string | null>
        );
        
        logDebug('Successfully loaded configuration from KV', {
          version: self.config.version,
          lastUpdated: self.config.lastUpdated,
          kvFetchTimeMs: kvDuration.toFixed(2),
          totalDurationMs: totalDuration.toFixed(2),
          videoDerivativesCount: Object.keys(self.config.video?.derivatives || {}).length,
          hasCacheConfig: !!self.config.cache,
          hasLoggingConfig: !!self.config.logging,
          defaultDuration,
          derivativeDurations
        });
        
        // Set duration limits from configuration if available
        self.setDurationLimitsFromConfig(self.config);
        
        // Trigger background distribution to managers if not already distributed
        if (requestContext && requestContext.executionContext) {
          requestContext.executionContext.waitUntil(self.distributeConfiguration(self.config));
        } else {
          // No execution context available, run synchronously
          await self.distributeConfiguration(self.config);
        }
        
        return self.config;
      } catch (error) {
        // Handle validation errors specifically - the error will already be logged by the wrapper
        if (error instanceof z.ZodError) {
          // Log each issue to help debugging
          error.errors.forEach((issue, index) => {
            logErrorWithContext(`Validation error #${index + 1}`, error, {
              path: issue.path.join('.'),
              message: issue.message,
              code: issue.code
            }, 'ConfigurationService');
          });
        } else {
          logErrorWithContext('Error processing KV configuration', error, {
            configVersion: kvConfig.version || 'unknown'
          }, 'ConfigurationService');
        }
        
        // Always return null on failure
        return null;
      }
    },
    {
      functionName: 'loadConfiguration',
      component: 'ConfigurationService',
      logErrors: true
    }
  );
  
  /**
   * Store configuration in KV
   * 
   * @param env Environment with KV bindings
   * @param config Configuration to store
   * @returns Success boolean
   */
  public storeConfiguration = withErrorHandling<
    [{ VIDEO_CONFIGURATION_STORE?: KVNamespace; ENVIRONMENT?: string }, WorkerConfiguration],
    Promise<boolean>
  >(
    async function storeConfigurationImpl(
      env: { VIDEO_CONFIGURATION_STORE?: KVNamespace; ENVIRONMENT?: string },
      config: WorkerConfiguration
    ): Promise<boolean> {
      const startTime = Date.now();
      const requestContext = getCurrentContext();
      const self = ConfigurationService.getInstance(); // Get instance
      
      logDebug('Beginning configuration storage process', {
        hasContext: !!requestContext,
        configVersion: config?.version,
        timestamp: new Date().toISOString()
      });
      
      // Check if KV namespace exists
      if (!env.VIDEO_CONFIGURATION_STORE) {
        logErrorWithContext('No VIDEO_CONFIGURATION_STORE KV namespace binding found',
          new ConfigurationError('Missing KV namespace binding'),
          {
            environment: env.ENVIRONMENT || 'unknown'
          },
          'ConfigurationService'
        );
        return false;
      }
      
      // Validate the configuration with error handling
      const validateConfig = withErrorHandling<
        [WorkerConfiguration],
        void
      >(
        function validateConfigImpl(configToValidate: WorkerConfiguration): void {
          logDebug('Validating configuration against schema');
          
          // Calculate size for debugging
          const configSize = JSON.stringify(configToValidate).length;
          logDebug('Configuration size metrics', {
            totalSizeBytes: configSize,
            videoConfigCount: Object.keys(configToValidate.video?.derivatives || {}).length,
            cacheConfigPresent: !!configToValidate.cache,
            loggingConfigPresent: !!configToValidate.logging,
            debugConfigPresent: !!configToValidate.debug,
            storageConfigPresent: !!(configToValidate as any).storage
          });
          
          // Validate against schema
          WorkerConfigurationSchema.parse(configToValidate);
          logDebug('Configuration validation successful');
        },
        {
          functionName: 'validateConfig',
          component: 'ConfigurationService',
          logErrors: true
        },
        {
          configVersion: config.version || 'unknown'
        }
      );
      
      try {
        // Run validation
        await validateConfig(config);
        
        // Make a copy of the config to avoid modifying the input
        const configToStore = { ...config };
        
        // Add lastUpdated timestamp if not present
        if (!configToStore.lastUpdated) {
          configToStore.lastUpdated = new Date().toISOString();
          logDebug('Added lastUpdated timestamp', {
            timestamp: configToStore.lastUpdated
          });
        }
        
        // Wrap the KV storage operation with error handling
        const storeInKV = withErrorHandling<
          [KVNamespace, string, string, { expirationTtl: number }],
          Promise<void>
        >(
          async (store, key, data, options) => {
            await store.put(key, data, options);
          },
          {
            functionName: 'storeInKV',
            component: 'ConfigurationService',
            logErrors: true
          },
          {
            key: self.CONFIG_KEY,
            configVersion: configToStore.version,
            expirationDays: 30
          }
        );
        
        // Store in KV
        logDebug('Storing configuration in KV', {
          key: self.CONFIG_KEY,
          expirationDays: 30
        });
        
        const kvStartTime = Date.now();
        await storeInKV(
          env.VIDEO_CONFIGURATION_STORE,
          self.CONFIG_KEY,
          JSON.stringify(configToStore),
          { expirationTtl: 86400 * 30 } // 30 days
        );
        const kvDuration = Date.now() - kvStartTime;
        
        logDebug('KV storage operation completed', {
          durationMs: kvDuration
        });
        
        // Update in-memory cache
        self.config = configToStore;
        self.lastFetchTimestamp = Date.now();
        
        const totalDuration = Date.now() - startTime;
        logDebug('Successfully stored configuration in KV', {
          version: configToStore.version,
          lastUpdated: configToStore.lastUpdated,
          totalDurationMs: totalDuration,
          kvOperationMs: kvDuration
        });
        
        return true;
      } catch (error) {
        // Error will already be logged by the error handling wrappers
        return false;
      }
    },
    {
      functionName: 'storeConfiguration',
      component: 'ConfigurationService',
      logErrors: true
    }
  );
  
  /**
   * Get video configuration section
   * 
   * @param env Environment with KV bindings
   * @returns Video configuration
   */
  public getVideoConfig = withErrorHandling<
    [{ VIDEO_CONFIGURATION_STORE?: KVNamespace; ENVIRONMENT?: string }],
    Promise<typeof VideoConfigSchema._type | null>
  >(
    async function getVideoConfigImpl(env: { VIDEO_CONFIGURATION_STORE?: KVNamespace; ENVIRONMENT?: string }): Promise<typeof VideoConfigSchema._type | null> {
      const self = ConfigurationService.getInstance();
      const config = await self.loadConfiguration(env);
      return config?.video || null;
    },
    {
      functionName: 'getVideoConfig',
      component: 'ConfigurationService',
      logErrors: true
    }
  );
  
  /**
   * Get cache configuration section
   * 
   * @param env Environment with KV bindings
   * @returns Cache configuration
   */
  public getCacheConfig = withErrorHandling<
    [{ VIDEO_CONFIGURATION_STORE?: KVNamespace; ENVIRONMENT?: string }],
    Promise<typeof CacheConfigSchema._type | null>
  >(
    async function getCacheConfigImpl(env: { VIDEO_CONFIGURATION_STORE?: KVNamespace; ENVIRONMENT?: string }): Promise<typeof CacheConfigSchema._type | null> {
      const self = ConfigurationService.getInstance();
      const config = await self.loadConfiguration(env);
      return config?.cache || null;
    },
    {
      functionName: 'getCacheConfig',
      component: 'ConfigurationService',
      logErrors: true
    }
  );
  
  /**
   * Get logging configuration section
   * 
   * @param env Environment with KV bindings
   * @returns Logging configuration
   */
  public getLoggingConfig = withErrorHandling<
    [{ VIDEO_CONFIGURATION_STORE?: KVNamespace; ENVIRONMENT?: string }],
    Promise<typeof LoggingConfigSchema._type | null>
  >(
    async function getLoggingConfigImpl(env: { VIDEO_CONFIGURATION_STORE?: KVNamespace; ENVIRONMENT?: string }): Promise<typeof LoggingConfigSchema._type | null> {
      const self = ConfigurationService.getInstance();
      const config = await self.loadConfiguration(env);
      return config?.logging || null;
    },
    {
      functionName: 'getLoggingConfig',
      component: 'ConfigurationService',
      logErrors: true
    }
  );
  
  /**
   * Get debug configuration section
   * 
   * @param env Environment with KV bindings
   * @returns Debug configuration
   */
  public getDebugConfig = withErrorHandling<
    [{ VIDEO_CONFIGURATION_STORE?: KVNamespace; ENVIRONMENT?: string }],
    Promise<typeof DebugConfigSchema._type | null>
  >(
    async function getDebugConfigImpl(env: { VIDEO_CONFIGURATION_STORE?: KVNamespace; ENVIRONMENT?: string }): Promise<typeof DebugConfigSchema._type | null> {
      const self = ConfigurationService.getInstance();
      const config = await self.loadConfiguration(env);
      return config?.debug || null;
    },
    {
      functionName: 'getDebugConfig',
      component: 'ConfigurationService',
      logErrors: true
    }
  );
  
  /**
   * Extract and set duration limits from configuration
   * 
   * @param config The loaded configuration
   */
  private setDurationLimitsFromConfig = tryOrNull<
    [WorkerConfiguration | null],
    void
  >(
    function setDurationLimitsFromConfigImpl(config: WorkerConfiguration | null): void {
      if (!config || !config.video?.defaults?.duration) {
        logDebug('No duration settings found in configuration');
        return;
      }
      
      // Import the transformation utils dynamically to avoid circular dependencies
      import('../utils/transformationUtils').then(({ 
        haveDurationLimits, 
        storeTransformationLimit,
        parseTimeString 
      }) => {
        // If limits are already set, don't overwrite them
        if (haveDurationLimits()) {
          logDebug('Duration limits already set, not overwriting from config');
          return;
        }
        
        // Get default duration from config
        const durationStr = config.video.defaults.duration;
        
        // Parse the duration string to seconds
        // Check for null before parsing
        if (durationStr === null) {
          logDebug('Null duration value in config');
          return;
        }
        
        const seconds = parseTimeString(durationStr);
        
        if (seconds === null) {
          logDebug('Could not parse duration from config', { durationStr });
          return;
        }
        
        // Store the duration limits
        logDebug('Setting duration limits from config', {
          defaultDuration: durationStr,
          parsedSeconds: seconds,
          min: 0,
          max: seconds
        });
        
        storeTransformationLimit('duration', 'min', 0);
        storeTransformationLimit('duration', 'max', seconds);
        
        // Check and log individual derivative durations
        Object.entries(config.video.derivatives || {}).forEach(([name, derivative]) => {
          if (derivative.duration) {
            const derivativeSeconds = parseTimeString(derivative.duration);
            logDebug(`Derivative ${name} duration`, {
              duration: derivative.duration,
              seconds: derivativeSeconds
            });
          }
        });
      }).catch(err => {
        logErrorWithContext('Error importing transformationUtils', err, {
          configVersion: config.version
        }, 'ConfigurationService');
      });
    },
    {
      functionName: 'setDurationLimitsFromConfig',
      component: 'ConfigurationService',
      logErrors: true
    }
  );
}

/**
 * Get performance metrics for the configuration service
 * Used for performance monitoring and diagnostics
 */
export function getConfigurationMetrics(): Record<string, number | string> {
  const instance = ConfigurationService.getInstance();
  return instance.getPerformanceMetrics();
}

// Export default instance for easy access
export default ConfigurationService.getInstance();
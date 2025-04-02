/**
 * ConfigurationService
 * 
 * Service for managing dynamic worker configuration via KV storage
 * Allows for configuration to be updated without redeploying the worker
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
 */
export class ConfigurationService {
  private static instance: ConfigurationService;
  private config: WorkerConfiguration | null = null;
  private lastFetchTimestamp: number = 0;
  private readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes memory cache
  private readonly CONFIG_KEY = 'worker-config';
  
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
   * Load configuration from KV store
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
      const startTime = Date.now();
      const requestContext = getCurrentContext();
      const self = ConfigurationService.getInstance(); // Get instance
      
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
      
      // Load from KV
      logDebug('Fetching configuration from KV store', {
        key: self.CONFIG_KEY,
        environment: env.ENVIRONMENT || 'unknown'
      });
      
      // Use a wrapped KV fetch operation to handle errors properly
      const fetchConfigFromKV = withErrorHandling<
        [KVNamespace, string],
        Promise<string | null>
      >(
        async (store, key) => await store.get(key),
        {
          functionName: 'fetchConfigFromKV',
          component: 'ConfigurationService',
          logErrors: true
        },
        {
          key: self.CONFIG_KEY,
          environment: env.ENVIRONMENT || 'unknown'
        }
      );
      
      const kvStartTime = Date.now();
      const kvConfigRaw = await fetchConfigFromKV(env.VIDEO_CONFIGURATION_STORE, self.CONFIG_KEY);
      const kvDuration = Date.now() - kvStartTime;
      
      logDebug('KV fetch operation completed', {
        durationMs: kvDuration,
        found: !!kvConfigRaw,
        dataSize: kvConfigRaw?.length || 0
      });
      
      if (!kvConfigRaw) {
        logDebug('No configuration found in KV store', {
          key: self.CONFIG_KEY,
          environment: env.ENVIRONMENT || 'unknown'
        });
        return null;
      }
      
      // Use another wrapped function for the parsing and validation step
      const parseAndValidateConfig = withErrorHandling<
        [string],
        WorkerConfiguration
      >(
        function parseAndValidateConfigImpl(rawConfig: string): WorkerConfiguration {
          // Parse JSON
          logDebug('Parsing JSON configuration from KV');
          const parseStartTime = Date.now();
          const kvConfig = JSON.parse(rawConfig);
          const parseTime = Date.now() - parseStartTime;
          
          // Validate schema
          logDebug('Validating configuration schema');
          const validateStartTime = Date.now();
          const config = WorkerConfigurationSchema.parse(kvConfig);
          const validateTime = Date.now() - validateStartTime;
          
          // Log validation success
          logDebug('Configuration validation successful', {
            parseTimeMs: parseTime,
            validateTimeMs: validateTime
          });
          
          return config;
        },
        {
          functionName: 'parseAndValidateConfig',
          component: 'ConfigurationService',
          logErrors: true
        },
        {
          dataSize: kvConfigRaw.length,
          dataSample: kvConfigRaw.substring(0, 100) + '...'
        }
      );
      
      try {
        // Parse and validate the configuration
        self.config = await parseAndValidateConfig(kvConfigRaw);
        self.lastFetchTimestamp = Date.now();
        const totalDuration = Date.now() - startTime;
        
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
          kvFetchTimeMs: kvDuration,
          totalDurationMs: totalDuration,
          videoDerivativesCount: Object.keys(self.config.video?.derivatives || {}).length,
          hasCacheConfig: !!self.config.cache,
          hasLoggingConfig: !!self.config.logging,
          defaultDuration,
          derivativeDurations
        });
        
        // Set duration limits from configuration if available
        self.setDurationLimitsFromConfig(self.config);
        
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
        
        // Add lastUpdated timestamp if not present
        if (!config.lastUpdated) {
          config.lastUpdated = new Date().toISOString();
          logDebug('Added lastUpdated timestamp', {
            timestamp: config.lastUpdated
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
            configVersion: config.version,
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
          JSON.stringify(config),
          { expirationTtl: 86400 * 30 } // 30 days
        );
        const kvDuration = Date.now() - kvStartTime;
        
        logDebug('KV storage operation completed', {
          durationMs: kvDuration
        });
        
        // Update in-memory cache
        self.config = config;
        self.lastFetchTimestamp = Date.now();
        
        const totalDuration = Date.now() - startTime;
        logDebug('Successfully stored configuration in KV', {
          version: config.version,
          lastUpdated: config.lastUpdated,
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

// Export default instance
export default ConfigurationService.getInstance();
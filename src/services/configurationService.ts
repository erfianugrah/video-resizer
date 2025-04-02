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
 * Helper for logging error messages
 */
function logError(message: string, data?: Record<string, unknown>): void {
  const requestContext = getCurrentContext();
  if (requestContext) {
    const logger = createLogger(requestContext);
    pinoError(requestContext, logger, 'ConfigurationService', message, data);
  } else {
    console.error(`ConfigurationService: ${message}`, data || {});
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
  public async loadConfiguration(env: {
    VIDEO_CONFIGURATION_STORE?: KVNamespace;
    ENVIRONMENT?: string;
  }): Promise<WorkerConfiguration | null> {
    try {
      const startTime = Date.now();
      const requestContext = getCurrentContext();
      
      logDebug('Starting configuration load process', {
        hasContext: !!requestContext,
        timestamp: new Date().toISOString(),
        cacheStatus: this.config ? 'available' : 'empty'
      });
      
      // Check if we need to refresh from KV
      if (!this.shouldRefreshFromKV()) {
        const cacheAge = (Date.now() - this.lastFetchTimestamp) / 1000;
        logDebug('Using cached configuration', { 
          cacheAge: `${cacheAge.toFixed(2)}s`,
          cacheTtl: `${(this.CACHE_TTL_MS / 1000).toFixed(0)}s`,
          configVersion: this.config?.version,
          lastUpdated: this.config?.lastUpdated
        });
        return this.config;
      }
      
      // Check if KV namespace exists
      if (!env.VIDEO_CONFIGURATION_STORE) {
        logError('No VIDEO_CONFIGURATION_STORE KV namespace binding found', {
          environment: env.ENVIRONMENT || 'unknown'
        });
        return null;
      }
      
      // Load from KV
      logDebug('Fetching configuration from KV store', {
        key: this.CONFIG_KEY,
        environment: env.ENVIRONMENT || 'unknown'
      });
      
      const kvStartTime = Date.now();
      const kvConfigRaw = await env.VIDEO_CONFIGURATION_STORE.get(this.CONFIG_KEY);
      const kvDuration = Date.now() - kvStartTime;
      
      logDebug('KV fetch operation completed', {
        durationMs: kvDuration,
        found: !!kvConfigRaw,
        dataSize: kvConfigRaw?.length || 0
      });
      
      if (!kvConfigRaw) {
        logDebug('No configuration found in KV store', {
          key: this.CONFIG_KEY,
          environment: env.ENVIRONMENT || 'unknown'
        });
        return null;
      }
      
      try {
        // Parse and validate the configuration
        logDebug('Parsing JSON configuration from KV');
        const parseStartTime = Date.now();
        const kvConfig = JSON.parse(kvConfigRaw);
        const parseTime = Date.now() - parseStartTime;
        
        logDebug('Validating configuration schema');
        const validateStartTime = Date.now();
        this.config = WorkerConfigurationSchema.parse(kvConfig);
        const validateTime = Date.now() - validateStartTime;
        
        this.lastFetchTimestamp = Date.now();
        const totalDuration = Date.now() - startTime;
        
        // Extract important duration settings for monitoring the issue
        const defaultDuration = this.config.video?.defaults?.duration || 'not set';
        const derivativeDurations = Object.entries(this.config.video?.derivatives || {}).reduce(
          (acc, [name, config]) => {
            acc[name] = config.duration || 'not set';
            return acc;
          },
          {} as Record<string, string | null>
        );
        
        logDebug('Successfully loaded configuration from KV', {
          version: this.config.version,
          lastUpdated: this.config.lastUpdated,
          kvFetchTimeMs: kvDuration,
          parseTimeMs: parseTime,
          validateTimeMs: validateTime,
          totalDurationMs: totalDuration,
          videoDerivativesCount: Object.keys(this.config.video?.derivatives || {}).length,
          hasCacheConfig: !!this.config.cache,
          hasLoggingConfig: !!this.config.logging,
          defaultDuration,
          derivativeDurations
        });
        
        // Set duration limits from configuration if available
        this.setDurationLimitsFromConfig(this.config);
        
        return this.config;
      } catch (error) {
        if (error instanceof z.ZodError) {
          const issues = error.errors.map(issue => 
            `${issue.path.join('.')}: ${issue.message}`
          ).join(', ');
          
          logError('Invalid configuration in KV store', { 
            validationErrors: issues,
            totalErrors: error.errors.length,
            environment: env.ENVIRONMENT || 'unknown'
          });
          
          // Log details about each validation error
          error.errors.forEach((issue, index) => {
            logError(`Validation error #${index + 1}`, {
              path: issue.path.join('.'),
              message: issue.message,
              code: issue.code
            });
          });
        } else {
          const errMessage = error instanceof Error ? error.message : String(error);
          logError('Failed to parse configuration from KV', {
            error: errMessage,
            dataSize: kvConfigRaw.length,
            dataSample: kvConfigRaw.substring(0, 100) + '...'
          });
        }
        
        return null;
      }
    } catch (error) {
      const errMessage = error instanceof Error ? error.message : String(error);
      const errStack = error instanceof Error ? error.stack : undefined;
      
      logError('Error loading configuration from KV', {
        error: errMessage,
        stack: errStack,
        timestamp: new Date().toISOString(),
        environment: env.ENVIRONMENT || 'unknown'
      });
      
      return null;
    }
  }
  
  /**
   * Store configuration in KV
   * 
   * @param env Environment with KV bindings
   * @param config Configuration to store
   * @returns Success boolean
   */
  public async storeConfiguration(
    env: { VIDEO_CONFIGURATION_STORE?: KVNamespace; ENVIRONMENT?: string },
    config: WorkerConfiguration
  ): Promise<boolean> {
    try {
      const startTime = Date.now();
      const requestContext = getCurrentContext();
      
      logDebug('Beginning configuration storage process', {
        hasContext: !!requestContext,
        configVersion: config?.version,
        timestamp: new Date().toISOString()
      });
      
      // Check if KV namespace exists
      if (!env.VIDEO_CONFIGURATION_STORE) {
        logError('No VIDEO_CONFIGURATION_STORE KV namespace binding found');
        return false;
      }
      
      // Validate the configuration
      try {
        logDebug('Validating configuration against schema');
        
        // Calculate size for debugging
        const configSize = JSON.stringify(config).length;
        logDebug('Configuration size metrics', {
          totalSizeBytes: configSize,
          videoConfigCount: Object.keys(config.video?.derivatives || {}).length,
          cacheConfigPresent: !!config.cache,
          loggingConfigPresent: !!config.logging,
          debugConfigPresent: !!config.debug,
          storageConfigPresent: !!(config as any).storage
        });
        
        // Validate against schema
        WorkerConfigurationSchema.parse(config);
        logDebug('Configuration validation successful');
      } catch (error) {
        if (error instanceof z.ZodError) {
          const issues = error.errors.map(issue => 
            `${issue.path.join('.')}: ${issue.message}`
          ).join(', ');
          
          logError('Invalid configuration', { 
            validationErrors: issues,
            totalErrors: error.errors.length
          });
          
          // Log details about each validation error
          error.errors.forEach((issue, index) => {
            logError(`Validation error #${index + 1}`, {
              path: issue.path.join('.'),
              message: issue.message,
              code: issue.code
            });
          });
        } else {
          logError('Failed to validate configuration', {
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined
          });
        }
        
        return false;
      }
      
      // Add lastUpdated timestamp if not present
      if (!config.lastUpdated) {
        config.lastUpdated = new Date().toISOString();
        logDebug('Added lastUpdated timestamp', {
          timestamp: config.lastUpdated
        });
      }
      
      // Store in KV
      logDebug('Storing configuration in KV', {
        key: this.CONFIG_KEY,
        expirationDays: 30
      });
      
      const kvStartTime = Date.now();
      await env.VIDEO_CONFIGURATION_STORE.put(
        this.CONFIG_KEY, 
        JSON.stringify(config),
        { expirationTtl: 86400 * 30 } // 30 days
      );
      const kvDuration = Date.now() - kvStartTime;
      
      logDebug('KV storage operation completed', {
        durationMs: kvDuration
      });
      
      // Update in-memory cache
      this.config = config;
      this.lastFetchTimestamp = Date.now();
      
      const totalDuration = Date.now() - startTime;
      logDebug('Successfully stored configuration in KV', {
        version: config.version,
        lastUpdated: config.lastUpdated,
        totalDurationMs: totalDuration,
        kvOperationMs: kvDuration
      });
      
      return true;
    } catch (error) {
      const errMessage = error instanceof Error ? error.message : String(error);
      const errStack = error instanceof Error ? error.stack : undefined;
      
      logError('Error storing configuration in KV', {
        error: errMessage,
        stack: errStack,
        configVersion: config?.version || 'unknown',
        timestamp: new Date().toISOString()
      });
      
      return false;
    }
  }
  
  /**
   * Get video configuration section
   * 
   * @param env Environment with KV bindings
   * @returns Video configuration
   */
  public async getVideoConfig(env: { VIDEO_CONFIGURATION_STORE?: KVNamespace; ENVIRONMENT?: string }) {
    const config = await this.loadConfiguration(env);
    return config?.video || null;
  }
  
  /**
   * Get cache configuration section
   * 
   * @param env Environment with KV bindings
   * @returns Cache configuration
   */
  public async getCacheConfig(env: { VIDEO_CONFIGURATION_STORE?: KVNamespace; ENVIRONMENT?: string }) {
    const config = await this.loadConfiguration(env);
    return config?.cache || null;
  }
  
  /**
   * Get logging configuration section
   * 
   * @param env Environment with KV bindings
   * @returns Logging configuration
   */
  public async getLoggingConfig(env: { VIDEO_CONFIGURATION_STORE?: KVNamespace; ENVIRONMENT?: string }) {
    const config = await this.loadConfiguration(env);
    return config?.logging || null;
  }
  
  /**
   * Get debug configuration section
   * 
   * @param env Environment with KV bindings
   * @returns Debug configuration
   */
  public async getDebugConfig(env: { VIDEO_CONFIGURATION_STORE?: KVNamespace; ENVIRONMENT?: string }) {
    const config = await this.loadConfiguration(env);
    return config?.debug || null;
  }
  
  /**
   * Extract and set duration limits from configuration
   * 
   * @param config The loaded configuration
   */
  private setDurationLimitsFromConfig(config: WorkerConfiguration | null): void {
    if (!config || !config.video?.defaults?.duration) {
      logDebug('No duration settings found in configuration');
      return;
    }
    
    try {
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
        logDebug('Error importing transformationUtils', {
          error: err instanceof Error ? err.message : String(err)
        });
      });
    } catch (err) {
      logDebug('Error setting duration limits from config', {
        error: err instanceof Error ? err.message : String(err)
      });
    }
  }
}

// Export default instance
export default ConfigurationService.getInstance();
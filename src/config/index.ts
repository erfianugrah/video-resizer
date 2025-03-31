/**
 * Configuration management system
 * 
 * Provides a centralized way to access all configuration managers.
 */
import { VideoConfigurationManager, PathPatternSchema } from './VideoConfigurationManager';
import { LoggingConfigurationManager } from './LoggingConfigurationManager';
import { CacheConfigurationManager } from './CacheConfigurationManager';
import { DebugConfigurationManager } from './DebugConfigurationManager';
import { EnvVariables, getEnvironmentConfig } from './environmentConfig';
import { z } from 'zod';

// Import from our own logger module
import { error as pinoError, debug as pinoDebug, info as pinoInfo, warn as pinoWarn } from '../utils/pinoLogger';
import { getCurrentContext } from '../utils/legacyLoggerAdapter';
import { createLogger } from '../utils/pinoLogger';

/**
 * Log an error message - helper for config module
 * Falls back to console.error during initialization before logging system is available
 */
function logError(message: string, data?: Record<string, unknown>): void {
  const requestContext = getCurrentContext();
  if (requestContext) {
    const logger = createLogger(requestContext);
    pinoError(requestContext, logger, 'Config', message, data);
  } else {
    // Direct console.error is appropriate only during initialization
    console.error(`Config: ${message}`, data || {});
  }
}

/**
 * Log a debug message - helper for config module
 * Falls back to console.log during initialization before logging system is available
 */
function logDebug(message: string, data?: Record<string, unknown>): void {
  const requestContext = getCurrentContext();
  if (requestContext) {
    const logger = createLogger(requestContext);
    pinoDebug(requestContext, logger, 'Config', message, data);
  } else {
    // Direct console.log is appropriate only during initialization
    console.log(`Config DEBUG: ${message}`, data || {});
  }
}

/**
 * Log an info message - helper for config module
 * Falls back to console.info during initialization before logging system is available
 */
function logInfo(message: string, data?: Record<string, unknown>): void {
  const requestContext = getCurrentContext();
  if (requestContext) {
    const logger = createLogger(requestContext);
    pinoInfo(requestContext, logger, 'Config', message, data);
  } else {
    // Direct console.info is appropriate only during initialization
    console.info(`Config INFO: ${message}`, data || {});
  }
}

/**
 * Log a warning message - helper for config module
 * Falls back to console.warn during initialization before logging system is available
 */
function logWarn(message: string, data?: Record<string, unknown>): void {
  const requestContext = getCurrentContext();
  if (requestContext) {
    const logger = createLogger(requestContext);
    pinoWarn(requestContext, logger, 'Config', message, data);
  } else {
    // Direct console.warn is appropriate only during initialization
    console.warn(`Config WARN: ${message}`, data || {});
  }
}

/**
 * Interface for the configuration system
 */
export interface ConfigurationSystem {
  videoConfig: VideoConfigurationManager;
  loggingConfig: LoggingConfigurationManager;
  cacheConfig: CacheConfigurationManager;
  debugConfig: DebugConfigurationManager;
}

/**
 * Initialize the configuration system with environment variables
 */
export function initializeConfiguration(env?: EnvVariables): ConfigurationSystem {
  // If environment variables provided, apply them to each config manager
  if (env) {
    applyEnvironmentVariables(env);
  }
  
  // Return the configuration system with existing instances
  return {
    videoConfig: VideoConfigurationManager.getInstance(),
    loggingConfig: LoggingConfigurationManager.getInstance(),
    cacheConfig: CacheConfigurationManager.getInstance(),
    debugConfig: DebugConfigurationManager.getInstance(),
  };
}

/**
 * Apply environment variables to configuration managers
 */
function applyEnvironmentVariables(env: EnvVariables): void {
  // Get the environment configuration
  const envConfig = getEnvironmentConfig(env);
  
  // Debug configuration from environment
  DebugConfigurationManager.getInstance().updateConfig({
    enabled: envConfig.debug.enabled,
    verbose: envConfig.debug.verbose,
    includeHeaders: envConfig.debug.includeHeaders,
    includePerformance: envConfig.debug.includePerformance,
    allowedIps: envConfig.debug.allowedIps,
    excludedPaths: envConfig.debug.excludedPaths,
  });
  
  // Cache configuration from environment
  CacheConfigurationManager.getInstance().updateConfig({
    method: envConfig.cache.method,
    debug: envConfig.cache.debug,
    defaultMaxAge: envConfig.cache.defaultTtl,
    respectOriginHeaders: envConfig.cache.respectOrigin,
    cacheEverything: envConfig.cache.cacheEverything,
    enableCacheTags: envConfig.cache.enableTags,
    purgeOnUpdate: envConfig.cache.purgeOnUpdate,
    bypassQueryParameters: envConfig.cache.bypassParams,
    // We'll handle KV cache configuration separately
    // as it's not part of the CacheConfigSchema
  });
  
  // Logging configuration from environment
  LoggingConfigurationManager.getInstance().updateConfig({
    level: envConfig.logging.level,
    format: envConfig.logging.format,
    includeTimestamps: envConfig.logging.includeTimestamps,
    includeComponentName: envConfig.logging.includeComponent,
    colorize: envConfig.logging.colorize,
    enabledComponents: envConfig.logging.enabledComponents,
    disabledComponents: envConfig.logging.disabledComponents,
    sampleRate: envConfig.logging.sampleRate,
    enablePerformanceLogging: envConfig.logging.performance,
    performanceThresholdMs: envConfig.logging.performanceThreshold,
  });
  
  // Video configuration from environment
  const videoConfig = VideoConfigurationManager.getInstance();
  
  // Update default values
  videoConfig.updateConfig({
    defaults: {
      ...videoConfig.getDefaults(),
      quality: envConfig.video.defaultQuality as any,
      compression: envConfig.video.defaultCompression as any,
      audio: envConfig.video.defaultAudio,
      fit: envConfig.video.defaultFit as any,
    },
    cdnCgi: {
      basePath: envConfig.cdnCgi.basePath,
    },
  });
  
  // Parse JSON configuration from environment if available
  if (env.PATH_PATTERNS) {
    try {
      // Parse string PATH_PATTERNS or use directly if it's already an array
      let pathPatterns: Record<string, unknown>[];
      
      if (typeof env.PATH_PATTERNS === 'string') {
        pathPatterns = JSON.parse(env.PATH_PATTERNS);
      } else {
        pathPatterns = env.PATH_PATTERNS as unknown as Record<string, unknown>[];
      }
      
      // Add each path pattern to video configuration
      if (Array.isArray(pathPatterns)) {
        const videoConfig = VideoConfigurationManager.getInstance();
        
        for (const pattern of pathPatterns) {
          // Only apply valid path patterns
          if (pattern && typeof pattern === 'object' && pattern.name && pattern.matcher) {
            try {
              videoConfig.addPathPattern(pattern as unknown as z.infer<typeof PathPatternSchema>);
            } catch (error) {
              // Log error but continue with other patterns
              const errMessage = error instanceof Error ? error.message : String(error);
              const errStack = error instanceof Error ? error.stack : undefined;
              logError(`Failed to add path pattern ${pattern.name}`, { 
                error: errMessage, 
                stack: errStack 
              });
            }
          }
        }
      }
    } catch (error) {
      // Log error but continue
      const errMessage = error instanceof Error ? error.message : String(error);
      const errStack = error instanceof Error ? error.stack : undefined;
      logError('Failed to process PATH_PATTERNS environment variable', { 
        error: errMessage, 
        stack: errStack 
      });
    }
  }
}

// Re-export individual configuration managers for convenience
export { 
  VideoConfigurationManager,
  configManager as videoConfig
} from './VideoConfigurationManager';

export { 
  LoggingConfigurationManager,
  loggingConfig
} from './LoggingConfigurationManager';

export { 
  CacheConfigurationManager,
  cacheConfig
} from './CacheConfigurationManager';

export { 
  DebugConfigurationManager,
  debugConfig
} from './DebugConfigurationManager';

// Export video path patterns getter
export function getVideoPathPatterns() {
  return VideoConfigurationManager.getInstance().getPathPatterns();
}

// Initialize default configuration system with environment variables
// This will be populated from the Worker environment at runtime
const config = initializeConfiguration();

/**
 * Update all configuration managers from KV configuration
 * @param kvConfig Configuration loaded from KV
 */
export function updateAllConfigFromKV(kvConfig: any) {
  if (!kvConfig) {
    logWarn('No KV configuration provided to updateAllConfigFromKV');
    return;
  }
  
  // Log the overall KV configuration structure for debugging
  logInfo('Processing KV configuration update', {
    hasVideoConfig: !!kvConfig.video,
    hasCacheConfig: !!kvConfig.cache,
    hasLoggingConfig: !!kvConfig.logging,
    hasDebugConfig: !!kvConfig.debug,
    hasStorageConfig: !!kvConfig.storage,
    configVersion: kvConfig.version,
    lastUpdated: kvConfig.lastUpdated
  });
  
  // Update video configuration if available
  if (kvConfig.video) {
    try {
      // Log video configuration details for debugging
      logInfo('Processing video configuration from KV', {
        hasPassthrough: !!kvConfig.video.passthrough,
        passthroughEnabled: kvConfig.video.passthrough?.enabled,
        hasDerivatives: !!kvConfig.video.derivatives,
        hasCdnCgi: !!kvConfig.video.cdnCgi,
        hasPathPatterns: Array.isArray(kvConfig.video.pathPatterns) ? kvConfig.video.pathPatterns.length : 0
      });
      
      const videoManager = VideoConfigurationManager.getInstance();
      videoManager.updateConfig(kvConfig.video);
      
      // Verify the update was successful by checking if passthrough config was applied
      const updatedConfig = videoManager.getConfig();
      logInfo('Updated video configuration from KV', {
        hasPassthrough: !!updatedConfig.passthrough,
        passthroughEnabled: updatedConfig.passthrough?.enabled,
        whitelistedFormats: updatedConfig.passthrough?.whitelistedFormats?.length || 0
      });
    } catch (err) {
      logError('Failed to update video configuration from KV', {
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined
      });
    }
  } else {
    logWarn('No video configuration in KV data');
  }
  
  // Update cache configuration if available
  if (kvConfig.cache) {
    try {
      // Log cache configuration details
      logInfo('Processing cache configuration from KV', {
        method: kvConfig.cache.method,
        debug: kvConfig.cache.debug,
        hasFallback: !!kvConfig.cache.fallback,
        profileCount: Object.keys(kvConfig.cache.cache || {}).length
      });
      
      const cacheManager = CacheConfigurationManager.getInstance();
      cacheManager.updateConfig(kvConfig.cache);
      logInfo('Updated cache configuration from KV');
    } catch (err) {
      logError('Failed to update cache configuration from KV', {
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined
      });
    }
  }
  
  // Update logging configuration if available
  if (kvConfig.logging) {
    try {
      const loggingManager = LoggingConfigurationManager.getInstance();
      loggingManager.updateConfig(kvConfig.logging);
      logInfo('Updated logging configuration from KV', {
        level: kvConfig.logging.level,
        format: kvConfig.logging.format
      });
    } catch (err) {
      logError('Failed to update logging configuration from KV', {
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined
      });
    }
  }
  
  // Update debug configuration if available
  if (kvConfig.debug) {
    try {
      const debugManager = DebugConfigurationManager.getInstance();
      debugManager.updateConfig(kvConfig.debug);
      logInfo('Updated debug configuration from KV', {
        enabled: kvConfig.debug.enabled,
        verbose: kvConfig.debug.verbose
      });
    } catch (err) {
      logError('Failed to update debug configuration from KV', {
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined
      });
    }
  }
  
  // Log completion of configuration update
  logInfo('Completed KV configuration update', {
    hasVideoConfig: !!kvConfig.video,
    hasCacheConfig: !!kvConfig.cache,
    hasLoggingConfig: !!kvConfig.logging,
    hasDebugConfig: !!kvConfig.debug
  });
}

export default config;

/**
 * Get KV cache configuration from environment
 * @returns KV cache configuration
 */
export function getCacheConfig(envVars?: EnvVariables) {
  // Get environment config
  const envConfig = getEnvironmentConfig(envVars);
  
  // Log the KV cache configuration details for debugging
  logDebug('KV cache configuration from environment', { 
    enableKVCache: envConfig.cache.enableKVCache,
    ttl: envConfig.cache.kvTtl,
    isProduction: envConfig.isProduction,
    mode: envConfig.mode
  });
  
  return {
    enableKVCache: envConfig.cache.enableKVCache,
    ttl: envConfig.cache.kvTtl
  };
}
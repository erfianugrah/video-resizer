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
import { error as pinoError } from '../utils/pinoLogger';
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

export default config;

/**
 * Get KV cache configuration from environment
 * @returns KV cache configuration
 */
export function getCacheConfig(envVars?: EnvVariables) {
  // Get environment config
  const envConfig = getEnvironmentConfig(envVars);
  
  // Log the KV cache configuration details for debugging
  logError('KV cache configuration from environment', { 
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
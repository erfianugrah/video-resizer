/**
 * Environment configuration for video resizer
 * 
 * This module handles parsing and processing environment variables into
 * properly typed configuration objects for the application.
 */
import { PathPattern } from '../utils/pathUtils';

// Import from our own logger module
import { info as pinoInfo, debug as pinoDebug, error as pinoError } from '../utils/pinoLogger';
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
    pinoError(requestContext, logger, 'EnvironmentConfig', message, data);
  } else {
    // Direct console.error is appropriate only during initialization
    console.error(`EnvironmentConfig: ${message}`, data || {});
  }
}

/**
 * Debug log message - helper for config module debugging
 * Falls back to console.log during initialization before logging system is available
 */
function logDebug(message: string, data?: Record<string, unknown>): void {
  const requestContext = getCurrentContext();
  if (requestContext) {
    const logger = createLogger(requestContext);
    pinoDebug(requestContext, logger, 'EnvironmentConfig', message, data);
  } else {
    // Direct console.log is appropriate only during initialization
    console.log(`EnvironmentConfig DEBUG: ${message}`, data || {});
  }
}

/**
 * Application environment configuration
 */
export interface EnvironmentConfig {
  mode: string;
  isProduction: boolean;
  isStaging: boolean;
  isDevelopment: boolean;
  version: string;
  debug: {
    enabled: boolean;
    verbose: boolean;
    includeHeaders: boolean;
    includePerformance: boolean;
    allowedIps: string[];
    excludedPaths: string[];
  };
  cache: {
    method: 'cf' | 'cacheApi';
    debug: boolean;
    defaultTtl: number;
    respectOrigin: boolean;
    cacheEverything: boolean;
    enableTags: boolean;
    purgeOnUpdate: boolean;
    bypassParams: string[];
    enableKVCache: boolean;
    kvTtl: {
      ok: number;
      redirects: number;
      clientError: number;
      serverError: number;
    };
  };
  logging: {
    level: 'debug' | 'info' | 'warn' | 'error';
    format: 'json' | 'text';
    includeTimestamps: boolean;
    includeComponent: boolean;
    colorize: boolean;
    enabledComponents: string[];
    disabledComponents: string[];
    sampleRate: number;
    performance: boolean;
    performanceThreshold: number;
    pinoSettings?: any; // Raw LOGGING_CONFIG from wrangler.jsonc
  };
  video: {
    defaultQuality: string;
    defaultCompression: string;
    defaultAudio: boolean;
    defaultFit: string;
  };
  cdnCgi: {
    basePath: string;
  };
  advanced: {
    workerConcurrency: number;
    requestTimeout: number;
    maxVideoSize: number;
  };
  pathPatterns?: PathPattern[];
}

/**
 * Environment variables interface
 */
export interface EnvVariables {
  // Application Settings
  ENVIRONMENT?: string;
  VERSION?: string;
  
  // Debug Configuration
  DEBUG_ENABLED?: string;
  DEBUG_VERBOSE?: string;
  DEBUG_INCLUDE_HEADERS?: string;
  DEBUG_PERFORMANCE?: string;
  DEBUG_ALLOWED_IPS?: string;
  DEBUG_EXCLUDED_PATHS?: string;
  
  // Cache Configuration
  CACHE_METHOD?: string;
  CACHE_DEBUG?: string;
  CACHE_DEFAULT_TTL?: string;
  CACHE_RESPECT_ORIGIN?: string;
  CACHE_EVERYTHING?: string;
  CACHE_ENABLE_TAGS?: string;
  CACHE_PURGE_ON_UPDATE?: string;
  CACHE_BYPASS_PARAMS?: string;
  CACHE_ENABLE_KV?: string;
  CACHE_KV_TTL_OK?: string;
  CACHE_KV_TTL_REDIRECTS?: string;
  CACHE_KV_TTL_CLIENT_ERROR?: string;
  CACHE_KV_TTL_SERVER_ERROR?: string;
  
  // Logging Configuration
  LOG_LEVEL?: string;
  LOG_FORMAT?: string;
  LOG_INCLUDE_TIMESTAMPS?: string;
  LOG_INCLUDE_COMPONENT?: string;
  LOG_COLORIZE?: string;
  LOG_ENABLED_COMPONENTS?: string;
  LOG_DISABLED_COMPONENTS?: string;
  LOG_SAMPLE_RATE?: string;
  LOG_PERFORMANCE?: string;
  LOG_PERFORMANCE_THRESHOLD?: string;
  // The comprehensive logging configuration from wrangler.jsonc
  // This can be either a string (JSON) or an already parsed object
  LOGGING_CONFIG?: string | {
    pino?: {
      level?: string;
      browser?: {
        asObject?: boolean;
      };
      base?: {
        service?: string;
        env?: string;
      };
      transport?: unknown;
    };
    sampling?: {
      enabled?: boolean;
      rate?: number;
    };
    breadcrumbs?: {
      enabled?: boolean;
      maxItems?: number;
    };
  };
  
  // Video Configuration
  VIDEO_DEFAULT_QUALITY?: string;
  VIDEO_DEFAULT_COMPRESSION?: string;
  VIDEO_DEFAULT_AUDIO?: string;
  VIDEO_DEFAULT_FIT?: string;
  
  // Path Patterns
  PATH_PATTERNS?: PathPattern[] | string;
  
  // CDN-CGI Configuration
  CDN_CGI_BASE_PATH?: string;
  
  // Advanced Settings
  WORKER_CONCURRENCY?: string;
  REQUEST_TIMEOUT?: string;
  MAX_VIDEO_SIZE?: string;
  
  // Worker specific bindings
  ASSETS?: {
    fetch: (request: Request) => Promise<Response>;
  } | undefined;
  
  // Storage bindings
  VIDEOS_BUCKET?: R2Bucket | undefined;
  VIDEO_TRANSFORMS_KV?: KVNamespace | undefined;
  VIDEO_TRANSFORMATIONS_CACHE?: KVNamespace | undefined;
  VIDEO_CONFIGURATION_STORE?: KVNamespace | undefined;
  
  // API Authentication
  CONFIG_API_TOKEN?: string;
}

/**
 * Helper function to parse boolean from environment variable
 * @param value - Environment variable value
 * @param defaultValue - Default value if missing
 * @returns Parsed boolean value
 */
function parseBoolean(value?: string, defaultValue = false): boolean {
  if (value === undefined) return defaultValue;
  
  // String value 'true' (case insensitive)
  if (value.toLowerCase() === 'true') return true;
  
  // String value '1' is also considered true
  if (value === '1') return true;
  
  // String value 'yes' (case insensitive) also means true 
  if (value.toLowerCase() === 'yes') return true;
  
  // Debug log the boolean parsing
  const parsedValue = value.toLowerCase() === 'true' || value === '1' || value.toLowerCase() === 'yes';
  logDebug('parseBoolean', { 
    rawValue: value, 
    parsedValue, 
    defaultValue 
  });
  
  return parsedValue;
}

/**
 * Helper function to parse number from environment variable
 * @param value - Environment variable value
 * @param defaultValue - Default value if missing or invalid
 * @returns Parsed number value
 */
function parseNumber(value?: string, defaultValue = 0): number {
  if (value === undefined) return defaultValue;
  const parsed = Number(value);
  return isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Helper function to parse string array from comma-separated string
 * @param value - Comma-separated string
 * @param defaultValue - Default value if missing
 * @returns String array
 */
function parseStringArray(value?: string, defaultValue: string[] = []): string[] {
  if (!value) return defaultValue;
  return value.split(',').map(item => item.trim()).filter(Boolean);
}

/**
 * Get environment configuration based on provided environment variables
 * @param {EnvVariables} env - Environment variables
 * @returns {EnvironmentConfig} - Configuration object
 */
export function getEnvironmentConfig(env: EnvVariables = {}): EnvironmentConfig {
  // Log environment config initialization
  logDebug('Initializing environment configuration', {
    environment: env.ENVIRONMENT || 'development',
    version: env.VERSION || '1.0.0',
    hasLoggingConfig: !!env.LOGGING_CONFIG
  });
  
  // Determine if we're in production, staging, or development
  const mode = (env.ENVIRONMENT || 'development').toLowerCase();
  const isProduction = mode === 'production';
  const isStaging = mode === 'staging';
  const isDevelopment = mode === 'development';
  
  // Log environment determination
  logDebug('Environment determined', {
    mode,
    isProduction,
    isStaging,
    isDevelopment
  });
  
  // Debug log environment variables
  logDebug('Environment configuration parsing', { 
    ENVIRONMENT: env.ENVIRONMENT,
    mode,
    isProduction,
    CACHE_ENABLE_KV: env.CACHE_ENABLE_KV,
    CACHE_ENABLE_KV_TYPE: typeof env.CACHE_ENABLE_KV
  });
  
  // Configuration object
  const config: EnvironmentConfig = {
    // General settings
    mode,
    isProduction,
    isStaging,
    isDevelopment,
    version: env.VERSION || '1.0.0',
    
    // Debug settings
    debug: {
      enabled: parseBoolean(env.DEBUG_ENABLED, !isProduction),
      verbose: parseBoolean(env.DEBUG_VERBOSE),
      includeHeaders: parseBoolean(env.DEBUG_INCLUDE_HEADERS),
      includePerformance: parseBoolean(env.DEBUG_PERFORMANCE),
      allowedIps: parseStringArray(env.DEBUG_ALLOWED_IPS),
      excludedPaths: parseStringArray(env.DEBUG_EXCLUDED_PATHS),
    },
    
    // Cache settings
    cache: {
      method: (env.CACHE_METHOD?.toLowerCase() === 'cf') ? 'cf' : 'cacheApi',
      debug: parseBoolean(env.CACHE_DEBUG),
      defaultTtl: parseNumber(env.CACHE_DEFAULT_TTL, 86400),
      respectOrigin: parseBoolean(env.CACHE_RESPECT_ORIGIN, true),
      cacheEverything: parseBoolean(env.CACHE_EVERYTHING),
      enableTags: parseBoolean(env.CACHE_ENABLE_TAGS, true),
      purgeOnUpdate: parseBoolean(env.CACHE_PURGE_ON_UPDATE),
      bypassParams: parseStringArray(env.CACHE_BYPASS_PARAMS, ['nocache', 'bypass']),
      enableKVCache: parseBoolean(env.CACHE_ENABLE_KV, isProduction), // Enable KV by default in production
      kvTtl: {
        ok: parseNumber(env.CACHE_KV_TTL_OK, 86400), // 24 hours
        redirects: parseNumber(env.CACHE_KV_TTL_REDIRECTS, 3600), // 1 hour
        clientError: parseNumber(env.CACHE_KV_TTL_CLIENT_ERROR, 60), // 1 minute
        serverError: parseNumber(env.CACHE_KV_TTL_SERVER_ERROR, 10), // 10 seconds
      },
    },
    
    // Logging configuration
    logging: {
      level: (env.LOG_LEVEL?.toLowerCase() || 'info') as 'debug' | 'info' | 'warn' | 'error',
      format: (env.LOG_FORMAT?.toLowerCase() || 'text') as 'json' | 'text',
      includeTimestamps: parseBoolean(env.LOG_INCLUDE_TIMESTAMPS, true),
      includeComponent: parseBoolean(env.LOG_INCLUDE_COMPONENT, true),
      colorize: parseBoolean(env.LOG_COLORIZE, true),
      enabledComponents: parseStringArray(env.LOG_ENABLED_COMPONENTS),
      disabledComponents: parseStringArray(env.LOG_DISABLED_COMPONENTS),
      sampleRate: Math.min(Math.max(parseNumber(env.LOG_SAMPLE_RATE, 1), 0), 1), // Clamp between 0 and 1
      performance: parseBoolean(env.LOG_PERFORMANCE),
      performanceThreshold: parseNumber(env.LOG_PERFORMANCE_THRESHOLD, 1000),
      // These are processed separately by LoggingConfigurationManager from LOGGING_CONFIG
      pinoSettings: typeof env.LOGGING_CONFIG === 'string' 
        ? JSON.parse(env.LOGGING_CONFIG) 
        : env.LOGGING_CONFIG,
    },
    
    // Video configuration
    video: {
      defaultQuality: env.VIDEO_DEFAULT_QUALITY || 'auto',
      defaultCompression: env.VIDEO_DEFAULT_COMPRESSION || 'auto',
      defaultAudio: parseBoolean(env.VIDEO_DEFAULT_AUDIO, true),
      defaultFit: env.VIDEO_DEFAULT_FIT || 'contain',
    },
    
    // CDN-CGI configuration
    cdnCgi: {
      basePath: env.CDN_CGI_BASE_PATH || '/cdn-cgi/media',
    },
    
    // Advanced settings
    advanced: {
      workerConcurrency: parseNumber(env.WORKER_CONCURRENCY, 10),
      requestTimeout: parseNumber(env.REQUEST_TIMEOUT, 30000),
      maxVideoSize: parseNumber(env.MAX_VIDEO_SIZE, 0),
    },
  };
  
  // Handle path patterns - can be either object or JSON string
  if (env.PATH_PATTERNS) {
    logDebug('Processing PATH_PATTERNS configuration', {
      type: typeof env.PATH_PATTERNS,
      isString: typeof env.PATH_PATTERNS === 'string',
      isArray: Array.isArray(env.PATH_PATTERNS)
    });
    
    if (typeof env.PATH_PATTERNS === 'string') {
      try {
        config.pathPatterns = JSON.parse(env.PATH_PATTERNS);
        logDebug('Successfully parsed PATH_PATTERNS JSON', {
          patternCount: config.pathPatterns?.length || 0
        });
      } catch (err) {
        const errMessage = err instanceof Error ? err.message : String(err);
        const errStack = err instanceof Error ? err.stack : undefined;
        logError('Error parsing PATH_PATTERNS environment variable', { 
          error: errMessage, 
          stack: errStack,
          rawValue: env.PATH_PATTERNS.substring(0, 100) + '...' // Log first 100 chars for debugging
        });
      }
    } else {
      // Already an object array
      config.pathPatterns = env.PATH_PATTERNS;
      logDebug('Using PATH_PATTERNS as object', {
        patternCount: config.pathPatterns?.length || 0
      });
    }
  } else {
    logDebug('No PATH_PATTERNS configuration provided');
  }
  
  logDebug('Environment configuration completed', {
    mode: config.mode,
    hasPathPatterns: !!config.pathPatterns,
    cacheMethod: config.cache.method,
    logLevel: config.logging.level
  });
  
  return config;
}
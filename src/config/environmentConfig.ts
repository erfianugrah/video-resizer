/**
 * Environment configuration for video resizer
 * 
 * This module handles parsing and processing environment variables into
 * properly typed configuration objects for the application.
 */
import { PathPattern } from '../utils/pathUtils';

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
  LOGGING_CONFIG?: string | Record<string, any>;
  
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
  
  // R2 bucket bindings
  VIDEOS_BUCKET?: R2Bucket | undefined;
}

/**
 * Helper function to parse boolean from environment variable
 * @param value - Environment variable value
 * @param defaultValue - Default value if missing
 * @returns Parsed boolean value
 */
function parseBoolean(value?: string, defaultValue = false): boolean {
  if (value === undefined) return defaultValue;
  return value.toLowerCase() === 'true';
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
  // Determine if we're in production, staging, or development
  const mode = (env.ENVIRONMENT || 'development').toLowerCase();
  const isProduction = mode === 'production';
  const isStaging = mode === 'staging';
  const isDevelopment = mode === 'development';
  
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
    if (typeof env.PATH_PATTERNS === 'string') {
      try {
        config.pathPatterns = JSON.parse(env.PATH_PATTERNS);
      } catch (err) {
        // Can't use logger here as this is during init
        const errMessage = err instanceof Error ? err.message : String(err);
        const errStack = err instanceof Error ? err.stack : undefined;
        console.error(`Error parsing PATH_PATTERNS environment variable: ${errMessage}`, { stack: errStack });
      }
    } else {
      // Already an object array
      config.pathPatterns = env.PATH_PATTERNS;
    }
  }
  
  return config;
}
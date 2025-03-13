/**
 * Environment configuration for video resizer
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
  debug: {
    enabled: boolean;
    verbose: boolean;
    includeHeaders: boolean;
  };
  pathPatterns?: PathPattern[];
}

/**
 * Environment variables interface
 */
export interface EnvVariables {
  ENVIRONMENT?: string;
  DEBUG_ENABLED?: string;
  DEBUG_VERBOSE?: string;
  DEBUG_INCLUDE_HEADERS?: string;
  PATH_PATTERNS?: PathPattern[] | string;
  VERSION?: string;
}

/**
 * Get environment configuration based on provided environment variables
 * @param {EnvVariables} env - Environment variables
 * @returns {EnvironmentConfig} - Configuration object
 */
export function getEnvironmentConfig(env: EnvVariables): EnvironmentConfig {
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
    
    // Debug settings
    debug: {
      enabled: env.DEBUG_ENABLED === 'true' || !isProduction,
      verbose: env.DEBUG_VERBOSE === 'true',
      includeHeaders: env.DEBUG_INCLUDE_HEADERS === 'true',
    },
  };
  
  // Handle path patterns - can be either object or JSON string
  if (env.PATH_PATTERNS) {
    if (typeof env.PATH_PATTERNS === 'string') {
      try {
        config.pathPatterns = JSON.parse(env.PATH_PATTERNS);
      } catch (err) {
        console.error('Error parsing PATH_PATTERNS environment variable', err);
      }
    } else {
      // Already an object array
      config.pathPatterns = env.PATH_PATTERNS;
    }
  }
  
  return config;
}
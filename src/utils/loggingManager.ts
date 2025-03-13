/**
 * Centralized logging manager
 */
import { initializeLogger } from './loggerUtils';
import { EnvVariables } from '../config/environmentConfig';

/**
 * Initialize logging based on environment configuration
 * @param env Environment variables
 */
export function initializeLogging(env: EnvVariables): void {
  const config = {
    debug: {
      enabled: env.DEBUG_ENABLED === 'true' || env.ENVIRONMENT !== 'production',
      verbose: env.DEBUG_VERBOSE === 'true',
    },
  };

  initializeLogger(config);
}

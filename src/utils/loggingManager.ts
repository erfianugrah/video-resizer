/**
 * Centralized logging manager
 */
import { initializeLogger } from './loggerUtils';

/**
 * Initialize logging based on environment configuration
 * @param env Environment variables
 */
export function initializeLogging(env: any): void {
  const config = {
    debug: {
      enabled: env.DEBUG_ENABLED === 'true' || env.ENVIRONMENT !== 'production',
      verbose: env.DEBUG_VERBOSE === 'true',
    },
  };

  initializeLogger(config);
}

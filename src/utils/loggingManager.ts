/**
 * Centralized logging manager
 */
import { initializeLogger } from './loggerUtils';
import { LoggingConfigurationManager } from '../config';
import { EnvVariables } from '../config/environmentConfig';

/**
 * Initialize logging based on environment configuration
 * @param env Environment variables
 */
export function initializeLogging(_env: EnvVariables): void {
  // Get the logging configuration from the manager
  const loggingConfig = LoggingConfigurationManager.getInstance();
  const config = loggingConfig.getConfig();
  
  // Convert the logging config to the format expected by initializeLogger
  const loggerConfig = {
    debug: {
      enabled: config.level === 'debug' || config.level === 'info',
      verbose: config.enablePerformanceLogging
    }
  };
  
  // Initialize the logger with the converted configuration
  initializeLogger(loggerConfig);
}

/**
 * Configuration validation utilities
 */
import { z } from 'zod';
import { ConfigurationError } from '../../errors';
import { WorkerConfigurationSchema, WorkerConfiguration } from './schemas';
import { createCategoryLogger } from '../../utils/logger';

const logger = createCategoryLogger('ConfigurationService');

/**
 * Check if the configuration JSON is valid against the schema
 * @param configJson Configuration JSON object to validate
 * @returns True if the configuration is valid, false otherwise
 */
export function isConfigValid(configJson: unknown): boolean {
  try {
    validateConfig(configJson);
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Validate configuration against the schema, throwing an error if invalid
 * @param configJson Configuration JSON object to validate
 * @throws ConfigurationError if validation fails
 */
export function validateConfig(configJson: unknown): void {
  try {
    WorkerConfigurationSchema.parse(configJson);
  } catch (error) {
    logger.error('Configuration validation failed', {
      error: error instanceof Error ? error.message : String(error),
      configSample: truncateConfig(configJson),
    });

    let validationMessage = 'Configuration validation failed';
    if (error instanceof z.ZodError) {
      validationMessage = error.errors
        .map((err) => `${err.path.join('.')}: ${err.message}`)
        .join('; ');
    }

    throw new ConfigurationError(validationMessage);
  }
}

/**
 * Convert JSON to typed configuration after validation
 * @param configJson Configuration JSON object to convert
 * @returns Typed WorkerConfiguration object
 * @throws ConfigurationError if validation fails
 */
export function convertJsonToConfig(configJson: unknown): WorkerConfiguration {
  validateConfig(configJson);
  return configJson as WorkerConfiguration;
}

/**
 * Create a sample of the configuration for logging, truncating large values
 * @param configJson Configuration object to truncate
 * @returns Truncated version for logging
 */
function truncateConfig(configJson: unknown): unknown {
  if (!configJson || typeof configJson !== 'object') {
    return configJson;
  }

  const result: Record<string, unknown> = {};

  // Handle array case
  if (Array.isArray(configJson)) {
    return configJson.length > 5
      ? configJson.slice(0, 3).concat(['...', `(${configJson.length} items total)`])
      : configJson;
  }

  // Handle object case
  for (const [key, value] of Object.entries(configJson)) {
    if (typeof value === 'object' && value !== null) {
      result[key] = '{...}'; // Truncate nested objects
    } else if (typeof value === 'string' && value.length > 100) {
      result[key] = value.substring(0, 50) + '...' + value.substring(value.length - 20);
    } else {
      result[key] = value;
    }
  }

  return result;
}

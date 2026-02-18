/**
 * Accessors for specific configuration sections
 */
import { WorkerConfiguration } from './schemas';
import { createCategoryLogger } from '../../utils/logger';
import { withErrorHandling } from '../../utils/errorHandlingUtils';
import { ConfigurationError } from '../../errors';

const logger = createCategoryLogger('ConfigurationService');

/**
 * Get video configuration section
 * @param config Complete worker configuration
 * @returns Video configuration section or null if not available
 */
export const getVideoConfig = withErrorHandling<[WorkerConfiguration | null], any | null>(
  (config: WorkerConfiguration | null) => {
    if (!config) {
      return null;
    }

    logger.debug('Getting video config', {
      hasConfig: !!config.video,
    });

    return config.video;
  },
  {
    functionName: 'getVideoConfig',
    component: 'ConfigurationService',
    logErrors: true,
  }
);

/**
 * Get cache configuration section
 * @param config Complete worker configuration
 * @returns Cache configuration section or null if not available
 */
export const getCacheConfig = withErrorHandling<[WorkerConfiguration | null], any | null>(
  (config: WorkerConfiguration | null) => {
    if (!config) {
      return null;
    }

    logger.debug('Getting cache config', {
      hasConfig: !!config.cache,
    });

    return config.cache;
  },
  {
    functionName: 'getCacheConfig',
    component: 'ConfigurationService',
    logErrors: true,
  }
);

/**
 * Get logging configuration section
 * @param config Complete worker configuration
 * @returns Logging configuration section or null if not available
 */
export const getLoggingConfig = withErrorHandling<[WorkerConfiguration | null], any | null>(
  (config: WorkerConfiguration | null) => {
    if (!config) {
      return null;
    }

    logger.debug('Getting logging config', {
      hasConfig: !!config.logging,
    });

    return config.logging;
  },
  {
    functionName: 'getLoggingConfig',
    component: 'ConfigurationService',
    logErrors: true,
  }
);

/**
 * Get debug configuration section
 * @param config Complete worker configuration
 * @returns Debug configuration section or null if not available
 */
export const getDebugConfig = withErrorHandling<[WorkerConfiguration | null], any | null>(
  (config: WorkerConfiguration | null) => {
    if (!config) {
      return null;
    }

    logger.debug('Getting debug config', {
      hasConfig: !!config.debug,
    });

    return config.debug;
  },
  {
    functionName: 'getDebugConfig',
    component: 'ConfigurationService',
    logErrors: true,
  }
);

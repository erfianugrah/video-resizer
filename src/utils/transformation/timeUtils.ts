/**
 * Time and duration utilities for media transformations
 */
import { tryOrNull, tryOrDefault, logErrorWithContext } from '../errorHandlingUtils';

/**
 * Valid time units
 */
export type TimeUnit = 's' | 'm';

/**
 * Implementation of parseTimeString that might throw errors
 */
function parseTimeStringImpl(timeStr: string): number | null {
  if (!timeStr) return null;

  // Match a number followed by 's' or 'm'
  const match = timeStr.match(/^(\d+(?:\.\d+)?)([sm])$/);
  if (!match) return null;

  const value = parseFloat(match[1]);
  const unit = match[2] as TimeUnit;

  // Convert to seconds
  if (unit === 'm') {
    return value * 60;
  }
  return value;
}

/**
 * Parse time string to seconds
 * Using tryOrNull for safe execution with proper error handling
 * 
 * @param timeStr Time string like "5s" or "2m"
 * @returns Time in seconds or null if invalid
 */
export const parseTimeString = tryOrNull<[string], number | null>(
  parseTimeStringImpl,
  {
    functionName: 'parseTimeString',
    component: 'TransformationUtils',
    logErrors: true
  }
);

/**
 * Implementation of formatTimeString that might throw errors
 */
function formatTimeStringImpl(seconds: number): string {
  if (seconds >= 60) {
    const minutes = Math.floor(seconds / 60);
    return `${minutes}m`;
  }
  return `${seconds}s`;
}

/**
 * Format seconds to time string
 * Using tryOrDefault for safe execution with proper error handling
 * 
 * @param seconds Time in seconds
 * @returns Formatted time string (e.g., "5s" or "2m")
 */
export const formatTimeString = tryOrDefault<[number], string>(
  formatTimeStringImpl,
  {
    functionName: 'formatTimeString',
    component: 'TransformationUtils',
    logErrors: true
  },
  '0s' // Safe default if the function fails
);

/**
 * Implementation of isValidTime that might throw errors
 */
function isValidTimeImpl(timeStr: string | null): boolean {
  if (!timeStr) return true;
  
  const seconds = parseTimeString(timeStr);
  if (seconds === null) return false;
  
  // Time accepted between 0s and 10m (600s)
  return seconds >= 0 && seconds <= 600;
}

/**
 * Validate time parameter
 * Using tryOrDefault for safe execution with proper error handling
 * 
 * @param timeStr Time string
 * @returns If the time is valid according to limits (0-600s)
 */
export const isValidTime = tryOrDefault<[string | null], boolean>(
  isValidTimeImpl,
  {
    functionName: 'isValidTime',
    component: 'TransformationUtils',
    logErrors: true
  },
  true // Default to accepting the time if validation fails
);

/**
 * Implementation of isValidDuration that might throw errors
 */
function isValidDurationImpl(durationStr: string | null): boolean {
  if (!durationStr) return true;
  
  const seconds = parseTimeString(durationStr);
  if (seconds === null) return false;
  
  // Duration must be between 1s and 300s (5m)
  return seconds >= 1 && seconds <= 300;
}

/**
 * Validate duration parameter format
 * Using tryOrDefault for safe execution with proper error handling
 * 
 * @param durationStr Duration string
 * @returns If the duration is a valid format (regardless of limits)
 */
export const isValidDuration = tryOrDefault<[string | null], boolean>(
  isValidDurationImpl,
  {
    functionName: 'isValidDuration',
    component: 'TransformationUtils',
    logErrors: true
  },
  true // Default to accepting the duration if validation fails
);

/**
 * Implementation of isDurationWithinLimits that might throw errors
 */
function isDurationWithinLimitsImpl(durationStr: string | null): boolean {
  if (!durationStr) return true;
  
  const seconds = parseTimeString(durationStr);
  if (seconds === null) return false;
  
  // If we don't have learned limits yet, we can't check
  if (!haveDurationLimits()) {
    // Log that we're skipping limit check due to missing limits
    import('../legacyLoggerAdapter').then(({ debug }) => {
      debug('TransformationUtils', 'Skipping duration limit check', {
        reason: 'No known limits available',
        duration: durationStr,
        seconds
      });
    }).catch((err) => {
      // Log error with standardized error handling
      logErrorWithContext(
        'Failed to import logger for duration limit check',
        err,
        { duration: durationStr, seconds },
        'TransformationUtils'
      );
    });
    return true;
  }
  
  const minDuration = transformationLimits.duration.min;
  const maxDuration = transformationLimits.duration.max;
  
  // Check if duration is outside limits
  const isWithinLimits = seconds >= minDuration && seconds <= maxDuration;
  
  // Log result if duration exceeds limits
  if (!isWithinLimits) {
    import('../legacyLoggerAdapter').then(({ warn }) => {
      warn('TransformationUtils', 'Duration exceeds known limits', {
        duration: durationStr,
        seconds,
        minDuration,
        maxDuration,
        exceedsMin: seconds < minDuration,
        exceedsMax: seconds > maxDuration
      });
    }).catch((err) => {
      // Log error with standardized error handling
      logErrorWithContext(
        'Failed to import logger for duration limit warning',
        err,
        { 
          duration: durationStr, 
          seconds,
          minDuration,
          maxDuration,
          exceedsMin: seconds < minDuration,
          exceedsMax: seconds > maxDuration
        },
        'TransformationUtils'
      );
    });
  }
  
  // Use our learned limits for validation
  return isWithinLimits;
}

/**
 * Check if duration is within learned limits
 * Using tryOrDefault for safe execution with proper error handling
 * 
 * @param durationStr Duration string
 * @returns If the duration is within known limits
 */
export const isDurationWithinLimits = tryOrDefault<[string | null], boolean>(
  isDurationWithinLimitsImpl,
  {
    functionName: 'isDurationWithinLimits',
    component: 'TransformationUtils',
    logErrors: true
  },
  true // Default to accepting the duration if validation fails
);

/**
 * Implementation of adjustDuration that might throw errors
 */
function adjustDurationImpl(durationStr: string | null, useSafeMax: boolean = false): string | null {
  if (!durationStr) return durationStr;
  
  const seconds = parseTimeString(durationStr);
  if (seconds === null) {
    return durationStr;
  }
  
  const minDuration = getTransformationLimit('duration', 'min') ?? 1;
  const configuredMax = getTransformationLimit('duration', 'max') ?? 60;
  const maxDuration = useSafeMax ? Math.floor(configuredMax) : configuredMax;
  const maxClampValue = Number.isInteger(maxDuration) ? maxDuration : Math.floor(maxDuration);

  if (seconds < minDuration) {
    return formatTimeString(minDuration);
  }

  if (seconds > maxDuration) {
    return formatTimeString(maxClampValue);
  }

  return durationStr;
}

/**
 * Adjust duration to be within valid limits
 * Using tryOrDefault for safe execution with proper error handling
 * 
 * @param durationStr Duration string
 * @param useSafeMax Whether to use a safe integer maximum (slightly below the actual max)
 * @returns Adjusted duration string or original if already valid or no limits known
 */
export const adjustDuration = tryOrDefault<[string | null, boolean?], string | null>(
  adjustDurationImpl,
  {
    functionName: 'adjustDuration',
    component: 'TransformationUtils',
    logErrors: true
  },
  null // Return null if adjustment fails completely
);

/**
 * Implementation of isDurationLimitError that might throw errors
 */
function isDurationLimitErrorImpl(errorText: string): boolean {
  if (!errorText) return false;
  
  // Return true if the error is a duration validation error
  if (errorText.includes('duration: attribute must be between')) {
    return true;
  }
  
  // Return true if the error is a duration parameter error
  if (errorText.toLowerCase().includes('duration') && 
      (errorText.toLowerCase().includes('invalid') || 
       errorText.toLowerCase().includes('must be'))) {
    return true;
  }
  
  return false;
}

/**
 * Check if an error message is related to duration limits
 * Using tryOrDefault for safe execution with proper error handling
 * 
 * @param errorText Error message text
 * @returns Whether the error is a duration limit error
 */
export const isDurationLimitError = tryOrDefault<[string], boolean>(
  isDurationLimitErrorImpl,
  {
    functionName: 'isDurationLimitError',
    component: 'TransformationUtils',
    logErrors: true
  },
  false // Default to false if the check fails
);

// In-memory cache for transformation limits discovered from API errors
// Initially empty - will be populated from API responses
export const transformationLimits: Record<string, Record<string, number>> = {
  // Defaults aligned to 5 minute support for this deployment
  duration: { min: 1, max: 300 },
  fileSize: {}  // Will be populated with max from API errors
};

/**
 * Implementation of storeTransformationLimit that might throw errors
 */
function storeTransformationLimitImpl(type: string, key: string, value: number): void {
  // Import logger dynamically to avoid circular dependencies
  import('../legacyLoggerAdapter').then(({ debug }) => {
    debug('TransformationUtils', `Discovered new ${type} limit`, {
      type,
      key,
      value,
      isNewLimitType: !transformationLimits[type],
      previousValue: transformationLimits[type]?.[key]
    });
  }).catch(err => {
    // Log error with standardized error handling
    logErrorWithContext(
      'Failed to import logger for transformation limit storage',
      err,
      { type, key, value },
      'TransformationUtils'
    );
    // Fallback to console if import fails
    console.debug(`[TransformationUtils] Discovered new ${type} limit: ${key}=${value}`);
  });

  // Initialize the limit type object if it doesn't exist
  if (!transformationLimits[type]) {
    transformationLimits[type] = {};
  }
  transformationLimits[type][key] = value;
}

/**
 * Store discovered transformation limit
 * Using tryOrDefault for safe execution to ensure limits are always stored
 * 
 * @param type - The type of limit (duration, fileSize, etc.)
 * @param key - The limit key (max, min, etc.)
 * @param value - The limit value
 */
export const storeTransformationLimit = tryOrDefault<[string, string, number], void>(
  storeTransformationLimitImpl,
  {
    functionName: 'storeTransformationLimit',
    component: 'TransformationUtils',
    logErrors: true
  },
  undefined // No return value needed
);

/**
 * Implementation of getTransformationLimit that might throw errors
 */
function getTransformationLimitImpl(type: string, key: string): number | undefined {
  return transformationLimits[type]?.[key];
}

/**
 * Get a transformation limit
 * Using tryOrNull for safe execution with proper error handling
 * 
 * @param type - The type of limit (duration, fileSize, etc.)
 * @param key - The limit key (max, min, etc.)
 * @returns The limit value
 */
export const getTransformationLimit = tryOrNull<[string, string], number | undefined>(
  getTransformationLimitImpl,
  {
    functionName: 'getTransformationLimit',
    component: 'TransformationUtils',
    logErrors: true
  }
);

/**
 * Implementation of haveDurationLimits that might throw errors
 */
function haveDurationLimitsImpl(): boolean {
  return 'min' in transformationLimits.duration && 
         'max' in transformationLimits.duration;
}

/**
 * Check if we have learned duration limits
 * Using tryOrDefault for safe execution with proper error handling
 * 
 * @returns Whether we have both min and max duration limits
 */
export const haveDurationLimits = tryOrDefault<[], boolean>(
  haveDurationLimitsImpl,
  {
    functionName: 'haveDurationLimits',
    component: 'TransformationUtils',
    logErrors: false // Low importance function, avoid excessive logging
  },
  false // Default to false if check fails
);

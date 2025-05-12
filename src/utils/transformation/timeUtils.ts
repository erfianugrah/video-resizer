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
  
  // Cloudflare Media Transformation limits time to 0-30s
  return seconds >= 0 && seconds <= 30;
}

/**
 * Validate time parameter
 * Using tryOrDefault for safe execution with proper error handling
 * 
 * @param timeStr Time string
 * @returns If the time is valid according to Cloudflare limits (0-30s)
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
  
  // Only validate that it's a non-negative value (0 is allowed)
  return seconds >= 0;
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
  
  // Dynamically import logger to avoid circular dependencies
  import('../legacyLoggerAdapter').then(({ info, warn }) => {
    info('TransformationUtils', 'Adjusting duration', {
      durationStr,
      haveLimits: haveDurationLimits(),
      currentLimits: transformationLimits.duration,
      configLoaded: true, // Flag to track if config is loaded properly
      requestedDuration: durationStr
    });
  }).catch((err) => {
    // Log error with standardized error handling
    logErrorWithContext(
      'Failed to import logger for duration adjustment',
      err,
      { durationStr, haveLimits: haveDurationLimits() },
      'TransformationUtils'
    );
    // Fallback to console for logging
    console.info(`[TransformationUtils] Adjusting duration: ${durationStr}`);
  });
  
  const seconds = parseTimeString(durationStr);
  if (seconds === null) {
    // Log invalid duration format
    import('../legacyLoggerAdapter').then(({ warn }) => {
      warn('TransformationUtils', 'Invalid duration format', {
        durationStr,
        reason: 'Failed to parse time string'
      });
    }).catch((err) => {
      // Log error with standardized error handling
      logErrorWithContext(
        'Failed to import logger for invalid duration warning',
        err,
        { durationStr },
        'TransformationUtils'
      );
      console.warn(`[TransformationUtils] Invalid duration format: ${durationStr}`);
    });
    return durationStr;
  }
  
  // If we don't have learned limits yet, try to get them from configuration first
  if (!haveDurationLimits()) {
    // Try to load from VideoConfigurationManager first before falling back to 30s
    try {
      // Import dynamically to avoid circular dependencies
      import('../../config/VideoConfigurationManager').then(({ VideoConfigurationManager }) => {
        const configManager = VideoConfigurationManager.getInstance();
        const configDuration = configManager.getDefaultOption('duration');

        if (configDuration) {
          // Parse the duration from config
          const configSeconds = parseTimeString(configDuration);
          if (configSeconds !== null && configSeconds > 0) {
            import('../legacyLoggerAdapter').then(({ info }) => {
              info('TransformationUtils', 'Setting duration limits from configuration', {
                configDuration,
                configSeconds,
                min: 0,
                max: configSeconds,
                originalDuration: durationStr,
                parsedSeconds: seconds
              });
            }).catch(() => {
              console.info(`[TransformationUtils] Setting duration limits from configuration: max=${configSeconds}s`);
            });

            // Set limits from configuration
            storeTransformationLimit('duration', 'min', 0);
            storeTransformationLimit('duration', 'max', configSeconds);
            return; // Exit early - we've set the limits
          }
        }

        // If we reach here, config didn't have usable duration, use 300s (5m) as fallback
        import('../legacyLoggerAdapter').then(({ warn }) => {
          warn('TransformationUtils', 'No valid duration found in configuration, using 5m fallback', {
            defaultsApplied: true,
            settingMin: 0,
            settingMax: 300, // 5 minutes
            reason: 'Configuration duration not available or invalid',
            requestedDuration: durationStr,
            parsedSeconds: seconds,
            configDuration: configDuration || 'not set'
          });
        }).catch((err) => {
          console.warn('[TransformationUtils] Using 5m fallback duration - config value not available');
        });

        storeTransformationLimit('duration', 'min', 0);
        storeTransformationLimit('duration', 'max', 300); // 5 minutes default
      }).catch((configErr) => {
        // Config manager couldn't be loaded, fall back to 300s (5m)
        import('../legacyLoggerAdapter').then(({ warn }) => {
          warn('TransformationUtils', 'Failed to load VideoConfigurationManager, using 5m fallback', {
            defaultsApplied: true,
            settingMin: 0,
            settingMax: 300, // 5 minutes
            error: configErr instanceof Error ? configErr.message : String(configErr),
            requestedDuration: durationStr
          });
        }).catch((err) => {
          console.warn('[TransformationUtils] Failed to load configuration, using 5m fallback duration');
        });

        storeTransformationLimit('duration', 'min', 0);
        storeTransformationLimit('duration', 'max', 300); // 5 minutes default
      });
    } catch (outerErr) {
      // Catch any synchronous errors from the try block
      console.warn('[TransformationUtils] Error checking configuration, using 5m fallback duration');
      storeTransformationLimit('duration', 'min', 0);
      storeTransformationLimit('duration', 'max', 300); // 5 minutes default
    }
  }
  
  const minDuration = transformationLimits.duration.min;
  const maxDuration = transformationLimits.duration.max;
  
  import('../legacyLoggerAdapter').then(({ info, debug }) => {
    info('TransformationUtils', 'Checking duration against limits', {
      requestedDuration: durationStr,
      requestedSeconds: seconds,
      minDuration,
      maxDuration,
      shouldAdjustMin: seconds < minDuration,
      shouldAdjustMax: seconds > maxDuration,
      transformationLimits: JSON.stringify(transformationLimits)
    });
  }).catch((err) => {
    // Log error with standardized error handling
    logErrorWithContext(
      'Failed to import logger for duration limit check',
      err,
      { 
        durationStr, 
        seconds, 
        minDuration, 
        maxDuration 
      },
      'TransformationUtils'
    );
    console.info(`[TransformationUtils] Checking duration ${durationStr} (${seconds}s) against limits min=${minDuration}, max=${maxDuration}`);
  });
  
  // Adjust duration if outside limits
  if (seconds < minDuration) {
    const adjusted = formatTimeString(minDuration);
    import('../legacyLoggerAdapter').then(({ info, warn }) => {
      warn('TransformationUtils', 'Duration below minimum limit', {
        original: durationStr,
        originalSeconds: seconds,
        adjusted,
        adjustedSeconds: minDuration,
        minDuration,
        maxDuration
      });
    }).catch((err) => {
      // Log error with standardized error handling
      logErrorWithContext(
        'Failed to import logger for minimum duration adjustment',
        err,
        { 
          original: durationStr,
          originalSeconds: seconds,
          adjusted,
          adjustedSeconds: minDuration,
          minDuration,
          maxDuration
        },
        'TransformationUtils'
      );
      console.warn(`[TransformationUtils] Duration ${durationStr} below minimum limit of ${minDuration}s, adjusting to ${adjusted}`);
    });
    return adjusted;
  } else if (seconds > maxDuration) {
    // Use the integer value (floor) of the maximum value from the API response
    // This gives us a clean, stable value that's safely below the limit
    const safeMax = Math.floor(maxDuration);
    const adjusted = formatTimeString(safeMax);
    import('../legacyLoggerAdapter').then(({ info, warn }) => {
      warn('TransformationUtils', 'Duration exceeds maximum limit', {
        original: durationStr,
        originalSeconds: seconds,
        adjusted,
        adjustedSeconds: safeMax,
        maxDuration,
        isDefault: maxDuration === 30, // Check if using default or learned limit
        usedSafeMax: true
      });
    }).catch((err) => {
      // Log error with standardized error handling
      logErrorWithContext(
        'Failed to import logger for maximum duration adjustment',
        err,
        { 
          original: durationStr,
          originalSeconds: seconds,
          adjusted,
          adjustedSeconds: safeMax,
          maxDuration,
          isDefault: maxDuration === 30
        },
        'TransformationUtils'
      );
      console.warn(`[TransformationUtils] Duration ${durationStr} exceeds maximum limit of ${maxDuration}s, adjusting to ${adjusted}`);
    });
    return adjusted;
  }
  
  // Log no adjustment needed
  import('../legacyLoggerAdapter').then(({ debug }) => {
    debug('TransformationUtils', 'No duration adjustment needed', {
      duration: durationStr,
      seconds,
      minDuration,
      maxDuration,
      isDefault: maxDuration === 30 // Check if using default or learned limit
    });
  }).catch((err) => {
    // For debug level, we can skip the standardized logging to avoid noise
    console.debug(`[TransformationUtils] No duration adjustment needed for ${durationStr}`);
  });
  
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
  duration: {}, // Will be populated with min and max from API errors
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
/**
 * Utility functions for handling media transformation parameters
 * and translating between different CDN parameter formats
 */
import { VideoTransformOptions } from '../domain/commands/TransformVideoCommand';
import { tryOrNull, tryOrDefault, logErrorWithContext } from './errorHandlingUtils';

/**
 * Valid time units
 */
type TimeUnit = 's' | 'm';

/**
 * Mapping from Akamai params to Cloudflare params
 */
const AKAMAI_TO_CLOUDFLARE_MAPPING = {
  // Akamai Image & Video Manager params
  'w': 'width',
  'h': 'height',
  'dpr': 'dpr',
  'obj-fit': 'fit',
  'q': 'quality',
  'f': 'format',
  'start': 'time',
  'dur': 'duration',
  'mute': 'audio',
  'bitrate': 'bitrate',
  
  // Map Akamai value translations
  'fit-values': {
    'cover': 'cover',
    'contain': 'contain',
    'crop': 'cover',
    'fill': 'contain',
    'scale-down': 'scale-down'
  },
  
  // Advanced video options
  'quality': 'quality',
  'compression': 'compression',
  'loop': 'loop',
  'preload': 'preload',
  'autoplay': 'autoplay',
  'muted': 'muted',
  
  // IMQuery responsive image parameters
  'imwidth': 'width',
  'imheight': 'height',
  'imref': 'imref',
  'im-viewwidth': 'viewwidth',
  'im-viewheight': 'viewheight',
  'im-density': 'dpr',
  
  // Additional video parameters
  'fps': 'fps',
  'speed': 'speed',
  'crop': 'crop',
  'rotate': 'rotate'
};

/**
 * Implementation of translateAkamaiParamName that might throw errors
 */
function translateAkamaiParamNameImpl(akamaiParam: string): string | null {
  return AKAMAI_TO_CLOUDFLARE_MAPPING[akamaiParam as keyof typeof AKAMAI_TO_CLOUDFLARE_MAPPING] as string || null;
}

/**
 * Translate Akamai parameter name to Cloudflare parameter name
 * Using tryOrNull for safe parameter translation
 * 
 * @param akamaiParam Akamai parameter name
 * @returns Cloudflare parameter name or null if not supported
 */
export const translateAkamaiParamName = tryOrNull<[string], string | null>(
  translateAkamaiParamNameImpl,
  {
    functionName: 'translateAkamaiParamName',
    component: 'TransformationUtils',
    logErrors: false // Low importance function, avoid excessive logging
  }
);

/**
 * Implementation of translateAkamaiParamValue that might throw errors
 */
function translateAkamaiParamValueImpl(paramName: string, akamaiValue: string | boolean | number): string | boolean | number {
  // Handle special case for 'mute' param which inverts the meaning
  if (paramName === 'mute') {
    return !(akamaiValue === 'true' || akamaiValue === true);
  }
  
  // Handle fit value translations
  if (paramName === 'obj-fit' && typeof akamaiValue === 'string') {
    const fitValues = AKAMAI_TO_CLOUDFLARE_MAPPING['fit-values'] as Record<string, string>;
    return fitValues[akamaiValue] || akamaiValue;
  }
  
  return akamaiValue;
}

/**
 * Translate Akamai parameter value to Cloudflare parameter value
 * Using tryOrDefault for safe parameter translation
 * 
 * @param paramName Parameter name
 * @param akamaiValue Akamai parameter value
 * @returns Translated Cloudflare parameter value
 */
export const translateAkamaiParamValue = tryOrDefault<[string, string | boolean | number], string | boolean | number>(
  translateAkamaiParamValueImpl,
  {
    functionName: 'translateAkamaiParamValue',
    component: 'TransformationUtils',
    logErrors: true
  },
  '' // Return empty string as a safe default if translation fails
);

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

// In-memory cache for transformation limits discovered from API errors
// Initially empty - will be populated from API responses
const transformationLimits: Record<string, Record<string, number>> = {
  duration: {}, // Will be populated with min and max from API errors
  fileSize: {}  // Will be populated with max from API errors
};

/**
 * Implementation of storeTransformationLimit that might throw errors
 */
function storeTransformationLimitImpl(type: string, key: string, value: number): void {
  // Import logger dynamically to avoid circular dependencies
  import('../utils/legacyLoggerAdapter').then(({ debug }) => {
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
    import('../utils/legacyLoggerAdapter').then(({ debug }) => {
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
    import('../utils/legacyLoggerAdapter').then(({ warn }) => {
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
  import('../utils/legacyLoggerAdapter').then(({ info, warn }) => {
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
    import('../utils/legacyLoggerAdapter').then(({ warn }) => {
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
  
  // If we don't have learned limits yet, set default of 30s max duration
  if (!haveDurationLimits()) {
    import('../utils/legacyLoggerAdapter').then(({ info, warn }) => {
      // This is an important warning - configuration might not be loading properly
      warn('TransformationUtils', 'No duration limits found from configuration', {
        defaultsApplied: true,
        settingMin: 0,
        settingMax: 30,
        reason: 'Configuration might not be loading correctly',
        requestedDuration: durationStr,
        parsedSeconds: seconds
      });
      
      info('TransformationUtils', 'Setting default duration limits', {
        min: 0,
        max: 30,
        originalDuration: durationStr,
        seconds
      });
    }).catch((err) => {
      // Log error with standardized error handling
      logErrorWithContext(
        'Failed to import logger for default duration limits',
        err,
        { durationStr, seconds },
        'TransformationUtils'
      );
      console.warn('[TransformationUtils] No duration limits found - setting defaults of 0-30s');
    });
    
    storeTransformationLimit('duration', 'min', 0);
    storeTransformationLimit('duration', 'max', 30);
  }
  
  const minDuration = transformationLimits.duration.min;
  const maxDuration = transformationLimits.duration.max;
  
  import('../utils/legacyLoggerAdapter').then(({ info, debug }) => {
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
    import('../utils/legacyLoggerAdapter').then(({ info, warn }) => {
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
    import('../utils/legacyLoggerAdapter').then(({ info, warn }) => {
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
  import('../utils/legacyLoggerAdapter').then(({ debug }) => {
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
  const isDurationError = errorText.includes('duration: attribute must be between');
  
  // Log duration limit detection
  if (isDurationError) {
    import('../utils/legacyLoggerAdapter').then(({ debug }) => {
      debug('TransformationUtils', 'Detected duration limit error', {
        errorText: errorText.substring(0, 100), // Truncate for safety
        pattern: 'duration: attribute must be between'
      });
    }).catch((err) => {
      // Log error with standardized error handling
      logErrorWithContext(
        'Failed to import logger for duration limit detection',
        err,
        { 
          errorTextSample: errorText.substring(0, 50), // Truncate for safety
          pattern: 'duration: attribute must be between'
        },
        'TransformationUtils'
      );
    });
  }
  
  return isDurationError;
}

/**
 * Check if the error is related to duration limits
 * Using tryOrDefault for robust handling of error analysis
 * 
 * @param errorText The error message from the API
 * @returns Boolean indicating if it's a duration limit error
 */
export const isDurationLimitError = tryOrDefault<[string], boolean>(
  isDurationLimitErrorImpl,
  {
    functionName: 'isDurationLimitError',
    component: 'TransformationUtils',
    logErrors: true
  },
  false // Default to false if pattern matching fails
);

/**
 * Implementation of isValidFormatForMode that might throw errors
 */
function isValidFormatForModeImpl(options: VideoTransformOptions): boolean {
  // Format should only be used with frame mode
  if (options.format && options.mode !== 'frame') {
    return false;
  }
  return true;
}

/**
 * Validate that format is only used with frame mode
 * Using tryOrDefault for safe validation
 * 
 * @param options Video transform options
 * @returns If the format parameter is valid for the specified mode
 */
export const isValidFormatForMode = tryOrDefault<[VideoTransformOptions], boolean>(
  isValidFormatForModeImpl,
  {
    functionName: 'isValidFormatForMode',
    component: 'TransformationUtils',
    logErrors: true
  },
  true // Default to true if validation fails (safer to pass than to block)
);

/**
 * Implementation of isValidQuality that might throw errors
 */
function isValidQualityImpl(
  qualityValue: string | null, 
  validValues: string[]
): boolean {
  if (!qualityValue) return true;
  return validValues.includes(qualityValue);
}

/**
 * Validate quality parameter
 * Using tryOrDefault for safe validation
 * 
 * @param qualityValue Quality value
 * @param validValues Valid quality values
 * @returns If the quality is valid
 */
export const isValidQuality = tryOrDefault<[string | null, string[]], boolean>(
  isValidQualityImpl,
  {
    functionName: 'isValidQuality',
    component: 'TransformationUtils',
    logErrors: true
  },
  true // Default to true if validation fails (safer to pass than to block)
);

/**
 * Implementation of isValidCompression that might throw errors
 */
function isValidCompressionImpl(
  compressionValue: string | null, 
  validValues: string[]
): boolean {
  if (!compressionValue) return true;
  return validValues.includes(compressionValue);
}

/**
 * Validate compression parameter
 * Using tryOrDefault for safe validation
 * 
 * @param compressionValue Compression value
 * @param validValues Valid compression values
 * @returns If the compression is valid
 */
export const isValidCompression = tryOrDefault<[string | null, string[]], boolean>(
  isValidCompressionImpl,
  {
    functionName: 'isValidCompression',
    component: 'TransformationUtils',
    logErrors: true
  },
  true // Default to true if validation fails (safer to pass than to block)
);

/**
 * Implementation of isValidPreload that might throw errors
 */
function isValidPreloadImpl(
  preloadValue: string | null, 
  validValues: string[]
): boolean {
  if (!preloadValue) return true;
  return validValues.includes(preloadValue);
}

/**
 * Validate preload parameter
 * Using tryOrDefault for safe validation
 * 
 * @param preloadValue Preload value
 * @param validValues Valid preload values
 * @returns If the preload is valid
 */
export const isValidPreload = tryOrDefault<[string | null, string[]], boolean>(
  isValidPreloadImpl,
  {
    functionName: 'isValidPreload',
    component: 'TransformationUtils',
    logErrors: true
  },
  true // Default to true if validation fails (safer to pass than to block)
);

/**
 * Implementation of isValidPlaybackOptions that might throw errors
 */
function isValidPlaybackOptionsImpl(options: VideoTransformOptions): boolean {
  // Loop and autoplay should only be used with video mode
  if ((options.loop || options.autoplay) && options.mode !== 'video') {
    return false;
  }
  
  // If autoplay is true, audio must be disabled or muted
  if (options.autoplay === true) {
    // For autoplay to work properly, either audio must be off or muted must be true
    if (options.audio === true && options.muted !== true) {
      return false;
    }
  }
  
  return true;
}

/**
 * Validate that loop and autoplay parameters are used appropriately
 * Using tryOrDefault for safe validation with proper error handling
 * 
 * @param options Video transform options
 * @returns If the loop and autoplay parameters are valid for the specified mode
 */
export const isValidPlaybackOptions = tryOrDefault<[VideoTransformOptions], boolean>(
  isValidPlaybackOptionsImpl,
  {
    functionName: 'isValidPlaybackOptions',
    component: 'TransformationUtils',
    logErrors: true
  },
  true // Default to true if validation fails (safer to pass than to block)
);

/**
 * Implementation of translateAkamaiToCloudflareParams that might throw errors
 */
function translateAkamaiToCloudflareParamsImpl(
  akamaiParams: Record<string, string | boolean | number>
): Record<string, string | boolean | number> {
  const result: Record<string, string | boolean | number> = {};
  
  for (const [key, value] of Object.entries(akamaiParams)) {
    const cloudflareKey = translateAkamaiParamName(key);
    if (cloudflareKey) {
      result[cloudflareKey] = translateAkamaiParamValue(key, value);
    }
  }
  
  return result;
}

/**
 * Translate all parameters from Akamai format to Cloudflare format
 * Using tryOrDefault for safe parameter translation with proper error handling
 * 
 * @param akamaiParams Object with Akamai parameters
 * @returns Object with Cloudflare parameters
 */
export const translateAkamaiToCloudflareParams = tryOrDefault<
  [Record<string, string | boolean | number>],
  Record<string, string | boolean | number>
>(
  translateAkamaiToCloudflareParamsImpl,
  {
    functionName: 'translateAkamaiToCloudflareParams',
    component: 'TransformationUtils',
    logErrors: true
  },
  {} // Return empty object as safe default if translation fails
);

/**
 * Implementation of parseErrorMessage that might throw errors
 */
function parseErrorMessageImpl(errorText: string): {
  originalMessage: string;
  specificError?: string;
  errorType?: string;
  limitType?: string;
  parameter?: string;
} {
  const result = {
    originalMessage: errorText,
  };
  
  // Log the start of parsing
  import('../utils/legacyLoggerAdapter').then(({ debug }) => {
    debug('TransformationUtils', 'Parsing API error message', {
      errorText: errorText.substring(0, 100) // Truncate for safety
    });
  }).catch((err) => {
    // Log error with standardized error handling
    logErrorWithContext(
      'Failed to import logger for error message parsing',
      err,
      { errorTextSample: errorText.substring(0, 50) },
      'TransformationUtils'
    );
    console.debug(`[TransformationUtils] Parsing API error: ${errorText.substring(0, 50)}...`);
  });

  // Check for duration validation errors
  const durationMatch = errorText.match(/duration: attribute must be between (\d+)ms and ([\d.]+)s/i);
  if (durationMatch) {
    const minMs = parseInt(durationMatch[1], 10);
    const maxS = parseFloat(durationMatch[2]);
    
    // Log the discovered limits
    import('../utils/legacyLoggerAdapter').then(({ info }) => {
      info('TransformationUtils', 'Discovered duration limits from API error', {
        minMs,
        maxSeconds: maxS,
        convertedMinSeconds: minMs / 1000,
        errorType: 'duration_limit',
        pattern: 'duration validation error'
      });
    }).catch((err) => {
      // Log error with standardized error handling
      logErrorWithContext(
        'Failed to import logger for duration limit discovery',
        err,
        { 
          minMs, 
          maxS, 
          convertedMinSeconds: minMs / 1000 
        },
        'TransformationUtils'
      );
    });
    
    // Store the discovered limits
    storeTransformationLimit('duration', 'min', minMs / 1000); // Convert ms to seconds
    storeTransformationLimit('duration', 'max', maxS);
    
    return {
      ...result,
      specificError: `Duration must be between ${minMs}ms and ${maxS}s`,
      errorType: 'duration_limit',
      limitType: 'duration',
      parameter: 'duration'
    };
  }
  
  // Check for file size validation errors
  const fileSizeMatch = errorText.match(/Input video must be less than (\d+) bytes/i);
  if (fileSizeMatch) {
    const maxBytes = parseInt(fileSizeMatch[1], 10);
    const maxMB = Math.round(maxBytes / (1024 * 1024) * 10) / 10; // Convert to MB with 1 decimal
    
    // Log the discovered limit
    import('../utils/legacyLoggerAdapter').then(({ info }) => {
      info('TransformationUtils', 'Discovered file size limit from API error', {
        maxBytes,
        maxMB,
        errorType: 'file_size_limit',
        pattern: 'file size validation error'
      });
    }).catch((err) => {
      // Log error with standardized error handling
      logErrorWithContext(
        'Failed to import logger for file size limit discovery',
        err,
        { maxBytes, maxMB },
        'TransformationUtils'
      );
    });
    
    // Store the discovered limit
    storeTransformationLimit('fileSize', 'max', maxBytes);
    
    return {
      ...result,
      specificError: `Video file size must be less than ${maxMB}MB`,
      errorType: 'file_size_limit',
      limitType: 'fileSize',
      parameter: 'fileSize'
    };
  }
  
  // Log that no specific error pattern was matched
  import('../utils/legacyLoggerAdapter').then(({ debug }) => {
    debug('TransformationUtils', 'No specific error pattern matched', {
      errorText: errorText.substring(0, 100) // Truncate for safety
    });
  }).catch((err) => {
    // For debug level, we can skip detailed error logging to reduce noise
    console.debug(`[TransformationUtils] No specific error pattern matched in: ${errorText.substring(0, 50)}...`);
  });
  
  // Add more error patterns as they are discovered
  
  return result;
}

/**
 * Parse error messages from Cloudflare's API to extract specific validation issues
 * Using tryOrDefault for safe error parsing with proper error handling
 * 
 * @param errorText - The error message text from Cloudflare's API
 * @returns An object with parsed error details and original error message
 */
export const parseErrorMessage = tryOrDefault<
  [string],
  {
    originalMessage: string;
    specificError?: string;
    errorType?: string;
    limitType?: string;
    parameter?: string;
  }
>(
  parseErrorMessageImpl,
  {
    functionName: 'parseErrorMessage',
    component: 'TransformationUtils',
    logErrors: true
  },
  { originalMessage: 'Error parsing failed' } // Default to a simple error message if parsing fails
);
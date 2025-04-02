/**
 * Utility functions for handling media transformation parameters
 * and translating between different CDN parameter formats
 */
import { VideoTransformOptions } from '../domain/commands/TransformVideoCommand';

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
 * Translate Akamai parameter name to Cloudflare parameter name
 * @param akamaiParam Akamai parameter name
 * @returns Cloudflare parameter name or null if not supported
 */
export function translateAkamaiParamName(akamaiParam: string): string | null {
  return AKAMAI_TO_CLOUDFLARE_MAPPING[akamaiParam as keyof typeof AKAMAI_TO_CLOUDFLARE_MAPPING] as string || null;
}

/**
 * Translate Akamai parameter value to Cloudflare parameter value
 * @param paramName Parameter name
 * @param akamaiValue Akamai parameter value
 * @returns Translated Cloudflare parameter value
 */
export function translateAkamaiParamValue(paramName: string, akamaiValue: string | boolean | number): string | boolean | number {
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
 * Parse time string to seconds
 * @param timeStr Time string like "5s" or "2m"
 * @returns Time in seconds or null if invalid
 */
export function parseTimeString(timeStr: string): number | null {
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
 * Format seconds to time string
 * @param seconds Time in seconds
 * @returns Formatted time string (e.g., "5s" or "2m")
 */
export function formatTimeString(seconds: number): string {
  if (seconds >= 60) {
    const minutes = Math.floor(seconds / 60);
    return `${minutes}m`;
  }
  return `${seconds}s`;
}

/**
 * Validate time parameter
 * @param timeStr Time string
 * @returns If the time is valid according to Cloudflare limits (0-30s)
 */
export function isValidTime(timeStr: string | null): boolean {
  if (!timeStr) return true;
  
  const seconds = parseTimeString(timeStr);
  if (seconds === null) return false;
  
  // Cloudflare Media Transformation limits time to 0-30s
  return seconds >= 0 && seconds <= 30;
}

// In-memory cache for transformation limits discovered from API errors
// Initially empty - will be populated from API responses
const transformationLimits: Record<string, Record<string, number>> = {
  duration: {}, // Will be populated with min and max from API errors
  fileSize: {}  // Will be populated with max from API errors
};

/**
 * Store discovered transformation limit
 * 
 * @param type - The type of limit (duration, fileSize, etc.)
 * @param key - The limit key (max, min, etc.)
 * @param value - The limit value
 */
export function storeTransformationLimit(type: string, key: string, value: number): void {
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
 * Get a transformation limit
 * 
 * @param type - The type of limit (duration, fileSize, etc.)
 * @param key - The limit key (max, min, etc.)
 * @returns The limit value
 */
export function getTransformationLimit(type: string, key: string): number | undefined {
  return transformationLimits[type]?.[key];
}

/**
 * Check if we have learned duration limits
 * @returns Whether we have both min and max duration limits
 */
export function haveDurationLimits(): boolean {
  return 'min' in transformationLimits.duration && 
         'max' in transformationLimits.duration;
}

/**
 * Validate duration parameter format
 * @param durationStr Duration string
 * @returns If the duration is a valid format (regardless of limits)
 */
export function isValidDuration(durationStr: string | null): boolean {
  if (!durationStr) return true;
  
  const seconds = parseTimeString(durationStr);
  if (seconds === null) return false;
  
  // Only validate that it's a non-negative value (0 is allowed)
  return seconds >= 0;
}

/**
 * Check if duration is within learned limits
 * @param durationStr Duration string
 * @returns If the duration is within known limits
 */
export function isDurationWithinLimits(durationStr: string | null): boolean {
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
    }).catch(() => {});
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
    }).catch(() => {});
  }
  
  // Use our learned limits for validation
  return isWithinLimits;
}

/**
 * Adjust duration to be within valid limits
 * @param durationStr Duration string
 * @param useSafeMax Whether to use a safe integer maximum (slightly below the actual max)
 * @returns Adjusted duration string or original if already valid or no limits known
 */
export function adjustDuration(durationStr: string | null, useSafeMax: boolean = false): string | null {
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
    // Fallback to console for logging
    console.info(`[TransformationUtils] Adjusting duration: ${durationStr}`, {
      error: err instanceof Error ? err.message : String(err)
    });
  });
  
  const seconds = parseTimeString(durationStr);
  if (seconds === null) {
    // Log invalid duration format
    import('../utils/legacyLoggerAdapter').then(({ warn }) => {
      warn('TransformationUtils', 'Invalid duration format', {
        durationStr,
        reason: 'Failed to parse time string'
      });
    }).catch(() => {
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
    }).catch(() => {
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
  }).catch(() => {
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
    }).catch(() => {
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
    }).catch(() => {
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
  }).catch(() => {
    console.debug(`[TransformationUtils] No duration adjustment needed for ${durationStr}`);
  });
  
  return durationStr;
}

/**
 * Check if the error is related to duration limits
 * @param errorText The error message from the API
 * @returns Boolean indicating if it's a duration limit error
 */
export function isDurationLimitError(errorText: string): boolean {
  const isDurationError = errorText.includes('duration: attribute must be between');
  
  // Log duration limit detection
  if (isDurationError) {
    import('../utils/legacyLoggerAdapter').then(({ debug }) => {
      debug('TransformationUtils', 'Detected duration limit error', {
        errorText: errorText.substring(0, 100), // Truncate for safety
        pattern: 'duration: attribute must be between'
      });
    }).catch(() => {});
  }
  
  return isDurationError;
}

/**
 * Validate that format is only used with frame mode
 * @param options Video transform options
 * @returns If the format parameter is valid for the specified mode
 */
export function isValidFormatForMode(options: VideoTransformOptions): boolean {
  // Format should only be used with frame mode
  if (options.format && options.mode !== 'frame') {
    return false;
  }
  return true;
}

/**
 * Validate quality parameter
 * @param qualityValue Quality value
 * @param validValues Valid quality values
 * @returns If the quality is valid
 */
export function isValidQuality(
  qualityValue: string | null, 
  validValues: string[]
): boolean {
  if (!qualityValue) return true;
  return validValues.includes(qualityValue);
}

/**
 * Validate compression parameter
 * @param compressionValue Compression value
 * @param validValues Valid compression values
 * @returns If the compression is valid
 */
export function isValidCompression(
  compressionValue: string | null, 
  validValues: string[]
): boolean {
  if (!compressionValue) return true;
  return validValues.includes(compressionValue);
}

/**
 * Validate preload parameter
 * @param preloadValue Preload value
 * @param validValues Valid preload values
 * @returns If the preload is valid
 */
export function isValidPreload(
  preloadValue: string | null, 
  validValues: string[]
): boolean {
  if (!preloadValue) return true;
  return validValues.includes(preloadValue);
}

/**
 * Validate that loop and autoplay parameters are used appropriately
 * @param options Video transform options
 * @returns If the loop and autoplay parameters are valid for the specified mode
 */
export function isValidPlaybackOptions(options: VideoTransformOptions): boolean {
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
 * Translate all parameters from Akamai format to Cloudflare format
 * @param akamaiParams Object with Akamai parameters
 * @returns Object with Cloudflare parameters
 */
export function translateAkamaiToCloudflareParams(
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
 * Parse error messages from Cloudflare's API to extract specific validation issues
 * This helps provide more detailed error information to clients
 * 
 * @param errorText - The error message text from Cloudflare's API
 * @returns An object with parsed error details and original error message
 */
export function parseErrorMessage(errorText: string): {
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
  }).catch(() => {
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
    }).catch(() => {});
    
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
    }).catch(() => {});
    
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
  }).catch(() => {});
  
  // Add more error patterns as they are discovered
  
  return result;
}
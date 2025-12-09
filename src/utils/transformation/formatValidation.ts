/**
 * Media format validation utilities
 */
import { VideoTransformOptions } from '../../domain/commands/TransformVideoCommand';
import { tryOrDefault } from '../errorHandlingUtils';

/**
 * Implementation of isValidFormatForMode that might throw errors
 */
function isValidFormatForModeImpl(options: VideoTransformOptions): boolean {
  if (!options.format) return true;

  if (options.mode === 'frame') {
    return ['jpg', 'jpeg', 'png'].includes(options.format.toLowerCase());
  }

  if (options.mode === 'audio') {
    return options.format.toLowerCase() === 'm4a';
  }

  // Format not allowed for other modes
  return false;
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

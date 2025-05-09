/**
 * Transformation Utilities
 * Re-exports all functionality to maintain backward compatibility
 */

// Export parameter mapping functions
export {
  AKAMAI_TO_CLOUDFLARE_MAPPING,
  translateAkamaiParamName,
  translateAkamaiParamValue,
  translateAkamaiToCloudflareParams
} from './parameterMapping';

// Export time utilities
export {
  parseTimeString,
  formatTimeString,
  isValidTime,
  isValidDuration,
  isDurationWithinLimits,
  adjustDuration,
  isDurationLimitError,
  transformationLimits,
  storeTransformationLimit,
  getTransformationLimit,
  haveDurationLimits
} from './timeUtils';

// Export format validation
export {
  isValidFormatForMode,
  isValidQuality,
  isValidCompression,
  isValidPreload,
  isValidPlaybackOptions
} from './formatValidation';

// Export error handling
export {
  parseErrorMessage
} from './errorHandling';
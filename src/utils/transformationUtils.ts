/**
 * Utility functions for handling media transformation parameters
 * and translating between different CDN parameter formats
 */
import { VideoTransformOptions } from '../domain/commands/TransformVideoCommand';

/**
 * Time format interface
 */
interface TimeFormat {
  value: number;
  unit: 's' | 'm';
}

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
  'muted': 'muted'
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

/**
 * Validate duration parameter
 * @param durationStr Duration string
 * @returns If the duration is valid
 */
export function isValidDuration(durationStr: string | null): boolean {
  if (!durationStr) return true;
  
  const seconds = parseTimeString(durationStr);
  if (seconds === null) return false;
  
  // Duration must be positive
  return seconds > 0;
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
/**
 * Service for determining video processing options from request parameters
 */
import { videoConfig } from '../config/videoConfig';
import { VideoTransformOptions } from '../domain/commands/TransformVideoCommand';
import { translateAkamaiParamName, translateAkamaiParamValue } from '../utils/transformationUtils';

/**
 * Type for video derivatives
 */
type VideoDerivativeKey = keyof typeof videoConfig.derivatives;

/**
 * Extract and normalize video processing options from URL parameters
 * @param request The HTTP request
 * @param params URL search parameters
 * @param path URL path
 * @returns Normalized video processing options
 */
export function determineVideoOptions(
  request: Request,
  params: URLSearchParams,
  path: string
): VideoTransformOptions {
  // Start with default options
  const options: VideoTransformOptions = { 
    ...videoConfig.defaults,
    source: undefined,
    derivative: null
  };

  // Check if a derivative was specified
  const derivative = params.get('derivative');
  if (derivative && isValidDerivative(derivative)) {
    // Apply derivative configuration
    Object.assign(options, videoConfig.derivatives[derivative]);
    options.derivative = derivative;
  }

  // Apply individual parameters that override the derivative
  
  // Process both standard Cloudflare params and Akamai format params
  params.forEach((value, key) => {
    // Check if this is an Akamai format parameter
    const translatedKey = translateAkamaiParamName(key);
    const paramKey = translatedKey || key;

    // Handle parameters based on their proper name
    switch (paramKey) {
      case 'mode':
        if (videoConfig.validOptions.mode.includes(value)) {
          options.mode = value;
        }
        break;
        
      case 'width':
        options.width = parseIntOrNull(value);
        break;
        
      case 'height':
        options.height = parseIntOrNull(value);
        break;
        
      case 'fit':
        // For Akamai params, translate the value if needed
        let fitValue = value;
        if (translatedKey) {
          fitValue = translateAkamaiParamValue(key, value) as string;
        }
        
        if (videoConfig.validOptions.fit.includes(fitValue)) {
          options.fit = fitValue;
        }
        break;
        
      case 'audio':
        // For Akamai 'mute' param, invert the value
        let audioValue = value;
        if (translatedKey && key === 'mute') {
          audioValue = translateAkamaiParamValue(key, value) as string;
        }
        
        if (audioValue === 'true' || audioValue === 'false') {
          options.audio = audioValue === 'true';
        }
        break;
        
      case 'format':
        if (videoConfig.validOptions.format.includes(value)) {
          options.format = value;
        }
        break;
        
      case 'time':
        options.time = value;
        break;
        
      case 'duration':
        options.duration = value;
        break;
        
      default:
        // Ignore parameters that don't match our known ones
        break;
    }
  });

  // Metadata about how the options were generated
  options.source = derivative ? 'derivative' : 'params';

  return options;
}

/**
 * Parse a string to an integer or return null if invalid
 * @param value String value to parse
 * @returns Parsed integer or null
 */
function parseIntOrNull(value: string | null): number | null {
  if (!value) return null;

  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? null : parsed;
}

/**
 * Check if a derivative is valid
 * @param derivative Derivative name to check
 * @returns True if derivative exists in config
 */
function isValidDerivative(derivative: string): derivative is VideoDerivativeKey {
  return derivative in videoConfig.derivatives;
}

/**
 * Service for determining video processing options from request parameters
 * Part of the service architecture improvements to use a service-oriented approach
 */
import { videoConfig } from '../config/videoConfig';
import { VideoTransformOptions } from '../domain/commands/TransformVideoCommand';
import { translateAkamaiParamName, translateAkamaiParamValue } from '../utils/transformationUtils';
import { getResponsiveVideoSize } from '../utils/responsiveWidthUtils';
import { getCurrentContext } from '../utils/legacyLoggerAdapter';
import { addBreadcrumb } from '../utils/requestContext';

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
  _path: string
): VideoTransformOptions {
  // Start with default options
  const options: VideoTransformOptions = { 
    ...videoConfig.defaults,
    source: undefined,
    derivative: null
  };

  // Get the request context for breadcrumbs
  const requestContext = getCurrentContext();
  
  // Check if a derivative was specified
  const derivative = params.get('derivative');
  if (derivative && isValidDerivative(derivative)) {
    // Apply derivative configuration
    Object.assign(options, videoConfig.derivatives[derivative]);
    options.derivative = derivative;
    
    // Add breadcrumb for derivative selection
    if (requestContext) {
      const derivativeConfig = videoConfig.derivatives[derivative];
      addBreadcrumb(requestContext, 'Client', 'Applied video derivative', {
        derivative,
        width: derivativeConfig.width,
        height: derivativeConfig.height,
        quality: 'quality' in derivativeConfig ? derivativeConfig.quality : undefined,
        format: 'format' in derivativeConfig ? derivativeConfig.format : undefined
      });
    }
  }

  // Process both standard Cloudflare params and Akamai format params
  let explicitWidth: number | null = null;
  let explicitHeight: number | null = null;
  let autoQuality = false;
  
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
        explicitWidth = parseIntOrNull(value);
        options.width = explicitWidth;
        break;
        
      case 'height':
        explicitHeight = parseIntOrNull(value);
        options.height = explicitHeight;
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
        
      case 'quality':
        // Check for auto-quality flag
        if (value === 'auto') {
          autoQuality = true;
        } else if (videoConfig.validOptions.quality.includes(value)) {
          options.quality = value;
        }
        break;
        
      case 'compression':
        if (videoConfig.validOptions.compression.includes(value)) {
          options.compression = value;
        }
        break;
        
      case 'loop':
        if (value === 'true' || value === 'false') {
          options.loop = value === 'true';
        }
        break;
        
      case 'preload':
        if (videoConfig.validOptions.preload.includes(value)) {
          options.preload = value;
        }
        break;
        
      case 'autoplay':
        if (value === 'true' || value === 'false') {
          options.autoplay = value === 'true';
        }
        break;
        
      case 'muted':
        if (value === 'true' || value === 'false') {
          options.muted = value === 'true';
        }
        break;
        
      default:
        // Ignore parameters that don't match our known ones
        break;
    }
  });

  // Apply responsive sizing if width/height aren't explicitly set or auto quality is requested
  if (autoQuality || (!explicitWidth && !explicitHeight)) {
    const responsiveSize = getResponsiveVideoSize(request, explicitWidth, explicitHeight);
    
    // Only override values that weren't explicitly set
    if (!explicitWidth) {
      options.width = responsiveSize.width;
    }
    
    if (!explicitHeight) {
      options.height = responsiveSize.height;
    }
    
    // Add responsive source information to options
    options.source = options.source || responsiveSize.method;
    
    // Add breadcrumb for responsive sizing
    if (requestContext) {
      addBreadcrumb(requestContext, 'Client', 'Applied responsive sizing', {
        width: options.width,
        height: options.height,
        method: responsiveSize.method,
        clientHints: responsiveSize.usingClientHints,
        deviceType: responsiveSize.deviceType,
        viewportWidth: responsiveSize.viewportWidth,
        explicitDimensions: !!(explicitWidth || explicitHeight)
      });
    }
  }
  // Otherwise set the source based on how options were generated
  else {
    options.source = derivative ? 'derivative' : 'params';
    
    // Add breadcrumb for explicit dimensions
    if (requestContext) {
      addBreadcrumb(requestContext, 'Client', 'Using explicit dimensions', {
        width: options.width,
        height: options.height,
        source: options.source
      });
    }
  }

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

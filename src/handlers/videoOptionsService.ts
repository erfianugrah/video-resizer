/**
 * Service for determining video processing options from request parameters
 * Part of the service architecture improvements to use a service-oriented approach
 */
import { VideoConfigurationManager } from '../config/VideoConfigurationManager';
import { VideoTransformOptions } from '../domain/commands/TransformVideoCommand';
import { translateAkamaiParamName, translateAkamaiParamValue } from '../utils/transformationUtils';
import { getResponsiveVideoSize } from '../utils/responsiveWidthUtils';
import { getCurrentContext } from '../utils/legacyLoggerAdapter';
import { addBreadcrumb } from '../utils/requestContext';
import { hasIMQueryParams, convertImQueryToClientHints, parseImQueryRef, validateAkamaiParams, findClosestDerivative } from '../utils/imqueryUtils';
import { debug, info, warn } from '../utils/loggerUtils';

/**
 * Type for video derivatives
 */
type VideoDerivativeKey = string;

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
  // Get the configuration manager instance
  // This manager is initialized by ConfigurationService during worker startup
  const configManager = VideoConfigurationManager.getInstance();
  
  // Start with default options
  const options: VideoTransformOptions = { 
    ...configManager.getDefaults(),
    source: undefined,
    derivative: null
  };

  // Get the request context for breadcrumbs
  const requestContext = getCurrentContext();
  
  // Check for IMQuery parameters
  const usingIMQuery = hasIMQueryParams(params);
  
  // Store original parameters for diagnostics if IMQuery is present
  if (usingIMQuery && requestContext) {
    // Extract parameters and convert to object for diagnostics
    const originalParams: Record<string, string> = {};
    params.forEach((value, key) => {
      originalParams[key] = value;
    });
    
    // Validate IMQuery parameters
    const validationResult = validateAkamaiParams(originalParams);
    if (!validationResult.isValid && validationResult.warnings.length > 0) {
      warn('IMQuery', 'IMQuery parameter validation warnings', { 
        warnings: validationResult.warnings 
      });
      
      // Store warnings in request context for debug UI
      if (requestContext.diagnostics) {
        requestContext.diagnostics.translationWarnings = validationResult.warnings;
      }
    }
    
    // Store in request context for debug UI
    if (requestContext.diagnostics) {
      requestContext.diagnostics.originalAkamaiParams = originalParams;
      requestContext.diagnostics.usingIMQuery = true;
    }
    
    // Look for IMQuery dimensions
    const imwidth = parseIntOrNull(params.get('imwidth'));
    const imheight = parseIntOrNull(params.get('imheight'));
    
    // Find closest derivative match
    if (imwidth || imheight) {
      // The method is determined inside findClosestDerivative
      // If only width is provided, it will try breakpoint-based matching first
      const matchedDerivative = findClosestDerivative(imwidth, imheight);
      
      if (matchedDerivative && isValidDerivative(matchedDerivative)) {
        // Get the configuration manager instance
        const configManager = VideoConfigurationManager.getInstance();
        
        // Store original requested dimensions before applying derivative configuration
        const requestedWidth = imwidth;
        const requestedHeight = imheight;
        
        // Apply derivative configuration
        Object.assign(options, configManager.getConfig().derivatives[matchedDerivative]);
        options.derivative = matchedDerivative;
        options.source = 'imquery-derivative';
        
        // Store original dimensions in customData for reference
        if (!options.customData) {
          options.customData = {};
        }
        
        options.customData.requestedWidth = requestedWidth;
        options.customData.requestedHeight = requestedHeight;
        options.customData.mappedFrom = 'imquery';
        
        // Determine mapping method used for diagnostics
        const mappingMethod = (imwidth && !imheight) 
          ? 'breakpoint' 
          : 'percentage';
        
        // IMPORTANT: Log derivative configuration to understand caching issues
        debug('IMQuery', 'Applied derivative configuration for caching', {
          derivative: matchedDerivative,
          mappingMethod,
          requestedWidth,
          requestedHeight,
          appliedWidth: options.width,
          appliedHeight: options.height,
          originalQueryParams: Object.fromEntries(params.entries())
        });
        
        // Store diagnostics
        if (requestContext.diagnostics) {
          requestContext.diagnostics.imqueryMatching = {
            requestedWidth: requestedWidth,
            requestedHeight: requestedHeight,
            matchedDerivative: matchedDerivative,
            derivativeWidth: configManager.getConfig().derivatives[matchedDerivative].width,
            derivativeHeight: configManager.getConfig().derivatives[matchedDerivative].height,
            mappingMethod
          };
        }
        
        // Add breadcrumb for derivative selection
        addBreadcrumb(requestContext, 'Client', 'Matched IMQuery dimensions to derivative', {
          requestedWidth,
          requestedHeight,
          derivative: matchedDerivative,
          derivativeWidth: configManager.getConfig().derivatives[matchedDerivative].width,
          derivativeHeight: configManager.getConfig().derivatives[matchedDerivative].height,
          mappingMethod,
          source: 'imquery-derivative'
        });
        
        info('IMQuery', 'Applied derivative based on IMQuery dimensions', {
          requestedWidth,
          requestedHeight,
          derivative: matchedDerivative,
          appliedWidth: options.width,
          appliedHeight: options.height,
          mappingMethod,
          source: 'imquery-derivative'
        });
      } else {
        // No matching derivative, fall back to direct dimensions
        debug('IMQuery', 'No matching derivative for IMQuery dimensions', {
          imwidth,
          imheight
        });
        
        // Apply IMQuery dimensions directly
        if (imwidth) options.width = imwidth;
        if (imheight) options.height = imheight;
      }
    }
    
    // Process imref parameter if present
    if (params.has('imref')) {
      const imrefValue = params.get('imref') || '';
      const imrefParams = parseImQueryRef(imrefValue);
      
      debug('IMQuery', 'Parsed IMQuery reference', { 
        imref: imrefValue, 
        params: imrefParams 
      });
      
      // Add breadcrumb for IMQuery reference
      addBreadcrumb(requestContext, 'Client', 'Processed IMQuery reference', {
        imref: imrefValue,
        paramCount: Object.keys(imrefParams).length
      });
    }
    
    // Convert IMQuery to client hints if present
    const clientHints = convertImQueryToClientHints(params);
    if (Object.keys(clientHints).length > 0) {
      // Create enhanced request with client hints
      const headers = new Headers(request.headers);
      
      // Add client hints headers
      for (const [key, value] of Object.entries(clientHints)) {
        headers.set(key, value);
      }
      
      // Create new request with enhanced headers
      const enhancedRequest = new Request(request.url, {
        method: request.method,
        headers,
        body: request.body,
        redirect: request.redirect,
        integrity: request.integrity,
        signal: request.signal
      });
      
      // Use the enhanced request for further processing
      request = enhancedRequest;
      
      info('IMQuery', 'Enhanced request with IMQuery client hints', { 
        addedHeaders: clientHints 
      });
      
      // Add breadcrumb for client hints conversion
      if (requestContext) {
        addBreadcrumb(requestContext, 'Client', 'Converted IMQuery to client hints', {
          headers: clientHints
        });
      }
    }
  }
  
  // Check if a derivative was specified
  const derivative = params.get('derivative');
  if (derivative && isValidDerivative(derivative)) {
    // Apply derivative configuration
    Object.assign(options, configManager.getConfig().derivatives[derivative]);
    options.derivative = derivative;
    
    // Add breadcrumb for derivative selection
    if (requestContext) {
      const derivativeConfig = configManager.getConfig().derivatives[derivative];
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
  
  // Extract parameters for translation
  const paramObject: Record<string, string | boolean | number> = {};
  params.forEach((value, key) => {
    paramObject[key] = value;
  });
  
  // Translate parameters and store for debug UI
  const translatedParams: Record<string, string | boolean | number> = {};
  
  params.forEach((value, key) => {
    // Check if this is an Akamai format parameter
    const translatedKey = translateAkamaiParamName(key);
    const paramKey = translatedKey || key;
    
    // Store in translated parameters object for debugging
    if (translatedKey) {
      let translatedValue: string | boolean | number = value;
      translatedValue = translateAkamaiParamValue(key, value);
      translatedParams[translatedKey] = translatedValue;
    }

    // Handle parameters based on their proper name
    switch (paramKey) {
      case 'mode':
        if (configManager.getValidOptions('mode').includes(value)) {
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
        
        if (configManager.getValidOptions('fit').includes(fitValue)) {
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
        if (configManager.getValidOptions('format').includes(value)) {
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
        } else if (configManager.getValidOptions('quality').includes(value)) {
          options.quality = value;
        }
        break;
        
      case 'compression':
        if (configManager.getValidOptions('compression').includes(value)) {
          options.compression = value;
        }
        break;
        
      case 'loop':
        if (value === 'true' || value === 'false') {
          options.loop = value === 'true';
        }
        break;
        
      case 'preload':
        if (configManager.getValidOptions('preload').includes(value)) {
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
        
      // Handle additional video parameters
      case 'fps':
        const fpsValue = parseFloat(value);
        if (!isNaN(fpsValue) && fpsValue > 0) {
          options.fps = fpsValue;
        }
        break;
        
      case 'speed':
        const speedValue = parseFloat(value);
        if (!isNaN(speedValue) && speedValue > 0) {
          options.speed = speedValue;
        }
        break;
        
      case 'rotate':
        const rotateValue = parseFloat(value);
        if (!isNaN(rotateValue)) {
          options.rotate = rotateValue;
        }
        break;
        
      case 'crop':
        options.crop = value;
        break;
        
      default:
        // Ignore parameters that don't match our known ones
        break;
    }
  });
  
  // Store translated parameters for debugging
  if (Object.keys(translatedParams).length > 0 && requestContext && requestContext.diagnostics) {
    requestContext.diagnostics.translatedCloudflareParams = translatedParams;
  }

  // Check if dimensions are already set by derivative
  const hasDerivativeDimensions = options.derivative && 
                               (typeof options.width === 'number' || 
                                typeof options.height === 'number');
  
  // Apply responsive sizing if no explicit dimensions (URL or derivative)
  if (autoQuality || (!explicitWidth && !explicitHeight && !hasDerivativeDimensions)) {
    const responsiveSize = getResponsiveVideoSize(request, explicitWidth, explicitHeight);
    
    // Only override values that weren't explicitly set
    if (!explicitWidth && !hasDerivativeDimensions) {
      options.width = responsiveSize.width;
    }
    
    if (!explicitHeight && !hasDerivativeDimensions) {
      options.height = responsiveSize.height;
    }
    
    // Add responsive source information to options
    options.source = options.source || responsiveSize.method;
    if (usingIMQuery) {
      options.source = 'imquery';
    }
    
    // Add breadcrumb for responsive sizing
    if (requestContext) {
      addBreadcrumb(requestContext, 'Client', 'Applied responsive sizing', {
        width: options.width,
        height: options.height,
        method: responsiveSize.method,
        clientHints: responsiveSize.usingClientHints,
        deviceType: responsiveSize.deviceType,
        viewportWidth: responsiveSize.viewportWidth,
        explicitDimensions: !!(explicitWidth || explicitHeight),
        derivativeDimensions: hasDerivativeDimensions,
        derivative: options.derivative,
        usingIMQuery
      });
    }
  }
  // Otherwise set the source based on how options were generated
  else {
    if (hasDerivativeDimensions) {
      options.source = 'derivative';
    } else if (usingIMQuery) {
      options.source = 'imquery';
    } else {
      options.source = derivative ? 'derivative' : 'params';
    }
    
    // Add breadcrumb for explicit dimensions
    if (requestContext) {
      addBreadcrumb(requestContext, 'Client', 'Using explicit dimensions', {
        width: options.width,
        height: options.height,
        source: options.source,
        hasDerivativeDimensions: hasDerivativeDimensions,
        derivative: options.derivative,
        usingIMQuery
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
  const configManager = VideoConfigurationManager.getInstance();
  return derivative in configManager.getConfig().derivatives;
}

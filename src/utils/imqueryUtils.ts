/**
 * Utilities for handling Akamai IMQuery parameters
 */
import { debug, info } from './loggerUtils';
import { videoConfig } from '../config/videoConfig';

/**
 * Parse IMQuery reference parameter
 * @param imref - IMQuery reference parameter
 * @returns Parsed parameters object
 */
export function parseImQueryRef(imref: string): Record<string, string> {
  // Format: key1=value1,key2=value2,...
  const result: Record<string, string> = {};
  
  if (!imref) return result;
  
  debug('IMQuery', 'Parsing imref parameter', { imref });
  
  const params = imref.split(',');
  for (const param of params) {
    const [key, value] = param.split('=');
    if (key && value) {
      result[key] = value;
    }
  }
  
  debug('IMQuery', 'Parsed imref parameter', { result });
  return result;
}

/**
 * Convert IMQuery parameters to client hints format
 * @param params - IMQuery parameters
 * @returns Parameters in client hints format
 */
export function convertImQueryToClientHints(
  params: URLSearchParams
): Record<string, string> {
  const result: Record<string, string> = {};
  
  // Map IMQuery to client hints
  if (params.has('im-viewwidth')) {
    result['Sec-CH-Viewport-Width'] = params.get('im-viewwidth')!;
  }
  
  if (params.has('im-viewheight')) {
    result['Viewport-Height'] = params.get('im-viewheight')!;
  }
  
  if (params.has('im-density')) {
    result['Sec-CH-DPR'] = params.get('im-density')!;
  }
  
  if (params.has('imwidth')) {
    result['Width'] = params.get('imwidth')!;
  }
  
  if (params.has('imheight')) {
    result['Height'] = params.get('imheight')!;
  }
  
  debug('IMQuery', 'Converted IMQuery to client hints', { 
    imQueryParams: Object.fromEntries(params.entries()),
    clientHints: result 
  });
  
  return result;
}

/**
 * Detect if request contains IMQuery parameters
 * @param params - URL search parameters
 * @returns Boolean indicating if IMQuery parameters are present
 */
export function hasIMQueryParams(params: URLSearchParams): boolean {
  const imQueryParams = [
    'imwidth', 
    'imheight', 
    'imref', 
    'im-viewwidth', 
    'im-viewheight', 
    'im-density'
  ];
  
  return imQueryParams.some(param => params.has(param));
}

/**
 * Finds the closest derivative matching the requested dimensions
 * Uses Euclidean distance formula for matching when both dimensions are provided,
 * or single dimension distance when only one is provided
 * 
 * @param targetWidth - Requested width (from IMQuery)
 * @param targetHeight - Requested height (from IMQuery)
 * @param maxDifferenceThreshold - Maximum percentage difference allowed (0.25 = 25%)
 * @returns Name of the closest derivative or null if no good match
 */
export function findClosestDerivative(
  targetWidth?: number | null,
  targetHeight?: number | null,
  maxDifferenceThreshold: number = 0.25
): string | null {
  // If no dimensions provided, we can't match
  if (!targetWidth && !targetHeight) {
    debug('IMQuery', 'No dimensions provided for derivative matching', {
      targetWidth,
      targetHeight
    });
    return null;
  }
  
  // Get derivatives with dimensions defined
  const derivatives = Object.entries(videoConfig.derivatives)
    .filter(([_, config]) => 
      (typeof config.width === 'number' && config.width > 0) || 
      (typeof config.height === 'number' && config.height > 0)
    );
  
  if (derivatives.length === 0) {
    debug('IMQuery', 'No derivatives with dimensions found', {
      totalDerivatives: Object.keys(videoConfig.derivatives).length
    });
    return null;
  }
  
  // Calculate "distance" score for each derivative
  const scored = derivatives.map(([name, config]) => {
    const width = config.width || 0;
    const height = config.height || 0;
    
    // Calculate Euclidean distance or single-dimension difference
    let distance = 0;
    let percentDifference = 0;
    
    if (targetWidth && targetHeight && width && height) {
      // Both dimensions available - use Euclidean distance
      distance = Math.sqrt(
        Math.pow((width - targetWidth), 2) + 
        Math.pow((height - targetHeight), 2)
      );
      
      // Calculate percent difference as average of width and height differences
      const widthDiff = Math.abs((width - targetWidth) / targetWidth);
      const heightDiff = Math.abs((height - targetHeight) / targetHeight);
      percentDifference = (widthDiff + heightDiff) / 2;
      
    } else if (targetWidth && width) {
      // Width only
      distance = Math.abs(width - targetWidth);
      percentDifference = Math.abs((width - targetWidth) / targetWidth);
      
    } else if (targetHeight && height) {
      // Height only
      distance = Math.abs(height - targetHeight);
      percentDifference = Math.abs((height - targetHeight) / targetHeight);
    }
    
    return { 
      name, 
      distance, 
      percentDifference,
      derivativeWidth: width,
      derivativeHeight: height
    };
  });
  
  // Find closest match within threshold
  scored.sort((a, b) => a.distance - b.distance);
  
  // Get the closest match
  const bestMatch = scored[0];
  
  // Check if it's within our threshold
  if (bestMatch && bestMatch.percentDifference <= maxDifferenceThreshold) {
    info('IMQuery', 'Found matching derivative for IMQuery dimensions', {
      targetWidth,
      targetHeight,
      matchedDerivative: bestMatch.name,
      derivativeWidth: bestMatch.derivativeWidth,
      derivativeHeight: bestMatch.derivativeHeight,
      percentDifference: (bestMatch.percentDifference * 100).toFixed(2) + '%',
      distance: bestMatch.distance
    });
    
    return bestMatch.name;
  }
  
  // If no good match found, log the best available match that was rejected
  if (bestMatch) {
    debug('IMQuery', 'No derivative within threshold for IMQuery dimensions', {
      targetWidth,
      targetHeight,
      closestDerivative: bestMatch.name,
      derivativeWidth: bestMatch.derivativeWidth,
      derivativeHeight: bestMatch.derivativeHeight,
      percentDifference: (bestMatch.percentDifference * 100).toFixed(2) + '%',
      threshold: (maxDifferenceThreshold * 100) + '%',
      distance: bestMatch.distance
    });
  }
  
  return null;
}

/**
 * Validate Akamai parameters for compatibility
 * @param params - Akamai parameters
 * @returns Validation result with warnings
 */
export function validateAkamaiParams(
  params: Record<string, string | boolean | number>
): { isValid: boolean; warnings: string[] } {
  const warnings: string[] = [];
  
  // List of known unsupported Akamai parameters
  const unsupportedParams = [
    'im-palette', 
    'im-colorspace', 
    'composite',
    'layer'
  ];
  
  // Check for unsupported parameters
  Object.keys(params).forEach(key => {
    if (unsupportedParams.includes(key)) {
      warnings.push(`Unsupported Akamai parameter: ${key}`);
    }
  });
  
  // Check IMQuery ref format
  if ('imref' in params && typeof params.imref === 'string') {
    const imref = params.imref;
    if (!imref.match(/^([a-zA-Z0-9-_]+=[^,]+)(,[a-zA-Z0-9-_]+=[^,]+)*$/)) {
      warnings.push(`Invalid imref format: ${imref}. Expected format: key1=value1,key2=value2,...`);
    }
  }
  
  return { 
    isValid: warnings.length === 0, 
    warnings 
  };
}
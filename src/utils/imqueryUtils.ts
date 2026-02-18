/**
 * Utilities for handling Akamai IMQuery parameters
 */
import { createCategoryLogger } from './logger';

const logger = createCategoryLogger('IMQuery');
import { VideoConfigurationManager } from '../config/VideoConfigurationManager';

/**
 * Parse IMQuery reference parameter
 * @param imref - IMQuery reference parameter
 * @returns Parsed parameters object
 */
export function parseImQueryRef(imref: string): Record<string, string> {
  // Format: key1=value1,key2=value2,...
  const result: Record<string, string> = {};

  if (!imref) return result;

  logger.debug('Parsing imref parameter', { imref });

  const params = imref.split(',');
  for (const param of params) {
    const [key, value] = param.split('=');
    if (key && value) {
      result[key] = value;
    }
  }

  logger.debug('Parsed imref parameter', { result });
  return result;
}

/**
 * Convert IMQuery parameters to client hints format
 * @param params - IMQuery parameters
 * @returns Parameters in client hints format
 */
export function convertImQueryToClientHints(params: URLSearchParams): Record<string, string> {
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

  logger.debug('Converted IMQuery to client hints', {
    imQueryParams: Object.fromEntries(params.entries()),
    clientHints: result,
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
    'im-density',
  ];

  return imQueryParams.some((param) => params.has(param));
}

/**
 * Maps a width value to a derivative using configured breakpoints
 * Uses explicit min/max ranges to find the appropriate derivative
 *
 * @param width - Requested width (from IMQuery)
 * @returns Name of the matched derivative or null if no match
 */
export function mapWidthToDerivative(width: number | null): string | null {
  // Skip invalid width
  if (!width || width <= 0) {
    logger.debug('Invalid width for breakpoint mapping', { width });
    return null;
  }

  // Get the config manager instance to access configuration
  const configManager = VideoConfigurationManager.getInstance();

  // Get breakpoint mappings from configuration
  const breakpoints = configManager.getResponsiveBreakpoints();

  // If no breakpoints configured, fall back to old percentage-based method
  if (!breakpoints || Object.keys(breakpoints).length === 0) {
    logger.debug('No responsive breakpoints configured, falling back to percentage method', {
      width,
    });
    return findClosestDerivativePercentage(width, null);
  }

  // Cache derivatives list to check availability
  const availableDerivatives = Object.keys(configManager.getConfig().derivatives);

  // Sort breakpoints by min value (ascending) first for consistent matching
  // This ensures that we match the correct range when there are overlapping or boundary cases
  const sortedBreakpoints = Object.entries(breakpoints).sort((a, b) => {
    // First sort by min value (ascending)
    const minA = a[1].min || 0;
    const minB = b[1].min || 0;

    if (minA !== minB) {
      return minA - minB;
    }

    // If min values are the same, then sort by max value (ascending)
    return (a[1].max || Infinity) - (b[1].max || Infinity);
  });

  // Find matching breakpoint
  for (const [name, range] of sortedBreakpoints) {
    // Check min bound if specified
    if (range.min && width < range.min) {
      continue;
    }

    // Check if within max bound (or if this is the last breakpoint with no max)
    if (range.max === undefined || width <= range.max) {
      // Verify the derivative exists in configuration
      if (availableDerivatives.includes(range.derivative)) {
        logger.info('Matched width to breakpoint', {
          width,
          breakpoint: name,
          derivative: range.derivative,
          min: range.min || 'none',
          max: range.max || 'none',
        });
        return range.derivative;
      } else {
        logger.debug('Breakpoint references non-existent derivative', {
          width,
          breakpoint: name,
          derivative: range.derivative,
          availableDerivatives: availableDerivatives.join(', '),
        });
      }
    }
  }

  // If no exact match found, try to find the closest breakpoint instead of just using the highest
  // This provides better cache consistency for edge cases that fall between breakpoints
  if (sortedBreakpoints.length > 0) {
    // Find the closest breakpoint using distance calculation
    const breakpointDistances = sortedBreakpoints.map(([name, range]) => {
      // Calculate how far width is from this breakpoint's range
      let distance = Infinity;

      // Distance calculation logic:
      // 1. If width is below min, distance is min - width
      // 2. If width is above max, distance is width - max
      // 3. If width is within range, distance is 0
      if (range.min && width < range.min) {
        distance = range.min - width;
      } else if (range.max && width > range.max) {
        distance = width - range.max;
      } else {
        // If width is within the range, distance is 0
        distance = 0;
      }

      return {
        name,
        range,
        distance,
        derivative: range.derivative,
      };
    });

    // Sort by distance (ascending)
    breakpointDistances.sort((a, b) => a.distance - b.distance);

    // Get the closest breakpoint
    const closestBreakpoint = breakpointDistances[0];

    // Check if the derivative exists in configuration
    if (availableDerivatives.includes(closestBreakpoint.derivative)) {
      logger.debug('Using closest breakpoint for width outside exact range', {
        width,
        breakpoint: closestBreakpoint.name,
        derivative: closestBreakpoint.derivative,
        distance: closestBreakpoint.distance,
      });
      return closestBreakpoint.derivative;
    }
  }

  // If we get here, no suitable breakpoint was found, fall back to percentage-based method
  logger.debug('Falling back to percentage-based derivative matching', { width });
  return findClosestDerivativePercentage(width, null);
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
export function findClosestDerivativePercentage(
  targetWidth?: number | null,
  targetHeight?: number | null,
  maxDifferenceThreshold: number = 0.25
): string | null {
  // If no dimensions provided, we can't match
  if (!targetWidth && !targetHeight) {
    logger.debug('No dimensions provided for derivative matching', {
      targetWidth,
      targetHeight,
    });
    return null;
  }

  // Get the config manager instance to access configuration
  const configManager = VideoConfigurationManager.getInstance();

  // Get derivatives with dimensions defined
  const derivatives = Object.entries(configManager.getConfig().derivatives).filter(
    ([_, config]) =>
      (typeof config.width === 'number' && config.width > 0) ||
      (typeof config.height === 'number' && config.height > 0)
  );

  if (derivatives.length === 0) {
    logger.debug('No derivatives with dimensions found', {
      totalDerivatives: Object.keys(configManager.getConfig().derivatives).length,
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
    let aspectRatioMatch = 1.0; // Default to neutral aspect ratio match factor

    if (targetWidth && targetHeight && width && height) {
      // Both dimensions available - use Euclidean distance
      distance = Math.sqrt(Math.pow(width - targetWidth, 2) + Math.pow(height - targetHeight, 2));

      // Calculate percent difference as average of width and height differences
      const widthDiff = Math.abs((width - targetWidth) / targetWidth);
      const heightDiff = Math.abs((height - targetHeight) / targetHeight);
      percentDifference = (widthDiff + heightDiff) / 2;

      // Calculate aspect ratio match to prefer dimensions with similar aspect ratio
      // This ensures more consistent visual results when resizing
      const targetAspectRatio = targetWidth / targetHeight;
      const derivativeAspectRatio = width / height;
      const aspectRatioDiff =
        Math.abs(targetAspectRatio - derivativeAspectRatio) / targetAspectRatio;

      // Higher value means worse aspect ratio match (will be multiplied with distance)
      aspectRatioMatch = 1.0 + aspectRatioDiff * 0.5;
    } else if (targetWidth && width) {
      // Width only
      distance = Math.abs(width - targetWidth);
      percentDifference = Math.abs((width - targetWidth) / targetWidth);
    } else if (targetHeight && height) {
      // Height only
      distance = Math.abs(height - targetHeight);
      percentDifference = Math.abs((height - targetHeight) / targetHeight);
    }

    // Apply aspect ratio factor to distance for better cache consistency
    const adjustedDistance = distance * aspectRatioMatch;

    return {
      name,
      distance: adjustedDistance,
      rawDistance: distance,
      percentDifference,
      derivativeWidth: width,
      derivativeHeight: height,
      aspectRatioMatch,
    };
  });

  // Find closest match within threshold
  scored.sort((a, b) => a.distance - b.distance);

  // Get the closest match
  const bestMatch = scored[0];

  // Check if it's within our threshold
  if (bestMatch && bestMatch.percentDifference <= maxDifferenceThreshold) {
    logger.info('Found matching derivative for IMQuery dimensions', {
      targetWidth,
      targetHeight,
      matchedDerivative: bestMatch.name,
      derivativeWidth: bestMatch.derivativeWidth,
      derivativeHeight: bestMatch.derivativeHeight,
      percentDifference: (bestMatch.percentDifference * 100).toFixed(2) + '%',
      distance: bestMatch.rawDistance,
      adjustedDistance: bestMatch.distance,
      aspectRatioFactor: bestMatch.aspectRatioMatch.toFixed(3),
    });

    return bestMatch.name;
  }

  // If no match found within the strict threshold, but we have candidates,
  // try a more permissive approach for better cache consistency
  if (scored.length > 0 && scored[0].percentDifference <= maxDifferenceThreshold * 1.5) {
    // Use a more permissive threshold (150% of original) for greater cache consistency
    const fallbackMatch = scored[0];

    logger.debug('Using fallback derivative match with expanded threshold', {
      targetWidth,
      targetHeight,
      fallbackDerivative: fallbackMatch.name,
      derivativeWidth: fallbackMatch.derivativeWidth,
      derivativeHeight: fallbackMatch.derivativeHeight,
      percentDifference: (fallbackMatch.percentDifference * 100).toFixed(2) + '%',
      standardThreshold: maxDifferenceThreshold * 100 + '%',
      expandedThreshold: maxDifferenceThreshold * 150 + '%',
      distance: fallbackMatch.rawDistance,
    });

    return fallbackMatch.name;
  }

  // If no good match found, log the best available match that was rejected
  if (bestMatch) {
    logger.debug('No derivative within threshold for IMQuery dimensions', {
      targetWidth,
      targetHeight,
      closestDerivative: bestMatch.name,
      derivativeWidth: bestMatch.derivativeWidth,
      derivativeHeight: bestMatch.derivativeHeight,
      percentDifference: (bestMatch.percentDifference * 100).toFixed(2) + '%',
      threshold: maxDifferenceThreshold * 100 + '%',
      distance: bestMatch.rawDistance,
    });
  }

  return null;
}

/**
 * Finds the closest derivative matching the requested dimensions
 * This is a wrapper function that first tries the new breakpoint method,
 * then falls back to the percentage-based method for backward compatibility
 *
 * It includes caching and debugging features to ensure consistent derivative mapping
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
  // Create cache key for width/height combination to normalize similar requests
  // Round to nearest 10px to improve cache hit rates for slightly different dimensions
  const normalizedWidth = targetWidth ? Math.round(targetWidth / 10) * 10 : null;
  const normalizedHeight = targetHeight ? Math.round(targetHeight / 10) * 10 : null;

  // Use a static cache to ensure consistent mapping of similar dimensions
  // This in-memory cache improves cache consistency for similar IMQuery parameters
  const cacheKey = `${normalizedWidth || 'null'}_${normalizedHeight || 'null'}`;

  // Static cache of derivative mappings to ensure consistency
  // This is a simple in-memory static variable at the module level
  if (typeof (global as any).__derivativeMappingCache === 'undefined') {
    (global as any).__derivativeMappingCache = {};
  }

  const mappingCache = (global as any).__derivativeMappingCache;

  // Check if we have a cached mapping
  if (mappingCache[cacheKey]) {
    logger.debug('Using cached derivative mapping', {
      originalWidth: targetWidth,
      originalHeight: targetHeight,
      normalizedWidth,
      normalizedHeight,
      derivative: mappingCache[cacheKey],
      source: 'memory-cache',
    });
    return mappingCache[cacheKey];
  }

  // If only width is specified, use the new breakpoint-based mapping
  let derivative: string | null = null;

  if (targetWidth && !targetHeight) {
    derivative = mapWidthToDerivative(targetWidth);
    if (derivative) {
      // Store in cache for future requests
      mappingCache[cacheKey] = derivative;
      return derivative;
    }
  }

  // For width+height or height-only, or if breakpoint mapping fails,
  // fall back to the original percentage-based method
  derivative = findClosestDerivativePercentage(targetWidth, targetHeight, maxDifferenceThreshold);

  // Store result in cache (even if null) to ensure consistent behavior
  // This helps ensure similar dimensions always map to the same derivative
  mappingCache[cacheKey] = derivative;

  return derivative;
}

/**
 * Validate Akamai parameters for compatibility
 * @param params - Akamai parameters
 * @returns Validation result with warnings
 */
/**
 * Get the actual dimensions for a derivative
 * Centralizes accessing derivative dimensions to avoid duplication across components
 *
 * @param derivative - The name of the derivative (mobile, tablet, desktop)
 * @returns The actual dimensions {width, height} or null if derivative not found
 */
export function getDerivativeDimensions(
  derivative: string | null
): { width: number; height: number } | null {
  if (!derivative) return null;

  const configManager = VideoConfigurationManager.getInstance();
  const derivatives = configManager.getConfig().derivatives;

  if (derivatives && derivatives[derivative]) {
    const derivativeConfig = derivatives[derivative];
    if (derivativeConfig.width && derivativeConfig.height) {
      logger.debug('Retrieved derivative dimensions', {
        derivative,
        width: derivativeConfig.width,
        height: derivativeConfig.height,
      });

      return {
        width: derivativeConfig.width,
        height: derivativeConfig.height,
      };
    }
  }

  // Log not found case
  logger.debug('Derivative dimensions not found', {
    derivative,
    availableDerivatives: derivatives ? Object.keys(derivatives) : [],
  });

  return null;
}

export function validateAkamaiParams(params: Record<string, string | boolean | number>): {
  isValid: boolean;
  warnings: string[];
} {
  const warnings: string[] = [];

  // List of known unsupported Akamai parameters
  const unsupportedParams = ['im-palette', 'im-colorspace', 'composite', 'layer'];

  // Check for unsupported parameters
  Object.keys(params).forEach((key) => {
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
    warnings,
  };
}

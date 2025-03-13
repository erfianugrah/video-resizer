/**
 * Utilities for responsive video sizing
 */
import { videoConfig } from '../config/videoConfig';
import { hasClientHints, getVideoSizeFromClientHints } from './clientHints';
import { hasCfDeviceType, getVideoSizeFromCfDeviceType, getVideoSizeFromUserAgent } from './deviceUtils';

/**
 * Interface for responsive video size result
 */
export interface ResponsiveSize {
  width: number;
  height: number;
  quality: string;
  method: string;
}

/**
 * Get optimal video dimensions for a responsive layout
 * @param request - The incoming request
 * @param widthParam - Optional explicit width parameter
 * @param heightParam - Optional explicit height parameter
 * @returns The responsive size values
 */
export function getResponsiveVideoSize(
  request: Request,
  widthParam?: number | null,
  heightParam?: number | null
): ResponsiveSize {
  // If explicit dimensions are provided, use them and bypass responsive sizing
  if (widthParam && heightParam) {
    return {
      width: widthParam,
      height: heightParam,
      quality: 'explicit',
      method: 'parameter'
    };
  }
  
  // If only one dimension is specified, calculate the other based on 16:9 aspect ratio
  if (widthParam) {
    return {
      width: widthParam,
      height: Math.round(widthParam * 9 / 16),
      quality: 'explicit-width',
      method: 'parameter-derived'
    };
  }
  
  if (heightParam) {
    return {
      width: Math.round(heightParam * 16 / 9),
      height: heightParam,
      quality: 'explicit-height',
      method: 'parameter-derived'
    };
  }
  
  // Check for ?quality=auto param which explicitly requests adaptive quality
  // This functionality is actually handled in videoOptionsService.ts
  
  // Otherwise, use adaptive sizing based on client capabilities
  // Try to get size info from various sources, in order of accuracy
  let videoSize;
  
  // Start with client hints, which are most accurate when available
  if (hasClientHints(request)) {
    videoSize = getVideoSizeFromClientHints(request);
    return {
      width: videoSize.width,
      height: videoSize.height,
      quality: 'adaptive',
      method: 'client-hints'
    };
  }
  
  // Next try CF-Device-Type header
  if (hasCfDeviceType(request)) {
    videoSize = getVideoSizeFromCfDeviceType(request);
    return {
      width: videoSize.width,
      height: videoSize.height,
      quality: 'adaptive',
      method: 'cf-device-type'
    };
  }
  
  // Fall back to User-Agent detection
  videoSize = getVideoSizeFromUserAgent(request);
  return {
    width: videoSize.width,
    height: videoSize.height,
    quality: 'adaptive',
    method: 'user-agent'
  };
}

/**
 * Calculate video dimensions that maintain aspect ratio but satisfy constraints
 * @param originalWidth - Original video width
 * @param originalHeight - Original video height
 * @param maxWidth - Maximum allowed width
 * @param maxHeight - Maximum allowed height
 * @returns Object with new width and height
 */
export function calculateConstrainedDimensions(
  originalWidth: number,
  originalHeight: number,
  maxWidth: number,
  maxHeight: number
): { width: number; height: number } {
  // If original dimensions are already within constraints, return as is
  if (originalWidth <= maxWidth && originalHeight <= maxHeight) {
    return { width: originalWidth, height: originalHeight };
  }
  
  // Calculate aspect ratio
  const aspectRatio = originalWidth / originalHeight;
  
  // Calculate dimensions constrained by maxWidth
  let newWidth = maxWidth;
  let newHeight = Math.round(newWidth / aspectRatio);
  
  // If height still exceeds maxHeight, constrain by height instead
  if (newHeight > maxHeight) {
    newHeight = maxHeight;
    newWidth = Math.round(newHeight * aspectRatio);
  }
  
  return { width: newWidth, height: newHeight };
}

/**
 * Finds the closest preset quality level
 * @param targetHeight - The target height to match
 * @returns The closest standard quality level
 */
export function findClosestQualityLevel(targetHeight: number): number {
  const availableQualities = videoConfig.responsive.availableQualities;
  const sortedQualities = [...availableQualities].sort((a, b) => a - b);
  
  // Find the first quality that meets or exceeds the target,
  // or fallback to the highest quality if none found
  return sortedQualities.find(q => q >= targetHeight) || sortedQualities[sortedQualities.length - 1];
}

/**
 * Gets the appropriate video quality preset based on device and network
 * @param request - The incoming request
 * @param deviceType - The detected device type
 * @param networkQuality - The detected network quality
 * @returns A preset quality level (height in pixels)
 */
export function getVideoQualityPreset(
  request: Request,
  deviceType: string, 
  networkQuality: string
): number {
  // Define a matrix of device types and network qualities
  const qualityMatrix: Record<string, Record<string, number>> = {
    mobile: {
      slow: 240,
      medium: 360,
      fast: 480,
      ultrafast: 720
    },
    tablet: {
      slow: 360,
      medium: 480,
      fast: 720,
      ultrafast: 1080
    },
    desktop: {
      slow: 480,
      medium: 720,
      fast: 1080,
      ultrafast: 1440
    },
    'large-desktop': {
      slow: 720,
      medium: 1080,
      fast: 1440,
      ultrafast: 2160
    }
  };
  
  // Get quality based on device type and network quality
  const qualityMap = qualityMatrix[deviceType] || qualityMatrix.desktop;
  const quality = qualityMap[networkQuality] || qualityMap.medium;

  // Get user's preference for quality
  const url = new URL(request.url);
  const qualityPreference = url.searchParams.get('quality');
  
  // Apply user preferences
  if (qualityPreference === 'low') {
    return Math.min(quality, 480);
  } else if (qualityPreference === 'high') {
    // Only allow high quality on fast networks
    if (networkQuality === 'fast' || networkQuality === 'ultrafast') {
      return Math.max(quality, 1080);
    }
  }
  
  return quality;
}
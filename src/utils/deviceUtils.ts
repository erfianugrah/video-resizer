/**
 * Device detection utilities for video requests
 * Enhanced with standardized error handling for robustness
 */
import { createCategoryLogger } from './logger';

const logger = createCategoryLogger('DeviceUtils');
import { VideoConfigurationManager } from '../config/VideoConfigurationManager';
import { getDeviceTypeFromUserAgent, getVideoSizeForDeviceType } from './userAgentUtils';
import { VideoSize } from './clientHints';
import { tryOrDefault, tryOrNull, logErrorWithContext } from './errorHandlingUtils';

/**
 * Implementation of hasCfDeviceType that might throw errors
 * @param request - The incoming request
 * @returns True if CF-Device-Type is available
 */
function hasCfDeviceTypeImpl(request: Request): boolean {
  return Boolean(request.headers.get('CF-Device-Type'));
}

/**
 * Check if CF-Device-Type header is present
 * Uses tryOrDefault for safe header detection with proper error handling
 *
 * @param request - The incoming request
 * @returns True if CF-Device-Type is available, false on error
 */
export const hasCfDeviceType = tryOrDefault<[Request], boolean>(
  hasCfDeviceTypeImpl,
  {
    functionName: 'hasCfDeviceType',
    component: 'DeviceUtils',
    logErrors: true,
  },
  false // Safe default is false if detection fails
);

/**
 * Implementation of getVideoSizeFromCfDeviceType that might throw errors
 * @param request - The incoming request
 * @returns Video size settings based on CF-Device-Type
 */
function getVideoSizeFromCfDeviceTypeImpl(request: Request): VideoSize {
  const cfDeviceType = request.headers.get('CF-Device-Type');
  logger.debug('CF-Device-Type detection', { cfDeviceType });

  // Get configuration manager instance
  const configManager = VideoConfigurationManager.getInstance();

  // Get device width mappings from config if available, or use defaults
  const deviceWidthMap = configManager.getResponsiveConfig().deviceWidths || {
    mobile: 480,
    tablet: 720,
    desktop: 1080,
  };

  // Get width for the device type or use desktop default
  const width =
    deviceWidthMap[cfDeviceType as keyof typeof deviceWidthMap] || deviceWidthMap.desktop;
  const height = Math.round((width * 9) / 16); // Maintain 16:9 aspect ratio

  return {
    width,
    height,
    source: `cf-device-type-${cfDeviceType}`,
    deviceType: cfDeviceType || undefined,
  };
}

/**
 * Get responsive video size based on CF-Device-Type header
 * Uses tryOrDefault for safe device detection with proper error handling
 *
 * @param request - The incoming request
 * @returns Video size settings based on CF-Device-Type, or default values on error
 */
export const getVideoSizeFromCfDeviceType = tryOrDefault<[Request], VideoSize>(
  getVideoSizeFromCfDeviceTypeImpl,
  {
    functionName: 'getVideoSizeFromCfDeviceType',
    component: 'DeviceUtils',
    logErrors: true,
  },
  {
    // Safe default values if CF-Device-Type processing fails
    width: 1080,
    height: 608,
    source: 'cf-device-type-error-fallback',
    deviceType: 'desktop',
  }
);

/**
 * Implementation of getVideoSizeFromUserAgent that might throw errors
 * @param request - The incoming request
 * @returns Video size settings based on User-Agent detection
 */
function getVideoSizeFromUserAgentImpl(request: Request): VideoSize {
  const userAgent = request.headers.get('User-Agent') || '';
  const deviceType = getDeviceTypeFromUserAgent(userAgent);

  logger.debug('User-Agent detection', {
    userAgent: userAgent.substring(0, 50),
    detectedDeviceType: deviceType,
  });

  // Determine if the request explicitly wants auto-quality
  const url = new URL(request.url);
  const isAutoRequested = url.searchParams.get('quality') === 'auto';

  // Get configuration manager instance
  const configManager = VideoConfigurationManager.getInstance();

  // Get available qualities from config
  const availableQualities = configManager.getResponsiveConfig().availableQualities;

  // Fallback: use specific size based on user agent detection
  return getVideoSizeForDeviceType(deviceType, isAutoRequested, availableQualities);
}

/**
 * Get responsive video size based on User-Agent string
 * Uses tryOrDefault for safe user agent detection with proper error handling
 *
 * @param request - The incoming request
 * @returns Video size settings based on User-Agent detection, or default values on error
 */
export const getVideoSizeFromUserAgent = tryOrDefault<[Request], VideoSize>(
  getVideoSizeFromUserAgentImpl,
  {
    functionName: 'getVideoSizeFromUserAgent',
    component: 'DeviceUtils',
    logErrors: true,
  },
  {
    // Safe default values if User-Agent processing fails
    width: 854,
    height: 480,
    source: 'user-agent-error-fallback',
    deviceType: 'desktop',
  }
);

/**
 * Implementation of detectDeviceCapabilities that might throw errors
 * @param request - The incoming request
 * @returns Object with device capabilities
 */
function detectDeviceCapabilitiesImpl(request: Request): Record<string, unknown> {
  const userAgent = request.headers.get('User-Agent') || '';
  const deviceType = getDeviceTypeFromUserAgent(userAgent);

  // Detect basic capabilities
  const capabilities = {
    deviceType,
    supportsHdr: false,
    supportsTouchscreen: deviceType === 'mobile' || deviceType === 'tablet',
    supportsHighFramerate: deviceType !== 'mobile',
    maxResolution: deviceType === 'mobile' ? 720 : deviceType === 'tablet' ? 1080 : 2160,
  };

  // Check for HDR support based on user agent
  if (/iPhone OS 1[1-9]|iPad OS 1[1-9]|Mac OS.*Safari 1[4-9]/i.test(userAgent)) {
    capabilities.supportsHdr = true;
  }

  if (/Chrome\/9[0-9]|Edge\/9[0-9]|Firefox\/9[0-9]/i.test(userAgent)) {
    capabilities.supportsHdr = true;
  }

  logger.debug('Device capabilities', capabilities);

  return capabilities;
}

/**
 * Detect device capabilities for video playback
 * Uses tryOrDefault for safe device capability detection with proper error handling
 *
 * @param request - The incoming request
 * @returns Object with device capabilities, or default capabilities on error
 */
export const detectDeviceCapabilities = tryOrDefault<[Request], Record<string, unknown>>(
  detectDeviceCapabilitiesImpl,
  {
    functionName: 'detectDeviceCapabilities',
    component: 'DeviceUtils',
    logErrors: true,
  },
  {
    // Safe default capabilities if detection fails
    deviceType: 'desktop',
    supportsHdr: false,
    supportsTouchscreen: false,
    supportsHighFramerate: true,
    maxResolution: 1080,
    source: 'error-fallback',
  }
);

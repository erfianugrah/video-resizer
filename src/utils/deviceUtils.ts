/**
 * Device detection utilities for video requests
 */
import { debug } from './loggerUtils';
import { videoConfig } from '../config/videoConfig';
import { getDeviceTypeFromUserAgent, getVideoSizeForDeviceType } from './userAgentUtils';
import { VideoSize } from './clientHints';

/**
 * Check if CF-Device-Type header is present
 * @param request - The incoming request
 * @returns True if CF-Device-Type is available
 */
export function hasCfDeviceType(request: Request): boolean {
  return Boolean(request.headers.get('CF-Device-Type'));
}

/**
 * Get responsive video size based on CF-Device-Type header
 * @param request - The incoming request
 * @returns Video size settings based on CF-Device-Type
 */
export function getVideoSizeFromCfDeviceType(request: Request): VideoSize {
  const cfDeviceType = request.headers.get('CF-Device-Type');
  debug('DeviceUtils', 'CF-Device-Type detection', { cfDeviceType });

  // Get device width mappings from config if available, or use defaults
  const deviceWidthMap = videoConfig.responsive.deviceWidths || {
    mobile: 480,
    tablet: 720,
    desktop: 1080,
  };

  // Get width for the device type or use desktop default
  const width = deviceWidthMap[cfDeviceType as keyof typeof deviceWidthMap] || deviceWidthMap.desktop;
  const height = Math.round(width * 9 / 16); // Maintain 16:9 aspect ratio

  return {
    width,
    height,
    source: `cf-device-type-${cfDeviceType}`,
  };
}

/**
 * Get responsive video size based on User-Agent string
 * @param request - The incoming request
 * @returns Video size settings based on User-Agent detection
 */
export function getVideoSizeFromUserAgent(request: Request): VideoSize {
  const userAgent = request.headers.get('User-Agent') || '';
  const deviceType = getDeviceTypeFromUserAgent(userAgent);

  debug('DeviceUtils', 'User-Agent detection', {
    userAgent: userAgent.substring(0, 50),
    detectedDeviceType: deviceType,
  });

  // Determine if the request explicitly wants auto-quality
  const url = new URL(request.url);
  const isAutoRequested = url.searchParams.get('quality') === 'auto';

  // Get available qualities from config
  const availableQualities = videoConfig.responsive.availableQualities;

  // Fallback: use specific size based on user agent detection
  return getVideoSizeForDeviceType(deviceType, isAutoRequested, availableQualities);
}

/**
 * Detect device capabilities for video playback
 * @param request - The incoming request
 * @returns Object with device capabilities
 */
export function detectDeviceCapabilities(request: Request): Record<string, any> {
  const userAgent = request.headers.get('User-Agent') || '';
  const deviceType = getDeviceTypeFromUserAgent(userAgent);
  
  // Detect basic capabilities
  const capabilities = {
    deviceType,
    supportsHdr: false,
    supportsTouchscreen: deviceType === 'mobile' || deviceType === 'tablet',
    supportsHighFramerate: deviceType !== 'mobile',
    maxResolution: deviceType === 'mobile' ? 720 : (deviceType === 'tablet' ? 1080 : 2160),
  };
  
  // Check for HDR support based on user agent
  if (/iPhone OS 1[1-9]|iPad OS 1[1-9]|Mac OS.*Safari 1[4-9]/i.test(userAgent)) {
    capabilities.supportsHdr = true;
  }
  
  if (/Chrome\/9[0-9]|Edge\/9[0-9]|Firefox\/9[0-9]/i.test(userAgent)) {
    capabilities.supportsHdr = true;
  }
  
  debug('DeviceUtils', 'Device capabilities', capabilities);
  
  return capabilities;
}
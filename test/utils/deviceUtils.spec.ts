/**
 * Tests for deviceUtils
 */
import { describe, it, expect, vi } from 'vitest';
import {
  hasCfDeviceType,
  getVideoSizeFromCfDeviceType,
  getVideoSizeFromUserAgent,
  detectDeviceCapabilities,
} from '../../src/utils/deviceUtils';

// Mock logger
vi.mock('../../src/utils/logger', () => ({
  createCategoryLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    errorWithContext: vi.fn(),
  })),
  logDebug: vi.fn(),
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
  logErrorWithContext: vi.fn(),
}));

vi.mock('../../src/utils/userAgentUtils', () => ({
  getDeviceTypeFromUserAgent: vi.fn((userAgent) => {
    if (userAgent.includes('iPhone')) return 'mobile';
    if (userAgent.includes('iPad')) return 'tablet';
    return 'desktop';
  }),
  getVideoSizeForDeviceType: vi.fn((deviceType) => {
    const sizes = {
      mobile: { width: 640, height: 360, source: 'ua-mobile' },
      tablet: { width: 1280, height: 720, source: 'ua-tablet' },
      desktop: { width: 1920, height: 1080, source: 'ua-desktop' },
    };
    return sizes[deviceType] || sizes.desktop;
  }),
}));

describe('deviceUtils', () => {
  describe('hasCfDeviceType', () => {
    it('should return true when CF-Device-Type header is present', () => {
      // Arrange
      const request = new Request('https://example.com/video.mp4', {
        headers: {
          'CF-Device-Type': 'mobile',
        },
      });

      // Act
      const result = hasCfDeviceType(request);

      // Assert
      expect(result).toBe(true);
    });

    it('should return false when CF-Device-Type header is not present', () => {
      // Arrange
      const request = new Request('https://example.com/video.mp4');

      // Act
      const result = hasCfDeviceType(request);

      // Assert
      expect(result).toBe(false);
    });
  });

  describe('getVideoSizeFromCfDeviceType', () => {
    it('should return the correct size for mobile device', () => {
      // Arrange
      const request = new Request('https://example.com/video.mp4', {
        headers: {
          'CF-Device-Type': 'mobile',
        },
      });

      // Act
      const result = getVideoSizeFromCfDeviceType(request);

      // Assert
      expect(result.width).toBe(480);
      expect(result.source).toBe('cf-device-type-mobile');
    });

    it('should return the correct size for tablet device', () => {
      // Arrange
      const request = new Request('https://example.com/video.mp4', {
        headers: {
          'CF-Device-Type': 'tablet',
        },
      });

      // Act
      const result = getVideoSizeFromCfDeviceType(request);

      // Assert
      expect(result.width).toBe(720);
      expect(result.source).toBe('cf-device-type-tablet');
    });

    it('should return desktop size as fallback for unknown device type', () => {
      // Arrange
      const request = new Request('https://example.com/video.mp4', {
        headers: {
          'CF-Device-Type': 'unknown',
        },
      });

      // Act
      const result = getVideoSizeFromCfDeviceType(request);

      // Assert
      expect(result.width).toBe(1080);
    });
  });

  describe('getVideoSizeFromUserAgent', () => {
    it('should return mobile size for iPhone user agent', () => {
      // Arrange
      const request = new Request('https://example.com/video.mp4', {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1',
        },
      });

      // Act
      const result = getVideoSizeFromUserAgent(request);

      // Assert
      expect(result.source).toBe('ua-mobile');
    });

    it('should return tablet size for iPad user agent', () => {
      // Arrange
      const request = new Request('https://example.com/video.mp4', {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (iPad; CPU OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1',
        },
      });

      // Act
      const result = getVideoSizeFromUserAgent(request);

      // Assert
      expect(result.source).toBe('ua-tablet');
    });

    it('should return desktop size for desktop user agent', () => {
      // Arrange
      const request = new Request('https://example.com/video.mp4', {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        },
      });

      // Act
      const result = getVideoSizeFromUserAgent(request);

      // Assert
      expect(result.source).toBe('ua-desktop');
    });
  });

  describe('detectDeviceCapabilities', () => {
    it('should detect capabilities for mobile devices', () => {
      // Arrange
      const request = new Request('https://example.com/video.mp4', {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1',
        },
      });

      // Act
      const result = detectDeviceCapabilities(request);

      // Assert
      expect(result.deviceType).toBe('mobile');
      expect(result.supportsTouchscreen).toBe(true);
      expect(result.maxResolution).toBeLessThanOrEqual(720);
    });

    it('should detect capabilities for desktop devices', () => {
      // Arrange
      const request = new Request('https://example.com/video.mp4', {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        },
      });

      // Act
      const result = detectDeviceCapabilities(request);

      // Assert
      expect(result.deviceType).toBe('desktop');
      expect(result.supportsTouchscreen).toBe(false);
      expect(result.maxResolution).toBeGreaterThan(1080);
      expect(result.supportsHighFramerate).toBe(true);
    });
  });
});

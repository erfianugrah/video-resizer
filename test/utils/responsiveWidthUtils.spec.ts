/**
 * Tests for responsiveWidthUtils
 */
import { describe, it, expect, vi } from 'vitest';
import { 
  getResponsiveVideoSize, 
  calculateConstrainedDimensions,
  findClosestQualityLevel,
  getVideoQualityPreset
} from '../../src/utils/responsiveWidthUtils';

// Mock imports
vi.mock('../../src/utils/loggerUtils', () => ({
  debug: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
}));

// Mock client hints functions
vi.mock('../../src/utils/clientHints', () => ({
  hasClientHints: vi.fn(),
  getVideoSizeFromClientHints: vi.fn(),
  getNetworkQuality: vi.fn()
}));

// Mock device utils functions
vi.mock('../../src/utils/deviceUtils', () => ({
  hasCfDeviceType: vi.fn(),
  getVideoSizeFromCfDeviceType: vi.fn(),
  getVideoSizeFromUserAgent: vi.fn(() => ({ width: 854, height: 480, source: 'test' }))
}));

// Mock imported functions from utils
import { hasClientHints, getVideoSizeFromClientHints } from '../../src/utils/clientHints';
import { hasCfDeviceType, getVideoSizeFromCfDeviceType } from '../../src/utils/deviceUtils';

describe('responsiveWidthUtils', () => {
  describe('getResponsiveVideoSize', () => {
    it('should use explicit dimensions when both width and height params are provided', () => {
      // Arrange
      const request = new Request('https://example.com/video.mp4');
      const width = 1280;
      const height = 720;

      // Act
      const result = getResponsiveVideoSize(request, width, height);

      // Assert
      expect(result.width).toBe(width);
      expect(result.height).toBe(height);
      expect(result.method).toBe('parameter');
    });

    it('should calculate height when only width is provided', () => {
      // Arrange
      const request = new Request('https://example.com/video.mp4');
      const width = 1280;

      // Act
      const result = getResponsiveVideoSize(request, width, null);

      // Assert
      expect(result.width).toBe(width);
      expect(result.height).toBe(720); // 16:9 aspect ratio
      expect(result.method).toBe('parameter-derived');
    });

    it('should calculate width when only height is provided', () => {
      // Arrange
      const request = new Request('https://example.com/video.mp4');
      const height = 720;

      // Act
      const result = getResponsiveVideoSize(request, null, height);

      // Assert
      expect(result.width).toBe(1280); // 16:9 aspect ratio
      expect(result.height).toBe(height);
      expect(result.method).toBe('parameter-derived');
    });

    it('should use client hints when available', () => {
      // Arrange
      const request = new Request('https://example.com/video.mp4');
      vi.mocked(hasClientHints).mockReturnValue(true);
      vi.mocked(getVideoSizeFromClientHints).mockReturnValue({
        width: 1920,
        height: 1080,
        source: 'client-hints-1080p'
      });

      // Act
      const result = getResponsiveVideoSize(request);

      // Assert
      expect(result.width).toBe(1920);
      expect(result.height).toBe(1080);
      expect(result.method).toBe('client-hints');
    });

    it('should use CF-Device-Type when client hints are not available', () => {
      // Arrange
      const request = new Request('https://example.com/video.mp4');
      vi.mocked(hasClientHints).mockReturnValue(false);
      vi.mocked(hasCfDeviceType).mockReturnValue(true);
      vi.mocked(getVideoSizeFromCfDeviceType).mockReturnValue({
        width: 720,
        height: 480,
        source: 'cf-device-type-mobile'
      });

      // Act
      const result = getResponsiveVideoSize(request);

      // Assert
      expect(result.width).toBe(720);
      expect(result.height).toBe(480);
      expect(result.method).toBe('cf-device-type');
    });

    it('should fall back to user agent when neither client hints nor CF-Device-Type are available', () => {
      // Arrange
      const request = new Request('https://example.com/video.mp4');
      vi.mocked(hasClientHints).mockReturnValue(false);
      vi.mocked(hasCfDeviceType).mockReturnValue(false);

      // Act
      const result = getResponsiveVideoSize(request);

      // Assert
      expect(result.width).toBe(854);
      expect(result.height).toBe(480);
      expect(result.method).toBe('user-agent');
    });
  });

  describe('calculateConstrainedDimensions', () => {
    it('should not change dimensions if already within constraints', () => {
      // Act
      const result = calculateConstrainedDimensions(1280, 720, 1920, 1080);

      // Assert
      expect(result.width).toBe(1280);
      expect(result.height).toBe(720);
    });

    it('should constrain by width if needed while maintaining aspect ratio', () => {
      // Act
      const result = calculateConstrainedDimensions(1920, 1080, 1280, 1080);

      // Assert
      expect(result.width).toBe(1280);
      expect(result.height).toBe(720);
    });

    it('should constrain by height if needed while maintaining aspect ratio', () => {
      // Act
      const result = calculateConstrainedDimensions(1920, 1080, 1920, 720);

      // Assert
      expect(result.width).toBe(1280);
      expect(result.height).toBe(720);
    });

    it('should constrain by both dimensions if needed', () => {
      // Act
      const result = calculateConstrainedDimensions(3840, 2160, 1280, 720);

      // Assert
      expect(result.width).toBe(1280);
      expect(result.height).toBe(720);
    });
  });

  describe('findClosestQualityLevel', () => {
    it('should find the exact match if available', () => {
      // Act & Assert
      expect(findClosestQualityLevel(720)).toBe(720);
    });

    it('should find the next highest quality if exact match not available', () => {
      // Act & Assert
      expect(findClosestQualityLevel(900)).toBe(1080);
    });

    it('should return the highest quality if target exceeds all available qualities', () => {
      // Act & Assert
      expect(findClosestQualityLevel(4000)).toBe(2160);
    });
  });

  describe('getVideoQualityPreset', () => {
    it('should return appropriate quality for mobile device on slow network', () => {
      // Arrange
      const request = new Request('https://example.com/video.mp4');

      // Act
      const result = getVideoQualityPreset(request, 'mobile', 'slow');

      // Assert
      expect(result).toBe(240);
    });

    it('should return appropriate quality for desktop device on fast network', () => {
      // Arrange
      const request = new Request('https://example.com/video.mp4');

      // Act
      const result = getVideoQualityPreset(request, 'desktop', 'fast');

      // Assert
      expect(result).toBe(1080);
    });

    it('should respect user quality preference for low quality', () => {
      // Arrange
      const request = new Request('https://example.com/video.mp4?quality=low');

      // Act
      const result = getVideoQualityPreset(request, 'desktop', 'fast');

      // Assert
      expect(result).toBeLessThanOrEqual(480);
    });

    it('should respect user quality preference for high quality on fast networks', () => {
      // Arrange
      const request = new Request('https://example.com/video.mp4?quality=high');

      // Act
      const result = getVideoQualityPreset(request, 'desktop', 'fast');

      // Assert
      expect(result).toBeGreaterThanOrEqual(1080);
    });
  });
});
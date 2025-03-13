/**
 * Tests for userAgentUtils
 */
import { describe, it, expect } from 'vitest';
import { 
  getDeviceTypeFromUserAgent, 
  getVideoSizeForDeviceType,
  detectBrowserVideoCapabilities
} from '../../src/utils/userAgentUtils';

describe('userAgentUtils', () => {
  describe('getDeviceTypeFromUserAgent', () => {
    it('should detect mobile devices correctly', () => {
      // Arrange
      const mobileUserAgents = [
        'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1',
        'Mozilla/5.0 (Linux; Android 10; SM-G970F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.120 Mobile Safari/537.36',
        'Mozilla/5.0 (Linux; Android 11; Pixel 4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.120 Mobile Safari/537.36',
      ];

      // Act & Assert
      mobileUserAgents.forEach(ua => {
        expect(getDeviceTypeFromUserAgent(ua)).toBe('mobile');
      });
    });

    it('should detect tablet devices correctly', () => {
      // Arrange
      const tabletUserAgents = [
        'Mozilla/5.0 (iPad; CPU OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1',
        'Mozilla/5.0 (Linux; Android 10; SM-T510) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.120 Safari/537.36',
      ];

      // Act & Assert
      tabletUserAgents.forEach(ua => {
        expect(getDeviceTypeFromUserAgent(ua)).toBe('tablet');
      });
    });

    it('should detect desktop devices correctly', () => {
      // Arrange
      const desktopUserAgents = [
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Safari/605.1.15',
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      ];

      // Act & Assert
      desktopUserAgents.forEach(ua => {
        expect(getDeviceTypeFromUserAgent(ua)).toBe('desktop');
      });
    });

    it('should default to desktop for empty or unrecognized user agent', () => {
      // Arrange
      const emptyUserAgent = '';
      const unrecognizedUserAgent = 'Some random string';

      // Act & Assert
      expect(getDeviceTypeFromUserAgent(emptyUserAgent)).toBe('desktop');
      expect(getDeviceTypeFromUserAgent(unrecognizedUserAgent)).toBe('desktop');
    });
  });

  describe('getVideoSizeForDeviceType', () => {
    it('should return correct video size for mobile', () => {
      // Act
      const result = getVideoSizeForDeviceType('mobile', false, [360, 480, 720, 1080]);

      // Assert
      expect(result.height).toBe(360); // Mobile minimum height
      expect(result.width).toBe(640);  // 16:9 aspect ratio
      expect(result.source).toBe('ua-mobile');
    });

    it('should return correct video size for tablet', () => {
      // Act
      const result = getVideoSizeForDeviceType('tablet', false, [360, 480, 720, 1080]);

      // Assert
      expect(result.height).toBe(720); // Tablet minimum height
      expect(result.width).toBe(1280); // 16:9 aspect ratio
      expect(result.source).toBe('ua-tablet');
    });

    it('should return higher quality for desktop when auto-requested', () => {
      // Act
      const autoResult = getVideoSizeForDeviceType('desktop', true, [360, 720, 1080, 1440]);
      const standardResult = getVideoSizeForDeviceType('desktop', false, [360, 720, 1080, 1440]);

      // Assert
      expect(autoResult.height).toBe(1080); // Auto-quality desktop
      expect(standardResult.height).toBe(720); // Standard desktop
    });

    it('should use available qualities or fall back to standards', () => {
      // Act with custom qualities
      const withCustom = getVideoSizeForDeviceType('mobile', false, [240, 480, 960]);
      
      // Act without custom qualities (uses standards)
      const withStandard = getVideoSizeForDeviceType('mobile', false, []);

      // Assert
      expect(withCustom.height).toBe(480); // First quality >= 360
      expect(withStandard.height).toBe(360); // Standard mobile size
    });
  });

  describe('detectBrowserVideoCapabilities', () => {
    it('should detect HEVC support in Safari', () => {
      // Arrange
      const safariUA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Safari/605.1.15';
      
      // Act
      const result = detectBrowserVideoCapabilities(safariUA);
      
      // Assert
      expect(result.supportsHEVC).toBe(true);
    });
    
    it('should detect AV1 support in modern Chrome', () => {
      // Arrange
      const chromeUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.212 Safari/537.36';
      
      // Act
      const result = detectBrowserVideoCapabilities(chromeUA);
      
      // Assert
      expect(result.supportsAV1).toBe(true);
      expect(result.supportsWebM).toBe(true);
    });
    
    it('should detect VP9 support in Firefox', () => {
      // Arrange
      const firefoxUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:89.0) Gecko/20100101 Firefox/89.0';
      
      // Act
      const result = detectBrowserVideoCapabilities(firefoxUA);
      
      // Assert
      expect(result.supportsVP9).toBe(true);
      expect(result.supportsWebM).toBe(true);
    });
  });
});
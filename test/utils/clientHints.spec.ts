/**
 * Tests for clientHints
 */
import { describe, it, expect, vi } from 'vitest';
import { hasClientHints, getVideoSizeFromClientHints, getNetworkQuality } from '../../src/utils/clientHints';

// Mock loggerUtils
vi.mock('../../src/utils/loggerUtils', () => ({
  debug: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
}));

describe('clientHints', () => {
  describe('hasClientHints', () => {
    it('should return true when client hints headers are present', () => {
      // Arrange
      const request = new Request('https://example.com/video.mp4', {
        headers: {
          'Sec-CH-Viewport-Width': '1280',
        },
      });

      // Act
      const result = hasClientHints(request);

      // Assert
      expect(result).toBe(true);
    });

    it('should return false when no client hints headers are present', () => {
      // Arrange
      const request = new Request('https://example.com/video.mp4');

      // Act
      const result = hasClientHints(request);

      // Assert
      expect(result).toBe(false);
    });
  });

  describe('getVideoSizeFromClientHints', () => {
    it('should return the correct video size based on viewport width', () => {
      // Arrange
      const request = new Request('https://example.com/video.mp4', {
        headers: {
          'Sec-CH-Viewport-Width': '1280',
        },
      });

      // Act
      const result = getVideoSizeFromClientHints(request);

      // Assert
      expect(result.width).toBe(1280);
      expect(result.height).toBe(720);
      expect(result.source).toBe('client-hints-1280p');
    });

    it('should apply DPR adjustment for high-DPI screens', () => {
      // Arrange
      const request = new Request('https://example.com/video.mp4', {
        headers: {
          'Sec-CH-Viewport-Width': '1280',
          'Sec-CH-DPR': '2',
        },
      });

      // Act
      const result = getVideoSizeFromClientHints(request);

      // Assert
      expect(result.width).toBe(2560);
      expect(result.source).toContain('client-hints');
    });

    it('should reduce quality when save-data is enabled', () => {
      // Arrange
      const request = new Request('https://example.com/video.mp4', {
        headers: {
          'Sec-CH-Viewport-Width': '1920',
          'Sec-CH-Save-Data': 'on',
        },
      });

      // Act
      const result = getVideoSizeFromClientHints(request);

      // Assert
      expect(result.width).toBeLessThanOrEqual(720);
    });

    it('should return fallback size when no viewport width is provided', () => {
      // Arrange
      const request = new Request('https://example.com/video.mp4');

      // Act
      const result = getVideoSizeFromClientHints(request);

      // Assert
      expect(result.width).toBe(854);
      expect(result.height).toBe(480);
      expect(result.source).toBe('client-hints-fallback');
    });
  });

  describe('getNetworkQuality', () => {
    it('should return slow for 2g connection', () => {
      // Arrange
      const request = new Request('https://example.com/video.mp4', {
        headers: {
          'ECT': '2g',
        },
      });

      // Act
      const result = getNetworkQuality(request);

      // Assert
      expect(result.quality).toBe('slow');
      expect(result.source).toBe('ect');
      expect(result.supportsHints).toBe(true);
      expect(result.ect).toBe('2g');
    });

    it('should return medium for 3g connection', () => {
      // Arrange
      const request = new Request('https://example.com/video.mp4', {
        headers: {
          'ECT': '3g',
        },
      });

      // Act
      const result = getNetworkQuality(request);

      // Assert
      expect(result.quality).toBe('medium');
      expect(result.source).toBe('ect');
      expect(result.supportsHints).toBe(true);
    });

    it('should determine quality based on downlink when ECT is not available', () => {
      // Arrange
      const request = new Request('https://example.com/video.mp4', {
        headers: {
          'Downlink': '3.5',
        },
      });

      // Act
      const result = getNetworkQuality(request);

      // Assert
      expect(result.quality).toBe('medium');
      expect(result.source).toBe('downlink');
      expect(result.supportsHints).toBe(true);
      expect(result.downlink).toBe(3.5);
    });

    it('should detect save-data preference', () => {
      // Arrange
      const request = new Request('https://example.com/video.mp4', {
        headers: {
          'Sec-CH-Save-Data': 'on',
          'ECT': '4g',
        },
      });

      // Act
      const result = getNetworkQuality(request);

      // Assert
      expect(result.quality).toBe('fast');
      expect(result.saveData).toBe(true);
    });

    it('should use user-agent fallback for mobile device', () => {
      // Arrange
      const request = new Request('https://example.com/video.mp4', {
        headers: {
          'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) Mobile',
        },
      });

      // Act
      const result = getNetworkQuality(request);

      // Assert
      expect(result.quality).toBe('medium');
      expect(result.source).toBe('user-agent-mobile');
      expect(result.supportsHints).toBe(false);
    });

    it('should use user-agent fallback for desktop device', () => {
      // Arrange
      const request = new Request('https://example.com/video.mp4', {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        },
      });

      // Act
      const result = getNetworkQuality(request);

      // Assert
      expect(result.quality).toBe('fast');
      expect(result.source).toBe('user-agent-desktop');
      expect(result.supportsHints).toBe(false);
    });
    
    it('should properly combine multiple client hint signals', () => {
      // Arrange
      const request = new Request('https://example.com/video.mp4', {
        headers: {
          'ECT': '4g',
          'Downlink': '8.5',
          'Sec-CH-Save-Data': 'on',
        },
      });

      // Act
      const result = getNetworkQuality(request);

      // Assert
      expect(result.quality).toBe('fast');
      expect(result.saveData).toBe(true);
      expect(result.source).toBe('ect');
      expect(result.downlink).toBe(8.5);
      // Even with fast connection, save-data should be respected in the response
    });
  });
});
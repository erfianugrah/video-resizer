/**
 * Tests for videoTransformationService
 */
import { describe, it, expect, vi } from 'vitest';
import {
  getBestVideoFormat,
  estimateOptimalBitrate,
} from '../../src/services/videoTransformationService';

// Mock TransformVideoCommand for transformVideo tests
vi.mock('../../src/domain/commands/TransformVideoCommand', () => {
  return {
    TransformVideoCommand: vi.fn().mockImplementation(() => {
      return {
        execute: vi.fn().mockImplementation(() => {
          return Promise.resolve(new Response('Video content'));
        }),
      };
    }),
  };
});

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

describe('videoTransformationService', () => {
  describe('getBestVideoFormat', () => {
    it('should return webm when Accept header includes webm', () => {
      // Arrange
      const request = new Request('https://example.com/video.mp4', {
        headers: {
          Accept: 'video/webm,video/mp4;q=0.9',
        },
      });

      // Act
      const result = getBestVideoFormat(request);

      // Assert
      expect(result).toBe('webm');
    });

    it('should return mp4 when Accept header includes mp4 but not webm', () => {
      // Arrange
      const request = new Request('https://example.com/video.mp4', {
        headers: {
          Accept: 'video/mp4,video/ogg',
        },
      });

      // Act
      const result = getBestVideoFormat(request);

      // Assert
      expect(result).toBe('mp4');
    });

    it('should default to mp4 when no relevant Accept header is present', () => {
      // Arrange
      const request = new Request('https://example.com/video.mp4');

      // Act
      const result = getBestVideoFormat(request);

      // Assert
      expect(result).toBe('mp4');
    });
  });

  describe('estimateOptimalBitrate', () => {
    it('should calculate bitrate for low resolution video on slow network', () => {
      // Act
      const result = estimateOptimalBitrate(640, 360, 'slow');

      // Assert - should be 500 kbps (1000 * 0.5)
      expect(result).toBe(500);
    });

    it('should calculate bitrate for HD video on fast network', () => {
      // Act
      const result = estimateOptimalBitrate(1280, 720, 'fast');

      // Assert - should be 2500 kbps (2500 * 1.0)
      expect(result).toBe(2500);
    });

    it('should calculate bitrate for Full HD video on ultrafast network', () => {
      // Act
      const result = estimateOptimalBitrate(1920, 1080, 'ultrafast');

      // Assert - should be 6000 kbps (5000 * 1.2)
      expect(result).toBe(6000);
    });

    it('should default to medium network quality for unknown quality', () => {
      // Act
      const result = estimateOptimalBitrate(1280, 720, 'unknown');

      // Assert - should use medium multiplier (2500 * 0.8)
      expect(result).toBe(2000);
    });
  });
});

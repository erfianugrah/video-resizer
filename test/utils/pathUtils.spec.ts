/**
 * Tests for pathUtils
 */
import { describe, it, expect } from 'vitest';
import {
  findMatchingPathPattern,
  buildCdnCgiMediaUrl,
  PathPattern,
} from '../../src/utils/pathUtils';

describe('pathUtils', () => {
  describe('findMatchingPathPattern', () => {
    it('should find the matching path pattern', () => {
      // Arrange
      const patterns: PathPattern[] = [
        {
          name: 'videos',
          matcher: '^/videos/',
          processPath: true,
          baseUrl: null,
          originUrl: null,
        },
        {
          name: 'custom',
          matcher: '^/ext/ingkadam/m/',
          processPath: true,
          baseUrl: null,
          originUrl: 'https://videos.example.com',
        },
      ];

      // Act
      const match1 = findMatchingPathPattern('/videos/sample.mp4', patterns);
      const match2 = findMatchingPathPattern('/ext/ingkadam/m/video.mp4', patterns);
      const match3 = findMatchingPathPattern('/unmatched/path.mp4', patterns);

      // Assert
      expect(match1).toEqual(patterns[0]);
      expect(match2).toEqual(patterns[1]);
      expect(match3).toBeNull();
    });

    it('should return null if no pattern matches', () => {
      // Arrange
      const patterns: PathPattern[] = [
        {
          name: 'videos',
          matcher: '^/videos/',
          processPath: true,
          baseUrl: null,
          originUrl: null,
        },
      ];

      // Act
      const match = findMatchingPathPattern('/images/photo.jpg', patterns);

      // Assert
      expect(match).toBeNull();
    });
  });

  describe('buildCdnCgiMediaUrl', () => {
    it('should build a CDN-CGI media URL with options', () => {
      // Arrange
      const options = {
        width: 640,
        height: 360,
        mode: 'video',
        fit: 'contain',
        audio: true,
      };
      const videoUrl = 'https://example.com/videos/sample.mp4';

      // Act
      const cdnCgiUrl = buildCdnCgiMediaUrl(options, videoUrl);

      // Assert
      expect(cdnCgiUrl).toContain('/cdn-cgi/media/');
      expect(cdnCgiUrl).toContain('width=640');
      expect(cdnCgiUrl).toContain('height=360');
      expect(cdnCgiUrl).toContain('mode=video');
      expect(cdnCgiUrl).toContain('fit=contain');
      expect(cdnCgiUrl).toContain('audio=true');
      expect(cdnCgiUrl).toContain(videoUrl);
    });

    it('should filter out null and undefined options', () => {
      // Arrange
      const options = {
        width: 640,
        height: null,
        mode: 'video',
        fit: undefined,
        audio: null,
      };
      const videoUrl = 'https://example.com/videos/sample.mp4';

      // Act
      const cdnCgiUrl = buildCdnCgiMediaUrl(options, videoUrl);

      // Assert
      expect(cdnCgiUrl).toContain('width=640');
      expect(cdnCgiUrl).toContain('mode=video');
      expect(cdnCgiUrl).not.toContain('height=');
      expect(cdnCgiUrl).not.toContain('fit=');
      expect(cdnCgiUrl).not.toContain('audio=');
    });
  });
});

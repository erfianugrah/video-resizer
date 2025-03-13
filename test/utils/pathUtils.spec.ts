/**
 * Tests for pathUtils
 */
import { describe, it, expect } from 'vitest';
import {
  findMatchingPathPattern,
  buildCdnCgiMediaUrl,
  PathPattern,
  matchPathWithCaptures,
  normalizeVideoPath,
  extractVideoId,
  createQualityPath
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
    
    it('should respect pattern priority', () => {
      // Arrange
      const patterns: PathPattern[] = [
        {
          name: 'general-videos',
          matcher: '^/videos/',
          processPath: true,
          baseUrl: null,
          originUrl: null,
          priority: 1,
        },
        {
          name: 'specific-videos',
          matcher: '^/videos/featured/',
          processPath: true,
          baseUrl: null,
          originUrl: null,
          priority: 10, // Higher priority should be matched first
        },
      ];

      // Act
      const match = findMatchingPathPattern('/videos/featured/sample.mp4', patterns);

      // Assert
      expect(match).toEqual(patterns[1]); // Should match the high priority pattern
      expect(match?.name).toBe('specific-videos');
    });
  });
  
  describe('matchPathWithCaptures', () => {
    it('should match path and extract capture groups', () => {
      // Arrange
      const patterns: PathPattern[] = [
        {
          name: 'videos',
          matcher: '^/videos/([a-z0-9]+)(?:/.*)?$',
          processPath: true,
          baseUrl: null,
          originUrl: null,
          captureGroups: ['videoId'],
        },
      ];

      // Act
      const result = matchPathWithCaptures('/videos/abc123/index.mp4', patterns);

      // Assert
      expect(result).not.toBeNull();
      expect(result?.matched).toBe(true);
      expect(result?.pattern).toEqual(patterns[0]);
      expect(result?.captures['1']).toBe('abc123');
      expect(result?.captures['videoId']).toBe('abc123');
    });
    
    it('should match multiple capture groups', () => {
      // Arrange
      const patterns: PathPattern[] = [
        {
          name: 'category-videos',
          matcher: '^/([a-z]+)/([a-z0-9-]+\\.mp4)$',
          processPath: true,
          baseUrl: null,
          originUrl: null,
          captureGroups: ['category', 'filename'],
        },
      ];

      // Act
      const result = matchPathWithCaptures('/sports/highlight-reel.mp4', patterns);

      // Assert
      expect(result).not.toBeNull();
      expect(result?.captures['category']).toBe('sports');
      expect(result?.captures['filename']).toBe('highlight-reel.mp4');
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
      const result = matchPathWithCaptures('/images/photo.jpg', patterns);

      // Assert
      expect(result).toBeNull();
    });
  });
  
  describe('normalizeVideoPath', () => {
    it('should remove double slashes', () => {
      // Act
      const result = normalizeVideoPath('/videos//sample//test.mp4');
      
      // Assert
      expect(result).toBe('/videos/sample/test.mp4');
    });
    
    it('should not remove double slashes after protocol', () => {
      // Act
      const result = normalizeVideoPath('https://example.com/videos/test.mp4');
      
      // Assert
      expect(result).toBe('https://example.com/videos/test.mp4');
    });
    
    it('should remove trailing slash', () => {
      // Act
      const result = normalizeVideoPath('/videos/test/');
      
      // Assert
      expect(result).toBe('/videos/test');
    });
  });
  
  describe('extractVideoId', () => {
    it('should extract video ID from path using pattern', () => {
      // Arrange
      const pattern: PathPattern = {
        name: 'videos',
        matcher: '^/videos/([a-z0-9]+)(?:/.*)?$',
        processPath: true,
        baseUrl: null,
        originUrl: null,
        captureGroups: ['videoId'],
      };
      
      // Act
      const videoId = extractVideoId('/videos/abc123/index.mp4', pattern);
      
      // Assert
      expect(videoId).toBe('abc123');
    });
    
    it('should return null if pattern does not match', () => {
      // Arrange
      const pattern: PathPattern = {
        name: 'videos',
        matcher: '^/videos/([a-z0-9]+)(?:/.*)?$',
        processPath: true,
        baseUrl: null,
        originUrl: null,
      };
      
      // Act
      const videoId = extractVideoId('/images/abc123.jpg', pattern);
      
      // Assert
      expect(videoId).toBeNull();
    });
    
    it('should use first capture group if no videoId is named', () => {
      // Arrange
      const pattern: PathPattern = {
        name: 'videos',
        matcher: '^/v/([a-z0-9]+)(?:/.*)?$',
        processPath: true,
        baseUrl: null,
        originUrl: null,
      };
      
      // Act
      const videoId = extractVideoId('/v/abc123/index.mp4', pattern);
      
      // Assert
      expect(videoId).toBe('abc123');
    });
  });
  
  describe('createQualityPath', () => {
    it('should insert quality into the path', () => {
      // Act
      const result = createQualityPath('https://example.com/videos/sample.mp4', '720p');
      
      // Assert
      expect(result).toBe('https://example.com/videos/quality/720p/sample.mp4');
    });
    
    it('should not modify paths that already contain quality', () => {
      // Act
      const path = 'https://example.com/videos/quality/1080p/sample.mp4';
      const result = createQualityPath(path, '720p');
      
      // Assert
      expect(result).toBe(path);
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
      expect(cdnCgiUrl).toEqual('https://example.com/cdn-cgi/media/width=640,height=360,mode=video,fit=contain,audio=true/https://example.com/videos/sample.mp4');
      expect(cdnCgiUrl).toContain('https://example.com/cdn-cgi/media/');
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
      expect(cdnCgiUrl).toEqual('https://example.com/cdn-cgi/media/width=640,mode=video/https://example.com/videos/sample.mp4');
      expect(cdnCgiUrl).toContain('width=640');
      expect(cdnCgiUrl).toContain('mode=video');
      expect(cdnCgiUrl).not.toContain('height=');
      expect(cdnCgiUrl).not.toContain('fit=');
      expect(cdnCgiUrl).not.toContain('audio=');
      expect(cdnCgiUrl).toContain(videoUrl);
    });
    
    it('should include the host in the CDN-CGI URL', () => {
      // Arrange
      const options = {
        width: 854,
        height: 480,
        fit: 'contain',
      };
      const videoUrl = 'https://videos.erfi.dev/rocky.mp4';

      // Act
      const cdnCgiUrl = buildCdnCgiMediaUrl(options, videoUrl);

      // Assert
      expect(cdnCgiUrl).toEqual('https://videos.erfi.dev/cdn-cgi/media/width=854,height=480,fit=contain/https://videos.erfi.dev/rocky.mp4');
      expect(cdnCgiUrl.startsWith('https://videos.erfi.dev/cdn-cgi/media/')).toBe(true);
    });
  });
});
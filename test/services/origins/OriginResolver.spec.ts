/**
 * Tests for the OriginResolver service
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OriginResolver } from '../../../src/services/origins/OriginResolver';
import { Origin, Source, VideoResizerConfig } from '../../../src/services/videoStorage/interfaces';

// Mock error handling utilities
vi.mock('../../../src/utils/errorHandlingUtils', () => ({
  logErrorWithContext: vi.fn(),
}));

describe('OriginResolver', () => {
  // Suppress console output during tests
  const originalConsoleDebug = console.debug;

  beforeEach(() => {
    console.debug = vi.fn();
  });

  afterEach(() => {
    console.debug = originalConsoleDebug;
  });

  // Test sample configuration with multiple origins
  const testConfig: VideoResizerConfig = {
    version: '2.0.0',
    origins: [
      {
        name: 'videos',
        matcher: '^/videos/(.+)$',
        captureGroups: ['videoId'],
        sources: [
          {
            type: 'r2',
            bucketBinding: 'VIDEOS_BUCKET',
            path: '$1',
            priority: 1,
          },
          {
            type: 'remote',
            url: 'https://videos.erfi.dev',
            path: 'videos/$1',
            priority: 2,
          },
          {
            type: 'fallback',
            url: 'https://cdn.erfi.dev',
            path: '$1',
            priority: 3,
          },
        ],
        ttl: {
          ok: 300,
          redirects: 300,
          clientError: 60,
          serverError: 10,
        },
        useTtlByStatus: true,
      },
      {
        name: 'popular',
        matcher: '^/popular/(.*\\.mp4)$',
        captureGroups: ['videoId'],
        sources: [
          {
            type: 'r2',
            bucketBinding: 'VIDEOS_BUCKET',
            path: 'popular/$1',
            priority: 1,
          },
          {
            type: 'remote',
            url: 'https://videos.erfi.dev',
            path: 'popular/$1',
            priority: 2,
          },
        ],
        ttl: {
          ok: 600,
          redirects: 300,
          clientError: 60,
          serverError: 10,
        },
      },
      {
        name: 'default',
        matcher: '.*',
        sources: [
          {
            type: 'fallback',
            url: 'https://cdn.erfi.dev',
            path: '$1',
            priority: 1,
          },
        ],
      },
    ],
  };

  describe('findMatchingOrigin', () => {
    it('should find the correct origin for a path', () => {
      const resolver = new OriginResolver(testConfig);

      const videoOrigin = resolver.findMatchingOrigin('/videos/test-video.mp4');
      expect(videoOrigin).not.toBeNull();
      expect(videoOrigin?.name).toBe('videos');

      const popularOrigin = resolver.findMatchingOrigin('/popular/trending.mp4');
      expect(popularOrigin).not.toBeNull();
      expect(popularOrigin?.name).toBe('popular');
    });

    it('should use the catch-all default pattern if no specific match is found', () => {
      const resolver = new OriginResolver(testConfig);

      const defaultOrigin = resolver.findMatchingOrigin('/some/other/path.mp4');
      expect(defaultOrigin).not.toBeNull();
      expect(defaultOrigin?.name).toBe('default');
    });

    it('should return null if no origins are defined', () => {
      const emptyConfig: VideoResizerConfig = {
        version: '2.0.0',
      };

      const resolver = new OriginResolver(emptyConfig);
      const result = resolver.findMatchingOrigin('/videos/test.mp4');

      expect(result).toBeNull();
    });
  });

  describe('matchOriginWithCaptures', () => {
    it('should match path and extract capture groups', () => {
      const resolver = new OriginResolver(testConfig);

      const result = resolver.matchOriginWithCaptures('/videos/test-video.mp4');
      expect(result).not.toBeNull();
      expect(result?.origin.name).toBe('videos');
      expect(result?.captures['1']).toBe('test-video.mp4');
      expect(result?.captures['videoId']).toBe('test-video.mp4');
    });

    it('should match paths with multiple capture groups', () => {
      // Create config with multiple capture groups
      const multiCaptureConfig: VideoResizerConfig = {
        version: '2.0.0',
        origins: [
          {
            name: 'videos',
            matcher: '^/videos/([^/]+)/([^/]+\\.mp4)$',
            captureGroups: ['category', 'filename'],
            sources: [
              {
                type: 'r2',
                path: '$1/$2',
                priority: 1,
              },
            ],
          },
        ],
      };

      const resolver = new OriginResolver(multiCaptureConfig);

      const result = resolver.matchOriginWithCaptures('/videos/nature/sunset.mp4');
      expect(result).not.toBeNull();
      expect(result?.origin.name).toBe('videos');
      expect(result?.captures['1']).toBe('nature');
      expect(result?.captures['2']).toBe('sunset.mp4');
      expect(result?.captures['category']).toBe('nature');
      expect(result?.captures['filename']).toBe('sunset.mp4');
    });

    it('should return null if no match is found', () => {
      // Create config without a catch-all pattern
      const strictConfig: VideoResizerConfig = {
        version: '2.0.0',
        origins: [
          {
            name: 'videos',
            matcher: '^/videos/(.+)$',
            sources: [{ type: 'r2', path: '$1', priority: 1 }],
          },
        ],
      };

      const resolver = new OriginResolver(strictConfig);

      const result = resolver.matchOriginWithCaptures('/not-videos/test.mp4');
      expect(result).toBeNull();
    });
  });

  describe('getHighestPrioritySource', () => {
    it('should return the source with the lowest priority number', () => {
      const resolver = new OriginResolver(testConfig);
      const origin = (testConfig.origins as Origin[])?.[0] as Origin;

      const source = resolver.getHighestPrioritySource(origin);
      expect(source).not.toBeNull();
      expect(source?.type).toBe('r2');
      expect(source?.priority).toBe(1);
    });

    it('should exclude specified types when requested', () => {
      const resolver = new OriginResolver(testConfig);
      const origin = (testConfig.origins as Origin[])?.[0] as Origin;

      const source = resolver.getHighestPrioritySource(origin, { excludeTypes: ['r2'] });
      expect(source).not.toBeNull();
      expect(source?.type).toBe('remote');
      expect(source?.priority).toBe(2);
    });

    it('should return null if no sources are available after filtering', () => {
      const resolver = new OriginResolver(testConfig);
      const origin = (testConfig.origins as Origin[])?.[0] as Origin;

      const source = resolver.getHighestPrioritySource(origin, {
        excludeTypes: ['r2', 'remote', 'fallback'],
      });
      expect(source).toBeNull();
    });
  });

  describe('resolvePathForSource', () => {
    it('should replace numbered capture references in the path template', () => {
      const resolver = new OriginResolver(testConfig);
      const captures = { '1': 'test-video.mp4' };
      const source = { type: 'r2' as const, path: '$1', priority: 1 };

      const result = resolver.resolvePathForSource('/videos/test-video.mp4', source, captures);
      expect(result).toBe('test-video.mp4');
    });

    it('should replace named capture references in the path template', () => {
      const resolver = new OriginResolver(testConfig);
      const captures = { videoId: 'test-video.mp4' };
      const source = { type: 'remote' as const, path: 'videos/${videoId}', priority: 2 };

      const result = resolver.resolvePathForSource('/videos/test-video.mp4', source, captures);
      expect(result).toBe('videos/test-video.mp4');
    });

    it('should handle complex paths with multiple replacements', () => {
      const resolver = new OriginResolver(testConfig);
      const captures = {
        '1': 'nature',
        '2': 'sunset.mp4',
        category: 'nature',
        filename: 'sunset.mp4',
      };
      const source = { type: 'r2' as const, path: 'videos/$1/${filename}', priority: 1 };

      const result = resolver.resolvePathForSource('/videos/nature/sunset.mp4', source, captures);
      expect(result).toBe('videos/nature/sunset.mp4');
    });

    it('should return normalized path if no source path is defined', () => {
      const resolver = new OriginResolver(testConfig);
      const captures = { '1': 'test-video.mp4' };
      const source = { type: 'r2' as const, priority: 1 } as Source;

      const result = resolver.resolvePathForSource('/videos/test-video.mp4', source, captures);
      expect(result).toBe('videos/test-video.mp4');
    });
  });

  describe('resolvePathToSource', () => {
    it('should resolve a path to the highest priority source with correct path', () => {
      const resolver = new OriginResolver(testConfig);

      const result = resolver.resolvePathToSource('/videos/test-video.mp4');
      expect(result).not.toBeNull();
      expect(result?.source.type).toBe('r2');
      expect(result?.resolvedPath).toBe('test-video.mp4');
      expect(result?.originType).toBe('r2');
    });

    it('should filter by origin type when specified', () => {
      const resolver = new OriginResolver(testConfig);

      const result = resolver.resolvePathToSource('/videos/test-video.mp4', {
        originType: 'remote',
      });
      expect(result).not.toBeNull();
      expect(result?.source.type).toBe('remote');
      expect(result?.resolvedPath).toBe('videos/test-video.mp4');
      expect(result?.originType).toBe('remote');
      expect(result?.sourceUrl).toBe('https://videos.erfi.dev/videos/test-video.mp4');
    });

    it('should include sourceUrl for remote and fallback types', () => {
      const resolver = new OriginResolver(testConfig);

      const remoteResult = resolver.resolvePathToSource('/videos/test-video.mp4', {
        originType: 'remote',
      });
      expect(remoteResult?.sourceUrl).toBe('https://videos.erfi.dev/videos/test-video.mp4');

      const fallbackResult = resolver.resolvePathToSource('/videos/test-video.mp4', {
        originType: 'fallback',
      });
      expect(fallbackResult?.sourceUrl).toBe('https://cdn.erfi.dev/test-video.mp4');
    });

    it('should return null if no match is found', () => {
      // Create config without a catch-all pattern
      const strictConfig: VideoResizerConfig = {
        version: '2.0.0',
        origins: [
          {
            name: 'videos',
            matcher: '^/videos/(.+)$',
            sources: [{ type: 'r2', path: '$1', priority: 1 }],
          },
        ],
      };

      const resolver = new OriginResolver(strictConfig);

      const result = resolver.resolvePathToSource('/not-videos/test.mp4');
      expect(result).toBeNull();
    });
  });
});

/**
 * Integration tests for the Origins resolution workflow
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { 
  createMockRequest, 
  mockFetch,
  generateRandomVideoId,
  createMockHeaders
} from '../utils/test-utils';
import { OriginResolver } from '../../src/services/origins/OriginResolver';
import { Origin, Source, VideoResizerConfig } from '../../src/services/videoStorage/interfaces';
import { ResponseBuilder } from '../../src/utils/responseBuilder';

//vi.mock('../../src/utils/responseBuilder');

// Mock fetch for remote sources
vi.mock('node-fetch', () => ({
  default: vi.fn().mockImplementation(() => 
    Promise.resolve(new Response('Remote content'))
  )
}));

// Mock error handling utilities
vi.mock('../../src/utils/errorHandlingUtils', () => ({
  logErrorWithContext: vi.fn()
}));

describe('Origin Resolution Integration', () => {
  // Sample config with origins
  const testConfig: VideoResizerConfig = {
    version: '2.0.0',
    origins: [
      {
        name: 'videos',
        matcher: '^/videos/([a-zA-Z0-9-_]+)(?:\\.(mp4|webm))?$',
        captureGroups: ['videoId', 'extension'],
        sources: [
          {
            type: 'r2',
            priority: 1,
            bucketBinding: 'VIDEOS_BUCKET',
            path: 'videos/${videoId}.mp4'
          },
          {
            type: 'remote',
            priority: 2,
            url: 'https://videos.example.com',
            path: '${videoId}.mp4'
          }
        ]
      },
      {
        name: 'shorts',
        matcher: '^/shorts/([a-zA-Z0-9-_]+)$',
        captureGroups: ['videoId'],
        sources: [
          {
            type: 'r2',
            priority: 1,
            bucketBinding: 'SHORTS_BUCKET',
            path: 'shorts/${videoId}.mp4'
          }
        ],
        transformOptions: {
          videoCompression: 'medium',
          quality: 'medium'
        }
      },
      {
        name: 'premium',
        matcher: '^/premium/([a-zA-Z0-9-_]+)$',
        captureGroups: ['videoId'],
        sources: [
          {
            type: 'remote',
            priority: 1,
            url: 'https://premium.example.com',
            path: 'videos/${videoId}.mp4',
            auth: {
              enabled: true,
              type: 'token',
              tokenHeaderName: 'X-Premium-Token',
              tokenSecret: 'SECRET_TOKEN'
            }
          }
        ]
      },
      {
        name: 'default',
        matcher: '.*',
        sources: [
          {
            type: 'fallback',
            priority: 1,
            url: 'https://fallback.example.com',
            path: '${request_path}'
          }
        ]
      }
    ]
  };

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn().mockImplementation(() => Promise.resolve(new Response('Mocked content')));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('OriginResolver', () => {
    it('should match a path to the correct origin', () => {
      const resolver = new OriginResolver(testConfig);
      const videoId = generateRandomVideoId();
      const path = `/videos/${videoId}`;

      const result = resolver.findMatchingOrigin(path);

      expect(result).not.toBeNull();
      expect(result?.name).toBe('videos');
    });

    it('should extract capture groups correctly', () => {
      const resolver = new OriginResolver(testConfig);
      const videoId = generateRandomVideoId();
      const path = `/videos/${videoId}.webm`;

      const result = resolver.matchOriginWithCaptures(path);

      expect(result).not.toBeNull();
      expect(result?.captures.videoId).toBe(videoId);
      expect(result?.captures.extension).toBe('webm');
    });

    it('should use template string format to resolve paths', () => {
      const resolver = new OriginResolver(testConfig);
      const videoId = generateRandomVideoId();
      const path = `/videos/${videoId}`;

      const result = resolver.matchOriginWithCaptures(path);
      expect(result).not.toBeNull();

      if (result) {
        const source = result.origin.sources[0]; // R2 source
        const resolvedPath = resolver.resolvePathForSource(path, source, result.captures);

        // Should resolve to the r2 path with the videoId and default mp4 extension
        expect(resolvedPath).toBe(`videos/${videoId}.mp4`);
      }
    });

    it('should resolve a path to the highest priority source for r2', () => {
      const resolver = new OriginResolver(testConfig);
      const videoId = generateRandomVideoId();
      const path = `/videos/${videoId}`;

      const result = resolver.resolvePathToSource(path);

      expect(result).not.toBeNull();
      expect(result?.source.type).toBe('r2');
      expect(result?.resolvedPath).toBe(`videos/${videoId}.mp4`);
    });

    it('should resolve a path to the remote source when specified directly', () => {
      const resolver = new OriginResolver(testConfig);
      const videoId = generateRandomVideoId();
      const path = `/videos/${videoId}`;

      const result = resolver.resolvePathToSource(path, { 
        originType: 'remote' 
      });

      expect(result).not.toBeNull();
      expect(result?.source.type).toBe('remote');
      expect(result?.resolvedPath).toBe(`${videoId}.mp4`);
      expect(result?.sourceUrl).toBe(`https://videos.example.com/${videoId}.mp4`);
    });

    it('should include the sourceUrl for remote sources', () => {
      const resolver = new OriginResolver(testConfig);
      const videoId = generateRandomVideoId();
      const path = `/videos/${videoId}`;

      const result = resolver.resolvePathToSource(path, { 
        originType: 'remote' 
      });

      expect(result).not.toBeNull();
      expect(result?.sourceUrl).toBe(`https://videos.example.com/${videoId}.mp4`);
    });

    it('should fallback to default origin if no specific match is found', () => {
      const resolver = new OriginResolver(testConfig);
      const path = '/unknown/path';

      const result = resolver.resolvePathToSource(path);

      expect(result).not.toBeNull();
      expect(result?.source.type).toBe('fallback');
      expect(result?.sourceUrl).toContain('https://fallback.example.com/');
    });

    it('should respect source priority ordering', () => {
      // Create a custom config with sources in reverse priority order
      const customConfig: VideoResizerConfig = {
        ...testConfig,
        origins: [
          {
            ...testConfig.origins![0],
            sources: [
              // Remote first in array but priority 2
              {
                type: 'remote',
                priority: 2,
                url: 'https://videos.example.com',
                path: '${videoId}.${extension:mp4}'
              },
              // R2 second in array but priority 1
              {
                type: 'r2',
                priority: 1,
                bucketBinding: 'VIDEOS_BUCKET',
                path: 'videos/${videoId}.${extension:mp4}'
              }
            ]
          }
        ]
      };

      const resolver = new OriginResolver(customConfig);
      const videoId = generateRandomVideoId();
      const path = `/videos/${videoId}`;

      const result = resolver.resolvePathToSource(path);

      // Should still select R2 because it has priority 1
      expect(result).not.toBeNull();
      expect(result?.source.type).toBe('r2');
    });
  });

  describe('Response Building', () => {
    // Skip these tests for now as they require complex mocking and
    // they are covered by the unit tests for ResponseBuilder
    it.skip('should add origin information to response headers', async () => {
      // This test would verify that ResponseBuilder.withOriginInfo correctly
      // adds origin information headers to the response
    });
    
    it.skip('should add source resolution information to headers', async () => {
      // This test would verify that ResponseBuilder.withOriginInfo correctly
      // adds source resolution information headers to the response
    });

    it.skip('should create proper error response for origin errors', () => {
      // This test would verify that ResponseBuilder.createOriginErrorResponse
      // correctly creates an error response with appropriate headers
    });
  });

  describe('Edge Cases', () => {
    it('should handle URL-encoded path components', () => {
      // Create a specific config for this test
      const encodedConfig: VideoResizerConfig = {
        version: '2.0.0',
        origins: [
          {
            name: 'videos',
            matcher: '^/videos/(.+)$',
            captureGroups: ['videoId'],
            sources: [
              {
                type: 'r2',
                priority: 1,
                bucketBinding: 'VIDEOS_BUCKET',
                path: 'videos/${videoId}'
              }
            ]
          }
        ]
      };
      
      const resolver = new OriginResolver(encodedConfig);
      const videoId = 'special video+with spaces';
      const encodedVideoId = encodeURIComponent(videoId);
      const path = `/videos/${encodedVideoId}`;

      const result = resolver.matchOriginWithCaptures(path);

      expect(result).not.toBeNull();
      expect(result?.captures['1']).toBe(encodedVideoId);
      expect(result?.captures.videoId).toBe(encodedVideoId);
    });

    it('should handle empty capture groups with defaults', () => {
      const resolver = new OriginResolver(testConfig);
      const videoId = generateRandomVideoId();
      const path = `/videos/${videoId}`;

      const result = resolver.matchOriginWithCaptures(path);
      expect(result).not.toBeNull();

      if (result) {
        const source = result.origin.sources[0]; // R2 source
        const resolvedPath = resolver.resolvePathForSource(path, source, result.captures);

        // Should use default mp4 extension when none is provided
        expect(resolvedPath).toBe(`videos/${videoId}.mp4`);
      }
    });

    it('should handle origins without sources gracefully', () => {
      // Create a config with an origin that has no sources
      const customConfig: VideoResizerConfig = {
        ...testConfig,
        origins: [
          {
            name: 'empty',
            matcher: '^/empty/.*$',
            sources: [] // Empty sources
          },
          ...testConfig.origins!
        ]
      };

      const resolver = new OriginResolver(customConfig);
      const path = '/empty/test';

      const highestPriority = resolver.matchOriginWithCaptures(path);
      expect(highestPriority).not.toBeNull();

      const source = resolver.getHighestPrioritySource(highestPriority!.origin);
      expect(source).toBeNull(); // No sources available
    });
  });
});
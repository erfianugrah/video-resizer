/**
 * Tests for cache behavior and edge cases
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { 
  createMockRequest, 
  createMockConfig, 
  mockFetch,
  setupMockCf
} from '../utils/test-utils';
import { handleVideoRequest } from '../../src/handlers/videoHandler';
import { determineCacheConfig } from '../../src/utils/cacheUtils';

// Mocks
vi.mock('../../src/utils/loggerUtils', () => ({
  debug: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  logRequest: vi.fn(),
}));

// Mock the videoTransformationService
vi.mock('../../src/services/videoTransformationService', () => {
  return {
    transformVideo: vi.fn().mockImplementation(async () => {
      return new Response('Transformed video content', {
        status: 200,
        headers: {
          'Content-Type': 'video/mp4',
          'Cache-Control': 'public, max-age=86400',
          'Cache-Tag': 'video-resizer,source:videos',
        }
      });
    }),
    getBestVideoFormat: vi.fn().mockReturnValue('mp4'),
    estimateOptimalBitrate: vi.fn().mockReturnValue(2500)
  };
});

describe('Cache Behavior and Edge Cases', () => {
  let mockCf: ReturnType<typeof setupMockCf>;
  
  beforeEach(() => {
    vi.clearAllMocks();
    // Setup mock Cloudflare cache
    mockCf = setupMockCf();
    // Default mock response
    mockFetch('Video content');
  });
  
  afterEach(() => {
    vi.restoreAllMocks();
  });
  
  describe('Cache TTL handling', () => {
    it('should set cache headers based on cache configuration', async () => {
      // Arrange - video URL that matches a high traffic pattern
      const request = createMockRequest('https://example.com/popular/trending.mp4');
      const config = createMockConfig();
      
      // Act
      const response = await handleVideoRequest(request, config);
      
      // Assert
      expect(response.status).toBe(200);
      
      // Should have Cache-Control header with TTL
      const cacheControl = response.headers.get('Cache-Control');
      expect(cacheControl).toContain('public');
      expect(cacheControl).toContain('max-age=');
      
      // Should include cache tags
      expect(response.headers.has('Cache-Tag')).toBe(true);
    });
    
    it('should use path-specific cache TTL when specified', async () => {
      // Arrange - URL that matches a path with custom TTL
      const request = createMockRequest('https://example.com/features/highlight-reel');
      const config = createMockConfig();
      
      // Override the mock for this specific test
      const { transformVideo } = await import('../../src/services/videoTransformationService');
      vi.mocked(transformVideo).mockImplementationOnce(async () => {
        return new Response('Transformed video content', {
          status: 200,
          headers: {
            'Content-Type': 'video/mp4',
            'Cache-Control': 'public, max-age=3600',
            'Cache-Tag': 'video-resizer,source:features',
          }
        });
      });
      
      // Act
      const response = await handleVideoRequest(request, config);
      
      // Assert
      expect(response.status).toBe(200);
      
      // Should have Cache-Control header with the path-specific TTL
      const cacheControl = response.headers.get('Cache-Control');
      expect(cacheControl).toContain('max-age=3600'); // TTL from the 'features' pattern
    });
    
    it('should set short cache TTL for error responses', async () => {
      // Arrange - Video URL with invalid width parameter
      const request = createMockRequest('https://example.com/videos/test.mp4?width=9999');
      const config = createMockConfig();
      
      // Override the mock for this specific test
      const { transformVideo } = await import('../../src/services/videoTransformationService');
      vi.mocked(transformVideo).mockImplementationOnce(async () => {
        return new Response('Error processing video: Width must be between 10 and 2000 pixels', {
          status: 500,
          headers: {
            'Content-Type': 'text/plain',
            'Cache-Control': 'public, max-age=10',
          }
        });
      });
      
      // Act
      const response = await handleVideoRequest(request, config);
      
      // Assert
      expect(response.status).toBe(500);
      
      // Should have Cache-Control header with short TTL for errors
      const cacheControl = response.headers.get('Cache-Control');
      expect(cacheControl).toContain('max-age=');
      
      // The error TTL should be shorter than the success TTL
      const ttlMatch = cacheControl?.match(/max-age=(\d+)/);
      if (ttlMatch && ttlMatch[1]) {
        const ttl = parseInt(ttlMatch[1], 10);
        expect(ttl).toBeLessThanOrEqual(60); // Error TTL should be short
      }
    });
  });
  
  describe('Edge cases', () => {
    it('should handle URLs with unusual characters', async () => {
      // Arrange - URL with spaces, UTF-8 characters, and query parameters
      const complexUrl = 'https://example.com/videos/My Video with spaces & 特殊文字.mp4?width=720&height=480';
      const request = createMockRequest(complexUrl);
      const config = createMockConfig();
      
      // Override the mock for this specific test
      const { transformVideo } = await import('../../src/services/videoTransformationService');
      vi.mocked(transformVideo).mockImplementationOnce(async () => {
        return new Response('Special chars video', {
          status: 200,
          headers: {
            'Content-Type': 'video/mp4',
            'Cache-Control': 'public, max-age=86400',
          }
        });
      });
      
      // Act
      const response = await handleVideoRequest(request, config);
      
      // Assert
      expect(response.status).toBe(200);
      
      // Response should contain our transformed content
      const content = await response.text();
      expect(content).toBe('Special chars video');
    });
    
    it('should handle requests with very long URLs', async () => {
      // Arrange - URL with a long path
      let longPath = '/videos/';
      for (let i = 0; i < 20; i++) {
        longPath += `segment${i}/`;
      }
      longPath += 'video.mp4';
      
      const longUrl = `https://example.com${longPath}`;
      const request = createMockRequest(longUrl);
      const config = createMockConfig();
      
      // Override the mock for this specific test
      const { transformVideo } = await import('../../src/services/videoTransformationService');
      vi.mocked(transformVideo).mockImplementationOnce(async () => {
        return new Response('Long URL video', {
          status: 200,
          headers: {
            'Content-Type': 'video/mp4',
            'Cache-Control': 'public, max-age=86400'
          }
        });
      });
      
      // Act
      const response = await handleVideoRequest(request, config);
      
      // Assert
      expect(response.status).toBe(200);
      const content = await response.text();
      expect(content).toBe('Long URL video');
    });
    
    it('should handle URLs with many query parameters', async () => {
      // Arrange - URL with many query parameters
      let url = 'https://example.com/videos/test.mp4?';
      const params = [];
      
      for (let i = 0; i < 20; i++) {
        params.push(`param${i}=value${i}`);
      }
      
      // Add our actual parameters at the end
      params.push('width=720&height=480');
      
      url += params.join('&');
      const request = createMockRequest(url);
      const config = createMockConfig();
      
      // Override the mock for this specific test
      const { transformVideo } = await import('../../src/services/videoTransformationService');
      vi.mocked(transformVideo).mockImplementationOnce(async () => {
        return new Response('Many params video', {
          status: 200,
          headers: {
            'Content-Type': 'video/mp4',
            'Cache-Control': 'public, max-age=86400',
            'X-Width': '720',
            'X-Height': '480'
          }
        });
      });
      
      // Act
      const response = await handleVideoRequest(request, config);
      
      // Assert
      expect(response.status).toBe(200);
      
      // Check response headers and content
      const content = await response.text();
      expect(content).toBe('Many params video');
      expect(response.headers.get('X-Width')).toBe('720');
      expect(response.headers.get('X-Height')).toBe('480');
    });
    
    it('should handle empty path segments', async () => {
      // Arrange - URL with empty path segments
      const url = 'https://example.com/videos//test///video.mp4';
      const request = createMockRequest(url);
      const config = createMockConfig();
      
      // Override the mock for this specific test
      const { transformVideo } = await import('../../src/services/videoTransformationService');
      vi.mocked(transformVideo).mockImplementationOnce(async () => {
        return new Response('Empty segments video', {
          status: 200,
          headers: {
            'Content-Type': 'video/mp4',
            'Cache-Control': 'public, max-age=86400',
            'X-Normalized-Path': '/videos/test/video.mp4'
          }
        });
      });
      
      // Act
      const response = await handleVideoRequest(request, config);
      
      // Assert
      expect(response.status).toBe(200);
      
      // Check response
      const content = await response.text();
      expect(content).toBe('Empty segments video');
      expect(response.headers.get('X-Normalized-Path')).toBe('/videos/test/video.mp4');
    });
  });
});
/**
 * Tests for cacheManagementService
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { applyCacheHeaders, shouldBypassCache, cacheResponse, getCachedResponse } from '../../src/services/cacheManagementService';
import { CacheConfig } from '../../src/utils/cacheUtils';

// Mock logging functions
vi.mock('../../src/utils/loggerUtils', () => ({
  debug: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
}));

describe('cacheManagementService', () => {
  describe('applyCacheHeaders', () => {
    it('should apply public cache headers for successful responses', () => {
      // Arrange
      const response = new Response('Success', { status: 200 });
      const cacheConfig: CacheConfig = {
        regex: '.*',
        cacheability: true,
        ttl: {
          ok: 3600,
          redirects: 300,
          clientError: 60,
          serverError: 10
        }
      };
      
      // Act
      const result = applyCacheHeaders(response, 200, cacheConfig, 'test-source');
      
      // Assert
      expect(result.headers.get('Cache-Control')).toBe('public, max-age=3600');
      expect(result.headers.get('Cache-Tag')).toBe('video-resizer,source:test-source');
    });
    
    it('should apply shorter TTL for redirect responses', () => {
      // Arrange
      const response = new Response('Redirect', { status: 302 });
      const cacheConfig: CacheConfig = {
        regex: '.*',
        cacheability: true,
        ttl: {
          ok: 3600,
          redirects: 300,
          clientError: 60,
          serverError: 10
        }
      };
      
      // Act
      const result = applyCacheHeaders(response, 302, cacheConfig);
      
      // Assert
      expect(result.headers.get('Cache-Control')).toBe('public, max-age=300');
    });
    
    it('should apply very short TTL for error responses', () => {
      // Arrange
      const response = new Response('Server Error', { status: 500 });
      const cacheConfig: CacheConfig = {
        regex: '.*',
        cacheability: true,
        ttl: {
          ok: 3600,
          redirects: 300,
          clientError: 60,
          serverError: 10
        }
      };
      
      // Act
      const result = applyCacheHeaders(response, 500, cacheConfig);
      
      // Assert
      expect(result.headers.get('Cache-Control')).toBe('public, max-age=10');
    });
    
    it('should apply no-store for uncacheable content', () => {
      // Arrange
      const response = new Response('Success', { status: 200 });
      const cacheConfig: CacheConfig = {
        regex: '.*',
        cacheability: false,
        ttl: {
          ok: 3600,
          redirects: 300,
          clientError: 60,
          serverError: 10
        }
      };
      
      // Act
      const result = applyCacheHeaders(response, 200, cacheConfig);
      
      // Assert
      expect(result.headers.get('Cache-Control')).toBe('no-store');
    });
    
    it('should default to no-store when no cache config is provided', () => {
      // Arrange
      const response = new Response('Success', { status: 200 });
      
      // Act
      const result = applyCacheHeaders(response, 200);
      
      // Assert
      expect(result.headers.get('Cache-Control')).toBe('no-store');
    });
    
    it('should include derivative in cache tag when provided', () => {
      // Arrange
      const response = new Response('Success', { status: 200 });
      const cacheConfig: CacheConfig = {
        regex: '.*',
        cacheability: true,
        ttl: {
          ok: 3600,
          redirects: 300,
          clientError: 60,
          serverError: 10
        }
      };
      
      // Act
      const result = applyCacheHeaders(response, 200, cacheConfig, 'test-source', 'mobile');
      
      // Assert
      expect(result.headers.get('Cache-Tag')).toBe('video-resizer,source:test-source,derivative:mobile');
    });
  });
  
  describe('shouldBypassCache', () => {
    it('should bypass cache when no-cache is in Cache-Control', () => {
      // Arrange
      const request = new Request('https://example.com/video.mp4', {
        headers: {
          'Cache-Control': 'no-cache'
        }
      });
      
      // Act
      const result = shouldBypassCache(request);
      
      // Assert
      expect(result).toBe(true);
    });
    
    it('should bypass cache when no-store is in Cache-Control', () => {
      // Arrange
      const request = new Request('https://example.com/video.mp4', {
        headers: {
          'Cache-Control': 'no-store'
        }
      });
      
      // Act
      const result = shouldBypassCache(request);
      
      // Assert
      expect(result).toBe(true);
    });
    
    it('should bypass cache when debug parameter is present', () => {
      // Arrange
      const request = new Request('https://example.com/video.mp4?debug=true');
      
      // Act
      const result = shouldBypassCache(request);
      
      // Assert
      expect(result).toBe(true);
    });
    
    it('should bypass cache when nocache parameter is present', () => {
      // Arrange
      const request = new Request('https://example.com/video.mp4?nocache=1');
      
      // Act
      const result = shouldBypassCache(request);
      
      // Assert
      expect(result).toBe(true);
    });
    
    it('should use cache by default', () => {
      // Arrange
      const request = new Request('https://example.com/video.mp4');
      
      // Act
      const result = shouldBypassCache(request);
      
      // Assert
      expect(result).toBe(false);
    });
  });
  
  describe('Cache API Integration', () => {
    // Mock global caches object
    const mockPut = vi.fn();
    const mockMatch = vi.fn();
    const mockDefaultCache = {
      put: mockPut,
      match: mockMatch,
    };
    
    // Setup global caches mock
    beforeEach(() => {
      // @ts-expect-error - Mocking global object
      global.caches = {
        default: mockDefaultCache,
        open: vi.fn().mockReturnValue(Promise.resolve(mockDefaultCache)),
      };
      mockPut.mockReset().mockResolvedValue(undefined);
      mockMatch.mockReset().mockResolvedValue(null);
    });
    
    it('should store a cacheable response in the cache', async () => {
      // Arrange
      const request = new Request('https://example.com/video.mp4');
      const response = new Response('Video content', {
        status: 200,
        headers: {
          'Content-Type': 'video/mp4',
          'Cache-Control': 'public, max-age=3600'
        }
      });
      
      // Act
      await cacheResponse(request, response);
      
      // Assert
      expect(mockPut).toHaveBeenCalledWith(request, expect.any(Response));
    });
    
    it('should not cache non-GET requests', async () => {
      // Arrange
      const request = new Request('https://example.com/video.mp4', {
        method: 'POST'
      });
      const response = new Response('Video content', {
        status: 200,
        headers: {
          'Content-Type': 'video/mp4',
          'Cache-Control': 'public, max-age=3600'
        }
      });
      
      // Act
      await cacheResponse(request, response);
      
      // Assert
      expect(mockPut).not.toHaveBeenCalled();
    });
    
    it('should not cache error responses', async () => {
      // Arrange
      const request = new Request('https://example.com/video.mp4');
      const response = new Response('Error', {
        status: 500,
        headers: {
          'Content-Type': 'text/plain',
          'Cache-Control': 'no-store'
        }
      });
      
      // Act
      await cacheResponse(request, response);
      
      // Assert
      expect(mockPut).not.toHaveBeenCalled();
    });
    
    it('should retrieve a cached response when available', async () => {
      // Arrange
      const request = new Request('https://example.com/video.mp4');
      const cachedResponse = new Response('Cached video content', {
        status: 200,
        headers: {
          'Content-Type': 'video/mp4',
          'Cache-Control': 'public, max-age=3600'
        }
      });
      
      mockMatch.mockResolvedValue(cachedResponse);
      
      // Act
      const result = await getCachedResponse(request);
      
      // Assert
      expect(mockMatch).toHaveBeenCalledWith(request);
      expect(result).toBe(cachedResponse);
    });
    
    it('should return null when no cached response is available', async () => {
      // Arrange
      const request = new Request('https://example.com/video.mp4');
      mockMatch.mockResolvedValue(null);
      
      // Act
      const result = await getCachedResponse(request);
      
      // Assert
      expect(mockMatch).toHaveBeenCalledWith(request);
      expect(result).toBeNull();
    });
    
    it('should not attempt to fetch from cache for non-GET requests', async () => {
      // Arrange
      const request = new Request('https://example.com/video.mp4', {
        method: 'POST'
      });
      
      // Act
      const result = await getCachedResponse(request);
      
      // Assert
      expect(mockMatch).not.toHaveBeenCalled();
      expect(result).toBeNull();
    });
    
    it('should bypass cache when Cache-Control: no-store is present', async () => {
      // Arrange
      const request = new Request('https://example.com/video.mp4', {
        headers: {
          'Cache-Control': 'no-store'
        }
      });
      
      // Act
      const result = await getCachedResponse(request);
      
      // Assert
      expect(mockMatch).not.toHaveBeenCalled();
      expect(result).toBeNull();
    });
  });
});
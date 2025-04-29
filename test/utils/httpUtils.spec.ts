/**
 * Tests for httpUtils.ts
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { parseRangeHeader, createUnsatisfiableRangeResponse, handleRangeRequestForInitialAccess } from '../../src/utils/httpUtils';

describe('httpUtils', () => {
  describe('parseRangeHeader', () => {
    it('should return null for null or empty header', () => {
      expect(parseRangeHeader(null, 1000)).toBeNull();
      expect(parseRangeHeader('', 1000)).toBeNull();
    });

    it('should return null for invalid format', () => {
      expect(parseRangeHeader('invalid', 1000)).toBeNull();
      expect(parseRangeHeader('bytes=', 1000)).toBeNull();
      expect(parseRangeHeader('bytes=invalid', 1000)).toBeNull();
      expect(parseRangeHeader('bytes=1-2-3', 1000)).toBeNull();
    });

    it('should return null for zero or negative total size', () => {
      expect(parseRangeHeader('bytes=0-499', 0)).toBeNull();
      expect(parseRangeHeader('bytes=0-499', -5)).toBeNull();
    });

    it('should handle simple range requests correctly', () => {
      const result = parseRangeHeader('bytes=0-499', 1000);
      expect(result).toEqual({ start: 0, end: 499, total: 1000 });
    });

    it('should handle open-ended range requests correctly', () => {
      const result = parseRangeHeader('bytes=500-', 1000);
      expect(result).toEqual({ start: 500, end: 999, total: 1000 });
    });

    it('should handle suffix range requests correctly', () => {
      const result = parseRangeHeader('bytes=-500', 1000);
      expect(result).toEqual({ start: 500, end: 999, total: 1000 });
    });

    it('should handle very small suffix range requests correctly', () => {
      const result = parseRangeHeader('bytes=-5', 10);
      expect(result).toEqual({ start: 5, end: 9, total: 10 });
    });

    it('should handle ranges that extend beyond the resource size', () => {
      const result = parseRangeHeader('bytes=750-2000', 1000);
      expect(result).toEqual({ start: 750, end: 999, total: 1000 });
    });

    it('should handle very large suffix range requests correctly', () => {
      const result = parseRangeHeader('bytes=-2000', 1000);
      expect(result).toEqual({ start: 0, end: 999, total: 1000 });
    });

    it('should return null for out-of-bounds range requests', () => {
      expect(parseRangeHeader('bytes=1000-1500', 1000)).toBeNull();
      expect(parseRangeHeader('bytes=2000-', 1000)).toBeNull();
    });

    it('should return null for invalid range start/end values', () => {
      expect(parseRangeHeader('bytes=abc-def', 1000)).toBeNull();
      expect(parseRangeHeader('bytes=-', 1000)).toBeNull();
      expect(parseRangeHeader('bytes=500-300', 1000)).toBeNull();
      expect(parseRangeHeader('bytes=-0', 1000)).toBeNull();
    });

    it('should handle edge case where totalSize=1', () => {
      const result = parseRangeHeader('bytes=0-0', 1);
      expect(result).toEqual({ start: 0, end: 0, total: 1 });
    });
  });

  describe('createUnsatisfiableRangeResponse', () => {
    it('should create a 416 response with proper headers', () => {
      const response = createUnsatisfiableRangeResponse(1000);

      expect(response.status).toBe(416);
      expect(response.headers.get('Content-Range')).toBe('bytes */1000');
      expect(response.headers.get('Accept-Ranges')).toBe('bytes');
    });

    it('should include the text "Range Not Satisfiable" in the response', async () => {
      const response = createUnsatisfiableRangeResponse(1000);
      const text = await response.text();
      expect(text).toBe('Range Not Satisfiable');
    });
  });

  describe('handleRangeRequestForInitialAccess', () => {
    let consoleSpy: any;
    let cachePutSpy: any;
    let cacheMatchSpy: any;
    let cacheOpenSpy: any;
    let mockCache: any;
    
    beforeEach(() => {
      // Reset mocks before each test
      consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.spyOn(console, 'debug').mockImplementation(() => {});
      
      // Create a mock cache
      mockCache = {
        put: vi.fn(() => Promise.resolve()),
        match: vi.fn(() => Promise.resolve(null))
      };
      
      // Mock the global caches object
      cacheOpenSpy = vi.spyOn(global, 'caches', 'get').mockReturnValue({
        open: vi.fn(() => Promise.resolve(mockCache))
      } as any);
      
      cachePutSpy = mockCache.put;
      cacheMatchSpy = mockCache.match;
      
      // For simplicity in tests, we'll just spy on console.debug
      // and not worry about the actual TTL calculation in tests
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should store response in cache and return cached response', async () => {
      // Create a mock response and request
      const request = new Request('https://example.com/video.mp4');
      const originalResponse = new Response('test content', {
        headers: {
          'Content-Type': 'video/mp4',
          'Content-Length': '12'
        }
      });
      
      // Mock the cache.match to return a response
      const cachedResponse = new Response('cached content', {
        headers: {
          'Content-Type': 'video/mp4',
          'Content-Length': '14',
          'Cache-Status': 'hit'
        }
      });
      mockCache.match.mockResolvedValue(cachedResponse);
      
      const result = await handleRangeRequestForInitialAccess(originalResponse, request);
      
      // Should open the cache
      expect(mockCache.put).toHaveBeenCalled();
      
      // Should attempt to match the request
      expect(mockCache.match).toHaveBeenCalled();
      
      // Should return the cached response
      // Use status and headers to verify it's the right response since we can't read bodies twice
      expect(result.status).toBe(cachedResponse.status);
      expect(result.headers.get('Content-Type')).toBe(cachedResponse.headers.get('Content-Type'));
      expect(result.headers.get('Cache-Status')).toBe('hit');
    });

    it('should handle range requests by creating a range request and using cache.match', async () => {
      // Create a request with a range header
      const request = new Request('https://example.com/video.mp4', {
        headers: {
          'Range': 'bytes=0-5',
          'Accept': 'video/*'
        }
      });
      
      const originalResponse = new Response('full video content', {
        headers: {
          'Content-Type': 'video/mp4',
          'Content-Length': '18'
        }
      });
      
      // Set up the cache to return range response for the range request
      const rangeResponse = new Response('full v', {
        status: 206,
        headers: {
          'Content-Type': 'video/mp4',
          'Content-Range': 'bytes 0-5/18',
          'Content-Length': '6'
        }
      });
      
      mockCache.match.mockImplementation((req: Request) => {
        if (req.headers.get('Range') === 'bytes=0-5') {
          return Promise.resolve(rangeResponse);
        }
        return Promise.resolve(null);
      });
      
      const result = await handleRangeRequestForInitialAccess(originalResponse, request);
      
      // Should put the response in the cache
      expect(cachePutSpy).toHaveBeenCalled();
      
      // Should return the ranged response
      // Use status and headers to verify it's the correct response
      expect(result.status).toBe(206);
      expect(result.headers.get('Content-Type')).toBe('video/mp4');
      expect(result.headers.get('Content-Range')).toBe('bytes 0-5/18');
    });

    it('should fall back to original implementation when Cache API fails', async () => {
      // Make caches.open throw an error
      (global.caches as any).open = vi.fn(() => Promise.reject(new Error('Cache API not available')));
      
      // Create a mock response and request with valid range
      const request = new Request('https://example.com/video.mp4', {
        headers: {
          'Range': 'bytes=0-5' // First 6 bytes
        }
      });
      const originalResponse = new Response('test content', {
        headers: {
          'Content-Type': 'video/mp4',
          'Content-Length': '12'
        }
      });

      const result = await handleRangeRequestForInitialAccess(originalResponse, request);
      
      // Should log the error
      expect(consoleSpy).toHaveBeenCalled();
      
      // Should fall back to the manual implementation
      expect(result.status).toBe(206);
      expect(result.headers.get('Content-Range')).toBe('bytes 0-5/12');
      
      // Check content
      const content = await result.text();
      expect(content).toBe('test c');
    });

    it('should handle failures in both primary and fallback implementations', async () => {
      // Make caches.open throw an error
      (global.caches as any).open = vi.fn(() => Promise.reject(new Error('Cache API not available')));
      
      // Create a mock response that throws when arrayBuffer() is called
      const mockResponse = {
        headers: new Headers({
          'Content-Type': 'video/mp4',
          'Content-Length': '12'
        }),
        clone: () => mockResponse,
        arrayBuffer: () => Promise.reject(new Error('Mock error'))
      };
      
      const request = new Request('https://example.com/video.mp4', {
        headers: {
          'Range': 'bytes=0-5'
        }
      });

      // Cast mockResponse to Response to satisfy type checking
      const result = await handleRangeRequestForInitialAccess(mockResponse as unknown as Response, request);
      
      // Should log multiple errors
      expect(consoleSpy).toHaveBeenCalled();
      
      // Should return the original response as fallback
      expect(result).toBe(mockResponse);
    });
  });
});
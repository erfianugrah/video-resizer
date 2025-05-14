/**
 * Tests for HTTP utilities range request handling
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseRangeHeader, createUnsatisfiableRangeResponse, handleRangeRequestForInitialAccess } from '../../src/utils/httpUtils';

describe('HTTP Utilities', () => {
  describe('parseRangeHeader', () => {
    it('should properly parse a range header with start and end', () => {
      const result = parseRangeHeader('bytes=0-999', 10000);
      expect(result).toEqual({ start: 0, end: 999, total: 10000 });
    });
    
    it('should adjust end to total size if too large', () => {
      const result = parseRangeHeader('bytes=500-20000', 10000);
      expect(result).toEqual({ start: 500, end: 9999, total: 10000 });
    });
    
    it('should handle open-ended ranges', () => {
      const result = parseRangeHeader('bytes=9000-', 10000);
      expect(result).toEqual({ start: 9000, end: 9999, total: 10000 });
    });
    
    it('should handle suffix ranges', () => {
      const result = parseRangeHeader('bytes=-1000', 10000);
      expect(result).toEqual({ start: 9000, end: 9999, total: 10000 });
    });
    
    it('should return null for invalid ranges', () => {
      expect(parseRangeHeader('bytes=500-300', 10000)).toBeNull();
      expect(parseRangeHeader('bytes=10000-20000', 10000)).toBeNull();
      expect(parseRangeHeader('bytes=-', 10000)).toBeNull();
      expect(parseRangeHeader('not-bytes=0-100', 10000)).toBeNull();
      expect(parseRangeHeader('bytes=abc-def', 10000)).toBeNull();
    });
  });
  
  describe('handleRangeRequestForInitialAccess', () => {
    beforeEach(() => {
      // Mock caches API
      // @ts-ignore - Mocking global
      globalThis.caches = {
        open: vi.fn().mockResolvedValue({
          put: vi.fn().mockResolvedValue(undefined),
          match: vi.fn().mockResolvedValue(null),
        }),
      };
      
      // Mock streamable response
      vi.mock('../../src/utils/requestContext', () => ({
        getCurrentContext: vi.fn(() => null),
        addBreadcrumb: vi.fn(),
      }));
      
      vi.mock('../../src/utils/pinoLogger', () => ({
        createLogger: vi.fn(),
        debug: vi.fn(),
        error: vi.fn(),
      }));
    });
    
    it('should bypass Cache API for direct streaming responses with range support', async () => {
      // Setup bypassed response
      const bypassResponse = new Response('video content', {
        status: 200,
        headers: new Headers({
          'Content-Type': 'video/mp4',
          'Content-Length': '10000',
          'Accept-Ranges': 'bytes',
          'X-Bypass-Cache-API': 'true',
        }),
      });
      
      // Setup mock streams
      const mockReader = {
        read: vi.fn()
          .mockResolvedValueOnce({ done: false, value: new Uint8Array(1000) })
          .mockResolvedValueOnce({ done: true }),
      };
      
      // Mock the clone method to return a response with a readable body
      bypassResponse.clone = vi.fn().mockReturnValue({
        body: { getReader: () => mockReader },
        headers: new Headers(bypassResponse.headers),
      });
      
      // Create range request
      const rangeRequest = new Request('https://example.com/video.mp4', {
        headers: new Headers({
          'Range': 'bytes=0-499',
        }),
      });
      
      // Mock TransformStream
      const originalTransformStream = globalThis.TransformStream;
      const mockWriter = {
        write: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
      };
      // @ts-ignore - Mocking global
      globalThis.TransformStream = function() {
        return {
          readable: {},
          writable: { getWriter: () => mockWriter },
        };
      };
      
      try {
        // Execute function
        const result = await handleRangeRequestForInitialAccess(bypassResponse, rangeRequest);
        
        // Verify direct streaming with 206 response
        expect(result.status).toBe(206);
        expect(result.headers.get('Content-Range')).toBe('bytes 0-499/10000');
        expect(result.headers.get('X-Range-Handled-By')).toBe('Direct-Stream-Range-Handler');
        expect(result.headers.get('X-Bypass-Cache-API')).toBe('true');
      } finally {
        // Restore original TransformStream
        globalThis.TransformStream = originalTransformStream;
      }
    });
  });
});
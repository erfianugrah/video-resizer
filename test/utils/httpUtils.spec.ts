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
    it('should return the original response without any Cache API processing', async () => {
      // Create a mock response and request
      const request = new Request('https://example.com/video.mp4');
      const originalResponse = new Response('test content', {
        headers: {
          'Content-Type': 'video/mp4',
          'Content-Length': '12'
        }
      });
      
      const result = await handleRangeRequestForInitialAccess(originalResponse, request);
      
      // Should return the original response unchanged
      expect(result).toBe(originalResponse);
    });

    it('should return the original response even with range headers', async () => {
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
      
      const result = await handleRangeRequestForInitialAccess(originalResponse, request);
      
      // Should return the original response unchanged
      expect(result).toBe(originalResponse);
      expect(result.status).toBe(200); // Original status, not 206
    });

    it('should handle any type of response gracefully', async () => {
      // Create various types of responses
      const request = new Request('https://example.com/video.mp4');
      
      // Test with 404 response
      const notFoundResponse = new Response('Not found', { status: 404 });
      let result = await handleRangeRequestForInitialAccess(notFoundResponse, request);
      expect(result).toBe(notFoundResponse);
      
      // Test with no content response
      const noContentResponse = new Response(null, { status: 204 });
      result = await handleRangeRequestForInitialAccess(noContentResponse, request);
      expect(result).toBe(noContentResponse);
      
      // Test with error response
      const errorResponse = new Response('Server error', { status: 500 });
      result = await handleRangeRequestForInitialAccess(errorResponse, request);
      expect(result).toBe(errorResponse);
    });

    it('should work with any request type', async () => {
      const originalResponse = new Response('test content', {
        headers: {
          'Content-Type': 'video/mp4'
        }
      });
      
      // Test with various request types
      const simpleRequest = new Request('https://example.com/video.mp4');
      let result = await handleRangeRequestForInitialAccess(originalResponse, simpleRequest);
      expect(result).toBe(originalResponse);
      
      // Test with POST request (though unusual for video)
      const postRequest = new Request('https://example.com/video.mp4', { method: 'POST' });
      result = await handleRangeRequestForInitialAccess(originalResponse, postRequest);
      expect(result).toBe(originalResponse);
      
      // Test with complex headers
      const complexRequest = new Request('https://example.com/video.mp4', {
        headers: {
          'Range': 'bytes=100-200',
          'If-Range': '"etag123"',
          'Accept-Encoding': 'gzip, deflate',
          'User-Agent': 'Mozilla/5.0'
        }
      });
      result = await handleRangeRequestForInitialAccess(originalResponse, complexRequest);
      expect(result).toBe(originalResponse);
    });
  });
});
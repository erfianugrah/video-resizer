/**
 * Tests for httpUtils.ts
 */
import { describe, it, expect } from 'vitest';
import { parseRangeHeader, createUnsatisfiableRangeResponse } from '../../src/utils/httpUtils';

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
});
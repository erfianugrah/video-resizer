import { describe, it, expect } from 'vitest';
import { 
  normalizeUrlForCaching,
  addVersionToUrl,
  getVersionFromUrl,
  hasVersionParameter
} from '../../src/utils/urlVersionUtils';

describe('urlVersionUtils', () => {
  describe('normalizeUrlForCaching', () => {
    it('should remove v parameter from URL', () => {
      const url = 'https://example.com/video.mp4?v=3&width=640';
      const result = normalizeUrlForCaching(url);
      expect(result).toBe('https://example.com/video.mp4?width=640');
    });

    it('should handle URLs without v parameter', () => {
      const url = 'https://example.com/video.mp4?width=640';
      const result = normalizeUrlForCaching(url);
      expect(result).toBe(url);
    });

    it('should handle URLs without parameters', () => {
      const url = 'https://example.com/video.mp4';
      const result = normalizeUrlForCaching(url);
      expect(result).toBe(url);
    });

    it('should handle invalid URLs', () => {
      const url = 'not-a-url';
      const result = normalizeUrlForCaching(url);
      expect(result).toBe(url);
    });
  });

  describe('addVersionToUrl', () => {
    it('should add v parameter to URL without parameters', () => {
      const url = 'https://example.com/video.mp4';
      const result = addVersionToUrl(url, 2);
      expect(result).toBe('https://example.com/video.mp4?v=2');
    });

    it('should add v parameter to URL with existing parameters', () => {
      const url = 'https://example.com/video.mp4?width=640';
      const result = addVersionToUrl(url, 3);
      expect(result).toBe('https://example.com/video.mp4?width=640&v=3');
    });

    it('should update existing v parameter', () => {
      const url = 'https://example.com/video.mp4?v=1&width=640';
      const result = addVersionToUrl(url, 2);
      expect(result).toBe('https://example.com/video.mp4?v=2&width=640');
    });

    it('should handle invalid URLs', () => {
      const url = 'not-a-url';
      const result = addVersionToUrl(url, 2);
      expect(result).toBe('not-a-url?v=2');
    });
  });

  describe('getVersionFromUrl', () => {
    it('should return version number from URL with v parameter', () => {
      const url = 'https://example.com/video.mp4?v=3&width=640';
      const result = getVersionFromUrl(url);
      expect(result).toBe(3);
    });

    it('should return null for URL without v parameter', () => {
      const url = 'https://example.com/video.mp4?width=640';
      const result = getVersionFromUrl(url);
      expect(result).toBeNull();
    });

    it('should return null for invalid version value', () => {
      const url = 'https://example.com/video.mp4?v=invalid&width=640';
      const result = getVersionFromUrl(url);
      expect(result).toBeNull();
    });

    it('should return null for invalid URLs', () => {
      const url = 'not-a-url';
      const result = getVersionFromUrl(url);
      expect(result).toBeNull();
    });
  });

  describe('hasVersionParameter', () => {
    it('should return true for URL with v parameter', () => {
      const url = 'https://example.com/video.mp4?v=3&width=640';
      const result = hasVersionParameter(url);
      expect(result).toBe(true);
    });

    it('should return false for URL without v parameter', () => {
      const url = 'https://example.com/video.mp4?width=640';
      const result = hasVersionParameter(url);
      expect(result).toBe(false);
    });

    it('should return false for invalid version value', () => {
      const url = 'https://example.com/video.mp4?v=invalid&width=640';
      const result = hasVersionParameter(url);
      expect(result).toBe(false);
    });

    it('should return false for invalid URLs', () => {
      const url = 'not-a-url';
      const result = hasVersionParameter(url);
      expect(result).toBe(false);
    });
  });
});
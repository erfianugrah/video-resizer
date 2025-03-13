/**
 * Tests for cacheControlUtils
 */
import { describe, it, expect } from 'vitest';
import { 
  determineCacheControl, 
  generateCacheTags, 
  applyCacheHeaders 
} from '../../src/utils/cacheControlUtils';
import { CacheConfig } from '../../src/utils/cacheUtils';

describe('cacheControlUtils', () => {
  describe('determineCacheControl', () => {
    it('should return empty string for undefined cache', () => {
      // Act
      const result = determineCacheControl(200);
      
      // Assert
      expect(result).toBe('');
    });
    
    it('should return TTL for successful responses', () => {
      // Arrange
      const cache: CacheConfig = {
        cacheability: true,
        videoCompression: 'auto',
        ttl: {
          ok: 3600,
          redirects: 60,
          clientError: 10,
          serverError: 0,
        },
      };
      
      // Act
      const result = determineCacheControl(200, cache);
      
      // Assert
      expect(result).toBe('public, max-age=3600');
    });
    
    it('should return TTL for redirect responses', () => {
      // Arrange
      const cache: CacheConfig = {
        cacheability: true,
        videoCompression: 'auto',
        ttl: {
          ok: 3600,
          redirects: 60,
          clientError: 10,
          serverError: 0,
        },
      };
      
      // Act
      const result = determineCacheControl(301, cache);
      
      // Assert
      expect(result).toBe('public, max-age=60');
    });
    
    it('should return TTL for client error responses', () => {
      // Arrange
      const cache: CacheConfig = {
        cacheability: true,
        videoCompression: 'auto',
        ttl: {
          ok: 3600,
          redirects: 60,
          clientError: 10,
          serverError: 0,
        },
      };
      
      // Act
      const result = determineCacheControl(404, cache);
      
      // Assert
      expect(result).toBe('public, max-age=10');
    });
    
    it('should return empty string for server error with TTL 0', () => {
      // Arrange
      const cache: CacheConfig = {
        cacheability: true,
        videoCompression: 'auto',
        ttl: {
          ok: 3600,
          redirects: 60,
          clientError: 10,
          serverError: 0,
        },
      };
      
      // Act
      const result = determineCacheControl(500, cache);
      
      // Assert
      expect(result).toBe('');
    });
  });
  
  describe('generateCacheTags', () => {
    it('should generate basic video tag when no parameters are provided', () => {
      // Act
      const tags = generateCacheTags();
      
      // Assert
      expect(tags).toEqual(['video']);
    });
    
    it('should include source tag when source is provided', () => {
      // Act
      const tags = generateCacheTags('example-source');
      
      // Assert
      expect(tags).toContain('video');
      expect(tags).toContain('source:example-source');
      expect(tags.length).toBe(2);
    });
    
    it('should include derivative tag when derivative is provided', () => {
      // Act
      const tags = generateCacheTags(undefined, 'thumbnail');
      
      // Assert
      expect(tags).toContain('video');
      expect(tags).toContain('derivative:thumbnail');
      expect(tags.length).toBe(2);
    });
    
    it('should include all tags when all parameters are provided', () => {
      // Act
      const tags = generateCacheTags('example-source', 'thumbnail');
      
      // Assert
      expect(tags).toEqual(['video', 'source:example-source', 'derivative:thumbnail']);
    });
  });
  
  describe('applyCacheHeaders', () => {
    it('should apply cache control headers to response', () => {
      // Arrange
      const response = new Response('Test response');
      const cache: CacheConfig = {
        cacheability: true,
        videoCompression: 'auto',
        ttl: {
          ok: 3600,
          redirects: 60,
          clientError: 10,
          serverError: 0,
        },
      };
      
      // Act
      const result = applyCacheHeaders(response, 200, cache, 'test-source', 'high');
      
      // Assert
      expect(result.headers.get('Cache-Control')).toBe('public, max-age=3600');
      expect(result.headers.get('Cache-Tag')).toBe('video,source:test-source,derivative:high');
    });
    
    it('should not apply cache control header when TTL is 0', () => {
      // Arrange
      const response = new Response('Test response');
      const cache: CacheConfig = {
        cacheability: true,
        videoCompression: 'auto',
        ttl: {
          ok: 0,
          redirects: 0,
          clientError: 0,
          serverError: 0,
        },
      };
      
      // Act
      const result = applyCacheHeaders(response, 200, cache);
      
      // Assert
      expect(result.headers.has('Cache-Control')).toBe(false);
      expect(result.headers.get('Cache-Tag')).toBe('video');
    });
  });
});
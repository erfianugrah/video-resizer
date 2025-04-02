/**
 * Tests for the cacheManagementService
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createCfObjectParams } from '../../src/services/cacheManagementService';

describe('cacheManagementService', () => {
  describe('createCfObjectParams', () => {
    it('should set cacheEverything: false when no config is provided', () => {
      // Act
      const cfParams = createCfObjectParams(200);
      
      // Assert
      expect(cfParams.cacheEverything).toBe(false);
      expect(cfParams.cacheTtl).toBe(0);
    });
    
    it('should set cacheEverything based on cacheability flag', () => {
      // Arrange
      const cacheable = {
        cacheability: true,
        ttl: { ok: 3600, redirects: 600, clientError: 60, serverError: 10 }
      };
      
      const notCacheable = {
        cacheability: false,
        ttl: { ok: 3600, redirects: 600, clientError: 60, serverError: 10 }
      };
      
      // Act - With cacheability: true
      const cacheableParams = createCfObjectParams(200, cacheable);
      
      // Act - With cacheability: false
      const notCacheableParams = createCfObjectParams(200, notCacheable);
      
      // Assert
      expect(cacheableParams.cacheEverything).toBe(true);
      expect(notCacheableParams.cacheEverything).toBe(false);
    });
    
    it('should use cacheTtlByStatus when cacheability is true', () => {
      // Arrange
      const cacheable = {
        cacheability: true,
        ttl: { ok: 3600, redirects: 600, clientError: 60, serverError: 10 }
      };
      
      // Act
      const cfParams = createCfObjectParams(200, cacheable);
      
      // Assert
      expect(cfParams.cacheTtlByStatus).toBeDefined();
      expect((cfParams.cacheTtlByStatus as Record<string, number>)['200-299']).toBe(3600);
      expect((cfParams.cacheTtlByStatus as Record<string, number>)['300-399']).toBe(600);
      expect((cfParams.cacheTtlByStatus as Record<string, number>)['400-499']).toBe(60);
      expect((cfParams.cacheTtlByStatus as Record<string, number>)['500-599']).toBe(10);
      // Should not set cacheTtl when using cacheTtlByStatus
      expect(cfParams.cacheTtl).toBeUndefined();
    });
    
    it('should set cacheTtl: 0 when cacheability is false (for backward compatibility)', () => {
      // Arrange
      const notCacheable = {
        cacheability: false,
        ttl: { ok: 3600, redirects: 600, clientError: 60, serverError: 10 }
      };
      
      // Act
      const cfParams = createCfObjectParams(200, notCacheable);
      
      // Assert
      expect(cfParams.cacheTtl).toBe(0);
      expect(cfParams.cacheTtlByStatus).toBeUndefined();
      expect(cfParams.cacheEverything).toBe(false);
    });
    
    it('should add cache tags when source is provided and cacheability is true', () => {
      // Arrange
      const cacheable = {
        cacheability: true,
        ttl: { ok: 3600, redirects: 600, clientError: 60, serverError: 10 }
      };
      const source = 'videos/test.mp4';
      const derivative = 'thumbnail';
      
      // Act
      const cfParams = createCfObjectParams(200, cacheable, source, derivative);
      
      // Assert
      expect(cfParams.cacheTags).toBeDefined();
      expect(Array.isArray(cfParams.cacheTags)).toBe(true);
      expect((cfParams.cacheTags as string[]).length).toBeGreaterThan(0);
    });
    
    it('should not add cache tags when cacheability is false', () => {
      // Arrange
      const notCacheable = {
        cacheability: false,
        ttl: { ok: 3600, redirects: 600, clientError: 60, serverError: 10 }
      };
      const source = 'videos/test.mp4';
      const derivative = 'thumbnail';
      
      // Act
      const cfParams = createCfObjectParams(200, notCacheable, source, derivative);
      
      // Assert
      expect(cfParams.cacheTags).toBeUndefined();
    });
    
    it('should not add cache tags when source is not provided', () => {
      // Arrange
      const cacheable = {
        cacheability: true,
        ttl: { ok: 3600, redirects: 600, clientError: 60, serverError: 10 }
      };
      
      // Act - No source provided
      const cfParams = createCfObjectParams(200, cacheable);
      
      // Assert
      expect(cfParams.cacheTags).toBeUndefined();
    });
    
    it('should not cache error status codes (4xx)', () => {
      // Arrange
      const cacheable = {
        cacheability: true,
        ttl: { ok: 3600, redirects: 600, clientError: 60, serverError: 10 }
      };
      
      // Act with 404 status
      const cfParams = createCfObjectParams(404, cacheable);
      
      // Assert
      expect(cfParams.cacheEverything).toBe(false);
      expect(cfParams.cacheTtl).toBe(0);
    });
    
    it('should not cache error status codes (5xx)', () => {
      // Arrange
      const cacheable = {
        cacheability: true,
        ttl: { ok: 3600, redirects: 600, clientError: 60, serverError: 10 }
      };
      
      // Act with 500 status
      const cfParams = createCfObjectParams(500, cacheable);
      
      // Assert
      expect(cfParams.cacheEverything).toBe(false);
      expect(cfParams.cacheTtl).toBe(0);
    });
    
    it('should not cache non-video/image content types', () => {
      // Arrange
      const cacheable = {
        cacheability: true,
        ttl: { ok: 3600, redirects: 600, clientError: 60, serverError: 10 }
      };
      
      // Act with non-cacheable content type
      const cfParams = createCfObjectParams(200, cacheable, 'video.mp4', 'mobile', 'text/html');
      
      // Assert
      expect(cfParams.cacheEverything).toBe(false);
      expect(cfParams.cacheTtl).toBe(0);
    });
    
    it('should cache video content types', () => {
      // Arrange
      const cacheable = {
        cacheability: true,
        ttl: { ok: 3600, redirects: 600, clientError: 60, serverError: 10 }
      };
      
      // Act with video content type
      const cfParams = createCfObjectParams(200, cacheable, 'video.mp4', 'mobile', 'video/mp4');
      
      // Assert
      expect(cfParams.cacheEverything).toBe(true);
      expect(cfParams.cacheTtlByStatus).toBeDefined();
    });
    
    it('should cache image content types', () => {
      // Arrange
      const cacheable = {
        cacheability: true,
        ttl: { ok: 3600, redirects: 600, clientError: 60, serverError: 10 }
      };
      
      // Act with image content type
      const cfParams = createCfObjectParams(200, cacheable, 'thumbnail.jpg', 'mobile', 'image/jpeg');
      
      // Assert
      expect(cfParams.cacheEverything).toBe(true);
      expect(cfParams.cacheTtlByStatus).toBeDefined();
    });
  });
});
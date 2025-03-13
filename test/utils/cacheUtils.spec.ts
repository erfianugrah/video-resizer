/**
 * Tests for cacheUtils
 */
import { describe, it, expect } from 'vitest';
import { determineCacheConfig, shouldCache } from '../../src/utils/cacheUtils';
import { videoConfig } from '../../src/config/videoConfig';

describe('cacheUtils', () => {
  describe('determineCacheConfig', () => {
    it('should find default cache configuration for any URL', () => {
      // Arrange
      const url = 'https://example.com/videos/sample.mp4';
      
      // Act
      const config = determineCacheConfig(url);
      
      // Assert
      expect(config).toEqual({
        cacheability: true,
        videoCompression: 'auto',
        ttl: videoConfig.cache.default.ttl,
      });
    });
    
    it('should find high traffic cache configuration for popular videos', () => {
      // Arrange
      const url = 'https://example.com/videos/popular/trending.mp4';
      
      // Act
      const config = determineCacheConfig(url);
      
      // Assert
      expect(config.ttl.ok).toBe(videoConfig.cache.highTraffic.ttl.ok);
      expect(config.ttl.ok).toBe(604800); // 7 days
    });
    
    it('should find short form cache configuration for shorts', () => {
      // Arrange
      const url = 'https://example.com/videos/shorts/funny.mp4';
      
      // Act
      const config = determineCacheConfig(url);
      
      // Assert
      expect(config.ttl.ok).toBe(videoConfig.cache.shortForm.ttl.ok);
      expect(config.ttl.ok).toBe(172800); // 2 days
    });
    
    it('should find dynamic cache configuration for live videos', () => {
      // Arrange
      const url = 'https://example.com/videos/live/stream.mp4';
      
      // Act
      const config = determineCacheConfig(url);
      
      // Assert
      expect(config.ttl.ok).toBe(videoConfig.cache.dynamic.ttl.ok);
      expect(config.ttl.ok).toBe(300); // 5 minutes
    });
  });
  
  describe('shouldCache', () => {
    it('should return true when cacheability is true', () => {
      // Arrange
      const config = {
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
      const result = shouldCache(config);
      
      // Assert
      expect(result).toBe(true);
    });
    
    it('should return false when cacheability is false', () => {
      // Arrange
      const config = {
        cacheability: false,
        videoCompression: 'auto',
        ttl: {
          ok: 3600,
          redirects: 60,
          clientError: 10,
          serverError: 0,
        },
      };
      
      // Act
      const result = shouldCache(config);
      
      // Assert
      expect(result).toBe(false);
    });
  });
});
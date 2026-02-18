/**
 * Tests for video configuration
 */
import { describe, it, expect } from 'vitest';
import { videoConfig } from '../../src/config/videoConfig';

describe('Video Configuration', () => {
  describe('Derivatives', () => {
    it('should define standard quality derivatives', () => {
      // Assert
      expect(videoConfig.derivatives).toBeDefined();
      expect(videoConfig.derivatives.high).toBeDefined();
      expect(videoConfig.derivatives.medium).toBeDefined();
      expect(videoConfig.derivatives.low).toBeDefined();
      expect(videoConfig.derivatives.mobile).toBeDefined();
      expect(videoConfig.derivatives.thumbnail).toBeDefined();
    });

    it('should have correct dimensions for high quality', () => {
      // Assert
      expect(videoConfig.derivatives.high.width).toBe(1920);
      expect(videoConfig.derivatives.high.height).toBe(1080);
    });

    it('should have correct dimensions for medium quality', () => {
      // Assert
      expect(videoConfig.derivatives.medium.width).toBe(1280);
      expect(videoConfig.derivatives.medium.height).toBe(720);
    });

    it('should have correct dimensions for low quality', () => {
      // Assert
      expect(videoConfig.derivatives.low.width).toBe(854);
      expect(videoConfig.derivatives.low.height).toBe(480);
    });

    it('should have correct dimensions for mobile quality', () => {
      // Assert
      expect(videoConfig.derivatives.mobile.width).toBe(640);
      expect(videoConfig.derivatives.mobile.height).toBe(360);
    });

    it('should have correct settings for thumbnail', () => {
      // Assert
      expect(videoConfig.derivatives.thumbnail.width).toBe(320);
      expect(videoConfig.derivatives.thumbnail.height).toBe(180);
      expect(videoConfig.derivatives.thumbnail.mode).toBe('frame');
      expect(videoConfig.derivatives.thumbnail.format).toBe('jpg');
    });
  });

  describe('Default Options', () => {
    it('should define default options', () => {
      // Assert
      expect(videoConfig.defaults).toBeDefined();
      expect(videoConfig.defaults.mode).toBe('video');
      expect(videoConfig.defaults.fit).toBe('contain');
      expect(videoConfig.defaults.audio).toBe(true);
    });

    it('should have null width and height by default', () => {
      // Assert
      expect(videoConfig.defaults.width).toBeNull();
      expect(videoConfig.defaults.height).toBeNull();
    });
  });

  describe('Valid Options', () => {
    it('should define valid mode options', () => {
      // Assert
      expect(videoConfig.validOptions.mode).toContain('video');
      expect(videoConfig.validOptions.mode).toContain('frame');
      expect(videoConfig.validOptions.mode).toContain('spritesheet');
    });

    it('should define valid fit options', () => {
      // Assert
      expect(videoConfig.validOptions.fit).toContain('contain');
      expect(videoConfig.validOptions.fit).toContain('cover');
      expect(videoConfig.validOptions.fit).toContain('scale-down');
    });

    it('should define valid format options', () => {
      // Assert
      expect(videoConfig.validOptions.format).toContain('jpg');
      expect(videoConfig.validOptions.format).toContain('png');
    });
  });

  describe('Parameter Mapping', () => {
    it('should map width parameter correctly', () => {
      // Assert
      expect(videoConfig.paramMapping.width).toBe('width');
    });

    it('should map height parameter correctly', () => {
      // Assert
      expect(videoConfig.paramMapping.height).toBe('height');
    });

    it('should map mode parameter correctly', () => {
      // Assert
      expect(videoConfig.paramMapping.mode).toBe('mode');
    });

    it('should map fit parameter correctly', () => {
      // Assert
      expect(videoConfig.paramMapping.fit).toBe('fit');
    });

    it('should map audio parameter correctly', () => {
      // Assert
      expect(videoConfig.paramMapping.audio).toBe('audio');
    });

    it('should map format parameter correctly', () => {
      // Assert
      expect(videoConfig.paramMapping.format).toBe('format');
    });

    it('should map time parameter correctly', () => {
      // Assert
      expect(videoConfig.paramMapping.time).toBe('time');
    });

    it('should map duration parameter correctly', () => {
      // Assert
      expect(videoConfig.paramMapping.duration).toBe('duration');
    });
  });

  describe('CDN-CGI Configuration', () => {
    it('should define CDN-CGI base path', () => {
      // Assert
      expect(videoConfig.cdnCgi.basePath).toBe('/cdn-cgi/media');
    });
  });

  describe('Responsive Configuration', () => {
    it('should define breakpoints', () => {
      // Assert
      expect(videoConfig.responsive.breakpoints).toBeDefined();
      expect(videoConfig.responsive.breakpoints.xs).toBeDefined();
      expect(videoConfig.responsive.breakpoints.sm).toBeDefined();
      expect(videoConfig.responsive.breakpoints.md).toBeDefined();
      expect(videoConfig.responsive.breakpoints.lg).toBeDefined();
      expect(videoConfig.responsive.breakpoints.xl).toBeDefined();
    });

    it('should have increasing breakpoint values', () => {
      // Assert
      const { xs, sm, md, lg, xl } = videoConfig.responsive.breakpoints;
      expect(xs).toBeLessThan(sm);
      expect(sm).toBeLessThan(md);
      expect(md).toBeLessThan(lg);
      expect(lg).toBeLessThan(xl);
    });
  });

  describe('Cache Configuration', () => {
    it('should define cache configurations', () => {
      // Assert
      expect(videoConfig.cache).toBeDefined();
      expect(videoConfig.cache.default).toBeDefined();
      expect(videoConfig.cache.default.ttl).toBeDefined();
    });

    it('should have proper TTL values for default cache config', () => {
      // Assert
      const { ttl } = videoConfig.cache.default;
      expect(ttl.ok).toBeGreaterThan(0);
      expect(ttl.redirects).toBeGreaterThan(0);
      expect(ttl.clientError).toBeGreaterThan(0);

      // Server errors might have 0 TTL which is fine
      expect(ttl.serverError).toBeGreaterThanOrEqual(0);
    });

    it('should only define a default cache profile', () => {
      // Assert - the default config only has a "default" cache profile
      expect(Object.keys(videoConfig.cache)).toEqual(['default']);
    });
  });
});

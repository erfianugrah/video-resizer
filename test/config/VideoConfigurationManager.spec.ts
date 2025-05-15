/**
 * Tests for the VideoConfigurationManager
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { VideoConfigurationManager, configManager, PathPatternSchema, VideoConfigSchema } from '../../src/config/VideoConfigurationManager';
import { z } from 'zod';
import { videoConfig } from '../../src/config/videoConfig';
import { ConfigurationError } from '../../src/errors';

describe('VideoConfigurationManager', () => {
  beforeEach(() => {
    // Reset the singleton instance before each test
    VideoConfigurationManager.resetInstance();
  });

  describe('Initialization and Singleton Pattern', () => {
    it('should create a singleton instance', () => {
      const instance1 = VideoConfigurationManager.getInstance();
      const instance2 = VideoConfigurationManager.getInstance();
      
      expect(instance1).toBe(instance2);
    });

    it('should use the default config if none provided', () => {
      const manager = VideoConfigurationManager.getInstance();
      const config = manager.getConfig();
      
      // Test a few key properties to ensure the default config was loaded
      expect(config.derivatives.desktop).toBeDefined();
      expect(config.defaults.mode).toBe('video');
      expect(config.validOptions.fit).toContain('contain');
    });

    it('should validate the configuration on initialization', () => {
      // Create an invalid config
      const invalidConfig = {
        // Missing required properties
        derivatives: {},
        // Rest of the properties are missing
      };

      // Expect an error when initializing with invalid config
      expect(() => VideoConfigurationManager.getInstance(invalidConfig))
        .toThrow(ConfigurationError);
    });
  });

  describe('Configuration Access Methods', () => {
    it('should return the entire configuration', () => {
      const manager = VideoConfigurationManager.getInstance();
      const config = manager.getConfig();
      
      // Account for new origins property that might be auto-generated
      const expectedKeys = [...Object.keys(videoConfig)];
      if (!expectedKeys.includes('origins') && config.origins) {
        expectedKeys.push('origins');
      }
      
      // Check that all expected keys are present
      // Note: We use includes() instead of strict equality because auto-generated props might be added
      Object.keys(config).forEach(key => {
        expect(expectedKeys).toContain(key);
      });
      
      // Check individual properties
      expect(config.derivatives).toEqual(videoConfig.derivatives);
      expect(config.defaults).toEqual(videoConfig.defaults);
      expect(config.validOptions).toEqual(videoConfig.validOptions);
      expect(config.responsive).toEqual(videoConfig.responsive);
      expect(config.paramMapping).toEqual(videoConfig.paramMapping);
      expect(config.cdnCgi).toEqual(videoConfig.cdnCgi);
      expect(config.pathPatterns).toEqual(videoConfig.pathPatterns);
      expect(config.caching).toEqual(videoConfig.caching);
    });

    it('should return a derivative by name', () => {
      const manager = VideoConfigurationManager.getInstance();
      const desktopDerivative = manager.getDerivative('desktop');
      
      expect(desktopDerivative).toEqual(videoConfig.derivatives.desktop);
    });

    it('should throw an error for non-existent derivative', () => {
      const manager = VideoConfigurationManager.getInstance();
      
      expect(() => manager.getDerivative('nonexistent'))
        .toThrow(ConfigurationError);
    });

    it('should return path patterns', () => {
      const manager = VideoConfigurationManager.getInstance();
      const pathPatterns = manager.getPathPatterns();
      
      expect(pathPatterns).toEqual(videoConfig.pathPatterns);
    });

    it('should return valid options for a parameter', () => {
      const manager = VideoConfigurationManager.getInstance();
      const validModes = manager.getValidOptions('mode');
      
      expect(validModes).toEqual(videoConfig.validOptions.mode);
    });

    it('should check if a value is valid for a parameter', () => {
      const manager = VideoConfigurationManager.getInstance();
      
      expect(manager.isValidOption('mode', 'video')).toBe(true);
      expect(manager.isValidOption('mode', 'invalidMode')).toBe(false);
      expect(manager.isValidOption('nonexistentParam', 'anyValue')).toBe(false);
    });

    it('should return default option value', () => {
      const manager = VideoConfigurationManager.getInstance();
      const defaultMode = manager.getDefaultOption('mode');
      
      expect(defaultMode).toBe(videoConfig.defaults.mode);
    });

    it('should return all default options', () => {
      const manager = VideoConfigurationManager.getInstance();
      const defaults = manager.getDefaults();
      
      expect(defaults).toEqual(videoConfig.defaults);
    });

    it('should return parameter mapping', () => {
      const manager = VideoConfigurationManager.getInstance();
      const paramMapping = manager.getParamMapping();
      
      expect(paramMapping).toEqual(videoConfig.paramMapping);
    });

    it('should return CDN-CGI configuration', () => {
      const manager = VideoConfigurationManager.getInstance();
      const cdnCgiConfig = manager.getCdnCgiConfig();
      
      expect(cdnCgiConfig).toEqual(videoConfig.cdnCgi);
    });

    it('should return cache configuration', () => {
      const manager = VideoConfigurationManager.getInstance();
      const cacheConfig = manager.getCacheConfig();
      
      // Check that all cache profile keys exist
      expect(Object.keys(cacheConfig).sort()).toEqual(Object.keys(videoConfig.cache).sort());
      
      // Check essential properties of each cache profile, allowing for default properties
      Object.keys(cacheConfig).forEach(key => {
        expect(cacheConfig[key].cacheability).toEqual(videoConfig.cache[key].cacheability);
        expect(cacheConfig[key].videoCompression).toEqual(videoConfig.cache[key].videoCompression);
        expect(cacheConfig[key].ttl).toEqual(videoConfig.cache[key].ttl);
      });
    });

    it('should return responsive configuration', () => {
      const manager = VideoConfigurationManager.getInstance();
      const responsiveConfig = manager.getResponsiveConfig();
      
      expect(responsiveConfig).toEqual(videoConfig.responsive);
    });

    it('should return caching method configuration', () => {
      const manager = VideoConfigurationManager.getInstance();
      const cachingConfig = manager.getCachingConfig();
      
      expect(cachingConfig).toEqual(videoConfig.caching);
    });
  });

  describe('Configuration Modification', () => {
    it('should add a path pattern', () => {
      const manager = VideoConfigurationManager.getInstance();
      const initialPatternCount = manager.getPathPatterns().length;
      
      const newPattern = {
        name: 'testPattern',
        matcher: '\\/test\\/([^\\/]+)',
        processPath: true,
        baseUrl: null,
        originUrl: 'https://example.com/videos',
        priority: 10,
        captureGroups: ['videoId']
      };
      
      const addedPattern = manager.addPathPattern(newPattern);
      
      expect(manager.getPathPatterns().length).toBe(initialPatternCount + 1);
      // Check all properties except useTtlByStatus which is added by default
      expect(addedPattern.name).toEqual(newPattern.name);
      expect(addedPattern.matcher).toEqual(newPattern.matcher);
      expect(addedPattern.processPath).toEqual(newPattern.processPath);
      expect(addedPattern.baseUrl).toEqual(newPattern.baseUrl);
      expect(addedPattern.originUrl).toEqual(newPattern.originUrl);
      expect(addedPattern.priority).toEqual(newPattern.priority);
      expect(addedPattern.captureGroups).toEqual(newPattern.captureGroups);
      // Check that the pattern was added to the path patterns array
      const addedToArray = manager.getPathPatterns()[initialPatternCount];
      expect(addedToArray.name).toBe(newPattern.name);
      expect(addedToArray.matcher).toBe(newPattern.matcher);
    });
    
    it('should add a path pattern with ttl structure', () => {
      const manager = VideoConfigurationManager.getInstance();
      const initialPatternCount = manager.getPathPatterns().length;
      
      const newPattern = {
        name: 'testPatternWithTtl',
        matcher: '\\/videos\\/([^\\/]+)',
        processPath: true,
        baseUrl: null,
        originUrl: 'https://example.com/videos',
        ttl: {
          ok: 86400,
          redirects: 3600,
          clientError: 60,
          serverError: 10
        },
        useTtlByStatus: true,
        priority: 10,
        captureGroups: ['videoId']
      };
      
      const addedPattern = manager.addPathPattern(newPattern);
      
      expect(manager.getPathPatterns().length).toBe(initialPatternCount + 1);
      expect(addedPattern.ttl).toEqual(newPattern.ttl);
      expect(addedPattern.useTtlByStatus).toBe(true);
    });
    
    it('should convert legacy cacheTtl to ttl structure', () => {
      const manager = VideoConfigurationManager.getInstance();
      const initialPatternCount = manager.getPathPatterns().length;
      
      const legacyPattern = {
        name: 'legacyPattern',
        matcher: '\\/legacy\\/([^\\/]+)',
        processPath: true,
        baseUrl: null,
        originUrl: 'https://example.com/videos',
        cacheTtl: 3600, // Legacy TTL
        priority: 10,
        captureGroups: ['videoId']
      };
      
      const addedPattern = manager.addPathPattern(legacyPattern);
      
      expect(manager.getPathPatterns().length).toBe(initialPatternCount + 1);
      
      // Should create ttl structure from legacy cacheTtl
      expect(addedPattern.ttl).toBeDefined();
      expect(addedPattern.ttl?.ok).toBe(3600);
      expect(addedPattern.ttl?.redirects).toBe(360); // 1/10th of the TTL
      expect(addedPattern.ttl?.clientError).toBe(60); // Min of 60 seconds
      expect(addedPattern.ttl?.serverError).toBe(10); // Min of 10 seconds
      
      // Should retain the original cacheTtl for backward compatibility
      expect(addedPattern.cacheTtl).toBe(3600);
    });

    it('should throw an error when adding an invalid path pattern', () => {
      const manager = VideoConfigurationManager.getInstance();
      
      // Missing required properties
      const invalidPattern = {
        name: 'testPattern'
        // Missing matcher, processPath, etc.
      };
      
      expect(() => manager.addPathPattern(invalidPattern as unknown as z.infer<typeof PathPatternSchema>))
        .toThrow(ConfigurationError);
    });

    it('should update the configuration', () => {
      const manager = VideoConfigurationManager.getInstance();
      
      // Update the CDN-CGI base path
      const updatedConfig = manager.updateConfig({
        cdnCgi: {
          basePath: '/new-cdn-cgi/media',
        }
      });
      
      expect(updatedConfig.cdnCgi.basePath).toBe('/new-cdn-cgi/media');
      expect(manager.getCdnCgiConfig().basePath).toBe('/new-cdn-cgi/media');
    });

    it('should throw an error when updating with invalid configuration', () => {
      const manager = VideoConfigurationManager.getInstance();
      
      // Invalid update - cdnCgi requires a basePath property
      const invalidUpdate = {
        cdnCgi: {}
      };
      
      expect(() => manager.updateConfig(invalidUpdate as unknown as Partial<z.infer<typeof VideoConfigSchema>>))
        .toThrow(ConfigurationError);
    });
    
    it('should get origins from configuration', () => {
      const manager = VideoConfigurationManager.getInstance();
      
      // Add test origins
      const testOrigins = [{
        name: 'test-origin',
        matcher: '^/test/(.+)$',
        captureGroups: ['videoId'],
        sources: [{
          type: 'r2' as const,
          priority: 1,
          path: '$1'
        }],
        ttl: {
          ok: 300,
          redirects: 300,
          clientError: 60,
          serverError: 10
        }
      }];
      
      // Update config with origins
      manager.updateConfig({ origins: testOrigins });
      
      // Test getOrigins method
      const origins = manager.getOrigins();
      expect(origins).toBeDefined();
      expect(origins.length).toBe(1);
      expect(origins[0].name).toBe('test-origin');
      
      // Test shouldUseOrigins method
      expect(manager.shouldUseOrigins()).toBe(true);
      
      // Test getOriginByName method
      const origin = manager.getOriginByName('test-origin');
      expect(origin).toBeDefined();
      expect(origin?.name).toBe('test-origin');
      
      // Test getOriginByName with non-existent name
      const nonExistentOrigin = manager.getOriginByName('non-existent');
      expect(nonExistentOrigin).toBeNull();
    });
    
    it('should add an origin to configuration', () => {
      const manager = VideoConfigurationManager.getInstance();
      const initialOriginCount = manager.getOrigins().length;
      
      const newOrigin = {
        name: 'new-origin',
        matcher: '^/new/(.+)$',
        captureGroups: ['videoId'],
        sources: [{
          type: 'remote' as const,
          priority: 1,
          url: 'https://example.com',
          path: '$1'
        }],
        ttl: {
          ok: 300,
          redirects: 300,
          clientError: 60,
          serverError: 10
        }
      };
      
      const addedOrigin = manager.addOrigin(newOrigin);
      
      expect(manager.getOrigins().length).toBe(initialOriginCount + 1);
      expect(addedOrigin.name).toBe('new-origin');
      expect(addedOrigin.sources[0].type).toBe('remote');
    });
    
    it('should generate origins diagnostics', () => {
      const manager = VideoConfigurationManager.getInstance();
      
      // Add test origins with different source types
      const testOrigins = [
        {
          name: 'test-origin-1',
          matcher: '^/test1/(.+)$',
          captureGroups: ['videoId'],
          sources: [
            { type: 'r2' as const, priority: 1, path: '$1' },
            { type: 'remote' as const, priority: 2, url: 'https://example.com', path: '$1' }
          ],
          ttl: { ok: 300, redirects: 300, clientError: 60, serverError: 10 },
          cacheability: true
        },
        {
          name: 'test-origin-2',
          matcher: '^/test2/(.+)$',
          captureGroups: ['videoId'],
          sources: [
            { type: 'fallback' as const, priority: 1, url: 'https://fallback.com', path: '$1' }
          ]
        }
      ];
      
      // Update config with origins
      manager.updateConfig({ origins: testOrigins });
      
      // Get diagnostics
      const diagnostics = manager.getOriginsDiagnostics();
      
      expect(diagnostics.origins).toBeDefined();
      expect(diagnostics.origins.count).toBe(2);
      expect(diagnostics.origins.enabled).toBe(true);
      expect(diagnostics.origins.sourceCounts.r2).toBe(1);
      expect(diagnostics.origins.sourceCounts.remote).toBe(1);
      expect(diagnostics.origins.sourceCounts.fallback).toBe(1);
      expect(diagnostics.origins.sourceCounts.total).toBe(3);
      expect(diagnostics.origins.originsWithTtl).toBe(1);
      expect(diagnostics.origins.originsWithCacheability).toBe(1);
    });
  });

  describe('Default Export', () => {
    it('should export a default config manager instance', () => {
      expect(configManager).toBeInstanceOf(VideoConfigurationManager);
    });
  });
});
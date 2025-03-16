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
      expect(config.derivatives.high).toBeDefined();
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
      
      expect(config).toEqual(videoConfig);
    });

    it('should return a derivative by name', () => {
      const manager = VideoConfigurationManager.getInstance();
      const highDerivative = manager.getDerivative('high');
      
      expect(highDerivative).toEqual(videoConfig.derivatives.high);
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
      
      expect(cacheConfig).toEqual(videoConfig.cache);
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
      expect(addedPattern).toEqual(newPattern);
      expect(manager.getPathPatterns()[initialPatternCount]).toEqual(newPattern);
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
  });

  describe('Default Export', () => {
    it('should export a default config manager instance', () => {
      expect(configManager).toBeInstanceOf(VideoConfigurationManager);
    });
  });
});
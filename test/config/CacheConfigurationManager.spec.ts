/**
 * Tests for the CacheConfigurationManager
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { 
  CacheConfigurationManager, 
  cacheConfig, 
  CacheConfigSchema, 
  CacheProfileSchema
} from '../../src/config/CacheConfigurationManager';
import { z } from 'zod';
import { ConfigurationError } from '../../src/errors';

describe('CacheConfigurationManager', () => {
  beforeEach(() => {
    // Reset the singleton instance before each test
    CacheConfigurationManager.resetInstance();
  });

  describe('Initialization and Singleton Pattern', () => {
    it('should create a singleton instance', () => {
      const instance1 = CacheConfigurationManager.getInstance();
      const instance2 = CacheConfigurationManager.getInstance();
      
      expect(instance1).toBe(instance2);
    });

    it('should use the default config if none provided', () => {
      const manager = CacheConfigurationManager.getInstance();
      const config = manager.getConfig();
      
      // Test key properties to ensure the default config was loaded
      expect(config.method).toBe('cf');
      expect(config.debug).toBe(false);
      expect(config.profiles.default).toBeDefined();
      expect(config.profiles.highTraffic).toBeDefined();
      expect(config.profiles.shortForm).toBeDefined();
      expect(config.profiles.dynamic).toBeDefined();
    });

    it('should validate the configuration on initialization', () => {
      // Create an invalid config
      const invalidConfig = {
        method: 'invalid-method', // Invalid enum value
        profiles: {
          test: {
            // Missing required regex field
            cacheability: true
          }
        }
      };

      // Expect an error when initializing with invalid config
      expect(() => CacheConfigurationManager.getInstance(invalidConfig))
        .toThrow(ConfigurationError);
    });
  });

  describe('Configuration Access Methods', () => {
    it('should return the entire configuration', () => {
      const manager = CacheConfigurationManager.getInstance();
      const config = manager.getConfig();
      
      // Just check for the key properties as the full config is quite large
      expect(config.method).toBe('cf');
      expect(config.debug).toBe(false);
      expect(config.defaultMaxAge).toBe(86400);
      expect(config.profiles.default).toBeDefined();
    });

    it('should return the cache method', () => {
      const manager = CacheConfigurationManager.getInstance();
      const method = manager.getCacheMethod();
      
      expect(method).toBe('cf');
    });

    it('should check if debug is enabled', () => {
      const manager = CacheConfigurationManager.getInstance();
      
      // Default should be false
      expect(manager.isDebugEnabled()).toBe(false);
      
      // Update to enable debug
      manager.updateConfig({
        debug: true
      });
      
      expect(manager.isDebugEnabled()).toBe(true);
    });

    it('should check if cache should be bypassed based on URL parameters', () => {
      const manager = CacheConfigurationManager.getInstance();
      
      // URL without bypass parameters should not bypass cache
      const normalUrl = new URL('https://example.com/video.mp4');
      expect(manager.shouldBypassCache(normalUrl)).toBe(false);
      
      // URL with bypass parameter should bypass cache
      const bypassUrl = new URL('https://example.com/video.mp4?nocache=true');
      expect(manager.shouldBypassCache(bypassUrl)).toBe(true);
      
      // URL with custom bypass parameter
      const customBypassUrl = new URL('https://example.com/video.mp4?bypass=1');
      expect(manager.shouldBypassCache(customBypassUrl)).toBe(true);
      
      // Add a custom bypass parameter
      manager.updateConfig({
        bypassQueryParameters: ['nocache', 'bypass', 'custom']
      });
      
      const customParamUrl = new URL('https://example.com/video.mp4?custom=true');
      expect(manager.shouldBypassCache(customParamUrl)).toBe(true);
    });

    it('should get the profile for a path', () => {
      const manager = CacheConfigurationManager.getInstance();
      
      // Test default profile for a normal path
      const normalProfile = manager.getProfileForPath('/videos/normal.mp4');
      expect(normalProfile).toBe(manager.getConfig().profiles.default);
      
      // Test highTraffic profile
      const highTrafficProfile = manager.getProfileForPath('/popular/trending.mp4');
      expect(highTrafficProfile).toBe(manager.getConfig().profiles.highTraffic);
      
      // Test shortForm profile
      const shortFormProfile = manager.getProfileForPath('/shorts/funny.mp4');
      expect(shortFormProfile).toBe(manager.getConfig().profiles.shortForm);
      
      // Test dynamic profile
      const dynamicProfile = manager.getProfileForPath('/live/streaming.mp4');
      expect(dynamicProfile).toBe(manager.getConfig().profiles.dynamic);
    });
  });

  describe('Configuration Modification', () => {
    it('should update the configuration', () => {
      const manager = CacheConfigurationManager.getInstance();
      
      const updatedConfig = manager.updateConfig({
        method: 'cf',
        debug: true,
        defaultMaxAge: 3600
      });
      
      expect(updatedConfig.method).toBe('cf');
      expect(updatedConfig.debug).toBe(true);
      expect(updatedConfig.defaultMaxAge).toBe(3600);
      
      // Unchanged properties should remain at their default values
      expect(updatedConfig.respectOriginHeaders).toBe(true);
    });

    it('should throw an error when updating with invalid configuration', () => {
      const manager = CacheConfigurationManager.getInstance();
      
      // Invalid method
      const invalidMethod = {
        method: 'invalid-method'
      };
      
      expect(() => manager.updateConfig(invalidMethod as unknown as Partial<z.infer<typeof CacheConfigSchema>>))
        .toThrow(ConfigurationError);
      
      // Invalid TTL (negative value)
      const invalidTTL = {
        profiles: {
          default: {
            ttl: {
              ok: -1 // Should be non-negative
            }
          }
        }
      };
      
      expect(() => manager.updateConfig(invalidTTL as unknown as Partial<z.infer<typeof CacheConfigSchema>>))
        .toThrow(ConfigurationError);
    });

    it('should add a new cache profile', () => {
      const manager = CacheConfigurationManager.getInstance();
      const initialProfileCount = Object.keys(manager.getConfig().profiles).length;
      
      const newProfile = {
        regex: '.*\\/premium\\/.*\\.mp4',
        cacheability: true,
        videoCompression: 'high' as const,
        useTtlByStatus: true, // Add this to match what the CacheConfigurationManager adds
        ttl: {
          ok: 259200, // 3 days
          redirects: 3600,
          clientError: 60,
          serverError: 10
        }
      };
      
      const addedProfile = manager.addProfile('premium', newProfile);
      
      expect(manager.getConfig().profiles.premium).toBeDefined();
      expect(manager.getConfig().profiles.premium).toEqual(newProfile);
      expect(Object.keys(manager.getConfig().profiles).length).toBe(initialProfileCount + 1);
      expect(addedProfile).toEqual(newProfile);
      
      // The new profile should be used for matching paths
      const premiumProfile = manager.getProfileForPath('/premium/movie.mp4');
      expect(premiumProfile).toBe(manager.getConfig().profiles.premium);
    });

    it('should throw an error when adding an invalid profile', () => {
      const manager = CacheConfigurationManager.getInstance();
      
      // Missing required regex field
      const invalidProfile = {
        cacheability: true,
        videoCompression: 'high'
      };
      
      expect(() => manager.addProfile('invalid', invalidProfile as unknown as Partial<z.infer<typeof CacheProfileSchema>>))
        .toThrow(ConfigurationError);
      
      // Invalid videoCompression value
      const invalidCompression = {
        regex: '.*\\/test\\/.*\\.mp4',
        videoCompression: 'invalid-compression'
      };
      
      expect(() => manager.addProfile('invalid', invalidCompression as unknown as Partial<z.infer<typeof CacheProfileSchema>>))
        .toThrow(ConfigurationError);
    });
  });

  describe('Default Export', () => {
    it('should export a default cache config manager instance', () => {
      expect(cacheConfig).toBeInstanceOf(CacheConfigurationManager);
    });
  });
});
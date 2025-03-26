/**
 * Tests for the LoggingConfigurationManager
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { LoggingConfigurationManager, loggingConfig, LoggingConfigSchema } from '../../src/config/LoggingConfigurationManager';
import { z } from 'zod';
import { ConfigurationError } from '../../src/errors';

describe('LoggingConfigurationManager', () => {
  beforeEach(() => {
    // Reset the singleton instance before each test
    LoggingConfigurationManager.resetInstance();
  });

  describe('Initialization and Singleton Pattern', () => {
    it('should create a singleton instance', () => {
      const instance1 = LoggingConfigurationManager.getInstance();
      const instance2 = LoggingConfigurationManager.getInstance();
      
      expect(instance1).toBe(instance2);
    });

    it('should use the default config if none provided', () => {
      const manager = LoggingConfigurationManager.getInstance();
      const config = manager.getConfig();
      
      // Test key properties to ensure the default config was loaded
      expect(config.level).toBe('info');
      expect(config.includeTimestamps).toBe(true);
      expect(config.format).toBe('text');
      expect(config.enabledComponents).toEqual([]);
      expect(config.sampleRate).toBe(1);
    });

    it('should validate the configuration on initialization', () => {
      // Create an invalid config with incorrect types
      const invalidConfig = {
        level: 'invalid-level', // Invalid enum value
        sampleRate: 2 // Out of range (should be 0-1)
      };

      // Expect an error when initializing with invalid config
      expect(() => LoggingConfigurationManager.getInstance(invalidConfig))
        .toThrow(ConfigurationError);
    });
  });

  describe('Configuration Access Methods', () => {
    it('should return the entire configuration', () => {
      const manager = LoggingConfigurationManager.getInstance();
      const config = manager.getConfig();
      
      // Test key properties instead of the entire object
      // This is more maintainable as the configuration evolves
      expect(config.level).toBe('info');
      expect(config.includeTimestamps).toBe(true);
      expect(config.includeComponentName).toBe(true);
      expect(config.format).toBe('text');
      expect(config.colorize).toBe(true);
      expect(config.enabledComponents).toEqual([]);
      expect(config.disabledComponents).toEqual([]);
      expect(config.sampleRate).toBe(1);
      expect(config.enablePerformanceLogging).toBe(false);
      expect(config.performanceThresholdMs).toBe(1000);
      
      // Check that breadcrumbs configuration exists
      expect(config.breadcrumbs).toBeDefined();
      expect(config.breadcrumbs.enabled).toBe(true);
      expect(config.breadcrumbs.maxItems).toBe(100);
    });

    it('should return the current log level', () => {
      const manager = LoggingConfigurationManager.getInstance();
      const level = manager.getLogLevel();
      
      expect(level).toBe('info');
    });

    it('should check if a component should be logged with no filters', () => {
      const manager = LoggingConfigurationManager.getInstance();
      
      // By default, all components should be logged when no filters are set
      expect(manager.shouldLogComponent('Component1')).toBe(true);
      expect(manager.shouldLogComponent('Component2')).toBe(true);
    });

    it('should check if a component should be logged with enabled components', () => {
      const manager = LoggingConfigurationManager.getInstance();
      
      // Update config to only enable specific components
      manager.updateConfig({
        enabledComponents: ['Component1', 'Component3']
      });
      
      expect(manager.shouldLogComponent('Component1')).toBe(true);
      expect(manager.shouldLogComponent('Component2')).toBe(false);
      expect(manager.shouldLogComponent('Component3')).toBe(true);
    });

    it('should check if a component should be logged with disabled components', () => {
      const manager = LoggingConfigurationManager.getInstance();
      
      // Update config to disable specific components
      manager.updateConfig({
        disabledComponents: ['Component2', 'Component4']
      });
      
      expect(manager.shouldLogComponent('Component1')).toBe(true);
      expect(manager.shouldLogComponent('Component2')).toBe(false);
      expect(manager.shouldLogComponent('Component3')).toBe(true);
      expect(manager.shouldLogComponent('Component4')).toBe(false);
    });

    it('should check if performance should be logged', () => {
      const manager = LoggingConfigurationManager.getInstance();
      
      // Default should be false
      expect(manager.shouldLogPerformance()).toBe(false);
      
      // Update to enable performance logging
      manager.updateConfig({
        enablePerformanceLogging: true
      });
      
      expect(manager.shouldLogPerformance()).toBe(true);
    });

    it('should return the performance threshold', () => {
      const manager = LoggingConfigurationManager.getInstance();
      
      // Default threshold
      expect(manager.getPerformanceThreshold()).toBe(1000);
      
      // Update threshold
      manager.updateConfig({
        performanceThresholdMs: 500
      });
      
      expect(manager.getPerformanceThreshold()).toBe(500);
    });
  });

  describe('Configuration Modification', () => {
    it('should update the configuration', () => {
      const manager = LoggingConfigurationManager.getInstance();
      
      const updatedConfig = manager.updateConfig({
        level: 'debug',
        format: 'json',
        colorize: false,
        sampleRate: 0.5
      });
      
      expect(updatedConfig.level).toBe('debug');
      expect(updatedConfig.format).toBe('json');
      expect(updatedConfig.colorize).toBe(false);
      expect(updatedConfig.sampleRate).toBe(0.5);
      
      // Unchanged properties should remain at their default values
      expect(updatedConfig.includeTimestamps).toBe(true);
    });

    it('should throw an error when updating with invalid configuration', () => {
      const manager = LoggingConfigurationManager.getInstance();
      
      // Invalid update - level must be one of the allowed values
      const invalidUpdate = {
        level: 'invalid-level'
      };
      
      expect(() => manager.updateConfig(invalidUpdate as unknown as Partial<z.infer<typeof LoggingConfigSchema>>))
        .toThrow(ConfigurationError);
      
      // Invalid update - sampleRate must be between 0 and 1
      const invalidSampleRate = {
        sampleRate: 2
      };
      
      expect(() => manager.updateConfig(invalidSampleRate))
        .toThrow(ConfigurationError);
    });
  });

  describe('Sampling Functionality', () => {
    it('should allow all logs when sample rate is 1', () => {
      const manager = LoggingConfigurationManager.getInstance();
      
      // With sampleRate = 1, all logs should be sampled
      manager.updateConfig({ sampleRate: 1 });
      
      // Test multiple times to ensure consistency
      for (let i = 0; i < 10; i++) {
        expect(manager.shouldSampleLog()).toBe(true);
      }
    });

    it('should reject all logs when sample rate is 0', () => {
      const manager = LoggingConfigurationManager.getInstance();
      
      // With sampleRate = 0, no logs should be sampled
      manager.updateConfig({ sampleRate: 0 });
      
      // Test multiple times to ensure consistency
      for (let i = 0; i < 10; i++) {
        expect(manager.shouldSampleLog()).toBe(false);
      }
    });

    // Note: We can't effectively test probability with a deterministic test,
    // but we can at least verify the method works without errors
    it('should use math.random for sampling with rate between 0 and 1', () => {
      const manager = LoggingConfigurationManager.getInstance();
      
      // Set sample rate to 0.5 (50% of logs)
      manager.updateConfig({ sampleRate: 0.5 });
      
      // Just ensure the method runs without errors
      const result = manager.shouldSampleLog();
      expect(typeof result).toBe('boolean');
    });
  });

  describe('Default Export', () => {
    it('should export a default logging config manager instance', () => {
      expect(loggingConfig).toBeInstanceOf(LoggingConfigurationManager);
    });
  });
});
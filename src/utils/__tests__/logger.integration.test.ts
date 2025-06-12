/**
 * Integration tests for the logging system
 * Tests the interaction between logger, configuration managers, and Pino
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LoggingConfigurationManager } from '../../config/LoggingConfigurationManager';
import { RequestContext } from '../requestContext';
import { createCategoryLogger } from '../logger';

describe('Logging System Integration', () => {
  let originalConsoleLog: typeof console.log;
  let originalConsoleWarn: typeof console.warn;
  let originalConsoleInfo: typeof console.info;
  let originalConsoleError: typeof console.error;
  let logOutput: string[] = [];

  beforeEach(() => {
    // Capture all console output
    originalConsoleLog = console.log;
    originalConsoleWarn = console.warn;
    originalConsoleInfo = console.info;
    originalConsoleError = console.error;
    
    console.log = (...args: any[]) => {
      logOutput.push(args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : String(arg)).join(' '));
    };
    
    console.warn = (...args: any[]) => {
      logOutput.push(args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : String(arg)).join(' '));
    };
    
    console.info = (...args: any[]) => {
      logOutput.push(args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : String(arg)).join(' '));
    };
    
    console.error = (...args: any[]) => {
      logOutput.push(args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : String(arg)).join(' '));
    };
    
    logOutput = [];
  });

  afterEach(() => {
    console.log = originalConsoleLog;
    console.warn = originalConsoleWarn;
    console.info = originalConsoleInfo;
    console.error = originalConsoleError;
    
    // Reset configuration to defaults
    LoggingConfigurationManager.resetInstance();
  });

  describe('Configuration Updates', () => {
    it('should log configuration changes', () => {
      const loggingConfig = LoggingConfigurationManager.getInstance();
      
      // Update configuration
      loggingConfig.updateConfig({
        level: 'warn',
        format: 'json',
        sampleRate: 0.5
      });
      
      // Check that changes were logged
      const changeLog = logOutput.find(log => log.includes('Logging configuration updated'));
      expect(changeLog).toBeTruthy();
      expect(changeLog).toContain('level');
      expect(changeLog).toContain('warn');
    });

    it('should handle invalid configuration gracefully', () => {
      const loggingConfig = LoggingConfigurationManager.getInstance();
      
      // Try to update with invalid configuration
      const result = loggingConfig.updateConfig({
        level: 'invalid-level' as any,
        sampleRate: -1
      });
      
      // Should log validation failure
      const errorLog = logOutput.find(log => log.includes('Logging configuration validation failed'));
      expect(errorLog).toBeTruthy();
      
      // Should revert to previous config
      expect(result.level).not.toBe('invalid-level');
      expect(result.sampleRate).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Component Filtering', () => {
    it('should filter components based on patterns', () => {
      const loggingConfig = LoggingConfigurationManager.getInstance();
      
      // Configure to only log Cache* components
      loggingConfig.updateConfig({
        enabledComponents: ['Cache*']
      });
      
      // Test filtering
      expect(loggingConfig.shouldLogComponent('CacheService')).toBe(true);
      expect(loggingConfig.shouldLogComponent('CacheUtils')).toBe(true);
      expect(loggingConfig.shouldLogComponent('VideoService')).toBe(false);
    });

    it('should support exclude patterns', () => {
      const loggingConfig = LoggingConfigurationManager.getInstance();
      
      // Configure to exclude Test components
      loggingConfig.updateConfig({
        disabledComponents: ['*Test', 'Debug*']
      });
      
      // Test filtering
      expect(loggingConfig.shouldLogComponent('ServiceTest')).toBe(false);
      expect(loggingConfig.shouldLogComponent('DebugUtils')).toBe(false);
      expect(loggingConfig.shouldLogComponent('ProductionService')).toBe(true);
    });
  });

  describe('Log Level Control', () => {
    it('should respect log level configuration', () => {
      const loggingConfig = LoggingConfigurationManager.getInstance();
      
      // Set log level to warn
      loggingConfig.updateConfig({
        level: 'warn'
      });
      
      expect(loggingConfig.getLogLevel()).toBe('warn');
      
      // In a real scenario, debug logs would not be emitted
      // This would be tested with actual Pino integration
    });
  });

  describe('Configuration Validation', () => {
    it('should validate configuration before applying', () => {
      const loggingConfig = LoggingConfigurationManager.getInstance();
      
      // Test validation method
      const validConfig = {
        level: 'info',
        format: 'json',
        sampleRate: 0.8
      };
      
      const invalidConfig = {
        level: 'invalid',
        format: 'xml',
        sampleRate: 2.0
      };
      
      const validResult = loggingConfig.validateConfig(validConfig);
      expect(validResult.valid).toBe(true);
      
      const invalidResult = loggingConfig.validateConfig(invalidConfig);
      expect(invalidResult.valid).toBe(false);
      expect(invalidResult.errors).toBeDefined();
      expect(invalidResult.errors!.length).toBeGreaterThan(0);
    });
  });

  describe('Breadcrumb Configuration', () => {
    it('should manage breadcrumb settings', () => {
      const loggingConfig = LoggingConfigurationManager.getInstance();
      
      // Update breadcrumb configuration
      loggingConfig.updateConfig({
        breadcrumbs: {
          enabled: false,
          maxItems: 50
        }
      });
      
      expect(loggingConfig.areBreadcrumbsEnabled()).toBe(false);
      expect(loggingConfig.getMaxBreadcrumbs()).toBe(50);
    });
  });

  describe('Performance Monitoring Configuration', () => {
    it('should configure performance monitoring', () => {
      const loggingConfig = LoggingConfigurationManager.getInstance();
      
      // Update performance configuration
      loggingConfig.updateConfig({
        enablePerformanceLogging: true,
        performanceThresholdMs: 500
      });
      
      expect(loggingConfig.shouldLogPerformance()).toBe(true);
      expect(loggingConfig.getPerformanceThreshold()).toBe(500);
    });
  });

  describe('Sampling Configuration', () => {
    it('should configure log sampling', () => {
      const loggingConfig = LoggingConfigurationManager.getInstance();
      
      // Set sampling rate
      loggingConfig.updateConfig({
        sampleRate: 0.25
      });
      
      const samplingConfig = loggingConfig.getSamplingConfig();
      expect(samplingConfig.enabled).toBe(true);
      expect(samplingConfig.rate).toBe(0.25);
      
      // Test sampling logic
      let sampled = 0;
      const iterations = 1000;
      
      for (let i = 0; i < iterations; i++) {
        if (loggingConfig.shouldSampleLog()) {
          sampled++;
        }
      }
      
      // Should be approximately 25% of iterations (with some variance)
      expect(sampled).toBeGreaterThan(iterations * 0.15);
      expect(sampled).toBeLessThan(iterations * 0.35);
    });
  });

  describe('Pattern Matching', () => {
    it('should support various wildcard patterns', () => {
      const loggingConfig = LoggingConfigurationManager.getInstance();
      
      // Test with enabled patterns
      loggingConfig.updateConfig({
        enabledComponents: ['Video*Service', '*Utils', 'Cache*Storage*']
      });
      
      // Prefix match
      expect(loggingConfig.shouldLogComponent('VideoTransformService')).toBe(true);
      expect(loggingConfig.shouldLogComponent('VideoStorageService')).toBe(true);
      
      // Suffix match
      expect(loggingConfig.shouldLogComponent('StringUtils')).toBe(true);
      expect(loggingConfig.shouldLogComponent('CacheUtils')).toBe(true);
      
      // Middle wildcard
      expect(loggingConfig.shouldLogComponent('CacheMemoryStorage')).toBe(true);
      expect(loggingConfig.shouldLogComponent('CacheDiskStorage')).toBe(true);
      
      // Non-matching
      expect(loggingConfig.shouldLogComponent('AuthService')).toBe(false);
    });
  });

  describe('Real-world Scenarios', () => {
    it('should handle production configuration', () => {
      const loggingConfig = LoggingConfigurationManager.getInstance();
      
      // Typical production config
      loggingConfig.updateConfig({
        level: 'info',
        format: 'json',
        sampleRate: 0.1,
        enablePerformanceLogging: true,
        performanceThresholdMs: 1000,
        disabledComponents: ['Debug*', '*Test'],
        breadcrumbs: {
          enabled: true,
          maxItems: 50
        }
      });
      
      // Verify configuration
      expect(loggingConfig.getLogLevel()).toBe('info');
      expect(loggingConfig.shouldLogComponent('DebugService')).toBe(false);
      expect(loggingConfig.shouldLogComponent('ProductionService')).toBe(true);
      expect(loggingConfig.getSamplingConfig().rate).toBe(0.1);
    });

    it('should handle development configuration', () => {
      const loggingConfig = LoggingConfigurationManager.getInstance();
      
      // Typical development config
      loggingConfig.updateConfig({
        level: 'debug',
        format: 'text',
        sampleRate: 1.0,
        enablePerformanceLogging: true,
        performanceThresholdMs: 100,
        enabledComponents: [], // Log everything
        breadcrumbs: {
          enabled: true,
          maxItems: 200
        }
      });
      
      // Verify configuration
      expect(loggingConfig.getLogLevel()).toBe('debug');
      expect(loggingConfig.shouldLogComponent('AnyComponent')).toBe(true);
      expect(loggingConfig.getSamplingConfig().enabled).toBe(false); // No sampling at 1.0
    });
  });
});
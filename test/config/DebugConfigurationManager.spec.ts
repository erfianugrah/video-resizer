/**
 * Tests for the DebugConfigurationManager
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  DebugConfigurationManager,
  debugConfig,
  DebugConfigSchema,
} from '../../src/config/DebugConfigurationManager';
import { z } from 'zod';
import { ConfigurationError } from '../../src/errors';

describe('DebugConfigurationManager', () => {
  beforeEach(() => {
    // Reset the singleton instance before each test
    DebugConfigurationManager.resetInstance();
  });

  describe('Initialization and Singleton Pattern', () => {
    it('should create a singleton instance', () => {
      const instance1 = DebugConfigurationManager.getInstance();
      const instance2 = DebugConfigurationManager.getInstance();

      expect(instance1).toBe(instance2);
    });

    it('should use the default config if none provided', () => {
      const manager = DebugConfigurationManager.getInstance();
      const config = manager.getConfig();

      // Test key properties to ensure the default config was loaded
      expect(config.enabled).toBe(true);
      expect(config.verbose).toBe(true);
      expect(config.includeHeaders).toBe(true);
      expect(config.dashboardMode).toBe(true);
      expect(config.debugQueryParam).toBe('debug');
    });

    it('should validate the configuration on initialization', () => {
      // Create an invalid config
      const invalidConfig = {
        enabled: 'not-a-boolean', // Should be boolean
        maxContentLength: -1, // Should be positive
      };

      // Expect an error when initializing with invalid config
      expect(() => DebugConfigurationManager.getInstance(invalidConfig)).toThrow(
        ConfigurationError
      );
    });
  });

  describe('Configuration Access Methods', () => {
    it('should return the entire configuration', () => {
      const manager = DebugConfigurationManager.getInstance();
      const config = manager.getConfig();

      expect(config).toEqual({
        enabled: true,
        verbose: true,
        includeHeaders: true,
        includePerformance: true,
        dashboardMode: true,
        viewMode: true,
        headerMode: true,
        debugQueryParam: 'debug',
        debugViewParam: 'view',
        preserveDebugParams: false,
        debugHeaders: ['X-Debug', 'X-Debug-Enabled', 'Debug'],
        renderStaticHtml: true,
        includeStackTrace: true,
        maxContentLength: 50000,
        truncationMessage: '... [content truncated]',
        allowedIps: [],
        excludedPaths: [],
      });
    });

    it('should check if debugging is enabled', () => {
      const manager = DebugConfigurationManager.getInstance();

      // Default is true (development defaults)
      expect(manager.isEnabled()).toBe(true);

      // Disable debug
      manager.updateConfig({
        enabled: false,
      });

      expect(manager.isEnabled()).toBe(false);
    });

    it('should check if verbose debugging is enabled', () => {
      const manager = DebugConfigurationManager.getInstance();

      // Default: both enabled and verbose are true
      expect(manager.isVerbose()).toBe(true);

      // Only enabled = true, verbose = false should return false
      manager.updateConfig({
        enabled: true,
        verbose: false,
      });
      expect(manager.isVerbose()).toBe(false);

      // Only verbose = true, enabled = false should return false
      manager.updateConfig({
        enabled: false,
        verbose: true,
      });
      expect(manager.isVerbose()).toBe(false);

      // Both enabled and verbose = true should return true
      manager.updateConfig({
        enabled: true,
        verbose: true,
      });
      expect(manager.isVerbose()).toBe(true);
    });

    it('should check if header inclusion is enabled', () => {
      const manager = DebugConfigurationManager.getInstance();

      // Default: both enabled and includeHeaders are true
      expect(manager.shouldIncludeHeaders()).toBe(true);

      // Disable includeHeaders
      manager.updateConfig({
        enabled: true,
        includeHeaders: false,
      });
      expect(manager.shouldIncludeHeaders()).toBe(false);
    });

    it('should check if performance metrics should be included', () => {
      const manager = DebugConfigurationManager.getInstance();

      // Default: both enabled and includePerformance are true
      expect(manager.shouldIncludePerformance()).toBe(true);

      // Disable includePerformance
      manager.updateConfig({
        enabled: true,
        includePerformance: false,
      });
      expect(manager.shouldIncludePerformance()).toBe(false);
    });
  });

  describe('Request-based Debug Checks', () => {
    it('should enable debugging for request with debug query param', () => {
      // Start with debug disabled so we can test per-request enabling
      const manager = DebugConfigurationManager.getInstance({ enabled: false });

      // Not enabled without debug param
      const normalRequest = new Request('https://example.com/video.mp4');
      expect(manager.shouldEnableForRequest(normalRequest)).toBe(false);

      // Request with debug parameter should enable debug
      const debugRequest = new Request('https://example.com/video.mp4?debug=true');
      expect(manager.shouldEnableForRequest(debugRequest)).toBe(true);
    });

    it('should enable debugging for request with debug header', () => {
      // Start with debug disabled so we can test per-request enabling
      const manager = DebugConfigurationManager.getInstance({ enabled: false });

      // Create a request with a debug header
      const headers = new Headers();
      headers.set('X-Debug', 'true');
      const debugHeaderRequest = new Request('https://example.com/video.mp4', { headers });

      expect(manager.shouldEnableForRequest(debugHeaderRequest)).toBe(true);

      // Test with a custom debug header
      manager.updateConfig({
        debugHeaders: ['X-Custom-Debug'],
      });

      const customHeaders1 = new Headers();
      customHeaders1.set('X-Custom-Debug', 'true');
      const customRequest1 = new Request('https://example.com/video.mp4', {
        headers: customHeaders1,
      });
      expect(manager.shouldEnableForRequest(customRequest1)).toBe(true);

      const customHeaders2 = new Headers();
      customHeaders2.set('X-Debug', 'true'); // This is no longer in the list
      const customRequest2 = new Request('https://example.com/video.mp4', {
        headers: customHeaders2,
      });
      expect(manager.shouldEnableForRequest(customRequest2)).toBe(false);
    });

    it('should respect excluded paths when globally enabled', () => {
      const manager = DebugConfigurationManager.getInstance();

      // Enable debug globally
      manager.updateConfig({
        enabled: true,
        excludedPaths: ['/assets/', '/images/'],
      });

      // Normal path should have debug enabled
      const normalRequest = new Request('https://example.com/video.mp4');
      expect(manager.shouldEnableForRequest(normalRequest)).toBe(true);

      // Excluded path should have debug disabled
      const excludedRequest1 = new Request('https://example.com/assets/video.mp4');
      expect(manager.shouldEnableForRequest(excludedRequest1)).toBe(false);

      const excludedRequest2 = new Request('https://example.com/images/thumbnail.jpg');
      expect(manager.shouldEnableForRequest(excludedRequest2)).toBe(false);
    });

    it('should check if debug view is requested', () => {
      const manager = DebugConfigurationManager.getInstance();

      // Normal request is not a debug view request
      const normalRequest = new Request('https://example.com/video.mp4');
      expect(manager.isDebugViewRequested(normalRequest)).toBe(false);

      // Debug param with value=true is not a view request
      const debugRequest = new Request('https://example.com/video.mp4?debug=true');
      expect(manager.isDebugViewRequested(debugRequest)).toBe(false);

      // Debug param with value=view is a view request
      const viewRequest = new Request('https://example.com/video.mp4?debug=view');
      expect(manager.isDebugViewRequested(viewRequest)).toBe(true);

      // Custom debug view parameter
      manager.updateConfig({
        debugQueryParam: 'dbg',
        debugViewParam: 'display',
      });

      const customViewRequest = new Request('https://example.com/video.mp4?dbg=display');
      expect(manager.isDebugViewRequested(customViewRequest)).toBe(true);
    });
  });

  describe('Configuration Modification', () => {
    it('should update the configuration', () => {
      const manager = DebugConfigurationManager.getInstance();

      const updatedConfig = manager.updateConfig({
        enabled: true,
        verbose: true,
        includeHeaders: true,
        maxContentLength: 10000,
      });

      expect(updatedConfig.enabled).toBe(true);
      expect(updatedConfig.verbose).toBe(true);
      expect(updatedConfig.includeHeaders).toBe(true);
      expect(updatedConfig.maxContentLength).toBe(10000);

      // Unchanged properties should remain at their default values
      expect(updatedConfig.dashboardMode).toBe(true);
      expect(updatedConfig.debugQueryParam).toBe('debug');
    });

    it('should gracefully handle invalid configuration updates', () => {
      const manager = DebugConfigurationManager.getInstance();
      const originalConfig = manager.getConfig();

      // Invalid enabled value (should be boolean) - should silently revert
      const invalidEnabled = {
        enabled: 'not-a-boolean',
      };

      const result = manager.updateConfig(
        invalidEnabled as unknown as Partial<z.infer<typeof DebugConfigSchema>>
      );

      // Should return the original config unchanged
      expect(result.enabled).toBe(originalConfig.enabled);
    });

    it('should add an allowed IP address', () => {
      const manager = DebugConfigurationManager.getInstance();
      const initialAllowedIps = [...manager.getConfig().allowedIps];

      const ip = '192.168.1.1';
      const allowedIps = manager.addAllowedIp(ip);

      expect(allowedIps).toContain(ip);
      expect(allowedIps.length).toBe(initialAllowedIps.length + 1);
      expect(manager.getConfig().allowedIps).toEqual(allowedIps);

      // Adding the same IP again should not duplicate it
      const allowedIpsAgain = manager.addAllowedIp(ip);
      expect(allowedIpsAgain).toEqual(allowedIps);
      expect(allowedIpsAgain.length).toBe(allowedIps.length);
    });

    it('should add an excluded path', () => {
      const manager = DebugConfigurationManager.getInstance();
      const initialExcludedPaths = [...manager.getConfig().excludedPaths];

      const path = '/assets/';
      const excludedPaths = manager.addExcludedPath(path);

      expect(excludedPaths).toContain(path);
      expect(excludedPaths.length).toBe(initialExcludedPaths.length + 1);
      expect(manager.getConfig().excludedPaths).toEqual(excludedPaths);

      // Adding the same path again should not duplicate it
      const excludedPathsAgain = manager.addExcludedPath(path);
      expect(excludedPathsAgain).toEqual(excludedPaths);
      expect(excludedPathsAgain.length).toBe(excludedPaths.length);
    });
  });

  describe('Default Export', () => {
    it('should export a default debug config manager instance', () => {
      expect(debugConfig).toBeInstanceOf(DebugConfigurationManager);
    });
  });
});

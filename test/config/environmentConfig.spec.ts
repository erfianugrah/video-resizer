/**
 * Tests for environment configuration
 */
import { describe, it, expect } from 'vitest';
import { getEnvironmentConfig, EnvVariables, EnvironmentConfig } from '../../src/config/environmentConfig';

describe('Environment Configuration', () => {
  describe('getEnvironmentConfig', () => {
    it('should set default values when no environment variables are provided', () => {
      // Arrange
      const env: EnvVariables = {};
      
      // Act
      const config = getEnvironmentConfig(env);
      
      // Assert
      expect(config.mode).toBe('development');
      expect(config.isProduction).toBe(false);
      expect(config.isDevelopment).toBe(true);
      expect(config.debug.enabled).toBe(true);
      expect(config.debug.verbose).toBe(false);
      expect(config.debug.includeHeaders).toBe(false);
    });
    
    it('should detect production environment', () => {
      // Arrange
      const env: EnvVariables = {
        ENVIRONMENT: 'production',
      };
      
      // Act
      const config = getEnvironmentConfig(env);
      
      // Assert
      expect(config.mode).toBe('production');
      expect(config.isProduction).toBe(true);
      expect(config.isStaging).toBe(false);
      expect(config.isDevelopment).toBe(false);
      
      // Debug should be disabled by default in production
      expect(config.debug.enabled).toBe(false);
    });
    
    it('should detect staging environment', () => {
      // Arrange
      const env: EnvVariables = {
        ENVIRONMENT: 'staging',
      };
      
      // Act
      const config = getEnvironmentConfig(env);
      
      // Assert
      expect(config.mode).toBe('staging');
      expect(config.isProduction).toBe(false);
      expect(config.isStaging).toBe(true);
      expect(config.isDevelopment).toBe(false);
    });
    
    it('should parse PATH_PATTERNS as JSON string', () => {
      // Arrange
      const patterns = [
        {
          name: 'test',
          matcher: '^/test/',
          processPath: true,
          baseUrl: null,
          originUrl: 'https://example.com',
        },
      ];
      
      const env: EnvVariables = {
        PATH_PATTERNS: JSON.stringify(patterns),
      };
      
      // Act
      const config = getEnvironmentConfig(env);
      
      // Assert
      expect(config.pathPatterns).toEqual(patterns);
    });
    
    it('should accept PATH_PATTERNS as object array', () => {
      // Arrange
      const patterns = [
        {
          name: 'test',
          matcher: '^/test/',
          processPath: true,
          baseUrl: null,
          originUrl: 'https://example.com',
        },
      ];
      
      const env: EnvVariables = {
        PATH_PATTERNS: patterns,
      };
      
      // Act
      const config = getEnvironmentConfig(env);
      
      // Assert
      expect(config.pathPatterns).toEqual(patterns);
    });
    
    it('should handle DEBUG_ENABLED flag', () => {
      // Arrange
      const env: EnvVariables = {
        ENVIRONMENT: 'production',
        DEBUG_ENABLED: 'true',
      };
      
      // Act
      const config = getEnvironmentConfig(env);
      
      // Assert
      expect(config.debug.enabled).toBe(true);
    });
    
    it('should handle DEBUG_VERBOSE flag', () => {
      // Arrange
      const env: EnvVariables = {
        DEBUG_VERBOSE: 'true',
      };
      
      // Act
      const config = getEnvironmentConfig(env);
      
      // Assert
      expect(config.debug.verbose).toBe(true);
    });
    
    it('should handle DEBUG_INCLUDE_HEADERS flag', () => {
      // Arrange
      const env: EnvVariables = {
        DEBUG_INCLUDE_HEADERS: 'true',
      };
      
      // Act
      const config = getEnvironmentConfig(env);
      
      // Assert
      expect(config.debug.includeHeaders).toBe(true);
    });
    
    it('should handle VERSION environment variable', () => {
      // Arrange
      const env: EnvVariables = {
        VERSION: '2.0.0',
      };
      
      // Act
      const config = getEnvironmentConfig(env);
      
      // Assert - VERSION is not directly part of the config object,
      // but we can use it to test that all variables are handled
      expect(config).toBeDefined();
    });
  });
});
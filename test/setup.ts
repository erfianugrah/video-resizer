/**
 * Global test setup file
 * 
 * Sets up global variables and configuration needed for tests
 */
import { vi } from 'vitest';

// Mock the configuration managers for tests
vi.mock('../src/config/LoggingConfigurationManager', () => {
  return {
    LoggingConfigurationManager: {
      getInstance: vi.fn().mockReturnValue({
        getPinoConfig: vi.fn().mockReturnValue({
          level: 'debug',
          browser: {
            asObject: true
          },
          base: {
            service: 'video-resizer',
            env: 'test'
          }
        }),
        getSamplingConfig: vi.fn().mockReturnValue({
          enabled: false,
          rate: 1.0
        }),
        getBreadcrumbConfig: vi.fn().mockReturnValue({
          enabled: true,
          maxItems: 100
        }),
        areBreadcrumbsEnabled: vi.fn().mockReturnValue(true),
        getMaxBreadcrumbs: vi.fn().mockReturnValue(100),
        getLogLevel: vi.fn().mockReturnValue('debug'),
        shouldLogComponent: vi.fn().mockReturnValue(true)
      }),
      resetInstance: vi.fn()
    },
    loggingConfig: {
      getPinoConfig: vi.fn().mockReturnValue({
        level: 'debug',
        browser: {
          asObject: true
        },
        base: {
          service: 'video-resizer',
          env: 'test'
        }
      }),
      getSamplingConfig: vi.fn().mockReturnValue({
        enabled: false,
        rate: 1.0
      }),
      getBreadcrumbConfig: vi.fn().mockReturnValue({
        enabled: true,
        maxItems: 100
      }),
      areBreadcrumbsEnabled: vi.fn().mockReturnValue(true),
      getMaxBreadcrumbs: vi.fn().mockReturnValue(100),
      getLogLevel: vi.fn().mockReturnValue('debug'),
      shouldLogComponent: vi.fn().mockReturnValue(true)
    }
  };
});

vi.mock('../src/config/DebugConfigurationManager', () => {
  return {
    DebugConfigurationManager: {
      getInstance: vi.fn().mockReturnValue({
        isDebugEnabled: vi.fn().mockReturnValue(true),
        isVerboseEnabled: vi.fn().mockReturnValue(false),
        shouldIncludeHeaders: vi.fn().mockReturnValue(true),
        shouldIncludePerformance: vi.fn().mockReturnValue(true)
      }),
      resetInstance: vi.fn()
    },
    debugConfig: {
      isDebugEnabled: vi.fn().mockReturnValue(true),
      isVerboseEnabled: vi.fn().mockReturnValue(false),
      shouldIncludeHeaders: vi.fn().mockReturnValue(true),
      shouldIncludePerformance: vi.fn().mockReturnValue(true)
    }
  };
});

// Still provide global variables for backward compatibility
(globalThis as any).LOGGING_CONFIG = {
  pino: {
    level: 'debug',
    browser: {
      asObject: true
    },
    base: {
      service: 'video-resizer',
      env: 'test'
    }
  },
  sampling: {
    enabled: false,
    rate: 1.0
  },
  breadcrumbs: {
    enabled: true,
    maxItems: 100
  }
};

// Mock the config index module
vi.mock('../src/config', () => {
  return {
    CacheConfigurationManager: {
      getInstance: vi.fn().mockReturnValue({
        getConfig: vi.fn().mockReturnValue({
          method: 'cache-api',
          debug: false,
          defaultTtl: 3600,
          bypassQueryParameters: ['debug', 'nocache', 'bypass']
        }),
        shouldBypassCache: vi.fn().mockReturnValue(false)
      })
    },
    DebugConfigurationManager: {
      getInstance: vi.fn().mockReturnValue({
        isDebugEnabled: vi.fn().mockReturnValue(true),
        isVerboseEnabled: vi.fn().mockReturnValue(false),
        shouldIncludeHeaders: vi.fn().mockReturnValue(true),
        shouldIncludePerformance: vi.fn().mockReturnValue(true)
      }),
      resetInstance: vi.fn()
    },
    LoggingConfigurationManager: {
      getInstance: vi.fn().mockReturnValue({
        getPinoConfig: vi.fn().mockReturnValue({
          level: 'debug',
          browser: { asObject: true },
          base: { service: 'video-resizer', env: 'test' }
        }),
        getSamplingConfig: vi.fn().mockReturnValue({
          enabled: false,
          rate: 1.0
        }),
        getBreadcrumbConfig: vi.fn().mockReturnValue({
          enabled: true,
          maxItems: 100
        }),
        areBreadcrumbsEnabled: vi.fn().mockReturnValue(true),
        getMaxBreadcrumbs: vi.fn().mockReturnValue(100),
        getLogLevel: vi.fn().mockReturnValue('debug'),
        shouldLogComponent: vi.fn().mockReturnValue(true)
      })
    },
    debugConfig: {
      isDebugEnabled: vi.fn().mockReturnValue(true),
      isVerboseEnabled: vi.fn().mockReturnValue(false),
      shouldIncludeHeaders: vi.fn().mockReturnValue(true),
      shouldIncludePerformance: vi.fn().mockReturnValue(true)
    }
  };
});

// Initialize other global variables if needed
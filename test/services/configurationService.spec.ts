/**
 * ConfigurationService tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConfigurationService, WorkerConfiguration } from '../../src/services/configurationService';

describe('ConfigurationService', () => {
  // Mock KV namespace
  const mockKV = {
    get: vi.fn(),
    put: vi.fn().mockResolvedValue(undefined),
    list: vi.fn()
  };

  // Mock environment with KV namespace
  const mockEnv = {
    VIDEO_CONFIGURATION_STORE: mockKV
  };

  // Sample configuration
  const sampleConfig: WorkerConfiguration = {
    version: '1.0.0',
    lastUpdated: new Date().toISOString(),
    video: {
      derivatives: {
        high: {
          width: 1920,
          height: 1080,
          mode: 'video',
          quality: 'high'
        }
      },
      defaults: {
        width: null,
        height: null,
        mode: 'video',
        fit: 'contain',
        audio: true,
        format: null,
        time: null,
        duration: null,
        quality: 'auto',
        compression: 'auto',
        loop: null,
        preload: 'auto',
        autoplay: null,
        muted: null
      },
      validOptions: {
        mode: ['video', 'frame', 'spritesheet'],
        fit: ['contain', 'scale-down', 'cover'],
        format: ['mp4', 'webm', 'gif', 'jpeg', 'webp', 'png'],
        audio: [true, false],
        quality: ['low', 'medium', 'high', 'auto'],
        compression: ['low', 'medium', 'high', 'auto'],
        preload: ['none', 'metadata', 'auto'],
        loop: [true, false],
        autoplay: [true, false],
        muted: [true, false]
      },
      responsive: {
        breakpoints: {
          xs: 1,
          sm: 640,
          md: 768,
          lg: 1024,
          xl: 1280,
          '2xl': 1536
        },
        availableQualities: [360, 480, 720, 1080, 1440, 2160],
        deviceWidths: {
          mobile: 640,
          tablet: 1024,
          desktop: 1920
        },
        networkQuality: {
          slow: {
            maxWidth: 640,
            maxHeight: 360,
            maxBitrate: 1000000
          },
          medium: {
            maxWidth: 1280,
            maxHeight: 720,
            maxBitrate: 2500000
          },
          fast: {
            maxWidth: 1920,
            maxHeight: 1080,
            maxBitrate: 5000000
          }
        }
      },
      paramMapping: {
        width: 'width',
        height: 'height',
        fit: 'fit',
        format: 'format',
        quality: 'quality',
        time: 'time',
        duration: 'duration',
        compression: 'compression',
        audio: 'audio',
        loop: 'loop',
        preload: 'preload',
        autoplay: 'autoplay',
        muted: 'muted'
      },
      cdnCgi: {
        basePath: '/cdn-cgi/media'
      },
      pathPatterns: [],
      caching: {
        method: 'cacheApi',
        debug: false,
        fallback: {
          enabled: true,
          badRequestOnly: true,
          preserveHeaders: ['Content-Type', 'Cache-Control', 'Etag']
        }
      },
      cache: {}
    },
    cache: {
      method: 'cacheApi',
      debug: false,
      defaultMaxAge: 86400,
      respectOriginHeaders: true,
      cacheEverything: false,
      enableCacheTags: true,
      purgeOnUpdate: false,
      bypassQueryParameters: ['nocache', 'bypass'],
      enableKVCache: true,
      ttl: {
        ok: 86400,
        redirects: 3600,
        clientError: 60,
        serverError: 10
      }
    },
    debug: {
      enabled: false,
      verbose: false,
      includeHeaders: false,
      includePerformance: true,
      allowedIps: [],
      excludedPaths: ['/favicon.ico', '/robots.txt']
    },
    logging: {
      level: 'info',
      format: 'json',
      includeTimestamps: true,
      includeComponentName: true,
      colorize: true,
      enabledComponents: [],
      disabledComponents: [],
      sampleRate: 1,
      enablePerformanceLogging: true,
      performanceThresholdMs: 1000,
      breadcrumbs: {
        enabled: true,
        maxItems: 20
      }
    }
  };

  beforeEach(() => {
    // Reset mocks
    vi.resetAllMocks();

    // Reset singleton
    ConfigurationService.resetInstance();

    // Mock KV values
    mockKV.get.mockImplementation(async (key) => {
      if (key === 'worker-config') {
        return JSON.stringify(sampleConfig);
      }
      return null;
    });

    mockKV.put.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.resetAllMocks();
    ConfigurationService.resetInstance();
  });

  describe('loadConfiguration', () => {
    it('should load configuration from KV store', async () => {
      const service = ConfigurationService.getInstance();
      const config = await service.loadConfiguration(mockEnv);

      expect(mockKV.get).toHaveBeenCalledWith('worker-config');
      expect(config).toBeDefined();
      expect(config?.version).toBe('1.0.0');
      expect(config?.video.derivatives).toHaveProperty('high');
      expect(config?.cache.method).toBe('cacheApi');
    });

    it('should return cached configuration when available', async () => {
      const service = ConfigurationService.getInstance();
      
      // First call should hit KV
      await service.loadConfiguration(mockEnv);
      expect(mockKV.get).toHaveBeenCalledTimes(1);
      
      // Second call should use cached value
      await service.loadConfiguration(mockEnv);
      expect(mockKV.get).toHaveBeenCalledTimes(1);
    });

    it('should handle missing KV namespace', async () => {
      const service = ConfigurationService.getInstance();
      const config = await service.loadConfiguration({});

      expect(config).toBeNull();
    });

    it('should handle missing configuration in KV', async () => {
      mockKV.get.mockResolvedValue(null);
      
      const service = ConfigurationService.getInstance();
      const config = await service.loadConfiguration(mockEnv);

      expect(config).toBeNull();
    });

    it('should handle invalid JSON in KV', async () => {
      mockKV.get.mockResolvedValue('invalid json');
      
      const service = ConfigurationService.getInstance();
      const config = await service.loadConfiguration(mockEnv);

      expect(config).toBeNull();
    });
  });

  describe('storeConfiguration', () => {
    it('should store configuration in KV', async () => {
      const service = ConfigurationService.getInstance();
      const result = await service.storeConfiguration(mockEnv, sampleConfig);

      expect(result).toBe(true);
      expect(mockKV.put).toHaveBeenCalledWith(
        'worker-config',
        JSON.stringify(sampleConfig),
        { expirationTtl: 86400 * 30 }
      );
    });

    it('should handle missing KV namespace', async () => {
      const service = ConfigurationService.getInstance();
      const result = await service.storeConfiguration({}, sampleConfig);

      expect(result).toBe(false);
    });

    it('should validate configuration before storing', async () => {
      const invalidConfig = {
        version: '1.0.0',
        lastUpdated: new Date().toISOString(),
        // Missing required fields
      };
      
      const service = ConfigurationService.getInstance();
      const result = await service.storeConfiguration(mockEnv, invalidConfig as any);

      expect(result).toBe(false);
      expect(mockKV.put).not.toHaveBeenCalled();
    });
  });

  describe('Config section getters', () => {
    it('should get video configuration', async () => {
      const service = ConfigurationService.getInstance();
      // Reset to force a new load
      service['config'] = null;
      service['lastFetchTimestamp'] = 0;
      
      const customMockKV = {
        get: vi.fn().mockResolvedValue(JSON.stringify(sampleConfig)),
        put: vi.fn().mockResolvedValue(undefined)
      };
      
      const customEnv = {
        VIDEO_CONFIGURATION_STORE: customMockKV
      };
      
      const videoConfig = await service.getVideoConfig(customEnv);
      expect(videoConfig).not.toBeNull();
      expect(videoConfig?.derivatives).toHaveProperty('high');
      expect(customMockKV.get).toHaveBeenCalledWith('worker-config');
    });

    it('should get cache configuration', async () => {
      const service = ConfigurationService.getInstance();
      // Reset to force a new load
      service['config'] = null;
      service['lastFetchTimestamp'] = 0;
      
      const customMockKV = {
        get: vi.fn().mockResolvedValue(JSON.stringify(sampleConfig)),
        put: vi.fn().mockResolvedValue(undefined)
      };
      
      const customEnv = {
        VIDEO_CONFIGURATION_STORE: customMockKV
      };
      
      const cacheConfig = await service.getCacheConfig(customEnv);
      expect(cacheConfig).not.toBeNull();
      expect(cacheConfig?.method).toBe('cacheApi');
      expect(customMockKV.get).toHaveBeenCalledWith('worker-config');
    });

    it('should get logging configuration', async () => {
      const service = ConfigurationService.getInstance();
      // Reset to force a new load
      service['config'] = null;
      service['lastFetchTimestamp'] = 0;
      
      const customMockKV = {
        get: vi.fn().mockResolvedValue(JSON.stringify(sampleConfig)),
        put: vi.fn().mockResolvedValue(undefined)
      };
      
      const customEnv = {
        VIDEO_CONFIGURATION_STORE: customMockKV
      };
      
      const loggingConfig = await service.getLoggingConfig(customEnv);
      expect(loggingConfig).not.toBeNull();
      expect(loggingConfig?.level).toBe('info');
      expect(customMockKV.get).toHaveBeenCalledWith('worker-config');
    });

    it('should get debug configuration', async () => {
      const service = ConfigurationService.getInstance();
      // Reset to force a new load
      service['config'] = null;
      service['lastFetchTimestamp'] = 0;
      
      const customMockKV = {
        get: vi.fn().mockResolvedValue(JSON.stringify(sampleConfig)),
        put: vi.fn().mockResolvedValue(undefined)
      };
      
      const customEnv = {
        VIDEO_CONFIGURATION_STORE: customMockKV
      };
      
      const debugConfig = await service.getDebugConfig(customEnv);
      expect(debugConfig).not.toBeNull();
      expect(debugConfig?.enabled).toBe(false);
      expect(customMockKV.get).toHaveBeenCalledWith('worker-config');
    });

    it('should return null for section getters when config not loaded', async () => {
      const service = ConfigurationService.getInstance();
      // Reset the instance completely
      ConfigurationService.resetInstance();
      const freshService = ConfigurationService.getInstance();
      
      // Mock KV to return null for this test
      const emptyMockKV = {
        get: vi.fn().mockResolvedValue(null),
        put: vi.fn().mockResolvedValue(undefined)
      };
      
      const emptyEnv = {
        VIDEO_CONFIGURATION_STORE: emptyMockKV
      };
      
      const videoConfig = await freshService.getVideoConfig(emptyEnv);
      const cacheConfig = await freshService.getCacheConfig(emptyEnv);
      const loggingConfig = await freshService.getLoggingConfig(emptyEnv);
      const debugConfig = await freshService.getDebugConfig(emptyEnv);
      
      expect(videoConfig).toBeNull();
      expect(cacheConfig).toBeNull();
      expect(loggingConfig).toBeNull();
      expect(debugConfig).toBeNull();
    });
  });

  // Test for adding lastUpdated to config
  it.skip('should add lastUpdated if missing', async () => {
    // Create service with mocked implementation
    const mockStoreImpl = vi.fn((key, data, options) => {
      const parsed = JSON.parse(data);
      expect(parsed).toHaveProperty('lastUpdated');
      expect(new Date(parsed.lastUpdated)).toBeInstanceOf(Date);
      return Promise.resolve(undefined);
    });
    
    const mockStore = {
      get: vi.fn().mockResolvedValue(null),
      put: mockStoreImpl,
    };
    
    const mockEnvWithStore = {
      VIDEO_CONFIGURATION_STORE: mockStore
    };
    
    // Create config without timestamp
    const configWithoutTimestamp = {
      ...sampleConfig,
      lastUpdated: undefined
    };
    
    // Reset and get fresh instance
    ConfigurationService.resetInstance();
    const service = ConfigurationService.getInstance();
    
    // Override validateConfig method to not throw validation error
    service['validateConfig'] = vi.fn().mockReturnValue(true);
    
    // Store configuration
    await service.storeConfiguration(mockEnvWithStore, configWithoutTimestamp as any);
    
    // Verify the mock was called
    expect(mockStoreImpl).toHaveBeenCalled();
  });
});
/**
 * ConfigurationService tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  ConfigurationService,
  WorkerConfiguration,
  WorkerConfigurationSchema,
} from '../../src/services/configurationService';
import { ConfigurationError } from '../../src/errors';

describe('ConfigurationService', () => {
  // Mock KV namespace
  const mockKV = {
    get: vi.fn(),
    put: vi.fn().mockResolvedValue(undefined),
    list: vi.fn(),
  };

  // Mock environment with KV namespace
  const mockEnv = {
    VIDEO_CONFIGURATION_STORE: mockKV,
  } as any;

  // Sample configuration (partial mock, typed as any to bypass strict checks)
  const sampleConfig = {
    version: '1.0.0',
    lastUpdated: new Date().toISOString(),
    video: {
      derivatives: {
        high: {
          width: 1920,
          height: 1080,
          mode: 'video',
          quality: 'high',
        },
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
        muted: null,
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
        muted: [true, false],
      },
      responsive: {
        breakpoints: {
          xs: 1,
          sm: 640,
          md: 768,
          lg: 1024,
          xl: 1280,
          '2xl': 1536,
        },
        availableQualities: [360, 480, 720, 1080, 1440, 2160],
        deviceWidths: {
          mobile: 640,
          tablet: 1024,
          desktop: 1920,
        },
        networkQuality: {
          slow: {
            maxWidth: 640,
            maxHeight: 360,
            maxBitrate: 1000000,
          },
          medium: {
            maxWidth: 1280,
            maxHeight: 720,
            maxBitrate: 2500000,
          },
          fast: {
            maxWidth: 1920,
            maxHeight: 1080,
            maxBitrate: 5000000,
          },
        },
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
        muted: 'muted',
      },
      cdnCgi: {
        basePath: '/cdn-cgi/media',
      },
      pathPatterns: [],
      caching: {
        method: 'kv',
        debug: false,
        fallback: {
          enabled: true,
          badRequestOnly: true,
          preserveHeaders: ['Content-Type', 'Cache-Control', 'Etag'],
        },
      },
      cache: {},
    },
    cache: {
      method: 'kv',
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
        serverError: 10,
      },
    },
    debug: {
      enabled: false,
      verbose: false,
      includeHeaders: false,
      includePerformance: true,
      allowedIps: [],
      excludedPaths: ['/favicon.ico', '/robots.txt'],
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
        maxItems: 20,
      },
    },
  };

  beforeEach(() => {
    // Reset mocks
    vi.resetAllMocks();

    // Reset singleton
    ConfigurationService.resetInstance();

    // Mock KV values - return parsed object for 'json' format (matches real KV API)
    mockKV.get.mockImplementation(async (key: string, format?: string) => {
      if (key === 'worker-config') {
        if (format === 'json') {
          return sampleConfig; // KV.get(key, 'json') returns parsed object
        }
        return JSON.stringify(sampleConfig); // KV.get(key, 'text') returns string
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

      expect(mockKV.get).toHaveBeenCalledWith('worker-config', 'json');
      expect(config).toBeDefined();
      expect(config?.version).toBe('1.0.0');
      expect(config?.video.derivatives).toHaveProperty('high');
      expect((config?.cache as any).method).toBe('kv');
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

    it('should throw ConfigurationError for missing KV namespace', async () => {
      const service = ConfigurationService.getInstance();

      await expect(service.loadConfiguration({})).rejects.toThrow(ConfigurationError);
      await expect(service.loadConfiguration({})).rejects.toThrow(
        'No configuration available in KV storage'
      );
    });

    it('should throw ConfigurationError for missing configuration in KV', async () => {
      mockKV.get.mockResolvedValue(null);

      const service = ConfigurationService.getInstance();

      await expect(service.loadConfiguration(mockEnv)).rejects.toThrow(ConfigurationError);
      await expect(service.loadConfiguration(mockEnv)).rejects.toThrow(
        'No configuration available in KV storage'
      );
    });

    it('should throw ConfigurationError for invalid JSON in KV', async () => {
      mockKV.get.mockResolvedValue('invalid json');

      const service = ConfigurationService.getInstance();

      await expect(service.loadConfiguration(mockEnv)).rejects.toThrow(ConfigurationError);
      await expect(service.loadConfiguration(mockEnv)).rejects.toThrow(
        'No configuration available in KV storage'
      );
    });
  });

  describe('storeConfiguration', () => {
    it('should store configuration in KV', async () => {
      const service = ConfigurationService.getInstance();
      const result = await service.storeConfiguration(mockEnv, sampleConfig as any);

      expect(result).toBe(true);
      // The new storeToKV no longer passes expirationTtl and updates lastUpdated
      expect(mockKV.put).toHaveBeenCalledTimes(1);
      expect(mockKV.put).toHaveBeenCalledWith('worker-config', expect.any(String));
      // Verify the stored data is valid JSON containing the config
      const storedData = JSON.parse(mockKV.put.mock.calls[0][1]);
      expect(storedData.version).toBe('1.0.0');
      expect(storedData.lastUpdated).toBeDefined();
      expect(storedData.video.derivatives).toHaveProperty('high');
    });

    it('should handle missing KV namespace', async () => {
      const service = ConfigurationService.getInstance();
      const result = await service.storeConfiguration({}, sampleConfig as any);

      expect(result).toBe(false);
    });

    it('should throw when storing partial config without base configuration loaded', async () => {
      const invalidConfig = {
        version: '1.0.0',
        lastUpdated: new Date().toISOString(),
        // Missing required fields - treated as partial update, but no base config loaded
      };

      const service = ConfigurationService.getInstance();

      // The new service throws ConfigurationError when no base config is available for partial updates
      await expect(service.storeConfiguration(mockEnv, invalidConfig as any)).rejects.toThrow(
        ConfigurationError
      );
      await expect(service.storeConfiguration(mockEnv, invalidConfig as any)).rejects.toThrow(
        'No base configuration available for update'
      );
      expect(mockKV.put).not.toHaveBeenCalled();
    });
  });

  describe('Config section getters', () => {
    it('should get video configuration', async () => {
      const service = ConfigurationService.getInstance();
      // Load config first so that this.config is set
      await service.loadConfiguration(mockEnv);

      const videoConfig = await service.getVideoConfig();
      expect(videoConfig).not.toBeNull();
      expect(videoConfig?.derivatives).toHaveProperty('high');
    });

    it('should get cache configuration', async () => {
      const service = ConfigurationService.getInstance();
      // Load config first so that this.config is set
      await service.loadConfiguration(mockEnv);

      const cacheConfig = await service.getCacheConfig();
      expect(cacheConfig).not.toBeNull();
      expect(cacheConfig?.method).toBe('kv');
    });

    it('should get logging configuration', async () => {
      const service = ConfigurationService.getInstance();
      // Load config first so that this.config is set
      await service.loadConfiguration(mockEnv);

      const loggingConfig = await service.getLoggingConfig();
      expect(loggingConfig).not.toBeNull();
      expect(loggingConfig?.level).toBe('info');
    });

    it('should get debug configuration', async () => {
      const service = ConfigurationService.getInstance();
      // Load config first so that this.config is set
      await service.loadConfiguration(mockEnv);

      const debugConfig = await service.getDebugConfig();
      expect(debugConfig).not.toBeNull();
      expect(debugConfig?.enabled).toBe(false);
    });

    it('should return null for section getters when config not loaded', async () => {
      // Reset the instance completely so this.config is null
      ConfigurationService.resetInstance();
      const freshService = ConfigurationService.getInstance();

      // Getters take no arguments; they return null when this.config is null
      const videoConfig = await freshService.getVideoConfig();
      const cacheConfig = await freshService.getCacheConfig();
      const loggingConfig = await freshService.getLoggingConfig();
      const debugConfig = await freshService.getDebugConfig();

      expect(videoConfig).toBeNull();
      expect(cacheConfig).toBeNull();
      expect(loggingConfig).toBeNull();
      expect(debugConfig).toBeNull();
    });
  });

  // Test for adding lastUpdated to config
  it('should add lastUpdated if missing', async () => {
    // Create service with mocked implementation that captures the data for inspection
    let capturedData: string | null = null;

    const mockStoreImpl = vi.fn((key, data, options) => {
      capturedData = data;
      return Promise.resolve(undefined);
    });

    const mockStore = {
      get: vi.fn().mockResolvedValue(null),
      put: mockStoreImpl,
    };

    const mockEnvWithStore = {
      VIDEO_CONFIGURATION_STORE: mockStore,
    };

    // Create config without timestamp
    const configWithoutTimestamp = {
      ...sampleConfig,
      lastUpdated: undefined,
    };
    delete configWithoutTimestamp.lastUpdated; // Ensure it's truly undefined

    // Reset and get fresh instance
    ConfigurationService.resetInstance();
    const service = ConfigurationService.getInstance();

    // Skip validation
    vi.spyOn(WorkerConfigurationSchema, 'parse').mockReturnValue(configWithoutTimestamp as any);

    // Store configuration
    await service.storeConfiguration(mockEnvWithStore as any, configWithoutTimestamp as any);

    // Verify the mock was called
    expect(mockStoreImpl).toHaveBeenCalled();

    // Check that the captured data has a lastUpdated property
    expect(capturedData).not.toBeNull();
    if (capturedData) {
      const parsed = JSON.parse(capturedData);
      expect(parsed).toHaveProperty('lastUpdated');

      // Verify it's a valid date string
      const lastUpdatedDate = new Date(parsed.lastUpdated);
      expect(lastUpdatedDate).toBeInstanceOf(Date);
      expect(isNaN(lastUpdatedDate.getTime())).toBe(false);
    }
  });
});

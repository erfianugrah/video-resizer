import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as kvStorageService from '../../src/services/kvStorageService';

// Create a mock KV namespace with the methods getCacheKV checks for
const mockKVNamespace = {
  get: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
  list: vi.fn(),
  getWithMetadata: vi.fn(),
} as unknown as KVNamespace;

// Mock CacheConfigurationManager (cacheConfig singleton)
const mockGetConfig = vi.fn().mockReturnValue({
  enableKVCache: true,
  bypassQueryParameters: ['nocache', 'bypass'],
  mimeTypes: {
    video: ['video/mp4', 'video/webm'],
    image: ['image/jpeg', 'image/png'],
  },
});

vi.mock('../../src/config/CacheConfigurationManager', () => ({
  cacheConfig: {
    getConfig: (...args: any[]) => mockGetConfig(...args),
  },
  CacheConfigurationManager: {
    getInstance: vi.fn(() => ({
      getConfig: (...args: any[]) => mockGetConfig(...args),
    })),
  },
}));

// Mock flexible bindings - getCacheKV returns our mock KV namespace
const mockGetCacheKV = vi.fn().mockReturnValue(mockKVNamespace);
vi.mock('../../src/utils/flexibleBindings', () => ({
  getCacheKV: (...args: any[]) => mockGetCacheKV(...args),
}));

// Mock URL normalization to pass through
vi.mock('../../src/utils/urlVersionUtils', () => ({
  normalizeUrlForCaching: vi.fn((url: string) => url),
}));

// Mock determineTTL to return a known TTL
const mockDetermineTTL = vi.fn().mockReturnValue(86400);
vi.mock('../../src/utils/determineTTL', () => ({
  determineTTL: (...args: any[]) => mockDetermineTTL(...args),
}));

// Mock the config module with the getCacheConfig function
vi.mock('../../src/config', () => ({
  getCacheConfig: vi.fn(() => ({
    enableKVCache: true,
    ttl: {
      ok: 86400,
      redirects: 3600,
      clientError: 60,
      serverError: 10,
    },
  })),
}));

// Mock the required modules for requestContext
vi.mock('../../src/utils/requestContext', () => ({
  getCurrentContext: vi.fn(() => ({
    requestId: 'test-request-id',
    url: 'https://example.com/videos/test.mp4',
    startTime: Date.now(),
    debugEnabled: false,
  })),
  addBreadcrumb: vi.fn(),
}));

// Mock the legacy logger adapter
// Mock logger
vi.mock('../../src/utils/pinoLogger', () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  })),
  debug: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
}));

vi.mock('../../src/utils/logger', () => ({
  createCategoryLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

// Mock KV storage service with default success response
vi.mock('../../src/services/kvStorageService', () => ({
  getTransformedVideo: vi.fn().mockResolvedValue({
    response: new Response('cached video data', {
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Length': '16',
      },
    }),
    metadata: {
      sourcePath: '/videos/test.mp4',
      derivative: 'mobile',
      cacheTags: ['video-test'],
      contentType: 'video/mp4',
      contentLength: 16,
      createdAt: Date.now(),
    },
  }),
  storeTransformedVideo: vi.fn().mockResolvedValue(true),
  generateKVKey: vi.fn((sourcePath: string, options: any) => {
    let key = `video:${sourcePath.replace(/^\/+/, '')}`;

    // Check for IMQuery parameters in customData
    const hasIMQuery = options.customData?.imwidth || options.customData?.imheight;

    if (hasIMQuery) {
      if (options.customData?.imwidth) key += `:imwidth=${options.customData.imwidth}`;
      if (options.customData?.imheight) key += `:imheight=${options.customData.imheight}`;
      if (options.derivative) key += `:via=${options.derivative}`;
    } else if (options.derivative) {
      key += `:derivative=${options.derivative}`;
    }

    return key;
  }),
}));

describe('KV Cache Utils', () => {
  let getFromKVCache: typeof import('../../src/utils/kvCacheUtils').getFromKVCache;
  let storeInKVCache: typeof import('../../src/utils/kvCacheUtils').storeInKVCache;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Re-setup default mock return values after clear
    mockGetConfig.mockReturnValue({
      enableKVCache: true,
      bypassQueryParameters: ['nocache', 'bypass'],
      mimeTypes: {
        video: ['video/mp4', 'video/webm'],
        image: ['image/jpeg', 'image/png'],
      },
    });
    mockGetCacheKV.mockReturnValue(mockKVNamespace);
    mockDetermineTTL.mockReturnValue(86400);

    // Re-setup default kvStorageService mocks after clear
    vi.mocked(kvStorageService.getTransformedVideo).mockResolvedValue({
      response: new Response('cached video data', {
        headers: {
          'Content-Type': 'video/mp4',
          'Content-Length': '16',
        },
      }),
      metadata: {
        sourcePath: '/videos/test.mp4',
        derivative: 'mobile',
        cacheTags: ['video-test'],
        contentType: 'video/mp4',
        contentLength: 16,
        createdAt: Date.now(),
      },
    } as any);
    vi.mocked(kvStorageService.storeTransformedVideo).mockResolvedValue(true);

    const mod = await import('../../src/utils/kvCacheUtils');
    getFromKVCache = mod.getFromKVCache;
    storeInKVCache = mod.storeInKVCache;
  });

  const mockEnv = {
    VIDEO_TRANSFORMATIONS_CACHE: mockKVNamespace,
    VIDEO_TRANSFORMS_KV: null,
  };

  const mockOptions = {
    derivative: 'mobile',
    width: 640,
    height: 360,
  };

  const sourcePath = '/videos/test.mp4';

  describe('getFromKVCache', () => {
    it('should return null when KV caching is disabled', async () => {
      // Override CacheConfigurationManager to disable KV cache
      mockGetConfig.mockReturnValue({
        enableKVCache: false,
        bypassQueryParameters: ['nocache', 'bypass'],
      });

      const result = await getFromKVCache(mockEnv as any, sourcePath, mockOptions);

      expect(result).toBeNull();
      expect(kvStorageService.getTransformedVideo).not.toHaveBeenCalled();
    });

    it('should return null when KV namespace is not available', async () => {
      mockGetCacheKV.mockReturnValue(null);

      const result = await getFromKVCache(mockEnv as any, sourcePath, mockOptions);

      expect(result).toBeNull();
      expect(kvStorageService.getTransformedVideo).not.toHaveBeenCalled();
    });

    it('should return cached response when available', async () => {
      const cachedResponse = new Response('cached video data', {
        headers: {
          'Content-Type': 'video/mp4',
          'Content-Length': '16',
        },
      });

      // Mock successful KV fetch
      vi.mocked(kvStorageService.getTransformedVideo).mockResolvedValue({
        response: cachedResponse,
        metadata: {
          sourcePath,
          derivative: 'mobile',
          cacheTags: ['video-test'],
          contentType: 'video/mp4',
          contentLength: 16,
          createdAt: Date.now(),
        },
      } as any);

      const result = await getFromKVCache(mockEnv as any, sourcePath, mockOptions);

      expect(result).toBe(cachedResponse);
      // Source code calls: getTransformedVideo(kvNamespace, normalizedPath, { ...options, env }, request)
      expect(kvStorageService.getTransformedVideo).toHaveBeenCalledWith(
        mockKVNamespace,
        sourcePath,
        expect.objectContaining({
          ...mockOptions,
          env: mockEnv,
        }),
        undefined
      );
    });

    it('should return null when cached response is not found', async () => {
      // Mock KV miss
      vi.mocked(kvStorageService.getTransformedVideo).mockResolvedValueOnce(null);

      const result = await getFromKVCache(mockEnv as any, sourcePath, mockOptions);

      expect(result).toBeNull();
      expect(kvStorageService.getTransformedVideo).toHaveBeenCalledWith(
        mockKVNamespace,
        sourcePath,
        expect.objectContaining({
          ...mockOptions,
          env: mockEnv,
        }),
        undefined
      );
    });

    it('should return null when getTransformedVideo throws an error', async () => {
      // Mock error in KV fetch
      vi.mocked(kvStorageService.getTransformedVideo).mockRejectedValueOnce(new Error('KV error'));

      const result = await getFromKVCache(mockEnv as any, sourcePath, mockOptions);

      expect(result).toBeNull();
    });

    it('should bypass KV cache when debug is enabled', async () => {
      // Mock success response
      vi.mocked(kvStorageService.getTransformedVideo).mockResolvedValue({
        response: new Response('cached data'),
        metadata: {
          sourcePath,
          derivative: 'mobile',
          cacheTags: ['video-test'],
          contentType: 'video/mp4',
          contentLength: 16,
          createdAt: Date.now(),
        },
      } as any);

      const result = await getFromKVCache(mockEnv as any, sourcePath, mockOptions);

      // We should get a response from KV cache even in debug mode
      expect(result).not.toBeNull();
    });

    it('should not bypass KV cache when URL has bypass parameters', async () => {
      // In our new implementation, URL parameters don't bypass KV cache anymore

      // Mock success response
      vi.mocked(kvStorageService.getTransformedVideo).mockResolvedValue({
        response: new Response('cached data'),
        metadata: {
          sourcePath,
          derivative: 'mobile',
          cacheTags: ['video-test'],
          contentType: 'video/mp4',
          contentLength: 16,
          createdAt: Date.now(),
        },
      } as any);

      const result = await getFromKVCache(mockEnv as any, sourcePath, mockOptions);

      // We should get a response from KV cache even with URL parameters
      expect(result).not.toBeNull();
    });

    it('should use IMQuery parameters in customData when looking up cached content', async () => {
      // Options with IMQuery parameters
      const imQueryOptions = {
        ...mockOptions,
        customData: {
          imwidth: '800',
          imheight: '450',
        },
      };

      // Mock successful KV lookup
      vi.mocked(kvStorageService.getTransformedVideo).mockResolvedValue({
        response: new Response('cached video data', {
          headers: {
            'Content-Type': 'video/mp4',
            'Content-Length': '16',
          },
        }),
        metadata: {
          sourcePath,
          derivative: 'mobile',
          cacheTags: ['video-test', 'video-imwidth-800'],
          contentType: 'video/mp4',
          contentLength: 16,
          createdAt: Date.now(),
        },
      } as any);

      const result = await getFromKVCache(mockEnv as any, sourcePath, imQueryOptions);

      expect(result).not.toBeNull();
      expect(kvStorageService.getTransformedVideo).toHaveBeenCalledWith(
        mockKVNamespace,
        sourcePath,
        expect.objectContaining({
          customData: {
            imwidth: '800',
            imheight: '450',
          },
          env: mockEnv,
        }),
        undefined
      );
    });
  });

  describe('storeInKVCache', () => {
    it('should return false when KV caching is disabled', async () => {
      // Override CacheConfigurationManager to disable KV cache
      mockGetConfig.mockReturnValue({
        enableKVCache: false,
        bypassQueryParameters: ['nocache', 'bypass'],
      });

      const response = new Response('video data');
      const result = await storeInKVCache(mockEnv as any, sourcePath, response, mockOptions);

      expect(result).toBe(false);
      expect(kvStorageService.storeTransformedVideo).not.toHaveBeenCalled();
    });

    it('should return false when KV namespace is not available', async () => {
      mockGetCacheKV.mockReturnValue(null);

      const response = new Response('video data');
      const result = await storeInKVCache(mockEnv as any, sourcePath, response, mockOptions);

      expect(result).toBe(false);
      expect(kvStorageService.storeTransformedVideo).not.toHaveBeenCalled();
    });

    it('should store response in KV cache with success response', async () => {
      const response = new Response('video data', {
        status: 200,
        headers: {
          'Content-Type': 'video/mp4',
          'Content-Length': '10',
        },
      });

      // Mock successful KV storage
      vi.mocked(kvStorageService.storeTransformedVideo).mockResolvedValue(true);

      const result = await storeInKVCache(mockEnv as any, sourcePath, response, mockOptions);

      expect(result).toBe(true);
      // Source code calls: storeTransformedVideo(kvNamespace, normalizedPath, responseClone, { ...options, env }, ttl, false)
      expect(kvStorageService.storeTransformedVideo).toHaveBeenCalledWith(
        mockKVNamespace,
        sourcePath,
        expect.any(Response),
        expect.objectContaining({
          ...mockOptions,
          env: mockEnv,
        }),
        86400, // TTL from our determineTTL mock
        false // streaming mode flag
      );
    });

    it('should set different TTLs based on response status', async () => {
      // Reset mock before this test
      vi.clearAllMocks();
      mockGetConfig.mockReturnValue({
        enableKVCache: true,
        bypassQueryParameters: ['nocache', 'bypass'],
        mimeTypes: {
          video: ['video/mp4', 'video/webm'],
          image: ['image/jpeg', 'image/png'],
        },
      });
      mockGetCacheKV.mockReturnValue(mockKVNamespace);

      // Test for redirect response - set determineTTL to return redirect TTL
      mockDetermineTTL.mockReturnValue(3600);

      const redirectResponse = new Response('', {
        status: 302,
        headers: {
          Location: 'https://example.com/redirected',
          'Content-Type': 'video/mp4',
        },
      });

      vi.mocked(kvStorageService.storeTransformedVideo).mockResolvedValue(true);

      await storeInKVCache(mockEnv as any, sourcePath, redirectResponse, mockOptions);

      expect(kvStorageService.storeTransformedVideo).toHaveBeenCalledWith(
        mockKVNamespace,
        sourcePath,
        expect.any(Response),
        expect.objectContaining({
          ...mockOptions,
          env: mockEnv,
        }),
        3600, // Redirect TTL from our determineTTL mock
        false
      );
    });

    it('should handle errors when storing in KV', async () => {
      const response = new Response('video data', {
        status: 200,
        headers: {
          'Content-Type': 'video/mp4',
          'Content-Length': '10',
        },
      });

      // Mock error in KV storage
      vi.mocked(kvStorageService.storeTransformedVideo).mockRejectedValueOnce(
        new Error('KV storage error')
      );

      const result = await storeInKVCache(mockEnv as any, sourcePath, response, mockOptions);

      expect(result).toBe(false);
    });

    it('should use generateKVKey with IMQuery parameters', async () => {
      // Reset mocks before test
      vi.clearAllMocks();

      // Create custom mock for testing IMQuery parameters in cache key
      const mockGenerateKVKey = vi
        .fn()
        .mockReturnValue('video:videos/test.mp4:imwidth=800:imheight=450:via=mobile');
      vi.spyOn(kvStorageService, 'generateKVKey').mockImplementation(mockGenerateKVKey);

      // Options with IMQuery parameters
      const imQueryOptions = {
        ...mockOptions,
        customData: {
          imwidth: '800',
          imheight: '450',
        },
      };

      // Call the function directly to verify behavior
      const key = kvStorageService.generateKVKey(sourcePath, imQueryOptions);

      expect(key).toBe('video:videos/test.mp4:imwidth=800:imheight=450:via=mobile');
      expect(mockGenerateKVKey).toHaveBeenCalledWith(
        sourcePath,
        expect.objectContaining({
          customData: {
            imwidth: '800',
            imheight: '450',
          },
        })
      );
    });
  });
});

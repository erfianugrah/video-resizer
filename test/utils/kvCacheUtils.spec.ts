import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as kvStorageService from '../../src/services/kvStorageService';
import * as configModule from '../../src/config';

// Create a mock KV namespace with the methods getCacheKV checks for
const mockKVNamespace = {
  get: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
  list: vi.fn(),
  getWithMetadata: vi.fn(),
} as unknown as KVNamespace;

// Mock CacheConfigurationManager (cacheConfig singleton)
// This is the primary config source used by getFromKVCache/storeInKVCache
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
vi.mock('../../src/utils/determineTTL', () => ({
  determineTTL: vi.fn(() => 86400),
}));

// Mock all dependencies
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

vi.mock('../../src/services/kvStorageService', () => {
  return {
    getTransformedVideo: vi.fn(),
    storeTransformedVideo: vi.fn().mockResolvedValue(true),
    generateKVKey: vi.fn(),
  };
});

vi.mock('../../src/utils/pinoLogger', () => ({
  createLogger: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('../../src/utils/logger', () => ({
  createCategoryLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

vi.mock('../../src/utils/requestContext', () => ({
  getCurrentContext: vi.fn(),
  addBreadcrumb: vi.fn(),
}));

vi.mock('../../src/utils/legacyLoggerAdapter', () => ({
  getCurrentContext: vi.fn().mockReturnValue({
    requestId: 'test-request-id',
    url: 'https://example.com/videos/test.mp4',
    startTime: Date.now(),
    debugEnabled: false,
  }),
}));

describe('KV Cache Utils', () => {
  // Import after mocks are set up
  let getFromKVCache: typeof import('../../src/utils/kvCacheUtils').getFromKVCache;
  let storeInKVCache: typeof import('../../src/utils/kvCacheUtils').storeInKVCache;

  beforeEach(async () => {
    vi.resetAllMocks();

    // Re-setup default mock return values after reset
    mockGetConfig.mockReturnValue({
      enableKVCache: true,
      bypassQueryParameters: ['nocache', 'bypass'],
      mimeTypes: {
        video: ['video/mp4', 'video/webm'],
        image: ['image/jpeg', 'image/png'],
      },
    });
    mockGetCacheKV.mockReturnValue(mockKVNamespace);

    // Re-import to get fresh references
    const mod = await import('../../src/utils/kvCacheUtils');
    getFromKVCache = mod.getFromKVCache;
    storeInKVCache = mod.storeInKVCache;
  });

  // Test environment setup
  const mockEnv = {
    VIDEO_TRANSFORMATIONS_CACHE: mockKVNamespace,
    VIDEO_TRANSFORMS_KV: null,
    CACHE_ENABLE_KV: 'true',
  };

  const mockOptions = {
    derivative: 'mobile',
    width: 640,
    height: 360,
  };

  const sourcePath = '/videos/test.mp4';

  describe('getFromKVCache', () => {
    it('should return null when KV caching is disabled', async () => {
      // Mock CacheConfigurationManager with KV caching disabled
      mockGetConfig.mockReturnValue({
        enableKVCache: false,
        bypassQueryParameters: ['nocache', 'bypass'],
      });

      const result = await getFromKVCache(mockEnv as any, sourcePath, mockOptions);

      expect(result).toBeNull();
      expect(kvStorageService.getTransformedVideo).not.toHaveBeenCalled();
    });

    it('should return null when KV namespace is not available', async () => {
      // Make getCacheKV return null
      mockGetCacheKV.mockReturnValue(null);

      const result = await getFromKVCache(mockEnv as any, sourcePath, mockOptions);

      expect(result).toBeNull();
      expect(kvStorageService.getTransformedVideo).not.toHaveBeenCalled();
    });

    it('should check KV storage when available', async () => {
      // Just testing that KV is accessed
      await getFromKVCache(mockEnv as any, sourcePath, mockOptions);

      // Verify function was called with correct arguments
      // Source code calls: getTransformedVideo(kvNamespace, normalizedPath, { ...options, env }, request)
      expect(kvStorageService.getTransformedVideo).toHaveBeenCalledWith(
        mockKVNamespace,
        sourcePath,
        expect.objectContaining({
          ...mockOptions,
          env: mockEnv,
        }),
        undefined // request parameter
      );
    });
  });

  describe('storeInKVCache', () => {
    beforeEach(() => {
      // Set up the storeTransformedVideo mock to succeed by default
      vi.mocked(kvStorageService.storeTransformedVideo).mockResolvedValue(true);
    });

    it('should return false when KV caching is disabled', async () => {
      // Mock CacheConfigurationManager with KV caching disabled
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
      // Make getCacheKV return null
      mockGetCacheKV.mockReturnValue(null);

      const response = new Response('video data');
      const result = await storeInKVCache(mockEnv as any, sourcePath, response, mockOptions);

      expect(result).toBe(false);
      expect(kvStorageService.storeTransformedVideo).not.toHaveBeenCalled();
    });

    it('should call KV storage service with appropriate TTL', async () => {
      // Create a test response
      const response = new Response('video data', {
        status: 200,
        headers: {
          'Content-Type': 'video/mp4',
          'Content-Length': '10',
        },
      });

      // Call the function and verify results
      await storeInKVCache(mockEnv as any, sourcePath, response, mockOptions);

      // Source code calls: storeTransformedVideo(kvNamespace, normalizedPath, responseClone, { ...options, env }, ttl, false)
      expect(kvStorageService.storeTransformedVideo).toHaveBeenCalledWith(
        mockKVNamespace,
        sourcePath,
        expect.any(Response),
        expect.objectContaining({
          ...mockOptions,
          env: mockEnv,
        }),
        86400, // Default TTL from our determineTTL mock
        false // streaming mode flag
      );
    });

    it('should handle errors gracefully', async () => {
      // Mock an error occurring in the storage service
      vi.mocked(kvStorageService.storeTransformedVideo).mockRejectedValue(
        new Error('KV storage error')
      );

      // Call function with a video/mp4 response so it passes content-type checks
      const response = new Response('test data', {
        status: 200,
        headers: {
          'Content-Type': 'video/mp4',
          'Content-Length': '9',
        },
      });
      const result = await storeInKVCache(mockEnv as any, sourcePath, response, mockOptions);

      // Should return false to indicate failure, but not throw
      expect(result).toBe(false);
    });
  });
});

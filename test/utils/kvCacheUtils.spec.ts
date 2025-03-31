import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getFromKVCache, storeInKVCache } from '../../src/utils/kvCacheUtils';
import * as kvStorageService from '../../src/services/kvStorageService';
import * as configModule from '../../src/config';

// Mock the logger
vi.mock('../../src/utils/pinoLogger', () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    error: vi.fn()
  })),
  debug: vi.fn()
}));

// Mock request context
vi.mock('../../src/utils/requestContext', () => ({
  getCurrentContext: vi.fn(() => ({
    requestId: 'test-request-id',
    url: 'https://example.com/videos/test.mp4',
    startTime: Date.now(),
    debugEnabled: false
  })),
  addBreadcrumb: vi.fn()
}));

// Mock the legacy logger adapter
vi.mock('../../src/utils/legacyLoggerAdapter', () => ({
  getCurrentContext: vi.fn(() => ({
    requestId: 'test-request-id',
    url: 'https://example.com/videos/test.mp4',
    startTime: Date.now(),
    debugEnabled: false
  }))
}));

// Mock KV storage service
vi.mock('../../src/services/kvStorageService', () => ({
  getTransformedVideo: vi.fn(),
  storeTransformedVideo: vi.fn(),
  generateKVKey: vi.fn((sourcePath, options) => {
    let key = `video:${sourcePath.replace(/^\/+/, '')}`;
    if (options.derivative) {
      key += `:derivative=${options.derivative}`;
    }
    return key;
  })
}));

// Mock config
vi.mock('../../src/config', () => ({
  getCacheConfig: vi.fn(() => ({
    enableKVCache: true,
    ttl: {
      ok: 86400,
      redirects: 3600,
      clientError: 60,
      serverError: 10
    }
  }))
}));

describe('KV Cache Utils', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockEnv = {
    VIDEO_TRANSFORMATIONS_CACHE: {} as KVNamespace,
    VIDEO_TRANSFORMS_KV: null
  };

  const mockOptions = {
    derivative: 'mobile',
    width: 640,
    height: 360
  };

  const sourcePath = '/videos/test.mp4';

  describe('getFromKVCache', () => {
    it('should return null when KV caching is disabled', async () => {
      // Mock cache config with KV caching disabled
      vi.mocked(configModule.getCacheConfig).mockReturnValue({
        enableKVCache: false,
        ttl: {
          ok: 86400,
          redirects: 3600,
          clientError: 60,
          serverError: 10
        }
      });
      
      const result = await getFromKVCache(mockEnv, sourcePath, mockOptions);
      
      expect(result).toBeNull();
      expect(kvStorageService.getTransformedVideo).not.toHaveBeenCalled();
    });

    it('should return null when KV namespace is not available', async () => {
      const envWithoutKV = {
        VIDEO_TRANSFORMATIONS_CACHE: null,
        VIDEO_TRANSFORMS_KV: null
      };
      
      const result = await getFromKVCache(envWithoutKV, sourcePath, mockOptions);
      
      expect(result).toBeNull();
      expect(kvStorageService.getTransformedVideo).not.toHaveBeenCalled();
    });

    it('should return cached response when available', async () => {
      const cachedResponse = new Response('cached video data', {
        headers: {
          'Content-Type': 'video/mp4',
          'Content-Length': '16'
        }
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
          createdAt: Date.now()
        }
      });
      
      const result = await getFromKVCache(mockEnv, sourcePath, mockOptions);
      
      expect(result).toBe(cachedResponse);
      expect(kvStorageService.getTransformedVideo).toHaveBeenCalledWith(
        mockEnv.VIDEO_TRANSFORMATIONS_CACHE,
        sourcePath,
        mockOptions
      );
    });

    it('should return null when cached response is not found', async () => {
      // Mock KV miss
      vi.mocked(kvStorageService.getTransformedVideo).mockResolvedValue(null);
      
      const result = await getFromKVCache(mockEnv, sourcePath, mockOptions);
      
      expect(result).toBeNull();
      expect(kvStorageService.getTransformedVideo).toHaveBeenCalledWith(
        mockEnv.VIDEO_TRANSFORMATIONS_CACHE,
        sourcePath,
        mockOptions
      );
    });

    it('should return null when getTransformedVideo throws an error', async () => {
      // Mock error in KV fetch
      vi.mocked(kvStorageService.getTransformedVideo).mockRejectedValue(
        new Error('KV error')
      );
      
      const result = await getFromKVCache(mockEnv, sourcePath, mockOptions);
      
      expect(result).toBeNull();
    });

    it('should bypass KV cache when debug is enabled', async () => {
      // Mock debug enabled in request context
      vi.mock('../../src/utils/legacyLoggerAdapter', () => ({
        getCurrentContext: vi.fn(() => ({
          requestId: 'test-request-id',
          url: 'https://example.com/videos/test.mp4',
          startTime: Date.now(),
          debugEnabled: true
        }))
      }), { virtual: true });
      
      const result = await getFromKVCache(mockEnv, sourcePath, mockOptions);
      
      expect(result).toBeNull();
      expect(kvStorageService.getTransformedVideo).not.toHaveBeenCalled();
    });

    it('should bypass KV cache when URL has bypass parameters', async () => {
      // Mock URL with bypass parameter
      vi.mock('../../src/utils/legacyLoggerAdapter', () => ({
        getCurrentContext: vi.fn(() => ({
          requestId: 'test-request-id',
          url: 'https://example.com/videos/test.mp4?no-kv-cache=true',
          startTime: Date.now(),
          debugEnabled: false
        }))
      }), { virtual: true });
      
      const result = await getFromKVCache(mockEnv, sourcePath, mockOptions);
      
      expect(result).toBeNull();
      expect(kvStorageService.getTransformedVideo).not.toHaveBeenCalled();
    });
  });

  describe('storeInKVCache', () => {
    it('should return false when KV caching is disabled', async () => {
      // Mock cache config with KV caching disabled
      vi.mocked(configModule.getCacheConfig).mockReturnValue({
        enableKVCache: false,
        ttl: {
          ok: 86400,
          redirects: 3600,
          clientError: 60,
          serverError: 10
        }
      });
      
      const response = new Response('video data');
      const result = await storeInKVCache(mockEnv, sourcePath, response, mockOptions);
      
      expect(result).toBe(false);
      expect(kvStorageService.storeTransformedVideo).not.toHaveBeenCalled();
    });

    it('should return false when KV namespace is not available', async () => {
      const envWithoutKV = {
        VIDEO_TRANSFORMATIONS_CACHE: null,
        VIDEO_TRANSFORMS_KV: null
      };
      
      const response = new Response('video data');
      const result = await storeInKVCache(envWithoutKV, sourcePath, response, mockOptions);
      
      expect(result).toBe(false);
      expect(kvStorageService.storeTransformedVideo).not.toHaveBeenCalled();
    });

    it('should store response in KV cache with success response', async () => {
      const response = new Response('video data', {
        status: 200,
        headers: {
          'Content-Type': 'video/mp4',
          'Content-Length': '10'
        }
      });
      
      // Mock successful KV storage
      vi.mocked(kvStorageService.storeTransformedVideo).mockResolvedValue(true);
      
      const result = await storeInKVCache(mockEnv, sourcePath, response, mockOptions);
      
      expect(result).toBe(true);
      expect(kvStorageService.storeTransformedVideo).toHaveBeenCalledWith(
        mockEnv.VIDEO_TRANSFORMATIONS_CACHE,
        sourcePath,
        expect.any(Response),
        mockOptions,
        86400 // 24 hours for OK responses
      );
    });

    it('should set different TTLs based on response status', async () => {
      // Test for redirect response
      const redirectResponse = new Response('', {
        status: 302,
        headers: { 'Location': 'https://example.com/redirected' }
      });
      
      vi.mocked(kvStorageService.storeTransformedVideo).mockResolvedValue(true);
      
      await storeInKVCache(mockEnv, sourcePath, redirectResponse, mockOptions);
      
      expect(kvStorageService.storeTransformedVideo).toHaveBeenCalledWith(
        mockEnv.VIDEO_TRANSFORMATIONS_CACHE,
        sourcePath,
        expect.any(Response),
        mockOptions,
        3600 // 1 hour for redirects
      );
      
      // Test for client error response
      const clientErrorResponse = new Response('Not Found', { status: 404 });
      
      await storeInKVCache(mockEnv, sourcePath, clientErrorResponse, mockOptions);
      
      expect(kvStorageService.storeTransformedVideo).toHaveBeenCalledWith(
        mockEnv.VIDEO_TRANSFORMATIONS_CACHE,
        sourcePath,
        expect.any(Response),
        mockOptions,
        60 // 1 minute for client errors
      );
      
      // Test for server error response
      const serverErrorResponse = new Response('Server Error', { status: 500 });
      
      await storeInKVCache(mockEnv, sourcePath, serverErrorResponse, mockOptions);
      
      expect(kvStorageService.storeTransformedVideo).toHaveBeenCalledWith(
        mockEnv.VIDEO_TRANSFORMATIONS_CACHE,
        sourcePath,
        expect.any(Response),
        mockOptions,
        10 // 10 seconds for server errors
      );
    });

    it('should handle errors when storing in KV', async () => {
      const response = new Response('video data');
      
      // Mock error in KV storage
      vi.mocked(kvStorageService.storeTransformedVideo).mockRejectedValue(
        new Error('KV storage error')
      );
      
      const result = await storeInKVCache(mockEnv, sourcePath, response, mockOptions);
      
      expect(result).toBe(false);
    });
  });
});
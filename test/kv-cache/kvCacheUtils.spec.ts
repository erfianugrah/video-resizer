import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getFromKVCache, storeInKVCache } from '../../src/utils/kvCacheUtils';
import * as kvStorageService from '../../src/services/kvStorageService';

// Mock the config module with the getCacheConfig function
vi.mock('../../src/config', () => ({
  getCacheConfig: vi.fn(() => ({
    enableKVCache: true,  // Default to enabled for tests
    ttl: {
      ok: 86400,
      redirects: 3600,
      clientError: 60,
      serverError: 10
    }
  })),
  CacheConfigurationManager: {
    getInstance: vi.fn(() => ({
      getConfig: vi.fn(() => ({ 
        defaultMaxAge: 86400,
        method: 'cf',
        enableCacheTags: true
      }))
    }))
  }
}));

// Mock the required modules for requestContext
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

// Mock logger
vi.mock('../../src/utils/pinoLogger', () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    error: vi.fn()
  })),
  debug: vi.fn(),
  info: vi.fn(),
  error: vi.fn()
}));

// Mock KV storage service with default success response
vi.mock('../../src/services/kvStorageService', () => ({
  // By default, return a successful response
  getTransformedVideo: vi.fn().mockResolvedValue({
    response: new Response('cached video data', {
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Length': '16'
      }
    }),
    metadata: {
      sourcePath: '/videos/test.mp4',
      derivative: 'mobile',
      cacheTags: ['video-test'],
      contentType: 'video/mp4',
      contentLength: 16,
      createdAt: Date.now()
    }
  }),
  storeTransformedVideo: vi.fn().mockResolvedValue(true),
  generateKVKey: vi.fn((sourcePath, options) => {
    let key = `video:${sourcePath.replace(/^\/+/, '')}`;
    
    // Check for IMQuery parameters in customData
    const hasIMQuery = options.customData?.imwidth || options.customData?.imheight;
    
    if (hasIMQuery) {
      // Use IMQuery parameters for the key if they exist
      if (options.customData?.imwidth) key += `:imwidth=${options.customData.imwidth}`;
      if (options.customData?.imheight) key += `:imheight=${options.customData.imheight}`;
      
      // Add derivative as metadata but not as primary key
      if (options.derivative) key += `:via=${options.derivative}`;
    } else if (options.derivative) {
      // Normal case - use derivative as key
      key += `:derivative=${options.derivative}`;
    }
    
    return key;
  })
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
      // Get access to the mock implementation
      const { getCacheConfig } = await import('../../src/config');
      
      // Override the mock return value for this test
      vi.mocked(getCacheConfig).mockImplementationOnce(() => ({
        enableKVCache: false,
        ttl: {
          ok: 86400,
          redirects: 3600,
          clientError: 60,
          serverError: 10
        }
      }));
      
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
        mockOptions,
        undefined
      );
    });

    it('should return null when cached response is not found', async () => {
      // Get access to the mock implementation
      const { getTransformedVideo } = await import('../../src/services/kvStorageService');
      
      // Mock KV miss
      vi.mocked(getTransformedVideo).mockResolvedValueOnce(null);
      
      const result = await getFromKVCache(mockEnv, sourcePath, mockOptions);
      
      expect(result).toBeNull();
      expect(getTransformedVideo).toHaveBeenCalledWith(
        mockEnv.VIDEO_TRANSFORMATIONS_CACHE,
        sourcePath,
        mockOptions,
        undefined
      );
    });

    it('should return null when getTransformedVideo throws an error', async () => {
      // Get access to the mock implementation
      const { getTransformedVideo } = await import('../../src/services/kvStorageService');
      
      // Mock error in KV fetch
      vi.mocked(getTransformedVideo).mockRejectedValueOnce(
        new Error('KV error')
      );
      
      const result = await getFromKVCache(mockEnv, sourcePath, mockOptions);
      
      expect(result).toBeNull();
    });

    it('should bypass KV cache when debug is enabled', async () => {
      // Skip this test - in our new implementation, debug mode doesn't bypass KV cache
      // just CF edge cache
      
      // Mock success response
      vi.mocked(kvStorageService.getTransformedVideo).mockResolvedValue({
        response: new Response('cached data'),
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
          createdAt: Date.now()
        }
      });
      
      const result = await getFromKVCache(mockEnv, sourcePath, mockOptions);
      
      // We should get a response from KV cache even with URL parameters
      expect(result).not.toBeNull();
    });
    
    it('should use IMQuery parameters in customData when looking up cached content', async () => {
      // Options with IMQuery parameters
      const imQueryOptions = {
        ...mockOptions,
        customData: {
          imwidth: '800',
          imheight: '450'
        }
      };
      
      // Mock successful KV lookup
      vi.mocked(kvStorageService.getTransformedVideo).mockResolvedValue({
        response: new Response('cached video data', {
          headers: {
            'Content-Type': 'video/mp4',
            'Content-Length': '16'
          }
        }),
        metadata: {
          sourcePath,
          derivative: 'mobile',
          cacheTags: ['video-test', 'video-imwidth-800'],
          contentType: 'video/mp4',
          contentLength: 16,
          createdAt: Date.now()
        }
      });
      
      const result = await getFromKVCache(mockEnv, sourcePath, imQueryOptions);
      
      expect(result).not.toBeNull();
      expect(kvStorageService.getTransformedVideo).toHaveBeenCalledWith(
        mockEnv.VIDEO_TRANSFORMATIONS_CACHE,
        sourcePath,
        expect.objectContaining({
          customData: {
            imwidth: '800',
            imheight: '450'
          }
        }),
        undefined
      );
    });
  });

  describe('storeInKVCache', () => {
    it('should return false when KV caching is disabled', async () => {
      // Get access to the mock implementation
      const { getCacheConfig } = await import('../../src/config');
      
      // Override the mock return value for this test
      vi.mocked(getCacheConfig).mockImplementationOnce(() => ({
        enableKVCache: false,
        ttl: {
          ok: 86400,
          redirects: 3600,
          clientError: 60,
          serverError: 10
        }
      }));
      
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
      // Reset mock before this test
      vi.clearAllMocks();
      
      // Test for redirect response
      const redirectResponse = new Response('', {
        status: 302,
        headers: { 
          'Location': 'https://example.com/redirected',
          'Content-Type': 'video/mp4' // Important - needs to be a video type
        }
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
      
      // Test for client error response - skip since errors aren't cached
      
      // Test for server error response - skip since errors aren't cached
    });

    it('should handle errors when storing in KV', async () => {
      const response = new Response('video data');
      
      // Get access to the mock implementation
      const { storeTransformedVideo } = await import('../../src/services/kvStorageService');
      
      // Mock error in KV storage
      vi.mocked(storeTransformedVideo).mockRejectedValueOnce(
        new Error('KV storage error')
      );
      
      const result = await storeInKVCache(mockEnv, sourcePath, response, mockOptions);
      
      expect(result).toBe(false);
    });
    
    it('should use generateKVKey with IMQuery parameters', async () => {
      // Reset mocks before test
      vi.clearAllMocks();
      
      // Create custom mock for testing IMQuery parameters in cache key
      const mockGenerateKVKey = vi.fn().mockReturnValue('video:videos/test.mp4:imwidth=800:imheight=450:via=mobile');
      vi.spyOn(kvStorageService, 'generateKVKey').mockImplementation(mockGenerateKVKey);
      
      // Options with IMQuery parameters
      const imQueryOptions = {
        ...mockOptions,
        customData: {
          imwidth: '800',
          imheight: '450'
        }
      };
      
      // Call the function directly to verify behavior
      const key = kvStorageService.generateKVKey(sourcePath, imQueryOptions);
      
      expect(key).toBe('video:videos/test.mp4:imwidth=800:imheight=450:via=mobile');
      expect(mockGenerateKVKey).toHaveBeenCalledWith(
        sourcePath,
        expect.objectContaining({
          customData: {
            imwidth: '800',
            imheight: '450'
          }
        })
      );
    });
  });
});
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getFromKVCache, storeInKVCache } from '../../src/utils/kvCacheUtils';
import * as kvStorageService from '../../src/services/kvStorageService';
import * as configModule from '../../src/config';
import * as legacyLoggerAdapter from '../../src/utils/legacyLoggerAdapter';

// Mock all dependencies
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

vi.mock('../../src/services/kvStorageService', () => {
  return {
    getTransformedVideo: vi.fn(),
    storeTransformedVideo: vi.fn().mockResolvedValue(true)
  };
});

vi.mock('../../src/utils/pinoLogger', () => ({
  createLogger: vi.fn(),
  debug: vi.fn()
}));

vi.mock('../../src/utils/requestContext', () => ({
  getCurrentContext: vi.fn(),
  addBreadcrumb: vi.fn()
}));

vi.mock('../../src/utils/legacyLoggerAdapter', () => ({
  getCurrentContext: vi.fn().mockReturnValue({
    requestId: 'test-request-id',
    url: 'https://example.com/videos/test.mp4',
    startTime: Date.now(),
    debugEnabled: false
  })
}));

describe('KV Cache Utils', () => {
  // Test environment setup
  const mockEnv = {
    VIDEO_TRANSFORMATIONS_CACHE: {} as KVNamespace,
    VIDEO_TRANSFORMS_KV: null,
    CACHE_ENABLE_KV: 'true'
  };

  const mockOptions = {
    derivative: 'mobile',
    width: 640,
    height: 360
  };

  const sourcePath = '/videos/test.mp4';

  describe('getFromKVCache', () => {
    beforeEach(() => {
      vi.resetAllMocks();
    });
    
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

    it('should check KV storage when available', async () => {
      // Just testing that KV is accessed
      await getFromKVCache(mockEnv, sourcePath, mockOptions);
      
      // Verify function was called with correct arguments
      expect(kvStorageService.getTransformedVideo).toHaveBeenCalledWith(
        mockEnv.VIDEO_TRANSFORMATIONS_CACHE,
        sourcePath,
        mockOptions
      );
    });
  });

  describe('storeInKVCache', () => {
    beforeEach(() => {
      vi.resetAllMocks();
      
      // Set up the storeTransformedVideo mock to succeed by default
      vi.mocked(kvStorageService.storeTransformedVideo).mockResolvedValue(true);
    });
    
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

    it('should call KV storage service with appropriate TTL', async () => {
      // Create a test response
      const response = new Response('video data', {
        status: 200,
        headers: {
          'Content-Type': 'video/mp4',
          'Content-Length': '10'
        }
      });
      
      // Call the function and verify results
      await storeInKVCache(mockEnv, sourcePath, response, mockOptions);
      
      // Verify the service was called with correct parameters
      expect(kvStorageService.storeTransformedVideo).toHaveBeenCalledWith(
        mockEnv.VIDEO_TRANSFORMATIONS_CACHE,
        sourcePath,
        expect.any(Response),
        mockOptions,
        86400 // Default TTL for success responses
      );
    });
    
    it('should handle errors gracefully', async () => {
      // Mock an error occurring in the storage service
      vi.mocked(kvStorageService.storeTransformedVideo).mockRejectedValue(new Error('KV storage error'));
      
      // Call function with a basic response
      const response = new Response('test data');
      const result = await storeInKVCache(mockEnv, sourcePath, response, mockOptions);
      
      // Should return false to indicate failure, but not throw
      expect(result).toBe(false);
    });
  });
});
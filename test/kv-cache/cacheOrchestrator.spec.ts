import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { withCaching } from '../../src/utils/cacheOrchestrator';
import * as cacheManagementService from '../../src/services/cacheManagementService';
import * as kvCacheUtils from '../../src/utils/kvCacheUtils';
import '../kv-cache/setup';

// Mock the cache management service
vi.mock('../../src/services/cacheManagementService', () => ({
  getCachedResponse: vi.fn()
}));

// Mock the KV cache utils
vi.mock('../../src/utils/kvCacheUtils', () => ({
  getFromKVCache: vi.fn(),
  storeInKVCache: vi.fn().mockResolvedValue(true)
}));

describe('Cache Orchestrator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockRequest = new Request('https://example.com/videos/test.mp4');
  const mockEnv = {
    VIDEO_TRANSFORMATIONS_CACHE: {
      get: vi.fn(),
      put: vi.fn(),
      getWithMetadata: vi.fn(),
      list: vi.fn()
    }
  };
  const mockOptions = {
    derivative: 'mobile',
    width: 640,
    height: 360
  };

  // Mock handler that returns a success response
  const mockHandler = vi.fn().mockResolvedValue(
    new Response('test video data', {
      status: 200,
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Length': '14'
      }
    })
  );

  // Mock waitUntil for Cloudflare Worker execution context
  const mockWaitUntil = vi.fn();
  const mockEnvWithCtx = {
    ...mockEnv,
    executionCtx: {
      waitUntil: mockWaitUntil
    }
  };

  describe('Cache flow', () => {
    it('should return response from Cloudflare Cache API when available', async () => {
      // Mock cache hit
      const cachedResponse = new Response('cached video data', {
        headers: {
          'Content-Type': 'video/mp4',
          'Content-Length': '16',
          'X-Cache': 'HIT'
        }
      });
      
      vi.mocked(cacheManagementService.getCachedResponse).mockResolvedValue(cachedResponse);
      
      const response = await withCaching(mockRequest, mockEnv, mockHandler, mockOptions);
      
      // Verify cache API was checked
      expect(cacheManagementService.getCachedResponse).toHaveBeenCalledWith(mockRequest);
      
      // Verify KV cache was not checked
      expect(kvCacheUtils.getFromKVCache).not.toHaveBeenCalled();
      
      // Verify handler was not called
      expect(mockHandler).not.toHaveBeenCalled();
      
      // Verify we got the cached response
      expect(response).toBe(cachedResponse);
      expect(await response.text()).toBe('cached video data');
    });

    it('should check KV cache when Cloudflare Cache API misses', async () => {
      // Mock Cache API miss
      vi.mocked(cacheManagementService.getCachedResponse).mockResolvedValue(null);
      
      // Mock KV cache hit
      const kvResponse = new Response('kv cached video data', {
        headers: {
          'Content-Type': 'video/mp4',
          'Content-Length': '18',
          'X-Cache': 'KV-HIT'
        }
      });
      
      vi.mocked(kvCacheUtils.getFromKVCache).mockResolvedValue(kvResponse);
      
      const response = await withCaching(mockRequest, mockEnv, mockHandler, mockOptions);
      
      // Verify cache API was checked
      expect(cacheManagementService.getCachedResponse).toHaveBeenCalledWith(mockRequest);
      
      // Verify KV cache was checked
      expect(kvCacheUtils.getFromKVCache).toHaveBeenCalledWith(
        mockEnv,
        '/videos/test.mp4',
        mockOptions
      );
      
      // Verify handler was not called
      expect(mockHandler).not.toHaveBeenCalled();
      
      // Verify we got the KV cached response
      expect(response).toBe(kvResponse);
      expect(await response.text()).toBe('kv cached video data');
    });

    it('should call handler when both caches miss', async () => {
      // Mock Cache API miss
      vi.mocked(cacheManagementService.getCachedResponse).mockResolvedValue(null);
      
      // Mock KV cache miss
      vi.mocked(kvCacheUtils.getFromKVCache).mockResolvedValue(null);
      
      const response = await withCaching(mockRequest, mockEnv, mockHandler, mockOptions);
      
      // Verify cache API was checked
      expect(cacheManagementService.getCachedResponse).toHaveBeenCalledWith(mockRequest);
      
      // Verify KV cache was checked
      expect(kvCacheUtils.getFromKVCache).toHaveBeenCalledWith(
        mockEnv,
        '/videos/test.mp4',
        mockOptions
      );
      
      // Verify handler was called
      expect(mockHandler).toHaveBeenCalled();
      
      // Verify we got the handler response
      expect(await response.text()).toBe('test video data');
    });

    it('should store response in KV cache when handler succeeds', async () => {
      // Mock Cache API miss
      vi.mocked(cacheManagementService.getCachedResponse).mockResolvedValue(null);
      
      // Mock KV cache miss
      vi.mocked(kvCacheUtils.getFromKVCache).mockResolvedValue(null);
      
      await withCaching(mockRequest, mockEnvWithCtx, mockHandler, mockOptions);
      
      // Verify response was stored in KV cache using waitUntil
      expect(mockWaitUntil).toHaveBeenCalled();
      
      // Extract the function passed to waitUntil and verify it calls storeInKVCache
      const waitUntilFn = mockWaitUntil.mock.calls[0][0];
      expect(waitUntilFn).toBeDefined();
      
      // Call the function to verify it calls storeInKVCache
      await waitUntilFn;
      
      // Verify storeInKVCache was called with the right parameters
      expect(kvCacheUtils.storeInKVCache).toHaveBeenCalledWith(
        mockEnvWithCtx,
        '/videos/test.mp4',
        expect.any(Response),
        mockOptions
      );
    });
  });

  describe('Cache bypass scenarios', () => {
    it('should bypass cache for non-GET requests', async () => {
      const postRequest = new Request('https://example.com/videos/test.mp4', {
        method: 'POST'
      });
      
      await withCaching(postRequest, mockEnv, mockHandler, mockOptions);
      
      // Verify caches were not checked
      expect(cacheManagementService.getCachedResponse).not.toHaveBeenCalled();
      expect(kvCacheUtils.getFromKVCache).not.toHaveBeenCalled();
      
      // Verify handler was called directly
      expect(mockHandler).toHaveBeenCalled();
    });

    it('should bypass cache when debug parameter is present', async () => {
      const debugRequest = new Request('https://example.com/videos/test.mp4?debug=true');
      
      await withCaching(debugRequest, mockEnv, mockHandler, mockOptions);
      
      // Verify caches were not checked
      expect(cacheManagementService.getCachedResponse).not.toHaveBeenCalled();
      expect(kvCacheUtils.getFromKVCache).not.toHaveBeenCalled();
      
      // Verify handler was called directly
      expect(mockHandler).toHaveBeenCalled();
    });
  });

  describe('Error handling', () => {
    it('should fallback to handler when Cache API throws an error', async () => {
      // Mock Cache API error
      vi.mocked(cacheManagementService.getCachedResponse).mockRejectedValue(
        new Error('Cache API error')
      );
      
      await withCaching(mockRequest, mockEnv, mockHandler, mockOptions);
      
      // Verify handler was called as fallback
      expect(mockHandler).toHaveBeenCalled();
    });

    it('should fallback to handler when KV cache throws an error', async () => {
      // Mock Cache API miss
      vi.mocked(cacheManagementService.getCachedResponse).mockResolvedValue(null);
      
      // Mock KV cache error
      vi.mocked(kvCacheUtils.getFromKVCache).mockRejectedValue(
        new Error('KV cache error')
      );
      
      await withCaching(mockRequest, mockEnv, mockHandler, mockOptions);
      
      // Verify handler was called as fallback
      expect(mockHandler).toHaveBeenCalled();
    });

    it('should return response even if KV storage fails', async () => {
      // Mock Cache API miss
      vi.mocked(cacheManagementService.getCachedResponse).mockResolvedValue(null);
      
      // Mock KV cache miss
      vi.mocked(kvCacheUtils.getFromKVCache).mockResolvedValue(null);
      
      // Mock KV storage failure
      vi.mocked(kvCacheUtils.storeInKVCache).mockRejectedValue(
        new Error('KV storage error')
      );
      
      const response = await withCaching(mockRequest, mockEnvWithCtx, mockHandler, mockOptions);
      
      // Verify we still got a valid response despite KV storage failure
      expect(response).toBeDefined();
      expect(await response.text()).toBe('test video data');
    });
  });
});
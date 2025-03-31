import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { withCaching } from '../../src/utils/cacheOrchestrator';
import * as cacheManagementService from '../../src/services/cacheManagementService';
import * as kvCacheUtils from '../../src/utils/kvCacheUtils';

// Mock the logger utils
vi.mock('../../src/utils/pinoLogger', () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
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

// Mock the cache management service
vi.mock('../../src/services/cacheManagementService', () => ({
  getCachedResponse: vi.fn()
}));

// Mock the KV cache utils
vi.mock('../../src/utils/kvCacheUtils', () => ({
  getFromKVCache: vi.fn(),
  storeInKVCache: vi.fn().mockResolvedValue(true)
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

// Skipping these tests as they're duplicated in test/kv-cache/cacheOrchestrator.spec.ts
// which already thoroughly tests this functionality
describe.skip('Cache Orchestrator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    // Reset all mocks to their default implementations
    vi.mocked(cacheManagementService.getCachedResponse).mockResolvedValue(null);
    vi.mocked(kvCacheUtils.getFromKVCache).mockResolvedValue(null);
    vi.mocked(kvCacheUtils.storeInKVCache).mockResolvedValue(true);
  });

  const mockRequest = new Request('https://example.com/videos/test.mp4');
  const mockEnv = {
    VIDEO_TRANSFORMATIONS_CACHE: {
      get: vi.fn(),
      put: vi.fn(),
      getWithMetadata: vi.fn(),
      list: vi.fn()
    },
    CACHE_ENABLE_KV: "true"
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
  const mockWaitUntil = vi.fn((promise) => promise);
  const mockEnvWithCtx = {
    ...mockEnv,
    executionCtx: {
      waitUntil: mockWaitUntil
    },
    CACHE_ENABLE_KV: "true"
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
      // Reset store mock to track calls
      const storeMock = vi.fn().mockResolvedValue(true);
      vi.mocked(kvCacheUtils.storeInKVCache).mockImplementation(storeMock);
      
      // Execute handler and store in cache
      const response = await withCaching(mockRequest, mockEnv, mockHandler, mockOptions);
      
      // Verify we got a response with 200 status
      expect(response).toBeDefined();
      expect(response.status).toBe(200);
      
      // Allow time for async operations
      await new Promise(process.nextTick);
      
      // Verify the mock was called
      expect(storeMock).toHaveBeenCalled();
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
      // Reset and mock KV storage failure
      const storeMock = vi.fn().mockImplementation(() => {
        throw new Error('KV storage error');
      });
      vi.mocked(kvCacheUtils.storeInKVCache).mockImplementation(storeMock);
      
      // Call withCaching with our mocked environment
      const response = await withCaching(mockRequest, mockEnv, mockHandler, mockOptions);
      
      // Allow time for async operations
      await new Promise(process.nextTick);
      
      // Verify we still got a valid response despite KV storage failure
      expect(response).toBeDefined();
      expect(response.status).toBe(200);
      
      // Verify the mock was called
      expect(storeMock).toHaveBeenCalled();
    });
  });
});
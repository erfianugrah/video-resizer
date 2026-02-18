import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { withCaching } from '../../src/utils/cacheOrchestrator';
import * as cacheManagementService from '../../src/services/cacheManagementService';
import * as kvCacheUtils from '../../src/utils/kvCacheUtils';

// Mock the logger utils
vi.mock('../../src/utils/pinoLogger', () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  })),
  debug: vi.fn(),
}));

// Mock request context
vi.mock('../../src/utils/requestContext', () => ({
  getCurrentContext: vi.fn(() => ({
    requestId: 'test-request-id',
    url: 'https://example.com/videos/test.mp4',
    startTime: Date.now(),
    debugEnabled: false,
  })),
  addBreadcrumb: vi.fn(),
}));

// Mock the cache management service
vi.mock('../../src/services/cacheManagementService', () => ({
  getCachedResponse: vi.fn(),
}));

// Mock the KV cache utils
vi.mock('../../src/utils/kvCacheUtils', () => ({
  getFromKVCache: vi.fn(),
  storeInKVCache: vi.fn().mockResolvedValue(true),
}));

// Mock the CacheConfigurationManager (dynamically imported in withCaching)
vi.mock('../../src/config/CacheConfigurationManager', () => ({
  CacheConfigurationManager: {
    getInstance: vi.fn(() => ({
      shouldBypassCache: vi.fn((url: URL) => {
        return (
          url.searchParams.has('debug') ||
          url.searchParams.has('nocache') ||
          url.searchParams.has('bypass')
        );
      }),
      isKVCacheEnabled: vi.fn(() => true),
      getConfig: vi.fn(() => ({
        defaultMaxAge: 86400,
        method: 'kv',
        enableCacheTags: true,
        enableKVCache: true,
      })),
    })),
  },
}));

// Testing the KV-based cache implementation
// withCaching uses only KV cache (not CF Cache API).
describe('KV Cache Orchestrator', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Reset all mocks to their default implementations
    vi.mocked(kvCacheUtils.getFromKVCache).mockResolvedValue(null);
    vi.mocked(kvCacheUtils.storeInKVCache).mockResolvedValue(true);
  });

  const mockRequest = new Request('https://example.com/videos/test.mp4');
  const mockEnv: any = {
    VIDEO_TRANSFORMATIONS_CACHE: {
      get: vi.fn(),
      put: vi.fn(),
      getWithMetadata: vi.fn(),
      list: vi.fn(),
    },
    CACHE_ENABLE_KV: 'true',
  };
  const mockOptions = {
    derivative: 'mobile',
    width: 640,
    height: 360,
  };

  // Mock handler that returns a success response
  const mockHandler = vi.fn().mockResolvedValue(
    new Response('test video data', {
      status: 200,
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Length': '14',
      },
    })
  );

  it('should return the KV cache result on cache hit', async () => {
    // Mock KV cache hit
    const kvResponse = new Response('kv cached video data', {
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Length': '18',
        'X-Cache': 'KV-HIT',
      },
    });

    vi.mocked(kvCacheUtils.getFromKVCache).mockResolvedValue(kvResponse);

    const response = await withCaching(mockRequest, mockEnv, mockHandler, mockOptions);

    // Verify KV cache was checked (with request as 4th arg)
    expect(kvCacheUtils.getFromKVCache).toHaveBeenCalledWith(
      mockEnv,
      '/videos/test.mp4',
      expect.objectContaining({
        derivative: 'mobile',
        width: 640,
        height: 360,
      }),
      expect.any(Request)
    );

    // Verify handler was not called
    expect(mockHandler).not.toHaveBeenCalled();

    // getCachedResponse is no longer used by withCaching
    expect(cacheManagementService.getCachedResponse).not.toHaveBeenCalled();

    // Verify we got the KV response
    expect(await response.text()).toBe('kv cached video data');
    expect(response.headers.get('X-Cache')).toBe('KV-HIT');
  });

  it('should call handler when KV cache misses', async () => {
    // Mock KV cache miss
    vi.mocked(kvCacheUtils.getFromKVCache).mockResolvedValue(null);

    const response = await withCaching(mockRequest, mockEnv, mockHandler, mockOptions);

    // Verify KV cache was checked
    expect(kvCacheUtils.getFromKVCache).toHaveBeenCalled();

    // getCachedResponse is no longer used by withCaching
    expect(cacheManagementService.getCachedResponse).not.toHaveBeenCalled();

    // Verify handler was called
    expect(mockHandler).toHaveBeenCalled();

    // Verify we got the handler response
    expect(await response.text()).toBe('test video data');
  });
});

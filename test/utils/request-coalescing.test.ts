import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { withCaching } from '../../src/utils/cacheOrchestrator';
import * as kvCacheUtils from '../../src/utils/kvCacheUtils';
import * as requestContext from '../../src/utils/requestContext';
import * as httpUtils from '../../src/utils/httpUtils';

// Mock environment
const mockEnv = {
  VIDEO_TRANSFORMATIONS_CACHE: {
    get: vi.fn(),
    put: vi.fn(),
    getWithMetadata: vi.fn()
  },
  CACHE_ENABLE_KV: 'true'
};

// Mock for getCurrentContext
vi.mock('../../src/utils/legacyLoggerAdapter', () => ({
  getCurrentContext: vi.fn().mockReturnValue({
    requestId: 'test-request-id',
    url: 'https://example.com/video.mp4',
    executionContext: {
      waitUntil: vi.fn((promise) => promise)
    }
  })
}));

// Mock for CacheConfigurationManager
vi.mock('../../src/config/CacheConfigurationManager', () => {
  const mockInstance = {
    isKVCacheEnabled: vi.fn().mockReturnValue(true),
    shouldBypassCache: vi.fn().mockReturnValue(false),
    getConfig: vi.fn().mockReturnValue({
      defaultMaxAge: 3600,
      ttl: { ok: 86400 }
    })
  };

  return {
    CacheConfigurationManager: {
      getInstance: vi.fn().mockReturnValue(mockInstance)
    }
  };
});

describe('Request Coalescing in Cache Orchestrator', () => {
  beforeEach(() => {
    // Clear all mocks before each test
    vi.clearAllMocks();

    // Mock getFromKVCache to always return cache miss (null)
    vi.spyOn(kvCacheUtils, 'getFromKVCache').mockResolvedValue(null);

    // Mock storeInKVCache to succeed
    vi.spyOn(kvCacheUtils, 'storeInKVCache').mockResolvedValue(true);

    // Mock addBreadcrumb
    vi.spyOn(requestContext, 'addBreadcrumb').mockImplementation(() => {});

    // Mock parseRangeHeader for range request tests
    vi.spyOn(httpUtils, 'parseRangeHeader').mockImplementation((rangeHeader, size) => {
      if (rangeHeader === 'bytes=0-499') {
        return { start: 0, end: 499 };
      }
      // Return null for invalid range headers
      return null;
    });

    // Mock dynamic imports
    vi.mock('../../src/utils/httpUtils', async () => {
      const actual = await vi.importActual('../../src/utils/httpUtils');
      return {
        ...actual,
        parseRangeHeader: vi.fn().mockImplementation((rangeHeader, size) => {
          if (rangeHeader === 'bytes=0-499') {
            return { start: 0, end: 499 };
          }
          return null;
        })
      };
    });
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('should coalesce multiple identical requests', async () => {
    // Mock a slow handler that completes after 200ms
    const mockHandler = vi.fn().mockImplementation(async () => {
      await new Promise(resolve => setTimeout(resolve, 200));
      return new Response('test video content', {
        status: 200,
        headers: {
          'Content-Type': 'video/mp4',
          'Content-Length': '17'
        }
      });
    });

    // Create test request
    const request = new Request('https://example.com/video.mp4');
    const options = { derivative: 'default', version: 1 };

    // Start three requests in parallel
    const [response1, response2, response3] = await Promise.all([
      withCaching(request, mockEnv, mockHandler, options),
      withCaching(request, mockEnv, mockHandler, options),
      withCaching(request, mockEnv, mockHandler, options)
    ]);

    // Verify that all responses are valid
    expect(response1.status).toBe(200);
    expect(response2.status).toBe(200);
    expect(response3.status).toBe(200);

    // Handler should only be called once despite 3 requests
    expect(mockHandler).toHaveBeenCalledTimes(1);
    
    // KV storage should only be attempted once
    expect(kvCacheUtils.storeInKVCache).toHaveBeenCalledTimes(1);
  });

  it('should correctly handle range requests during coalescing', async () => {
    // Mock a handler that returns video content
    const mockVideoContent = new Uint8Array(1000).fill(0xFF);
    const mockHandler = vi.fn().mockImplementation(async () => {
      return new Response(mockVideoContent, {
        status: 200,
        headers: {
          'Content-Type': 'video/mp4',
          'Content-Length': '1000'
        }
      });
    });

    // Create requests - one normal and one range request
    const normalRequest = new Request('https://example.com/video.mp4');
    
    const rangeRequest = new Request('https://example.com/video.mp4');
    rangeRequest.headers.set('Range', 'bytes=0-499');
    
    const options = { derivative: 'default', version: 1 };

    // Start both requests in parallel
    const [normalResponse, rangeResponse] = await Promise.all([
      withCaching(normalRequest, mockEnv, mockHandler, options),
      withCaching(rangeRequest, mockEnv, mockHandler, options)
    ]);

    // Verify normal response
    expect(normalResponse.status).toBe(200);
    expect(await normalResponse.arrayBuffer()).toHaveLength(1000);

    // Verify range response
    expect(rangeResponse.status).toBe(206);
    expect(rangeResponse.headers.get('Content-Range')).toBe('bytes 0-499/1000');
    expect(await rangeResponse.arrayBuffer()).toHaveLength(500);

    // Handler should only be called once
    expect(mockHandler).toHaveBeenCalledTimes(1);
  });

  it('should handle errors in the handler gracefully', async () => {
    // Mock a handler that throws an error
    const mockError = new Error('Test handler error');
    const mockHandler = vi.fn().mockImplementation(async () => {
      throw mockError;
    });

    // Create test request
    const request = new Request('https://example.com/video.mp4');
    const options = { derivative: 'default', version: 1 };

    // Expect the error to be properly handled and rethrown
    await expect(withCaching(request, mockEnv, mockHandler, options)).rejects.toThrow(mockError);

    // Handler should have been called once
    expect(mockHandler).toHaveBeenCalledTimes(1);
    
    // No KV storage attempts should be made when handler errors
    expect(kvCacheUtils.storeInKVCache).not.toHaveBeenCalled();
  });

  it('should coalesce requests with different parameters if they produce the same cache key', async () => {
    // Mock a handler that returns video content
    const mockHandler = vi.fn().mockImplementation(async () => {
      return new Response('test video content', {
        status: 200,
        headers: {
          'Content-Type': 'video/mp4',
          'Content-Length': '17'
        }
      });
    });

    // Create requests with slightly different but equivalent options
    const request1 = new Request('https://example.com/video.mp4');
    const request2 = new Request('https://example.com/video.mp4?timestamp=123');
    
    // These should map to the same cache key
    const options1 = { derivative: 'default', version: 1 };
    const options2 = { derivative: 'default', version: 1 };

    // Start both requests in parallel
    const [response1, response2] = await Promise.all([
      withCaching(request1, mockEnv, mockHandler, options1),
      withCaching(request2, mockEnv, mockHandler, options2)
    ]);

    // Verify that both responses are valid
    expect(response1.status).toBe(200);
    expect(response2.status).toBe(200);

    // Handler should only be called once despite 2 requests
    expect(mockHandler).toHaveBeenCalledTimes(1);
  });

  it('should not coalesce requests with different derivatives', async () => {
    // Mock a handler that returns video content
    const mockHandler = vi.fn().mockImplementation(async () => {
      return new Response('test video content', {
        status: 200,
        headers: {
          'Content-Type': 'video/mp4',
          'Content-Length': '17'
        }
      });
    });

    // Create same request but with different derivative options
    const request = new Request('https://example.com/video.mp4');
    
    // These should map to different cache keys
    const options1 = { derivative: 'low', version: 1 };
    const options2 = { derivative: 'high', version: 1 };

    // Start both requests in parallel
    await Promise.all([
      withCaching(request, mockEnv, mockHandler, options1),
      withCaching(request, mockEnv, mockHandler, options2)
    ]);

    // Handler should be called twice for different derivatives
    expect(mockHandler).toHaveBeenCalledTimes(2);
  });
});
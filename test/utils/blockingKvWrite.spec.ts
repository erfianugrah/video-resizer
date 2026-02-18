import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { withCaching } from '../../src/utils/cacheOrchestrator';
import * as kvCacheUtils from '../../src/utils/kvCacheUtils';

// Mock the logger utils
vi.mock('../../src/utils/pinoLogger', () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  })),
  debug: vi.fn(),
  error: vi.fn(),
}));

// Mock the category logger used by cacheOrchestrator
vi.mock('../../src/utils/logger', () => ({
  createCategoryLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    errorWithContext: vi.fn(),
  })),
  logDebug: vi.fn(),
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
  logErrorWithContext: vi.fn(),
}));

// Mock request context
vi.mock('../../src/utils/requestContext', () => ({
  getCurrentContext: vi.fn(() => ({
    requestId: 'test-request-id',
    url: 'https://example.com/videos/test.mp4',
    startTime: Date.now(),
    debugEnabled: false,
    breadcrumbs: [],
  })),
  addBreadcrumb: vi.fn(),
}));

// Mock the legacy logger adapter
vi.mock('../../src/utils/legacyLoggerAdapter', () => ({
  getCurrentContext: vi.fn(() => ({
    requestId: 'test-request-id',
    url: 'https://example.com/videos/test.mp4',
    startTime: Date.now(),
    debugEnabled: false,
    breadcrumbs: [],
  })),
}));

// Mock the KV cache utils
vi.mock('../../src/utils/kvCacheUtils', () => ({
  getFromKVCache: vi.fn(),
  storeInKVCache: vi.fn().mockResolvedValue(true),
}));

// Mock CacheConfigurationManager (dynamically imported by withCaching)
vi.mock('../../src/config/CacheConfigurationManager', () => ({
  CacheConfigurationManager: {
    getInstance: vi.fn(() => ({
      shouldBypassCache: vi.fn(() => false),
      isKVCacheEnabled: vi.fn(() => true),
      getConfig: vi.fn(() => ({ storeIndefinitely: false })),
    })),
  },
}));

// Mock streamUtils for range request processing
vi.mock('../../src/utils/streamUtils', () => ({
  processRangeRequest: vi.fn(async (response, start, end, totalSize, options) => {
    const headers = new Headers(response.headers);
    headers.set('Content-Range', `bytes ${start}-${end}/${totalSize}`);
    headers.set('Content-Length', String(end - start + 1));
    headers.set('Accept-Ranges', 'bytes');
    return new Response(new ArrayBuffer(end - start + 1), {
      status: 206,
      statusText: 'Partial Content',
      headers,
    });
  }),
  withTimeout: vi.fn((promise) => promise),
}));

// Mock httpUtils for range header parsing
vi.mock('../../src/utils/httpUtils', () => ({
  parseRangeHeader: vi.fn((rangeHeader: string, size: number) => {
    const match = rangeHeader.match(/bytes=(\d+)-(\d+)/);
    if (match) {
      return { start: parseInt(match[1]), end: parseInt(match[2]) };
    }
    return null;
  }),
}));

// Mock errorHandlingUtils
vi.mock('../../src/utils/errorHandlingUtils', () => ({
  logErrorWithContext: vi.fn(),
}));

// Mock bypassHeadersUtils
vi.mock('../../src/utils/bypassHeadersUtils', () => ({
  setBypassHeaders: vi.fn(),
}));

describe('Blocking KV Write and Request Coalescing Fixes', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Reset all mocks to their default implementations
    vi.mocked(kvCacheUtils.getFromKVCache).mockResolvedValue(null);
    vi.mocked(kvCacheUtils.storeInKVCache).mockResolvedValue(true);
  });

  const createMockRequest = (url: string, rangeHeader?: string): Request => {
    const headers = new Headers();
    if (rangeHeader) {
      headers.set('Range', rangeHeader);
    }
    return new Request(url, { headers });
  };

  const mockEnv = {
    VIDEO_TRANSFORMATIONS_CACHE: {
      get: vi.fn(),
      put: vi.fn(),
      getWithMetadata: vi.fn(),
      list: vi.fn(),
      delete: vi.fn(),
      deleteBulk: vi.fn(),
    },
    CACHE_ENABLE_KV: 'true',
    executionCtx: {
      waitUntil: vi.fn((promise: Promise<unknown>) => promise),
    },
  } as any;

  const mockOptions = {
    derivative: 'mobile',
    width: 640,
    height: 360,
  };

  describe('Range request handling and blocking KV write fix', () => {
    it('should store full video in KV even when range request is received', async () => {
      // Create a request with a Range header
      const rangeRequest = createMockRequest('https://example.com/videos/test.mp4', 'bytes=0-999');

      // Mock KV cache miss
      vi.mocked(kvCacheUtils.getFromKVCache).mockResolvedValue(null);

      // Mock a video response (full content)
      const mockVideoResponse = new Response(new ArrayBuffer(10000), {
        status: 200,
        headers: {
          'Content-Type': 'video/mp4',
          'Content-Length': '10000',
          'Accept-Ranges': 'bytes',
        },
      });

      // Mock handler that would normally generate the full response
      const mockHandler = vi.fn().mockResolvedValue(mockVideoResponse);

      // Set up a spy on the storeInKVCache function
      const storeSpy = vi.mocked(kvCacheUtils.storeInKVCache);

      // Call withCaching with our range request
      const response = await withCaching(rangeRequest, mockEnv, mockHandler, mockOptions);

      // Verify the storage was called with the FULL response (not partial)
      // We expect the status to be 200 (full content) not 206 (partial)
      expect(storeSpy).toHaveBeenCalled();
      const storedResponse = storeSpy.mock.calls[0][2]; // Third argument is the response
      expect(storedResponse.status).toBe(200);

      // Verify the response to the client is properly ranged (206)
      expect(response.status).toBe(206);
      expect(response.headers.get('Content-Range')).toContain('bytes 0-999');
    });
  });

  describe('Core fixes for KV storage and request handling', () => {
    it('should properly store full content in KV even for range requests', async () => {
      // Mock handler to return full content response
      const mockHandler = vi.fn().mockResolvedValue(
        new Response(new ArrayBuffer(10000), {
          status: 200,
          headers: {
            'Content-Type': 'video/mp4',
            'Content-Length': '10000',
            'Accept-Ranges': 'bytes',
          },
        })
      );

      // Mock KV cache miss
      vi.mocked(kvCacheUtils.getFromKVCache).mockResolvedValue(null);

      // Create a range request
      const rangeRequest = createMockRequest('https://example.com/videos/test.mp4', 'bytes=0-999');

      // Process the request
      const response = await withCaching(rangeRequest, mockEnv, mockHandler, mockOptions);

      // Verify the response is properly ranged for the client
      expect(response.status).toBe(206); // Partial Content
      expect(response.headers.get('Content-Range')).toContain('bytes 0-999');
      expect(parseInt(response.headers.get('Content-Length') || '0', 10)).toBe(1000);

      // Verify the handler was called since it was a cache miss
      expect(mockHandler).toHaveBeenCalledTimes(1);

      // Verify that KV storage was called with the full response (not partial)
      expect(kvCacheUtils.storeInKVCache).toHaveBeenCalledTimes(1);

      // Check that what was stored had the full content length
      const storedResponse = vi.mocked(kvCacheUtils.storeInKVCache).mock.calls[0][2];
      expect(storedResponse.status).toBe(200); // Should be 200 (full content), not 206
      expect(parseInt(storedResponse.headers.get('Content-Length') || '0', 10)).toBe(10000);
    });
  });
});

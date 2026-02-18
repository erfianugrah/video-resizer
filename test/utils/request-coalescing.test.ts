import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { withCaching } from '../../src/utils/cacheOrchestrator';
import * as kvCacheUtils from '../../src/utils/kvCacheUtils';

// Mock environment
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

// Mock pinoLogger
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

// Mock for getCurrentContext from legacyLoggerAdapter
vi.mock('../../src/utils/legacyLoggerAdapter', () => ({
  getCurrentContext: vi.fn().mockReturnValue({
    requestId: 'test-request-id',
    url: 'https://example.com/video.mp4',
    startTime: Date.now(),
    breadcrumbs: [],
    executionContext: {
      waitUntil: vi.fn((promise: Promise<unknown>) => promise),
    },
  }),
}));

// Mock requestContext
vi.mock('../../src/utils/requestContext', () => ({
  getCurrentContext: vi.fn(() => ({
    requestId: 'test-request-id',
    url: 'https://example.com/video.mp4',
    startTime: Date.now(),
    breadcrumbs: [],
  })),
  addBreadcrumb: vi.fn(),
}));

// Mock KV cache utils
vi.mock('../../src/utils/kvCacheUtils', () => ({
  getFromKVCache: vi.fn(),
  storeInKVCache: vi.fn().mockResolvedValue(true),
}));

// Mock for CacheConfigurationManager
vi.mock('../../src/config/CacheConfigurationManager', () => ({
  CacheConfigurationManager: {
    getInstance: vi.fn(() => ({
      isKVCacheEnabled: vi.fn().mockReturnValue(true),
      shouldBypassCache: vi.fn().mockReturnValue(false),
      getConfig: vi.fn().mockReturnValue({
        defaultMaxAge: 3600,
        ttl: { ok: 86400 },
      }),
    })),
  },
}));

// Mock streamUtils for range request processing
vi.mock('../../src/utils/streamUtils', () => ({
  processRangeRequest: vi.fn(
    async (response: Response, start: number, end: number, totalSize: number) => {
      // Read the original response body to simulate actual processing
      const originalBuffer = await response.clone().arrayBuffer();
      const sliced = originalBuffer.slice(start, end + 1);
      const headers = new Headers(response.headers);
      headers.set('Content-Range', `bytes ${start}-${end}/${totalSize}`);
      headers.set('Content-Length', String(end - start + 1));
      headers.set('Accept-Ranges', 'bytes');
      return new Response(sliced, {
        status: 206,
        statusText: 'Partial Content',
        headers,
      });
    }
  ),
  withTimeout: vi.fn((promise: Promise<unknown>) => promise),
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

describe('Request Coalescing in Cache Orchestrator', () => {
  beforeEach(() => {
    // Clear call history but keep mock implementations
    vi.clearAllMocks();

    // Reset KV mocks
    vi.mocked(kvCacheUtils.getFromKVCache).mockResolvedValue(null);
    vi.mocked(kvCacheUtils.storeInKVCache).mockResolvedValue(true);
  });

  it('should coalesce multiple identical requests', async () => {
    // Mock a slow handler that completes after 200ms
    const mockHandler = vi.fn().mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
      return new Response('test video content', {
        status: 200,
        headers: {
          'Content-Type': 'video/mp4',
          'Content-Length': '17',
        },
      });
    });

    // Create test request
    const request = new Request('https://example.com/video.mp4');
    const options = { derivative: 'default', version: 1 };

    // Start three requests in parallel
    const [response1, response2, response3] = await Promise.all([
      withCaching(request, mockEnv, mockHandler, options),
      withCaching(request, mockEnv, mockHandler, options),
      withCaching(request, mockEnv, mockHandler, options),
    ]);

    // Verify that all responses are valid
    expect(response1.status).toBe(200);
    expect(response2.status).toBe(200);
    expect(response3.status).toBe(200);

    // Handler should only be called once despite 3 requests
    expect(mockHandler).toHaveBeenCalledTimes(1);

    // KV storage should only be attempted once (only first request stores)
    expect(kvCacheUtils.storeInKVCache).toHaveBeenCalledTimes(1);
  });

  it('should correctly handle range requests during coalescing', async () => {
    // Mock a slow handler to ensure coalescing window
    const mockVideoContent = new Uint8Array(1000).fill(0xff);
    const mockHandler = vi.fn().mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
      return new Response(mockVideoContent.slice(), {
        status: 200,
        headers: {
          'Content-Type': 'video/mp4',
          'Content-Length': '1000',
        },
      });
    });

    // Create requests - one normal and one range request
    const normalRequest = new Request('https://example.com/video.mp4');

    const rangeHeaders = new Headers();
    rangeHeaders.set('Range', 'bytes=0-499');
    const rangeRequest = new Request('https://example.com/video.mp4', { headers: rangeHeaders });

    const options = { derivative: 'default', version: 1 };

    // Start both requests in parallel
    const [normalResponse, rangeResponse] = await Promise.all([
      withCaching(normalRequest, mockEnv, mockHandler, options),
      withCaching(rangeRequest, mockEnv, mockHandler, options),
    ]);

    // Verify normal response
    expect(normalResponse.status).toBe(200);
    const normalBuffer = await normalResponse.arrayBuffer();
    expect(normalBuffer.byteLength).toBe(1000);

    // Verify range response - should be 206 with partial content
    expect(rangeResponse.status).toBe(206);
    expect(rangeResponse.headers.get('Content-Range')).toBe('bytes 0-499/1000');
    const rangeBuffer = await rangeResponse.arrayBuffer();
    expect(rangeBuffer.byteLength).toBe(500);

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

    // The error propagates: withCaching catches the original error in the outer catch,
    // then tries the fallback handler() which also throws, so it re-throws the original.
    await expect(withCaching(request, mockEnv, mockHandler, options)).rejects.toThrow(mockError);

    // Handler is called once for the in-flight request, then once more as the fallback
    // in the catch block (line 1104 of cacheOrchestrator.ts)
    expect(mockHandler).toHaveBeenCalledTimes(2);

    // No KV storage attempts should be made when handler errors
    expect(kvCacheUtils.storeInKVCache).not.toHaveBeenCalled();
  });

  it('should coalesce requests with different parameters if they produce the same cache key', async () => {
    // Mock a slow handler to ensure coalescing window
    const mockHandler = vi.fn().mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
      return new Response('test video content', {
        status: 200,
        headers: {
          'Content-Type': 'video/mp4',
          'Content-Length': '17',
        },
      });
    });

    // Both URLs have the same pathname (/video.mp4) - query params don't affect cache key
    const request1 = new Request('https://example.com/video.mp4');
    const request2 = new Request('https://example.com/video.mp4?timestamp=123');

    // These should map to the same cache key
    const options1 = { derivative: 'default', version: 1 };
    const options2 = { derivative: 'default', version: 1 };

    // Start both requests in parallel
    const [response1, response2] = await Promise.all([
      withCaching(request1, mockEnv, mockHandler, options1),
      withCaching(request2, mockEnv, mockHandler, options2),
    ]);

    // Verify that both responses are valid
    expect(response1.status).toBe(200);
    expect(response2.status).toBe(200);

    // Handler should only be called once despite 2 requests (coalesced)
    expect(mockHandler).toHaveBeenCalledTimes(1);
  });

  it('should not coalesce requests with different derivatives', async () => {
    // Mock a handler that returns video content
    const mockHandler = vi.fn().mockImplementation(async () => {
      return new Response('test video content', {
        status: 200,
        headers: {
          'Content-Type': 'video/mp4',
          'Content-Length': '17',
        },
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
      withCaching(request, mockEnv, mockHandler, options2),
    ]);

    // Handler should be called twice for different derivatives
    expect(mockHandler).toHaveBeenCalledTimes(2);
  });
});

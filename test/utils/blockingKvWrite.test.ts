import { describe, it, expect, vi, beforeEach } from 'vitest';
import { withCaching } from '../../src/utils/cacheOrchestrator';
import * as kvCacheUtils from '../../src/utils/kvCacheUtils';

// Mock the required dependencies
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

vi.mock('../../src/utils/requestContext', () => ({
  getCurrentContext: vi.fn(() => ({
    requestId: 'test-request-id',
    url: 'https://example.com/test.mp4',
    startTime: Date.now(),
    breadcrumbs: [],
  })),
  addBreadcrumb: vi.fn(),
}));

// Create a simple mock for the KV storage
vi.mock('../../src/utils/kvCacheUtils', () => ({
  getFromKVCache: vi.fn(),
  storeInKVCache: vi.fn().mockResolvedValue(true),
}));

// Mock the config import for KV caching
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
  processRangeRequest: vi.fn(
    async (response: Response, start: number, end: number, totalSize: number) => {
      const headers = new Headers(response.headers);
      headers.set('Content-Range', `bytes ${start}-${end}/${totalSize}`);
      headers.set('Content-Length', String(end - start + 1));
      headers.set('Accept-Ranges', 'bytes');
      return new Response(new ArrayBuffer(end - start + 1), {
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

describe('Range Request Handling and KV Storage', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Reset the KV mocks
    vi.mocked(kvCacheUtils.getFromKVCache).mockResolvedValue(null);
    vi.mocked(kvCacheUtils.storeInKVCache).mockResolvedValue(true);
  });

  const createMockRequest = (rangeHeader?: string) => {
    const headers = new Headers();
    if (rangeHeader) {
      headers.set('Range', rangeHeader);
    }
    return new Request('https://example.com/videos/test.mp4', { headers });
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

  it('should store the full video in KV and return a partial response for range requests', async () => {
    // Create a test video buffer
    const videoBuffer = new ArrayBuffer(10000);

    // Mock a full video response
    const mockHandler = vi.fn().mockResolvedValue(
      new Response(videoBuffer, {
        status: 200,
        headers: {
          'Content-Type': 'video/mp4',
          'Content-Length': '10000',
          'Accept-Ranges': 'bytes',
        },
      })
    );

    // Create a request with a Range header
    const request = createMockRequest('bytes=0-999');

    // Call the function under test
    const response = await withCaching(request, mockEnv, mockHandler, { derivative: 'mobile' });

    // Verify handlers were called as expected
    expect(mockHandler).toHaveBeenCalled();
    expect(kvCacheUtils.storeInKVCache).toHaveBeenCalled();

    // Verify the response was properly transformed into a 206 Partial Response
    expect(response.status).toBe(206);
    expect(response.headers.get('Content-Range')).toContain('bytes 0-999');

    // Verify KV storage received the FULL response, not the partial one
    const storedResponse = vi.mocked(kvCacheUtils.storeInKVCache).mock.calls[0][2];
    expect(storedResponse.status).toBe(200); // Full content, not partial
    expect(storedResponse.headers.get('Content-Length')).toBe('10000');
  });
});

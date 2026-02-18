import { vi } from 'vitest';

// ── Module-level mocks (hoisted by vitest) ────────────────────────────

vi.mock('../../src/utils/requestContext', () => ({
  getCurrentContext: vi.fn(() => ({
    requestId: 'test-request-id',
    url: 'https://example.com/videos/test.mp4',
    startTime: Date.now(),
    debugEnabled: false,
  })),
  createRequestContext: vi.fn((req: any) => ({
    requestId: 'test-request-id',
    url: req.url,
    startTime: Date.now(),
    debugEnabled: false,
  })),
  addBreadcrumb: vi.fn(),
  setCurrentContext: vi.fn(),
  initRequestContext: vi.fn(),
  startTimedOperation: vi.fn(),
  endTimedOperation: vi.fn(),
}));

vi.mock('../../src/utils/pinoLogger', () => ({
  createLogger: vi.fn(() => ({ debug: vi.fn(), info: vi.fn(), error: vi.fn(), warn: vi.fn() })),
  debug: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('../../src/utils/logger', () => ({
  initializeLegacyLogger: vi.fn(),
  createCategoryLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
  logDebug: vi.fn(),
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
  logErrorWithContext: vi.fn(),
}));

vi.mock('../../src/utils/errorHandlingUtils', () => ({
  logErrorWithContext: vi.fn(),
  withErrorHandling: vi.fn((fn: any) => fn),
  tryOrNull: vi.fn((fn: any) => (...args: any[]) => {
    try {
      return fn(...args);
    } catch {
      return null;
    }
  }),
  tryOrDefault: vi.fn((fn: any) => fn),
}));

vi.mock('../../src/config', () => ({
  getCacheConfig: vi.fn(() => ({
    enableKVCache: true,
    ttl: { ok: 86400, redirects: 3600, clientError: 60, serverError: 10 },
  })),
  getVideoPathPatterns: vi.fn(() => [{ pattern: '/videos/:path', ttl: 86400, cacheTag: 'video' }]),
  CacheConfigurationManager: {
    getInstance: vi.fn(() => ({
      getConfig: vi.fn(() => ({
        defaultMaxAge: 86400,
        method: 'cf',
        enableCacheTags: true,
        storeIndefinitely: false,
        bypassQueryParameters: [],
      })),
      isKVCacheEnabled: vi.fn(() => true),
      shouldBypassCache: vi.fn(() => false),
    })),
  },
}));

vi.mock('../../src/config/CacheConfigurationManager', () => ({
  CacheConfigurationManager: {
    getInstance: vi.fn(() => ({
      getConfig: vi.fn(() => ({
        defaultMaxAge: 86400,
        method: 'cf',
        enableCacheTags: true,
        storeIndefinitely: false,
        bypassQueryParameters: [],
      })),
      isKVCacheEnabled: vi.fn(() => true),
      shouldBypassCache: vi.fn(() => false),
    })),
  },
}));

// Mock the transformation service — returns a video response
vi.mock('../../src/services/videoTransformationService', () => ({
  transformVideo: vi.fn(
    async () =>
      new Response('transformed video data', {
        status: 200,
        headers: {
          'Content-Type': 'video/mp4',
          'Content-Length': '20',
          'Cache-Control': 'public, max-age=86400',
        },
      })
  ),
}));

// Mock kvCacheUtils so we control cache hit/miss behavior directly
// (cacheOrchestrator.ts imports these statically)
vi.mock('../../src/utils/kvCacheUtils', () => ({
  getFromKVCache: vi.fn().mockResolvedValue(null),
  storeInKVCache: vi.fn().mockResolvedValue(true),
}));

// ── Imports ───────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach } from 'vitest';
import { handleRequestWithCaching } from '../../src/handlers/videoHandlerWithCache';

describe('Video Handler with KV Caching - Integration Test', () => {
  let mockEnv: any;

  beforeEach(async () => {
    vi.clearAllMocks();

    mockEnv = {
      VIDEO_TRANSFORMATIONS_CACHE: {
        get: vi.fn(),
        put: vi.fn(),
        delete: vi.fn(),
        list: vi.fn(),
        getWithMetadata: vi.fn(),
      },
      executionCtx: {
        waitUntil: vi.fn((promise: any) => promise),
      },
    };

    // Reset kvCacheUtils mocks to default (cache miss, store succeeds)
    const kvCacheUtils = await import('../../src/utils/kvCacheUtils');
    vi.mocked(kvCacheUtils.getFromKVCache).mockResolvedValue(null);
    vi.mocked(kvCacheUtils.storeInKVCache).mockResolvedValue(true);

    // Reset CacheConfigurationManager to default (KV enabled, no bypass)
    const { CacheConfigurationManager } =
      await import('../../src/config/CacheConfigurationManager');
    vi.mocked(CacheConfigurationManager.getInstance).mockReturnValue({
      getConfig: vi.fn(() => ({
        defaultMaxAge: 86400,
        method: 'cf',
        enableCacheTags: true,
        storeIndefinitely: false,
        bypassQueryParameters: [],
      })),
      isKVCacheEnabled: vi.fn(() => true),
      shouldBypassCache: vi.fn(() => false),
    } as any);

    // Reset transformVideo to default
    const { transformVideo } = await import('../../src/services/videoTransformationService');
    vi.mocked(transformVideo).mockImplementation(
      async () =>
        new Response('transformed video data', {
          status: 200,
          headers: {
            'Content-Type': 'video/mp4',
            'Content-Length': '20',
            'Cache-Control': 'public, max-age=86400',
          },
        })
    );
  });

  function createRequest(options?: Record<string, string>) {
    const url = new URL('https://example.com/videos/test.mp4');
    if (options) {
      for (const [key, value] of Object.entries(options)) {
        if (value !== undefined) {
          url.searchParams.set(key, value);
        }
      }
    }
    return new Request(url.toString());
  }

  it('should transform and cache video on first request', async () => {
    const request = createRequest({
      derivative: 'mobile',
      width: '640',
      height: '360',
    });

    const response = await handleRequestWithCaching(request, mockEnv, mockEnv.executionCtx);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('transformed video data');

    // Give time for waitUntil to complete
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Verify the execution context was used for background caching
    expect(mockEnv.executionCtx.waitUntil).toHaveBeenCalled();

    // Verify storeInKVCache was called
    const kvCacheUtils = await import('../../src/utils/kvCacheUtils');
    expect(kvCacheUtils.storeInKVCache).toHaveBeenCalled();
  });

  it('should return cached video on second request', async () => {
    // Mock getFromKVCache to return a cached response
    const kvCacheUtils = await import('../../src/utils/kvCacheUtils');
    vi.mocked(kvCacheUtils.getFromKVCache).mockResolvedValue(
      new Response('cached video data', {
        status: 200,
        headers: {
          'Content-Type': 'video/mp4',
          'Content-Length': '16',
          'X-KV-Cache-Age': '100',
          'X-KV-Cache-TTL': '86400',
        },
      })
    );

    const request = createRequest({
      derivative: 'mobile',
      width: '640',
      height: '360',
    });

    const response = await handleRequestWithCaching(request, mockEnv, mockEnv.executionCtx);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('cached video data');

    // Verify the transformation service was NOT called (cache hit)
    const { transformVideo } = await import('../../src/services/videoTransformationService');
    expect(transformVideo).not.toHaveBeenCalled();
  });

  it('should bypass cache when debug is enabled', async () => {
    // The withCaching function uses shouldBypassCache to determine whether to skip cache.
    // Since CacheConfigurationManager.getInstance() returns a new mock each call,
    // we need to override the mock factory to return shouldBypassCache: true.
    const { CacheConfigurationManager } =
      await import('../../src/config/CacheConfigurationManager');
    vi.mocked(CacheConfigurationManager.getInstance).mockReturnValue({
      getConfig: vi.fn(() => ({
        defaultMaxAge: 86400,
        method: 'cf',
        enableCacheTags: true,
        storeIndefinitely: false,
        bypassQueryParameters: ['debug'],
      })),
      isKVCacheEnabled: vi.fn(() => true),
      shouldBypassCache: vi.fn(() => true),
    } as any);

    const request = createRequest({
      derivative: 'mobile',
      debug: 'true',
    });

    const response = await handleRequestWithCaching(request, mockEnv, mockEnv.executionCtx);

    expect(response.status).toBe(200);
    // When cache is bypassed, we get the transformed data
    const content = await response.text();
    expect(content).toBe('transformed video data');

    // Verify getFromKVCache was NOT called (bypassed)
    const kvCacheUtils = await import('../../src/utils/kvCacheUtils');
    expect(kvCacheUtils.getFromKVCache).not.toHaveBeenCalled();
  });

  it('should cache different variants separately', async () => {
    const request1 = createRequest({ derivative: 'mobile' });
    const response1 = await handleRequestWithCaching(request1, mockEnv, mockEnv.executionCtx);
    expect(response1.status).toBe(200);

    const request2 = createRequest({ derivative: 'high' });
    const response2 = await handleRequestWithCaching(request2, mockEnv, mockEnv.executionCtx);
    expect(response2.status).toBe(200);

    // Give time for waitUntil to complete
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Verify that the background caching was initiated
    expect(mockEnv.executionCtx.waitUntil).toHaveBeenCalled();

    // Verify storeInKVCache was called for both variants
    const kvCacheUtils = await import('../../src/utils/kvCacheUtils');
    expect(kvCacheUtils.storeInKVCache).toHaveBeenCalledTimes(2);
  });

  it('should handle errors gracefully and fall back to transformation', async () => {
    // Mock getFromKVCache to throw an error
    const kvCacheUtils = await import('../../src/utils/kvCacheUtils');
    vi.mocked(kvCacheUtils.getFromKVCache).mockRejectedValue(new Error('KV error'));

    const request = createRequest({ derivative: 'mobile' });

    const response = await handleRequestWithCaching(request, mockEnv, mockEnv.executionCtx);

    // Should still get a successful response despite KV errors
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('transformed video data');
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { retryWithAlternativeOrigins } from '../../src/services/transformation/retryWithAlternativeOrigins';

// Mock dependencies
vi.mock('../../src/utils/pinoLogger', () => ({
  createLogger: vi.fn().mockReturnValue({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('../../src/utils/logger', () => ({
  logDebug: vi.fn(),
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
  createCategoryLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    errorWithContext: vi.fn(),
  })),
}));

vi.mock('../../src/utils/errorHandlingUtils', () => ({
  logErrorWithContext: vi.fn(),
}));

vi.mock('../../src/utils/requestContext', () => ({
  addBreadcrumb: vi.fn(),
  getCurrentContext: vi.fn().mockReturnValue(null),
}));

// Mock KV storage utilities - we'll update these in the test
const mockStoreInKVCache = vi.fn().mockResolvedValue(true);
vi.mock('../../src/utils/kvCacheUtils', () => ({
  storeInKVCache: mockStoreInKVCache,
  TransformOptions: {},
}));

const mockGetCacheKV = vi.fn();
vi.mock('../../src/utils/flexibleBindings', () => ({
  getCacheKV: mockGetCacheKV,
}));

const mockIsKVCacheEnabled = vi.fn();
vi.mock('../../src/config/CacheConfigurationManager', () => ({
  CacheConfigurationManager: {
    getInstance: () => ({
      isKVCacheEnabled: mockIsKVCacheEnabled,
    }),
  },
}));

vi.mock('../../src/utils/pathUtils', () => ({
  buildCdnCgiMediaUrl: vi
    .fn()
    .mockReturnValue(
      'https://example.com/cdn-cgi/media/width=1920/https://backup.example.com/videos/test.mp4'
    ),
}));

// Mock VideoConfigurationManager with proper structure
vi.mock('../../src/config/VideoConfigurationManager', () => ({
  VideoConfigurationManager: {
    getInstance: () => ({
      getConfig: () => ({
        origins: [
          {
            name: 'videos',
            matcher: '^/videos/(.+)$',
            sources: [
              {
                type: 'r2',
                priority: 1,
                bucketBinding: 'VIDEO_ASSETS',
                pathTemplate: '{1}',
                path: '{1}',
              },
              {
                type: 'remote',
                priority: 2,
                url: 'https://backup.example.com',
                pathTemplate: 'videos/{1}',
                path: 'videos/{1}',
              },
            ],
            ttl: {
              ok: 3600, // 1 hour TTL
            },
          },
        ],
      }),
    }),
  },
}));

describe('404 Failover - KV Storage Test', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    // Mock global fetch to prevent real TLS requests
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response('Transformed video', {
        status: 200,
        headers: { 'Content-Type': 'video/mp4' },
      })
    );
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('should store failover response in KV cache when enabled', async () => {
    // Configure KV storage to be enabled
    mockIsKVCacheEnabled.mockReturnValue(true);
    mockGetCacheKV.mockReturnValue({ put: vi.fn() }); // Mock KV namespace

    // Mock fetchVideoWithOrigins to return success
    vi.mock('../../src/services/videoStorage/fetchVideoWithOrigins', () => ({
      fetchVideoWithOrigins: vi.fn().mockResolvedValue({
        response: new Response('Video content', {
          status: 200,
          headers: { 'Content-Type': 'video/mp4' },
        }),
        sourceType: 'remote',
        contentType: 'video/mp4',
        size: 1000,
        originalUrl: 'https://backup.example.com/videos/test.mp4',
        path: 'test.mp4',
      }),
    }));

    // Mock cacheResponse to return successful transformation
    vi.mock('../../src/services/cacheManagementService', () => ({
      cacheResponse: vi.fn().mockImplementation(async (req, fetchFn) => {
        return new Response('Transformed video', {
          status: 200,
          headers: { 'Content-Type': 'video/mp4' },
        });
      }),
    }));

    const { retryWithAlternativeOrigins } =
      await import('../../src/services/transformation/retryWithAlternativeOrigins');

    const mockRequest = new Request('https://example.com/videos/test.mp4?imwidth=1920');
    const mockOrigin = {
      name: 'videos',
      matcher: '^/videos/(.+)$',
      sources: [
        {
          type: 'r2',
          priority: 1,
          bucketBinding: 'VIDEO_ASSETS',
          pathTemplate: '{1}',
          path: '{1}',
        },
        {
          type: 'remote',
          priority: 2,
          url: 'https://backup.example.com',
          pathTemplate: 'videos/{1}',
          path: 'videos/{1}',
        },
      ],
      ttl: {
        ok: 3600,
      },
    };

    const mockFailedSource = mockOrigin.sources[0]; // R2 source failed

    const mockContext = {
      request: mockRequest,
      options: { width: 1920, version: 2, derivative: 'test-derivative' },
      origin: mockOrigin,
      env: { VIDEO_ASSETS: {} },
    };

    const mockRequestContext = {
      requestId: 'test-123',
      url: mockRequest.url,
      startTime: Date.now(),
      breadcrumbs: [],
      diagnostics: {
        errors: [],
        warnings: [],
        originalUrl: mockRequest.url,
      },
      componentTiming: {},
      debugEnabled: false,
      verboseEnabled: false,
    };

    // Mock execution context with waitUntil
    const waitUntilFn = vi.fn();
    const envWithContext = {
      VIDEO_ASSETS: {},
      executionCtx: {
        waitUntil: waitUntilFn,
      },
    } as any;

    const response = await retryWithAlternativeOrigins({
      originalRequest: mockRequest,
      transformOptions: { width: 1920, version: 2, derivative: 'test-derivative' },
      failedOrigin: mockOrigin as any,
      failedSource: mockFailedSource as any,
      context: mockContext as any,
      env: envWithContext,
      requestContext: mockRequestContext,
      pathPatterns: [],
      debugInfo: {},
    });

    // Verify the response is successful
    expect(response).toBeDefined();
    expect(response.status).toBe(200);
    expect(response.headers.get('X-Retry-Applied')).toBe('true');
    expect(response.headers.get('X-Alternative-Source')).toBe('remote');
    expect(response.headers.get('X-Failed-Source')).toBe('r2');

    // Verify waitUntil was called (meaning KV storage was initiated)
    expect(waitUntilFn).toHaveBeenCalled();

    // Execute the waitUntil promise to verify storeInKVCache is called
    const waitUntilPromise = waitUntilFn.mock.calls[0][0];
    await waitUntilPromise;

    // Verify storeInKVCache was called with correct parameters
    expect(mockStoreInKVCache).toHaveBeenCalledWith(
      envWithContext,
      '/videos/test.mp4',
      expect.any(Response),
      expect.objectContaining({
        width: 1920,
        version: 2,
        derivative: 'test-derivative',
      })
    );
  });

  it('should skip KV storage when disabled', async () => {
    // Configure KV storage to be disabled
    mockIsKVCacheEnabled.mockReturnValue(false);
    mockGetCacheKV.mockReturnValue(null);

    // Mock fetchVideoWithOrigins to return success
    vi.mock('../../src/services/videoStorage/fetchVideoWithOrigins', () => ({
      fetchVideoWithOrigins: vi.fn().mockResolvedValue({
        response: new Response('Video content', {
          status: 200,
          headers: { 'Content-Type': 'video/mp4' },
        }),
        sourceType: 'remote',
        contentType: 'video/mp4',
        size: 1000,
        originalUrl: 'https://backup.example.com/videos/test.mp4',
        path: 'test.mp4',
      }),
    }));

    // Mock cacheResponse
    vi.mock('../../src/services/cacheManagementService', () => ({
      cacheResponse: vi.fn().mockImplementation(async (req, fetchFn) => {
        return new Response('Transformed video', {
          status: 200,
          headers: { 'Content-Type': 'video/mp4' },
        });
      }),
    }));

    const { retryWithAlternativeOrigins } =
      await import('../../src/services/transformation/retryWithAlternativeOrigins');

    const mockRequest = new Request('https://example.com/videos/test.mp4');
    const mockOrigin = {
      name: 'videos',
      matcher: '^/videos/(.+)$',
      sources: [
        { type: 'r2', priority: 1, bucketBinding: 'VIDEO_ASSETS' },
        { type: 'remote', priority: 2, url: 'https://backup.example.com' },
      ],
    };

    const response = await retryWithAlternativeOrigins({
      originalRequest: mockRequest,
      transformOptions: { width: 1920 },
      failedOrigin: mockOrigin as any,
      failedSource: mockOrigin.sources[0] as any,
      context: {
        request: mockRequest,
        options: { width: 1920 },
        origin: mockOrigin,
        env: { VIDEO_ASSETS: {} },
      } as any,
      env: { VIDEO_ASSETS: {} } as any,
      requestContext: {
        requestId: 'test-123',
        url: mockRequest.url,
        startTime: Date.now(),
        breadcrumbs: [],
        diagnostics: { errors: [], warnings: [], originalUrl: mockRequest.url },
        componentTiming: {},
        debugEnabled: false,
        verboseEnabled: false,
      },
      pathPatterns: [],
      debugInfo: {},
    });

    // Verify the response is successful
    expect(response.status).toBe(200);

    // Verify storeInKVCache was NOT called
    expect(mockStoreInKVCache).not.toHaveBeenCalled();
  });
});

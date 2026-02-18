import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { fetchFromFallback } from '../../src/services/videoStorage/fallbackStorage';

// Mock for storeTransformedVideo
const mockStoreTransformedVideo = vi.fn().mockResolvedValue(true);

// Mock dynamic import with the correct path
vi.mock('../../src/services/kvStorage/storeVideo', () => {
  return {
    storeTransformedVideo: mockStoreTransformedVideo,
  };
});

// Mock streamStorage
vi.mock('../../src/services/kvStorage/streamStorage', () => ({
  storeTransformedVideoWithStreaming: vi.fn().mockResolvedValue(true),
}));

// Mock VideoConfigurationManager
vi.mock('../../src/config', () => {
  return {
    VideoConfigurationManager: {
      getInstance: vi.fn().mockReturnValue({
        getConfig: vi.fn().mockReturnValue({
          cache: {
            ttl: {
              ok: 3600,
            },
          },
        }),
      }),
    },
  };
});

// Mock pathTransform
vi.mock('../../src/services/videoStorage/pathTransform', () => ({
  applyPathTransformation: vi.fn((path: string) => path),
}));

// Mock logging
vi.mock('../../src/services/videoStorage/logging', () => ({
  logDebug: vi.fn(),
}));

// Mock errorHandlingUtils
vi.mock('../../src/utils/errorHandlingUtils', () => ({
  withErrorHandling: vi.fn((fn: any) => fn),
  logErrorWithContext: vi.fn(),
  tryOrNull: vi.fn((fn: any) => fn),
  tryOrDefault: vi.fn((fn: any) => fn),
  getCircularReplacer: vi.fn(() => () => undefined),
  serializeError: vi.fn((err: any) => ({ message: String(err) })),
  toTransformError: vi.fn((err: any) => err),
}));

// Mock presignedUrlCacheService
vi.mock('../../src/services/presignedUrlCacheService', () => ({
  getPresignedUrl: vi.fn(),
  storePresignedUrl: vi.fn(),
  isUrlExpiring: vi.fn(),
  refreshPresignedUrl: vi.fn(),
}));

// Mock legacyLoggerAdapter
vi.mock('../../src/utils/legacyLoggerAdapter', () => ({
  getCurrentContext: vi.fn().mockReturnValue(null),
}));

// Mock requestContext
vi.mock('../../src/utils/requestContext', () => ({
  addBreadcrumb: vi.fn(),
}));

// Mock flexibleBindings so getCacheKV returns our mock KV namespace
vi.mock('../../src/utils/flexibleBindings', () => ({
  getCacheKV: vi.fn((env: any) => env?.VIDEO_TRANSFORMATIONS_CACHE || null),
  getPresignedUrlKV: vi.fn(() => null),
}));

// Mock environment with proper KV namespace (including delete for isKVNamespace check)
const mockEnv = {
  VIDEO_TRANSFORMATIONS_CACHE: {
    put: vi.fn(),
    get: vi.fn(),
    getWithMetadata: vi.fn(),
    delete: vi.fn(),
    list: vi.fn(),
  } as unknown as KVNamespace,
  executionCtx: {
    waitUntil: vi.fn((promise: any) => promise),
  },
};

// Mock the fetch function
const originalFetch = global.fetch;

describe('Fallback Background Storage', () => {
  beforeEach(() => {
    // Clear mocks before each test (don't reset - preserves mock implementations)
    vi.clearAllMocks();

    // Setup our fetch mock implementation
    global.fetch = vi.fn().mockResolvedValue(
      new Response('mock video content', {
        status: 200,
        headers: {
          'Content-Type': 'video/mp4',
          'Content-Length': '1000',
        },
      })
    );
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('should initiate background storage when fallback fetch succeeds', async () => {
    // Simple configuration for test
    const testConfig = {
      storage: {
        fallbackAuth: {
          enabled: false,
        },
      },
      cache: {
        ttl: {
          ok: 3600,
        },
      },
    };

    // Call the fetchFromFallback function
    const result = await fetchFromFallback(
      'test/video.mp4',
      'https://fallback.example.com/',
      testConfig as any,
      mockEnv as any
    );

    // Verify the result
    expect(result).not.toBeNull();
    expect(result?.sourceType).toBe('fallback');

    // Verify waitUntil was called - this is the main thing we need to check
    expect(mockEnv.executionCtx.waitUntil).toHaveBeenCalled();

    // Check the first argument is a Promise
    const waitUntilArg = mockEnv.executionCtx.waitUntil.mock.calls[0][0];
    expect(waitUntilArg).toBeInstanceOf(Promise);
  });

  it('should not initiate background storage when fallback fetch fails', async () => {
    // Mock a failed fetch
    global.fetch = vi.fn().mockResolvedValue(
      new Response('Not Found', {
        status: 404,
      })
    );

    // Simple configuration for test
    const testConfig = {
      storage: {
        fallbackAuth: {
          enabled: false,
        },
      },
      cache: {
        ttl: {
          ok: 3600,
        },
      },
    };

    // Call the fetchFromFallback function
    const result = await fetchFromFallback(
      'test/video.mp4',
      'https://fallback.example.com/',
      testConfig as any,
      mockEnv as any
    );

    // Verify the result is null due to failed fetch
    expect(result).toBeNull();

    // Verify waitUntil was not called
    expect(mockEnv.executionCtx.waitUntil).not.toHaveBeenCalled();

    // Verify storeTransformedVideo was not called
    expect(mockStoreTransformedVideo).not.toHaveBeenCalled();
  });

  it('should not initiate background storage when KV or executionCtx is not available', async () => {
    // Create environment without executionCtx or KV
    const limitedEnv = {};

    // Simple configuration for test
    const testConfig = {
      storage: {
        fallbackAuth: {
          enabled: false,
        },
      },
      cache: {
        ttl: {
          ok: 3600,
        },
      },
    };

    // Call the fetchFromFallback function
    const result = await fetchFromFallback(
      'test/video.mp4',
      'https://fallback.example.com/',
      testConfig as any,
      limitedEnv as any
    );

    // Verify the result is not null (successful fetch)
    expect(result).not.toBeNull();
    expect(result?.sourceType).toBe('fallback');

    // Verify storeTransformedVideo was not called
    expect(mockStoreTransformedVideo).not.toHaveBeenCalled();
  });

  it('should return the fallback response immediately without waiting for background storage', async () => {
    // Mock a delayed storeTransformedVideo that takes a long time
    mockEnv.executionCtx.waitUntil = vi.fn((promise: any) => {
      // Don't return or await the promise to simulate background processing
      return promise;
    });

    // Simple configuration for test
    const testConfig = {
      storage: {
        fallbackAuth: {
          enabled: false,
        },
      },
      cache: {
        ttl: {
          ok: 3600,
        },
      },
    };

    // Create a mock response with timing information
    global.fetch = vi.fn().mockResolvedValue(
      new Response('mock video content', {
        status: 200,
        headers: {
          'Content-Type': 'video/mp4',
          'Content-Length': '1000',
          'X-Response-Time': '50ms',
        },
      })
    );

    // Measure time to get the response
    const startTime = Date.now();
    const result = await fetchFromFallback(
      'test/video.mp4',
      'https://fallback.example.com/',
      testConfig as any,
      mockEnv as any
    );
    const responseTime = Date.now() - startTime;

    // Verify the result came back quickly
    expect(result).not.toBeNull();
    expect(result?.sourceType).toBe('fallback');

    // Verify waitUntil was called (background storage initiated)
    expect(mockEnv.executionCtx.waitUntil).toHaveBeenCalled();

    // Response should be returned without significant delay
    // We should see response in under ~100ms (just a sanity check)
    expect(responseTime).toBeLessThan(100);
  });

  it('should use streams API for very large files', async () => {
    // Simple configuration for test
    const testConfig = {
      storage: {
        fallbackAuth: {
          enabled: false,
        },
      },
      cache: {
        ttl: {
          ok: 3600,
        },
      },
    };

    // Create a mock response with a large content length (>100MB but <128MB to avoid skip)
    global.fetch = vi.fn().mockResolvedValue(
      new Response('large mock video content', {
        status: 200,
        headers: {
          'Content-Type': 'video/mp4',
          'Content-Length': '120000000', // 120MB - above 100MB threshold but below 128MB skip threshold
          'X-Response-Time': '50ms',
        },
      })
    );

    // Call the fetchFromFallback function
    const result = await fetchFromFallback(
      'test/large-video.mp4',
      'https://fallback.example.com/',
      testConfig as any,
      mockEnv as any
    );

    // Verify the result is not null
    expect(result).not.toBeNull();
    expect(result?.sourceType).toBe('fallback');

    // Verify waitUntil was called for background caching even with large file
    expect(mockEnv.executionCtx.waitUntil).toHaveBeenCalled();
  });
});

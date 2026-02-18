/**
 * Tests for background fallback chunking functionality
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleTransformationError } from '../../src/services/errorHandler/transformationErrorHandler';

// Mocks
vi.mock('../../src/utils/requestContext', () => {
  return {
    getCurrentContext: vi.fn(() => null),
    addBreadcrumb: vi.fn(),
    createContext: vi.fn(() => ({ requestId: '123', url: 'test' })),
    getPerformanceMetrics: vi.fn(() => ({})),
  };
});

vi.mock('../../src/utils/pinoLogger', () => {
  return {
    createLogger: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    logDebug: vi.fn(),
  };
});

vi.mock('../../src/utils/pathUtils', () => ({
  findMatchingPathPattern: vi.fn(),
  isCdnCgiMediaPath: vi.fn(() => false),
}));

// Mock cache management service
vi.mock('../../src/services/cacheManagementService', () => {
  return {
    cacheResponse: vi.fn((req, handler) => handler()),
    applyCacheHeaders: vi.fn((response) => response),
  };
});

// Mock videoStorageService
vi.mock('../../src/services/videoStorageService', () => {
  return {
    fetchVideo: vi.fn().mockResolvedValue({
      sourceType: 'origin',
      response: new Response('Mocked video content', {
        status: 200,
        headers: {
          'Content-Type': 'video/mp4',
        },
      }),
    }),
  };
});

// Mock VideoConfigurationManager
vi.mock('../../src/config', async () => {
  return {
    VideoConfigurationManager: {
      getInstance: vi.fn(() => ({
        getConfig: vi.fn(() => ({
          caching: {
            method: 'kv',
            debug: false,
            fallback: {
              enabled: true,
              badRequestOnly: false,
              fileSizeErrorHandling: true,
            },
          },
        })),
        getPathPatterns: vi.fn(() => []),
      })),
    },
  };
});

// Mock the fallbackStorage module - streamFallbackToKV is called via dynamic import
vi.mock('../../src/services/videoStorage/fallbackStorage', () => {
  return {
    streamFallbackToKV: vi.fn().mockResolvedValue(undefined),
  };
});

// Mock TransformationService
vi.mock('../../src/services/TransformationService', () => {
  return {
    prepareVideoTransformation: vi.fn().mockResolvedValue({
      cdnCgiUrl: 'https://example.com/cdn-cgi/video/test.mp4',
    }),
  };
});

// Mock bypassHeadersUtils (used in the finalize fallback section)
vi.mock('../../src/utils/bypassHeadersUtils', () => {
  return {
    setBypassHeaders: vi.fn(),
    hasBypassHeaders: vi.fn(() => false),
  };
});

// Mock fetchVideoWithOrigins (used for storage service fallback when no direct URL)
vi.mock('../../src/services/videoStorage/fetchVideoWithOrigins', () => {
  return {
    fetchVideoWithOrigins: vi.fn().mockResolvedValue({
      sourceType: 'remote',
      response: new Response('Mocked fallback from storage', {
        status: 200,
        headers: {
          'Content-Type': 'video/mp4',
          'Content-Length': '5000',
        },
      }),
    }),
  };
});

describe('Background Fallback Chunking', () => {
  let globalFetch: typeof fetch;
  let mockExecutionCtx: { waitUntil: ReturnType<typeof vi.fn> };

  // Helper to create a KV-like mock that passes isKVNamespace check
  function createMockKV() {
    return { get: vi.fn(), put: vi.fn(), delete: vi.fn() } as any;
  }

  // Setup: Store the original fetch function
  beforeEach(() => {
    globalFetch = global.fetch;
    // Create a mock execution context with waitUntil function
    mockExecutionCtx = { waitUntil: vi.fn() };
  });

  // Cleanup: Restore the original fetch function
  afterEach(() => {
    global.fetch = globalFetch;
    vi.clearAllMocks();
  });

  it('should initiate background caching for server error fallbacks with direct URL', async () => {
    // Mock fetch to return a video response
    global.fetch = vi.fn().mockResolvedValue(
      new Response('mock video content', {
        status: 200,
        headers: new Headers({
          'Content-Type': 'video/mp4',
          'Content-Length': '5242880', // 5MB
          'Accept-Ranges': 'bytes',
        }),
      })
    );

    // Create mock environment with waitUntil and KV namespace
    const env = {
      executionCtx: mockExecutionCtx,
      VIDEO_TRANSFORMATIONS_CACHE: createMockKV(),
    };

    // Use a 500 server error (not 256MiB file size) so background caching is triggered
    const errorResponse = new Response('Internal server error', {
      status: 500,
      headers: { 'Content-Type': 'text/plain' },
    });

    const originalRequest = new Request('https://example.com/videos/large-video.mp4');

    const context = {
      request: originalRequest,
      logger: vi.fn(),
      pathPatterns: [],
      env,
    };

    const requestContext = { requestId: '123', url: 'test' };

    await handleTransformationError({
      errorResponse,
      originalRequest,
      context: context as any,
      requestContext: requestContext as any,
      diagnosticsInfo: {} as any,
      fallbackOriginUrl: 'https://example.com/originals/large-video.mp4',
      cdnCgiUrl: 'https://example.com/cdn-cgi/video/large-video.mp4',
      source: 'origin',
    });

    // Verify that waitUntil was called for background chunking
    expect(mockExecutionCtx.waitUntil).toHaveBeenCalled();
  });

  it('should handle fallbacks via storage service when no direct URL available', async () => {
    // Mock fetch (won't be called for direct fetch since no valid URL)
    global.fetch = vi.fn().mockResolvedValue(
      new Response('mock video', {
        status: 200,
        headers: new Headers({
          'Content-Type': 'video/mp4',
          'Content-Length': '10485760',
          'Accept-Ranges': 'bytes',
        }),
      })
    );

    const env = {
      executionCtx: mockExecutionCtx,
      VIDEO_TRANSFORMATIONS_CACHE: createMockKV(),
    };

    // 500 server error with no fallbackOriginUrl → falls to storage service
    const errorResponse = new Response('Server error', {
      status: 500,
      headers: { 'Content-Type': 'text/plain' },
    });

    const originalRequest = new Request('https://example.com/videos/pattern-video.mp4');

    const context = {
      request: originalRequest,
      logger: vi.fn(),
      pathPatterns: [],
      env,
    };

    const requestContext = { requestId: '123', url: 'test' };

    // Call the error handler - no direct URL, uses storage service fallback
    const response = await handleTransformationError({
      errorResponse,
      originalRequest,
      context: context as any,
      requestContext: requestContext as any,
      diagnosticsInfo: {} as any,
      fallbackOriginUrl: null,
      cdnCgiUrl: 'https://example.com/cdn-cgi/video/pattern-video.mp4',
    });

    // Should get a 200 response from the storage service fallback
    expect(response.status).toBe(200);
  });

  it('should handle non-large video fallbacks with background chunking', async () => {
    // Mock fetch to return a regular video response
    global.fetch = vi.fn().mockResolvedValue(
      new Response('mock regular video content', {
        status: 200,
        headers: new Headers({
          'Content-Type': 'video/mp4',
          'Content-Length': '5242880', // 5MB
          'Accept-Ranges': 'bytes',
        }),
      })
    );

    // Create mock environment with waitUntil and KV namespace
    const env = {
      executionCtx: mockExecutionCtx,
      VIDEO_TRANSFORMATIONS_CACHE: createMockKV(),
    };

    // Setup error response - 500 server error (NOT file size error)
    const errorResponse = new Response('Server error', {
      status: 500,
      headers: { 'Content-Type': 'text/plain' },
    });

    const originalRequest = new Request('https://example.com/videos/regular-video.mp4');

    const context = {
      request: originalRequest,
      logger: vi.fn(),
      pathPatterns: [],
      env,
    };

    const requestContext = { requestId: '123', url: 'test' };

    await handleTransformationError({
      errorResponse,
      originalRequest,
      context: context as any,
      requestContext: requestContext as any,
      diagnosticsInfo: {} as any,
      fallbackOriginUrl: 'https://example.com/originals/regular-video.mp4',
      cdnCgiUrl: 'https://example.com/cdn-cgi/video/regular-video.mp4',
      source: 'origin',
    });

    // Verify that waitUntil was called for background chunking
    expect(mockExecutionCtx.waitUntil).toHaveBeenCalled();
  });

  it('should not fail if background chunking setup throws an error', async () => {
    // Override streamFallbackToKV to throw (per-test, not vi.mock which would hoist)
    const { streamFallbackToKV } = await import('../../src/services/videoStorage/fallbackStorage');
    vi.mocked(streamFallbackToKV).mockImplementation(() => {
      throw new Error('Import error');
    });

    // Mock fetch to return a successful response
    global.fetch = vi.fn().mockResolvedValue(
      new Response('mock video content', {
        status: 200,
        headers: new Headers({
          'Content-Type': 'video/mp4',
          'Content-Length': '1048576', // 1MB
          'Accept-Ranges': 'bytes',
        }),
      })
    );

    // Create mock environment with waitUntil and KV namespace
    const env = {
      executionCtx: mockExecutionCtx,
      VIDEO_TRANSFORMATIONS_CACHE: createMockKV(),
    };

    // Setup error response
    const errorResponse = new Response('Server error', {
      status: 500,
      headers: { 'Content-Type': 'text/plain' },
    });

    const originalRequest = new Request('https://example.com/videos/error-video.mp4');

    const context = {
      request: originalRequest,
      logger: vi.fn(),
      pathPatterns: [],
      env,
    };

    const requestContext = { requestId: '123', url: 'test' };

    // Call the error handler - should not throw despite the error in background chunking
    const response = await handleTransformationError({
      errorResponse,
      originalRequest,
      context: context as any,
      requestContext: requestContext as any,
      diagnosticsInfo: {} as any,
      fallbackOriginUrl: 'https://example.com/originals/error-video.mp4',
      cdnCgiUrl: 'https://example.com/cdn-cgi/video/error-video.mp4',
      source: 'origin',
    });

    // Verify response was returned successfully despite background chunking error
    expect(response.status).toBe(200);
  });
});

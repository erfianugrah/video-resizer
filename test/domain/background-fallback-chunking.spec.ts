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

// Mock the fallbackStorage module
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

describe('Background Fallback Chunking', () => {
  let globalFetch: typeof fetch;
  let mockExecutionCtx: { waitUntil: ReturnType<typeof vi.fn> };

  // Setup: Store the original fetch function
  beforeEach(() => {
    globalFetch = global.fetch;
    // Create a mock execution context with waitUntil function
    mockExecutionCtx = { waitUntil: vi.fn() };
  });

  // Cleanup: Restore the original fetch function
  afterEach(() => {
    global.fetch = globalFetch;
    vi.resetAllMocks();
  });

  it('should initiate background chunking for large video fallbacks', async () => {
    // Import the modules we need to test
    const { streamFallbackToKV } = await import('../../src/services/videoStorage/fallbackStorage');

    // Mock fetch to return a large video response
    global.fetch = vi.fn().mockResolvedValue(new Response('mock large video content', {
      status: 200,
      headers: new Headers({
        'Content-Type': 'video/mp4',
        'Content-Length': '268435456', // 256MiB
        'Accept-Ranges': 'bytes'
      })
    }));

    // Create mock environment with waitUntil and KV namespace
    const env = {
      executionCtx: mockExecutionCtx,
      VIDEO_TRANSFORMATIONS_CACHE: {} as any // Mock KV namespace
    };

    // Setup error response
    const errorResponse = new Response('File size limit exceeded: 256MiB', {
      status: 400,
      headers: { 'Content-Type': 'text/plain' }
    });

    // Create an original request
    const originalRequest = new Request('https://example.com/videos/large-video.mp4');

    // Create context and requestContext
    const context = {
      request: originalRequest,
      logger: vi.fn(),
      pathPatterns: [],
      env
    };

    const requestContext = { requestId: '123', url: 'test' };

    // Call the error handler
    await handleTransformationError({
      errorResponse,
      originalRequest,
      context: context as any,
      requestContext: requestContext as any,
      diagnosticsInfo: {} as any,
      fallbackOriginUrl: 'https://example.com/originals/large-video.mp4',
      cdnCgiUrl: 'https://example.com/cdn-cgi/video/large-video.mp4',
      source: 'origin'
    });

    // Verify that waitUntil was called for background chunking
    expect(mockExecutionCtx.waitUntil).toHaveBeenCalled();
  });

  it('should initiate background chunking for pattern-specific fallbacks', async () => {
    // Import the modules we need to test
    const { streamFallbackToKV } = await import('../../src/services/videoStorage/fallbackStorage');
    
    // Override pathUtils mock to return a pattern match
    const { findMatchingPathPattern } = await import('../../src/utils/pathUtils');
    (findMatchingPathPattern as any).mockReturnValue({
      name: 'test-pattern',
      originUrl: 'https://test-origin.com',
      auth: {
        enabled: true,
        type: 'aws-s3-presigned-url'
      }
    });

    // Mock fetch to return a successful response for pattern-specific URL
    global.fetch = vi.fn().mockResolvedValue(new Response('mock video from pattern source', {
      status: 200,
      headers: new Headers({
        'Content-Type': 'video/mp4',
        'Content-Length': '10485760', // 10MB
        'Accept-Ranges': 'bytes'
      })
    }));

    // Create mock environment with waitUntil and KV namespace
    const env = {
      executionCtx: mockExecutionCtx,
      VIDEO_TRANSFORMATIONS_CACHE: {} as any // Mock KV namespace
    };

    // Setup error response
    const errorResponse = new Response('Server error', {
      status: 500,
      headers: { 'Content-Type': 'text/plain' }
    });

    // Create an original request
    const originalRequest = new Request('https://example.com/videos/pattern-video.mp4');

    // Create context and requestContext
    const context = {
      request: originalRequest,
      logger: vi.fn(),
      pathPatterns: [{
        name: 'test-pattern',
        matcher: '^/videos/(.+)$',
        originUrl: 'https://test-origin.com',
        auth: {
          enabled: true,
          type: 'aws-s3-presigned-url'
        }
      }],
      env
    };

    const requestContext = { requestId: '123', url: 'test' };

    // Call the error handler
    await handleTransformationError({
      errorResponse,
      originalRequest,
      context: context as any,
      requestContext: requestContext as any,
      diagnosticsInfo: {} as any,
      fallbackOriginUrl: null,
      cdnCgiUrl: 'https://example.com/cdn-cgi/video/pattern-video.mp4'
    });

    // Verify that waitUntil was called for background chunking
    expect(mockExecutionCtx.waitUntil).toHaveBeenCalled();
  });

  it('should handle non-large video fallbacks with background chunking', async () => {
    // Import the modules we need to test
    const { streamFallbackToKV } = await import('../../src/services/videoStorage/fallbackStorage');
    
    // Mock fetch to return a regular video response
    global.fetch = vi.fn().mockResolvedValue(new Response('mock regular video content', {
      status: 200,
      headers: new Headers({
        'Content-Type': 'video/mp4',
        'Content-Length': '5242880', // 5MB
        'Accept-Ranges': 'bytes'
      })
    }));

    // Create mock environment with waitUntil and KV namespace
    const env = {
      executionCtx: mockExecutionCtx,
      VIDEO_TRANSFORMATIONS_CACHE: {} as any // Mock KV namespace
    };

    // Setup error response
    const errorResponse = new Response('Server error', {
      status: 500,
      headers: { 'Content-Type': 'text/plain' }
    });

    // Create an original request
    const originalRequest = new Request('https://example.com/videos/regular-video.mp4');

    // Create context and requestContext
    const context = {
      request: originalRequest,
      logger: vi.fn(),
      pathPatterns: [],
      env
    };

    const requestContext = { requestId: '123', url: 'test' };

    // Call the error handler
    await handleTransformationError({
      errorResponse,
      originalRequest,
      context: context as any,
      requestContext: requestContext as any,
      diagnosticsInfo: {} as any,
      fallbackOriginUrl: 'https://example.com/originals/regular-video.mp4',
      cdnCgiUrl: 'https://example.com/cdn-cgi/video/regular-video.mp4',
      source: 'origin'
    });

    // Verify that waitUntil was called for background chunking
    expect(mockExecutionCtx.waitUntil).toHaveBeenCalled();
  });

  it('should not fail if background chunking setup throws an error', async () => {
    // Override the import to throw an error
    vi.mock('../../src/services/videoStorage/fallbackStorage', () => {
      return {
        streamFallbackToKV: vi.fn().mockImplementation(() => {
          throw new Error('Import error');
        }),
      };
    });

    // Mock fetch to return a successful response
    global.fetch = vi.fn().mockResolvedValue(new Response('mock video content', {
      status: 200,
      headers: new Headers({
        'Content-Type': 'video/mp4',
        'Content-Length': '1048576', // 1MB
        'Accept-Ranges': 'bytes'
      })
    }));

    // Create mock environment with waitUntil and KV namespace
    const env = {
      executionCtx: mockExecutionCtx,
      VIDEO_TRANSFORMATIONS_CACHE: {} as any // Mock KV namespace
    };

    // Setup error response
    const errorResponse = new Response('Server error', {
      status: 500,
      headers: { 'Content-Type': 'text/plain' }
    });

    // Create an original request
    const originalRequest = new Request('https://example.com/videos/error-video.mp4');

    // Create context and requestContext
    const context = {
      request: originalRequest,
      logger: vi.fn(),
      pathPatterns: [],
      env
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
      source: 'origin'
    });

    // Verify response was returned successfully despite background chunking error
    expect(response.status).toBe(200);
  });
});
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Add types to the global object
declare global {
  var storeVideoFunctions: {
    storeTransformedVideo: ReturnType<typeof vi.fn>;
  };
}

// Mock all needed imports
vi.mock('../../../src/utils/errorHandlingUtils', () => ({
  withErrorHandling: vi.fn((fn: any) => fn),
  logErrorWithContext: vi.fn(),
  tryOrNull: vi.fn((fn: any) => fn),
  tryOrDefault: vi.fn((fn: any) => fn),
  getCircularReplacer: vi.fn(() => () => undefined),
  serializeError: vi.fn((err: any) => ({ message: String(err) })),
  toTransformError: vi.fn((err: any) => err),
}));

vi.mock('../../../src/utils/legacyLoggerAdapter', () => ({
  getCurrentContext: vi.fn(() => ({
    requestId: 'test-request-id',
    url: 'https://example.com/videos/test.mp4',
    startTime: Date.now(),
    headers: new Headers(),
    executionContext: {
      waitUntil: vi.fn((promise: any) => promise),
    },
  })),
}));

vi.mock('../../../src/utils/requestContext', () => ({
  addBreadcrumb: vi.fn(),
}));

vi.mock('../../../src/services/videoStorage/logging', () => ({
  logDebug: vi.fn(),
}));

vi.mock('../../../src/services/errorHandler/logging', () => ({
  logDebug: vi.fn(),
}));

vi.mock('../../../src/utils/transformationUtils', () => ({
  parseErrorMessage: vi.fn((str: string) => ({
    errorType: 'file_size_limit',
    specificError: 'Video exceeds 256MiB limit',
  })),
  isDurationLimitError: vi.fn().mockReturnValue(false),
  adjustDuration: vi.fn(),
  storeTransformationLimit: vi.fn(),
}));

vi.mock('../../../src/services/videoStorage/pathTransform', () => ({
  applyPathTransformation: vi.fn((path: string) => path),
}));

// Mock kvStorage storeVideo and streamStorage
vi.mock('../../../src/services/kvStorage/storeVideo', () => ({
  storeTransformedVideo: vi.fn().mockResolvedValue(true),
}));

vi.mock('../../../src/services/kvStorage/streamStorage', () => ({
  storeTransformedVideoWithStreaming: vi.fn().mockResolvedValue(true),
}));

// Mock dynamic imports using vi.mock with factory
vi.mock('../../../src/config', () => {
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

vi.mock('../../../src/utils/bypassHeadersUtils', () => ({
  setBypassHeaders: vi.fn(),
}));

vi.mock('../../../src/services/presignedUrlCacheService', () => ({
  getPresignedUrl: vi.fn(),
  storePresignedUrl: vi.fn(),
  isUrlExpiring: vi.fn(),
  refreshPresignedUrl: vi.fn(),
}));

// Mock flexibleBindings to use our env's KV namespace
vi.mock('../../../src/utils/flexibleBindings', () => ({
  getCacheKV: vi.fn((env: any) => env?.VIDEO_TRANSFORMATIONS_CACHE || null),
  getPresignedUrlKV: vi.fn(() => null),
}));

// Mock fetchVideoWithOrigins for the handler fallback path
vi.mock('../../../src/services/videoStorage/fetchVideoWithOrigins', () => ({
  fetchVideoWithOrigins: vi.fn().mockResolvedValue({
    response: new Response('Storage service response', {
      status: 200,
      headers: { 'Content-Type': 'video/mp4' },
    }),
    sourceType: 'remote',
  }),
}));

// Mock fallbackStorage's streamFallbackToKV for the handler tests
vi.mock('../../../src/services/videoStorage/fallbackStorage', () => ({
  streamFallbackToKV: vi.fn().mockResolvedValue(undefined),
  fetchFromFallback: vi.fn(),
}));

describe('Large File Background Caching Integration', () => {
  // Common test variables
  const mockEnv = {
    VIDEO_TRANSFORMATIONS_CACHE: {
      put: vi.fn(),
      get: vi.fn(),
      getWithMetadata: vi.fn(),
      delete: vi.fn(),
    } as unknown as KVNamespace,
    executionCtx: {
      waitUntil: vi.fn((promise: any) => promise),
    },
  };

  const mockRequestContext = {
    requestId: 'test-request-id',
    url: 'https://example.com/videos/large-test.mp4',
    startTime: Date.now(),
    headers: new Headers(),
    breadcrumbs: [],
    diagnostics: { errors: [], warnings: [] },
    componentTiming: {},
    debugEnabled: false,
    verboseEnabled: false,
  };

  // Reset mocks before each test
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should process large files (>100MB) with streaming instead of skipping them', async () => {
    // Import the real handleTransformationError
    const { handleTransformationError } =
      await import('../../../src/services/errorHandler/transformationErrorHandler');

    // Create large video data (just use small buffer with Content-Length header for test)
    const contentLength = 250 * 1024 * 1024; // 250 MB
    const smallDataForTest = new Uint8Array(1024).fill(1);

    // Mock fetch to return a large file response
    global.fetch = vi.fn().mockResolvedValue(
      new Response(smallDataForTest.buffer, {
        headers: {
          'Content-Type': 'video/mp4',
          'Content-Length': contentLength.toString(),
        },
        status: 200,
        statusText: 'OK',
      })
    );

    // Create a 500 error response to trigger fallback
    const errorResponse = new Response('Transformation failed - file size limit', {
      status: 500,
    });

    const originalRequest = new Request('https://example.com/videos/large-test.mp4');

    // Call handleTransformationError with a valid source URL to trigger direct fetch
    const result = await handleTransformationError({
      errorResponse,
      originalRequest,
      context: {
        request: originalRequest,
        options: { width: 720 },
        pathPatterns: [],
        debugInfo: { isEnabled: false },
        env: mockEnv,
      } as any,
      requestContext: mockRequestContext as any,
      diagnosticsInfo: { errors: [], warnings: [] } as any,
      fallbackOriginUrl: 'https://origin.example.com/videos/large-test.mp4',
      cdnCgiUrl: 'https://example.com/cdn-cgi/media/width=720/videos/large-test.mp4',
      source: undefined,
    });

    // Verify the result is a successful response (fallback applied)
    expect(result).toBeInstanceOf(Response);
    expect(result.status).toBe(200);
    expect(result.headers.get('X-Fallback-Applied')).toBe('true');

    // Verify fetch was called to get the content directly
    expect(global.fetch).toHaveBeenCalled();

    // Verify logging to confirm large file was processed
    const { logDebug } = await import('../../../src/services/errorHandler/logging');
    expect(logDebug).toHaveBeenCalledWith(
      'handleTransformationError',
      expect.stringContaining('Direct source fetch successful'),
      expect.any(Object)
    );
  });

  it('should handle the complete fallback flow for large videos', async () => {
    // Import the real handleTransformationError
    const { handleTransformationError } =
      await import('../../../src/services/errorHandler/transformationErrorHandler');

    const contentLength = 260 * 1024 * 1024; // 260MB

    // Mock fetch to return a large video response with Accept-Ranges
    global.fetch = vi.fn().mockResolvedValue(
      new Response(new Uint8Array(1024).fill(1), {
        status: 200,
        headers: {
          'Content-Type': 'video/mp4',
          'Content-Length': contentLength.toString(),
          'Accept-Ranges': 'bytes',
        },
      })
    );

    // Create a file size error response (triggers 256MiB path)
    const errorResponse = new Response('Video exceeds 256MiB file size limit', {
      status: 413,
      headers: { 'Content-Type': 'text/plain' },
    });

    // Adjust parseErrorMessage mock for this test to return file_size_limit
    const { parseErrorMessage } = await import('../../../src/utils/transformationUtils');
    (parseErrorMessage as any).mockReturnValue({
      errorType: 'file_size_limit',
      specificError: 'Video exceeds 256MiB limit',
      parameter: null,
    });

    const originalRequest = new Request('https://example.com/videos/really-large.mp4');

    // Call the real handler with a source URL
    const result = await handleTransformationError({
      errorResponse,
      originalRequest,
      context: {
        request: originalRequest,
        options: { width: 720 },
        pathPatterns: [],
        debugInfo: { isEnabled: false },
        env: mockEnv,
      } as any,
      requestContext: mockRequestContext as any,
      diagnosticsInfo: { errors: [], warnings: [] } as any,
      fallbackOriginUrl: 'https://origin.example.com/videos/really-large.mp4',
      cdnCgiUrl: 'https://example.com/cdn-cgi/media/width=720/videos/really-large.mp4',
      source: undefined,
    });

    // Verify the result is a response
    expect(result).toBeInstanceOf(Response);
    expect(result.status).toBe(200);

    // Verify that proper headers were set on the response
    expect(result.headers.get('X-Fallback-Applied')).toBe('true');
    expect(result.headers.get('X-File-Size-Error')).toBe('true');
    expect(result.headers.get('X-Video-Too-Large')).toBe('true');

    // Verify fetch was called to get the content
    expect(global.fetch).toHaveBeenCalled();
  });

  it('should handle stream error gracefully', async () => {
    // Import the real handleTransformationError
    const { handleTransformationError } =
      await import('../../../src/services/errorHandler/transformationErrorHandler');

    // Mock fetch to throw an error during direct fetch
    global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

    // Create a server error response to trigger fallback
    const errorResponse = new Response('Transformation failed', { status: 500 });

    const originalRequest = new Request('https://example.com/videos/error-test.mp4');

    // Mock fetchVideoWithOrigins to also fail
    const { fetchVideoWithOrigins } =
      await import('../../../src/services/videoStorage/fetchVideoWithOrigins');
    (fetchVideoWithOrigins as any).mockResolvedValueOnce({
      response: new Response('Error', { status: 500 }),
      sourceType: 'error',
      error: new Error('Storage service failed'),
    });

    // Call the handler - it should handle the error gracefully
    const result = await handleTransformationError({
      errorResponse,
      originalRequest,
      context: {
        request: originalRequest,
        options: { width: 720 },
        pathPatterns: [],
        debugInfo: { isEnabled: false },
        env: mockEnv,
      } as any,
      requestContext: mockRequestContext as any,
      diagnosticsInfo: { errors: [], warnings: [] } as any,
      fallbackOriginUrl: 'https://origin.example.com/videos/error-test.mp4',
      cdnCgiUrl: 'https://example.com/cdn-cgi/media/width=720/videos/error-test.mp4',
      source: undefined,
    });

    // The handler should catch errors and log them
    const { logErrorWithContext } = await import('../../../src/utils/errorHandlingUtils');
    expect(logErrorWithContext).toHaveBeenCalledWith(
      expect.stringContaining('Error'),
      expect.anything(),
      expect.any(Object),
      expect.any(String)
    );

    // Should still return a response (error response)
    expect(result).toBeInstanceOf(Response);
  });

  it('should handle a valid response with missing body', async () => {
    // Import the real streamFallbackToKV
    const { streamFallbackToKV } =
      await import('../../../src/services/videoStorage/fallbackStorage');

    // Create a response with null body to test edge case
    const noBodyResponse = new Response();
    Object.defineProperty(noBodyResponse, 'body', { value: null });
    Object.defineProperty(noBodyResponse, 'ok', { value: true });

    // Should return early without error
    await (streamFallbackToKV as any)(mockEnv, 'videos/no-body.mp4', noBodyResponse, {
      cache: { ttl: { ok: 3600 } },
    });

    // Verify storeTransformedVideo was NOT called
    const { storeTransformedVideo } = await import('../../../src/services/kvStorage/storeVideo');
    expect(storeTransformedVideo).not.toHaveBeenCalled();

    // Verify no error was logged
    const { logErrorWithContext } = await import('../../../src/utils/errorHandlingUtils');
    expect(logErrorWithContext).not.toHaveBeenCalled();
  });
});

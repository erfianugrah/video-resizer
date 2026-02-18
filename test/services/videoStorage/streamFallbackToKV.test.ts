import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock logger - must use vi.hoisted for vi.mock hoisting
const { mockLoggerDebug } = vi.hoisted(() => ({
  mockLoggerDebug: vi.fn(),
}));
vi.mock('../../../src/utils/logger', () => ({
  createCategoryLogger: vi.fn(() => ({
    debug: mockLoggerDebug,
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    errorWithContext: vi.fn(),
  })),
}));

// Instead of trying to test the entire integration, let's focus on verifying our fix
// by directly reading and testing the source file
describe('streamFallbackToKV Streams API Implementation', () => {
  // Our mocks
  const mockKVNamespace = {
    put: vi.fn(),
    get: vi.fn(),
    getWithMetadata: vi.fn(),
    delete: vi.fn(),
  };

  const mockEnv = {
    VIDEO_TRANSFORMATIONS_CACHE: mockKVNamespace,
  };

  // Mock storeTransformedVideo, which is dynamically imported
  vi.mock('../../../src/services/kvStorage/storeVideo', () => ({
    storeTransformedVideo: vi.fn().mockImplementation((kv, key, response, options, ttl) => {
      // Simple implementation that just returns successful promise
      return Promise.resolve(true);
    }),
  }));

  vi.mock('../../../src/utils/errorHandlingUtils', () => ({
    logErrorWithContext: vi.fn(),
    withErrorHandling: vi.fn((fn) => fn),
    tryOrDefault: vi.fn((fn) => fn),
  }));

  vi.mock('../../../src/services/videoStorage/pathTransform', () => ({
    applyPathTransformation: vi.fn((path) => path),
  }));

  // Reset mocks before each test
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('demonstrates that our implementation properly handles streaming for large files', async () => {
    // Import the implementation directly (without mocking it)
    const { streamFallbackToKV } =
      await import('../../../src/services/videoStorage/fallbackStorage');

    // We test that streamFallbackToKV properly delegates to storeTransformedVideo
    // Note: Files > 128MB are skipped by the 128MB safety limit in streamFallbackToKV
    // Files > 40MB use storeTransformedVideoWithStreaming instead of storeTransformedVideo
    // So we use 10MB to test the standard storeTransformedVideo path
    const largeContentLength = 10 * 1024 * 1024; // 10MB (under 40MB threshold)

    // Create a small buffer for the test, but the Content-Length header will indicate large size
    const smallBuffer = new Uint8Array(1024).fill(1);
    const largeVideoResponse = new Response(smallBuffer.buffer, {
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Length': largeContentLength.toString(),
      },
      status: 200,
    });

    // The streamFallbackToKV function should properly stream this to KV
    await streamFallbackToKV(mockEnv, 'videos/large-test.mp4', largeVideoResponse, {
      cache: { ttl: { ok: 3600 } },
    });

    // Verify that storeTransformedVideo was called with the correct parameters
    const { storeTransformedVideo } = await import('../../../src/services/kvStorage/storeVideo');
    expect(storeTransformedVideo).toHaveBeenCalledTimes(1);

    // Verify the call arguments (getCacheKV returns the KV from env, path is transformed)
    const callArgs = vi.mocked(storeTransformedVideo).mock.calls[0];
    expect(callArgs[1]).toBe('videos/large-test.mp4'); // path
    expect(callArgs[2]).toBeInstanceOf(Response); // response
    expect(callArgs[4]).toBe(3600); // TTL

    // Verify that the Response passed to storeTransformedVideo has the correct headers
    const responseArg = callArgs[2] as Response;
    expect(responseArg.headers.get('Content-Type')).toBe('video/mp4');
    expect(responseArg.headers.get('Content-Length')).toBe(largeContentLength.toString());

    // Verify the logging for file processing
    expect(mockLoggerDebug).toHaveBeenCalledWith(
      'Starting background streaming of fallback to KV',
      expect.objectContaining({
        path: 'videos/large-test.mp4',
        contentType: 'video/mp4',
        contentLength: largeContentLength,
      })
    );

    expect(mockLoggerDebug).toHaveBeenCalledWith(
      'Successfully stored fallback content in KV',
      expect.objectContaining({
        path: 'videos/large-test.mp4',
        kvNamespace: 'VIDEO_TRANSFORMATIONS_CACHE',
      })
    );
  });

  it('handles KV storage errors gracefully', async () => {
    // Import the implementation directly
    const { streamFallbackToKV } =
      await import('../../../src/services/videoStorage/fallbackStorage');

    // Mock storeTransformedVideo to throw an error
    const { storeTransformedVideo } = await import('../../../src/services/kvStorage/storeVideo');
    vi.mocked(storeTransformedVideo).mockImplementationOnce(() =>
      Promise.reject(new Error('KV storage error'))
    );

    // Create a valid response
    const response = new Response('test content', {
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Length': '11',
      },
      status: 200,
    });

    // Call the function - it should handle the error without throwing
    await streamFallbackToKV(mockEnv, 'videos/error-test.mp4', response, {
      cache: { ttl: { ok: 3600 } },
    });

    // Verify the error was logged
    const { logErrorWithContext } = await import('../../../src/utils/errorHandlingUtils');
    expect(logErrorWithContext).toHaveBeenCalledWith(
      'Error streaming fallback content to KV',
      expect.any(Error),
      expect.objectContaining({
        sourcePath: 'videos/error-test.mp4',
        kvNamespace: 'VIDEO_TRANSFORMATIONS_CACHE',
      }),
      'VideoStorageService'
    );
  });

  it('does not attempt to store a response with null body', async () => {
    // Import the implementation directly
    const { streamFallbackToKV } =
      await import('../../../src/services/videoStorage/fallbackStorage');

    // Create a response with null body
    const noBodyResponse = new Response(null, { status: 200 });

    // Call the function with the response
    await streamFallbackToKV(mockEnv, 'videos/no-body.mp4', noBodyResponse, {
      cache: { ttl: { ok: 3600 } },
    });

    // Verify storeTransformedVideo was not called
    const { storeTransformedVideo } = await import('../../../src/services/kvStorage/storeVideo');
    expect(storeTransformedVideo).not.toHaveBeenCalled();
  });

  it('does not attempt to store a non-OK response', async () => {
    // Import the implementation directly
    const { streamFallbackToKV } =
      await import('../../../src/services/videoStorage/fallbackStorage');

    // Create a non-OK response
    const errorResponse = new Response('Error', { status: 404 });

    // Call the function with the response
    await streamFallbackToKV(mockEnv, 'videos/not-found.mp4', errorResponse, {
      cache: { ttl: { ok: 3600 } },
    });

    // Verify storeTransformedVideo was not called
    const { storeTransformedVideo } = await import('../../../src/services/kvStorage/storeVideo');
    expect(storeTransformedVideo).not.toHaveBeenCalled();
  });
});

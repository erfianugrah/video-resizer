import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { streamFallbackToKV } from '../../../src/services/videoStorage/fallbackStorage';

// Mock all needed imports
vi.mock('../../../src/utils/errorHandlingUtils', () => ({
  withErrorHandling: vi.fn((fn, _, __) => fn),
  logErrorWithContext: vi.fn(),
  tryOrDefault: vi.fn((fn, _context, _defaultValue) => fn),
}));

vi.mock('../../../src/utils/requestContext', () => ({
  getCurrentContext: vi.fn(() => ({
    requestId: 'test-request-id',
    url: 'https://example.com/videos/test.mp4',
    startTime: Date.now(),
    headers: new Headers(),
    executionContext: {
      waitUntil: vi.fn((promise) => promise),
    },
  })),
  addBreadcrumb: vi.fn(),
}));

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

vi.mock('../../../src/services/videoStorage/pathTransform', () => ({
  applyPathTransformation: vi.fn((path) => path),
}));

// Mock the dynamic import for storeTransformedVideo
vi.mock('../../../src/services/kvStorage/storeVideo', () => ({
  storeTransformedVideo: vi.fn().mockResolvedValue(true),
}));

describe('Fallback Storage - streamFallbackToKV', () => {
  // Common test variables
  const mockEnv = {
    VIDEO_TRANSFORMATIONS_CACHE: {
      put: vi.fn(),
      get: vi.fn(),
      getWithMetadata: vi.fn(),
      delete: vi.fn(),
    } as unknown as KVNamespace,
    executionCtx: {
      waitUntil: vi.fn((promise) => promise),
    },
  };

  const mockConfig = {
    cache: {
      ttl: {
        ok: 3600,
      },
    },
  };

  // Reset mocks before each test
  beforeEach(async () => {
    vi.clearAllMocks();
    // Reset mocks for the dynamically imported storeTransformedVideo
    const { storeTransformedVideo } = await import('../../../src/services/kvStorage/storeVideo');
    vi.mocked(storeTransformedVideo).mockReset();
    vi.mocked(storeTransformedVideo).mockResolvedValue(true);
  });

  it('should stream small fallback content to KV', async () => {
    // Create small video data
    const videoData = new Uint8Array(1024 * 1024).fill(1); // 1 MB
    const videoResponse = new Response(videoData.buffer, {
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Length': videoData.length.toString(),
      },
    });

    await streamFallbackToKV(mockEnv as any, 'videos/test.mp4', videoResponse, mockConfig as any);

    // Verify storeTransformedVideo was called with correct parameters
    const { storeTransformedVideo } = await import('../../../src/services/kvStorage/storeVideo');
    expect(storeTransformedVideo).toHaveBeenCalledTimes(1);

    // Verify first parameter is the KV namespace
    expect(vi.mocked(storeTransformedVideo).mock.calls[0][0]).toBe(
      mockEnv.VIDEO_TRANSFORMATIONS_CACHE
    );

    // Verify second parameter is the path
    expect(vi.mocked(storeTransformedVideo).mock.calls[0][1]).toBe('videos/test.mp4');

    // Verify TTL was passed correctly
    expect(vi.mocked(storeTransformedVideo).mock.calls[0][4]).toBe(3600);

    // Verify logging
    expect(mockLoggerDebug).toHaveBeenCalledWith(
      'Starting background streaming of fallback to KV',
      expect.objectContaining({
        path: 'videos/test.mp4',
        contentType: 'video/mp4',
        contentLength: 1048576,
      })
    );

    expect(mockLoggerDebug).toHaveBeenCalledWith(
      'Successfully stored fallback content in KV',
      expect.objectContaining({
        path: 'videos/test.mp4',
        kvNamespace: 'VIDEO_TRANSFORMATIONS_CACHE',
      })
    );
  });

  it('should handle large video files correctly', async () => {
    // Note: streamFallbackToKV has a 128MB safety limit - files larger than that are skipped entirely.
    // Files > 40MB use storeTransformedVideoWithStreaming (not storeTransformedVideo).
    // So we test with 30MB to go through the standard storeTransformedVideo path.
    const contentLength = 30 * 1024 * 1024; // 30 MB (under 40MB streaming threshold)

    // Create a mock response with content-length header indicating size
    const smallBuffer = new Uint8Array(1024).fill(1); // 1 KB buffer as placeholder
    const largeVideoResponse = new Response(smallBuffer.buffer, {
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Length': contentLength.toString(),
        'Accept-Ranges': 'bytes',
        'X-Fallback-Applied': 'true',
      },
    });

    // Mock storeTransformedVideo implementation
    const { storeTransformedVideo: storeTransformedVideoMock } =
      await import('../../../src/services/kvStorage/storeVideo');
    (vi.mocked(storeTransformedVideoMock) as any).mockImplementation(
      async (namespace: any, path: any, response: any, options: any, ttl: any) => {
        // Simulate successful storage
        return true;
      }
    );

    await streamFallbackToKV(
      mockEnv as any,
      'videos/large-test.mp4',
      largeVideoResponse,
      mockConfig as any
    );

    // Verify storeTransformedVideo was called with correct parameters
    const { storeTransformedVideo } = await import('../../../src/services/kvStorage/storeVideo');
    expect(storeTransformedVideo).toHaveBeenCalledTimes(1);

    // Verify call arguments
    const callArgs = vi.mocked(storeTransformedVideo).mock.calls[0];
    expect(callArgs[1]).toBe('videos/large-test.mp4'); // path
    expect(callArgs[2]).toBeInstanceOf(Response); // response
    expect(typeof callArgs[4]).toBe('number'); // TTL

    // Verify logging for file
    // Check if log message about content was recorded
    expect(mockLoggerDebug).toHaveBeenCalledWith(
      expect.stringContaining('Starting background streaming of fallback to KV'),
      expect.objectContaining({
        path: 'videos/large-test.mp4',
        contentType: 'video/mp4',
        contentLength: 30 * 1024 * 1024,
      })
    );

    // Verify success message
    expect(mockLoggerDebug).toHaveBeenCalledWith(
      'Successfully stored fallback content in KV',
      expect.objectContaining({
        path: 'videos/large-test.mp4',
        kvNamespace: 'VIDEO_TRANSFORMATIONS_CACHE',
      })
    );
  });

  it('should handle errors during streaming and storage', async () => {
    // Create video data
    const videoData = new Uint8Array(2 * 1024 * 1024).fill(1); // 2 MB
    const videoResponse = new Response(videoData.buffer, {
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Length': videoData.length.toString(),
      },
    });

    // Mock storeTransformedVideo to throw an error
    const { storeTransformedVideo: storeTransformedVideoMock } =
      await import('../../../src/services/kvStorage/storeVideo');
    vi.mocked(storeTransformedVideoMock).mockRejectedValue(new Error('KV storage error'));

    await streamFallbackToKV(
      mockEnv as any,
      'videos/error-test.mp4',
      videoResponse,
      mockConfig as any
    );

    // Verify error handling
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

  it('should not proceed if KV namespace or response is missing', async () => {
    // Test with missing KV namespace
    await streamFallbackToKV(
      { ...mockEnv, VIDEO_TRANSFORMATIONS_CACHE: undefined } as any,
      'videos/test.mp4',
      new Response('test'),
      mockConfig as any
    );

    // Verify storeTransformedVideo was not called
    const { storeTransformedVideo } = await import('../../../src/services/kvStorage/storeVideo');
    expect(storeTransformedVideo).not.toHaveBeenCalled();

    // Test with missing response body
    const emptyResponse = new Response(null);
    Object.defineProperty(emptyResponse, 'body', { value: null });

    await streamFallbackToKV(mockEnv as any, 'videos/test.mp4', emptyResponse, mockConfig as any);

    // Verify storeTransformedVideo was still not called
    expect(storeTransformedVideo).not.toHaveBeenCalled();
  });

  it('should handle non-ok responses correctly', async () => {
    // Create a failed response
    const failedResponse = new Response('Not Found', {
      status: 404,
      headers: {
        'Content-Type': 'text/plain',
      },
    });

    await streamFallbackToKV(
      mockEnv as any,
      'videos/not-found.mp4',
      failedResponse,
      mockConfig as any
    );

    // Verify storeTransformedVideo was not called for non-ok responses
    const { storeTransformedVideo } = await import('../../../src/services/kvStorage/storeVideo');
    expect(storeTransformedVideo).not.toHaveBeenCalled();
  });

  it('should apply path transformation from config', async () => {
    // Create video data
    const videoData = new Uint8Array(1024).fill(1);
    const videoResponse = new Response(videoData.buffer, {
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Length': videoData.length.toString(),
      },
    });

    // Mock the path transformation to return a specific path
    const { applyPathTransformation } =
      await import('../../../src/services/videoStorage/pathTransform');
    vi.mocked(applyPathTransformation).mockReturnValue('transformed/test.mp4');

    await streamFallbackToKV(
      mockEnv as any,
      'videos/original-test.mp4',
      videoResponse,
      mockConfig as any
    );

    // Verify transformation was applied
    expect(applyPathTransformation).toHaveBeenCalledWith(
      'videos/original-test.mp4',
      mockConfig,
      'fallback'
    );

    // Verify storeTransformedVideo was called with transformed path
    const { storeTransformedVideo } = await import('../../../src/services/kvStorage/storeVideo');
    expect(vi.mocked(storeTransformedVideo).mock.calls[0][1]).toBe('transformed/test.mp4');
  });

  // This test verifies integration with the KV storage system for files
  it('should integrate correctly with KV storage for files under 40MB', async () => {
    // Note: Files > 128MB are skipped, files > 40MB use storeTransformedVideoWithStreaming.
    // We use 30MB to test the standard storeTransformedVideo path.
    const contentLength = 30 * 1024 * 1024; // 30 MB (under 40MB threshold)
    const smallData = new Uint8Array(1024).fill(1); // Small actual data

    const videoResponse = new Response(smallData.buffer, {
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Length': contentLength.toString(),
        'Accept-Ranges': 'bytes',
        'X-Fallback-Applied': 'true',
      },
    });

    // Setup a mock to inspect how storeTransformedVideo is called
    let capturedResponse: Response | null = null;
    let capturedOptions: any = null;

    const { storeTransformedVideo: storeTransformedVideoMock } =
      await import('../../../src/services/kvStorage/storeVideo');
    (vi.mocked(storeTransformedVideoMock) as any).mockImplementation(
      async (namespace: any, path: any, response: any, options: any, ttl: any) => {
        capturedResponse = response;
        capturedOptions = options;
        return true;
      }
    );

    await streamFallbackToKV(mockEnv as any, 'videos/chunked-test.mp4', videoResponse, {
      ...mockConfig,
      width: 1280,
      height: 720,
      format: 'mp4',
    } as any);

    // Verify response was passed with correct headers
    expect(capturedResponse).not.toBeNull();
    expect((capturedResponse as Response | null)?.headers.get('Content-Type')).toBe('video/mp4');
    expect((capturedResponse as Response | null)?.headers.get('Content-Length')).toBe(
      contentLength.toString()
    );

    // Verify options were passed correctly including transformation parameters
    expect(capturedOptions).toEqual(
      expect.objectContaining({
        width: 1280,
        height: 720,
        format: 'mp4',
        env: mockEnv,
      })
    );

    // Verify the log message about file processing
    expect(mockLoggerDebug).toHaveBeenCalledWith(
      expect.stringContaining('Starting background streaming of fallback to KV'),
      expect.objectContaining({
        contentLength: contentLength,
      })
    );
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { streamFallbackToKV } from '../../../src/services/videoStorage/fallbackStorage';

// Mock all needed imports
vi.mock('../../../src/utils/errorHandlingUtils', () => ({
  withErrorHandling: vi.fn((fn, _, __) => fn),
  logErrorWithContext: vi.fn()
}));

vi.mock('../../../src/utils/legacyLoggerAdapter', () => ({
  getCurrentContext: vi.fn(() => ({
    requestId: 'test-request-id',
    url: 'https://example.com/videos/test.mp4',
    startTime: Date.now(),
    headers: new Headers(),
    executionContext: {
      waitUntil: vi.fn((promise) => promise)
    }
  }))
}));

vi.mock('../../../src/utils/requestContext', () => ({
  addBreadcrumb: vi.fn()
}));

vi.mock('../../../src/services/videoStorage/logging', () => ({
  logDebug: vi.fn()
}));

vi.mock('../../../src/services/videoStorage/pathTransform', () => ({
  applyPathTransformation: vi.fn((path) => path)
}));

// Mock the dynamic import for storeTransformedVideo
vi.mock('../../../src/services/kvStorage/storeVideo', () => ({
  storeTransformedVideo: vi.fn().mockResolvedValue(true)
}));

describe('Fallback Storage - streamFallbackToKV', () => {
  // Common test variables
  const mockEnv = {
    VIDEO_TRANSFORMATIONS_CACHE: {
      put: vi.fn(),
      get: vi.fn(),
      getWithMetadata: vi.fn(),
      delete: vi.fn()
    } as unknown as KVNamespace,
    executionCtx: {
      waitUntil: vi.fn((promise) => promise)
    }
  };

  const mockConfig = {
    cache: {
      ttl: {
        ok: 3600
      }
    }
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
        'Content-Length': videoData.length.toString()
      }
    });

    await streamFallbackToKV(
      mockEnv,
      'videos/test.mp4',
      videoResponse,
      mockConfig
    );

    // Verify storeTransformedVideo was called with correct parameters
    const { storeTransformedVideo } = await import('../../../src/services/kvStorage/storeVideo');
    expect(storeTransformedVideo).toHaveBeenCalledTimes(1);

    // Verify first parameter is the KV namespace
    expect(storeTransformedVideo.mock.calls[0][0]).toBe(mockEnv.VIDEO_TRANSFORMATIONS_CACHE);
    
    // Verify second parameter is the path
    expect(storeTransformedVideo.mock.calls[0][1]).toBe('videos/test.mp4');
    
    // Verify TTL was passed correctly
    expect(storeTransformedVideo.mock.calls[0][4]).toBe(3600);


    // Verify logging
    const { logDebug } = await import('../../../src/services/videoStorage/logging');
    expect(logDebug).toHaveBeenCalledWith(
      'VideoStorageService', 
      'Starting background streaming of fallback to KV', 
      expect.objectContaining({ 
        path: 'videos/test.mp4',
        contentType: 'video/mp4',
        contentLength: 1048576
      })
    );
    
    expect(logDebug).toHaveBeenCalledWith(
      'VideoStorageService', 
      'Successfully stored fallback content in KV', 
      expect.objectContaining({
        path: 'videos/test.mp4',
        kvNamespace: 'VIDEO_TRANSFORMATIONS_CACHE'
      })
    );
  });

  it('should handle large video files (>100MB) correctly', async () => {
    // Create large video data
    // Note: We're not actually creating 100MB+ of data in memory, just mocking the size
    const contentLength = 150 * 1024 * 1024; // 150 MB
    
    // Create a mock response with content-length header indicating large size
    // but actually containing a small buffer to avoid memory issues in tests
    const smallBuffer = new Uint8Array(1024).fill(1); // 1 KB buffer as placeholder
    const largeVideoResponse = new Response(smallBuffer.buffer, {
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Length': contentLength.toString(),
        'Accept-Ranges': 'bytes',
        'X-Fallback-Applied': 'true'
      }
    });

    // Mock storeTransformedVideo implementation
    const { storeTransformedVideo: storeTransformedVideoMock } = await import('../../../src/services/kvStorage/storeVideo');
    vi.mocked(storeTransformedVideoMock).mockImplementation(
      async (namespace, path, response, options, ttl) => {
        // Simulate successful storage
        return true;
      }
    );

    await streamFallbackToKV(
      mockEnv,
      'videos/large-test.mp4',
      largeVideoResponse,
      mockConfig
    );

    // Verify storeTransformedVideo was called with correct parameters
    const { storeTransformedVideo } = await import('../../../src/services/kvStorage/storeVideo');
    expect(storeTransformedVideo).toHaveBeenCalledTimes(1);

    // Verify response passed to storeTransformedVideo has proper headers
    expect(storeTransformedVideo).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      expect.objectContaining({ headers: expect.any(Headers) }),
      expect.objectContaining({
        env: mockEnv
      }),
      expect.any(Number)
    );


    // Verify logging for large file
    const { logDebug } = await import('../../../src/services/videoStorage/logging');

    // Check if log message about large content was recorded
    expect(logDebug).toHaveBeenCalledWith(
      'VideoStorageService', 
      expect.stringContaining('Starting background streaming of fallback to KV'), 
      expect.objectContaining({ 
        path: 'videos/large-test.mp4',
        contentType: 'video/mp4',
        contentLength: 150 * 1024 * 1024
      })
    );
    
    // Verify success message
    expect(logDebug).toHaveBeenCalledWith(
      'VideoStorageService', 
      'Successfully stored fallback content in KV', 
      expect.objectContaining({
        path: 'videos/large-test.mp4',
        kvNamespace: 'VIDEO_TRANSFORMATIONS_CACHE'
      })
    );
  });

  it('should handle errors during streaming and storage', async () => {
    // Create video data
    const videoData = new Uint8Array(2 * 1024 * 1024).fill(1); // 2 MB
    const videoResponse = new Response(videoData.buffer, {
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Length': videoData.length.toString()
      }
    });

    // Mock storeTransformedVideo to throw an error
    const { storeTransformedVideo: storeTransformedVideoMock } = await import('../../../src/services/kvStorage/storeVideo');
    vi.mocked(storeTransformedVideoMock).mockRejectedValue(
      new Error('KV storage error')
    );

    await streamFallbackToKV(
      mockEnv,
      'videos/error-test.mp4',
      videoResponse,
      mockConfig
    );

    // Verify error handling
    const { logErrorWithContext } = await import('../../../src/utils/errorHandlingUtils');
    expect(logErrorWithContext).toHaveBeenCalledWith(
      'Error streaming fallback content to KV',
      expect.any(Error),
      expect.objectContaining({ 
        sourcePath: 'videos/error-test.mp4', 
        kvNamespace: 'VIDEO_TRANSFORMATIONS_CACHE' 
      }),
      'VideoStorageService'
    );
  });

  it('should not proceed if KV namespace or response is missing', async () => {
    // Test with missing KV namespace
    await streamFallbackToKV(
      { ...mockEnv, VIDEO_TRANSFORMATIONS_CACHE: undefined },
      'videos/test.mp4',
      new Response('test'),
      mockConfig
    );

    // Verify storeTransformedVideo was not called
    const { storeTransformedVideo } = await import('../../../src/services/kvStorage/storeVideo');
    expect(storeTransformedVideo).not.toHaveBeenCalled();

    // Test with missing response body
    const emptyResponse = new Response(null);
    Object.defineProperty(emptyResponse, 'body', { value: null });

    await streamFallbackToKV(
      mockEnv,
      'videos/test.mp4',
      emptyResponse,
      mockConfig
    );

    // Verify storeTransformedVideo was still not called
    expect(storeTransformedVideo).not.toHaveBeenCalled();
  });

  it('should handle non-ok responses correctly', async () => {
    // Create a failed response
    const failedResponse = new Response('Not Found', {
      status: 404,
      headers: {
        'Content-Type': 'text/plain'
      }
    });

    await streamFallbackToKV(
      mockEnv,
      'videos/not-found.mp4',
      failedResponse,
      mockConfig
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
        'Content-Length': videoData.length.toString()
      }
    });

    // Mock the path transformation to return a specific path
    const { applyPathTransformation } = await import('../../../src/services/videoStorage/pathTransform');
    vi.mocked(applyPathTransformation).mockReturnValue('transformed/test.mp4');

    await streamFallbackToKV(
      mockEnv,
      'videos/original-test.mp4',
      videoResponse,
      mockConfig
    );

    // Verify transformation was applied
    expect(applyPathTransformation).toHaveBeenCalledWith(
      'videos/original-test.mp4', 
      mockConfig, 
      'fallback'
    );

    // Verify storeTransformedVideo was called with transformed path
    const { storeTransformedVideo } = await import('../../../src/services/kvStorage/storeVideo');
    expect(storeTransformedVideo.mock.calls[0][1]).toBe('transformed/test.mp4');
  });

  // This test verifies integration with the KV chunking system for large files
  it('should integrate correctly with KV chunking for large files', async () => {
    // Create a large file that would trigger chunking
    // We're not actually creating a huge buffer, just setting the Content-Length
    const largeContentLength = 120 * 1024 * 1024; // 120 MB
    const smallData = new Uint8Array(1024).fill(1); // Small actual data
    
    const largeVideoResponse = new Response(smallData.buffer, {
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Length': largeContentLength.toString(),
        'Accept-Ranges': 'bytes',
        'X-Fallback-Applied': 'true'
      }
    });

    // Setup a mock to inspect how storeTransformedVideo is called
    let capturedResponse: Response | null = null;
    let capturedOptions: any = null;

    const { storeTransformedVideo: storeTransformedVideoMock } = await import('../../../src/services/kvStorage/storeVideo');
    vi.mocked(storeTransformedVideoMock).mockImplementation(
      async (namespace, path, response, options, ttl) => {
        capturedResponse = response;
        capturedOptions = options;
        return true;
      }
    );

    await streamFallbackToKV(
      mockEnv,
      'videos/chunked-test.mp4',
      largeVideoResponse,
      {
        ...mockConfig,
        width: 1280,
        height: 720,
        format: 'mp4'
      }
    );

    // Verify response was passed with correct headers
    expect(capturedResponse).not.toBeNull();
    expect(capturedResponse?.headers.get('Content-Type')).toBe('video/mp4');
    expect(capturedResponse?.headers.get('Content-Length')).toBe(largeContentLength.toString());
    expect(capturedResponse?.headers.get('X-Fallback-Applied')).toBe('true');
    expect(capturedResponse?.headers.get('Accept-Ranges')).toBe('bytes');
    
    // Verify options were passed correctly including transformation parameters
    expect(capturedOptions).toEqual(expect.objectContaining({
      width: 1280,
      height: 720,
      format: 'mp4',
      env: mockEnv
    }));

    // Verify the log message about large file processing
    const { logDebug } = await import('../../../src/services/videoStorage/logging');
    expect(logDebug).toHaveBeenCalledWith(
      'VideoStorageService',
      expect.stringContaining('Starting background streaming of fallback to KV'),
      expect.objectContaining({
        contentLength: largeContentLength
      })
    );
  });
});
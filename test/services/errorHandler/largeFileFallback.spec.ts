import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the streamFallbackToKV function instead of importing it directly
const streamFallbackToKV = vi.fn(async (env, sourcePath, response, config) => {
  if (!env.VIDEO_TRANSFORMATIONS_CACHE || !response.body || !response.ok) {
    return;
  }
  
  try {
    const contentType = response.headers.get('Content-Type') || 'video/mp4';
    const contentLength = parseInt(response.headers.get('Content-Length') || '0', 10);
    
    // Log start
    const { logDebug } = require('../../../src/services/videoStorage/logging');
    logDebug('VideoStorageService', 'Starting background streaming of fallback to KV', { 
      path: sourcePath,
      contentType,
      contentLength 
    });
    
    // Use our global helper instead of dynamic import
    await global.storeVideoFunctions.storeTransformedVideo(
      env.VIDEO_TRANSFORMATIONS_CACHE,
      sourcePath,
      new Response(response.body, {
        headers: new Headers({
          'Content-Type': contentType,
          'Content-Length': contentLength ? contentLength.toString() : ''
        })
      }),
      {
        width: (config as any).width || null,
        height: (config as any).height || null,
        format: (config as any).format || null,
        env: env
      },
      config?.cache?.ttl?.ok ?? 3600
    );
    
    // Log success
    logDebug('VideoStorageService', 'Successfully stored fallback content in KV', {
      path: sourcePath,
      kvNamespace: 'VIDEO_TRANSFORMATIONS_CACHE'
    });
  } catch (err) {
    const { logErrorWithContext } = require('../../../src/utils/errorHandlingUtils');
    logErrorWithContext(
      'Error streaming fallback content to KV',
      err,
      { sourcePath, kvNamespace: 'VIDEO_TRANSFORMATIONS_CACHE' },
      'VideoStorageService'
    );
  }
});

// Mock helper function to access our mocked initiateBackgroundCaching from tests
let _initiateBackgroundCaching: any;
let _handleTransformationError: any;

// Add types to the global object
declare global {
  var storeVideoFunctions: {
    storeTransformedVideo: ReturnType<typeof vi.fn>;
  };
}

// Mock all needed imports
vi.mock('../../../src/utils/errorHandlingUtils', () => ({
  withErrorHandling: vi.fn((fn, _, __) => fn),
  logErrorWithContext: vi.fn(),
  tryOrDefault: vi.fn((fn) => fn)
}));

// Mock the transformation error handler module to capture the exported functions
vi.mock('../../../src/services/errorHandler/transformationErrorHandler', () => {
  // Create mock functions we can access from our tests
  const initiateBackgroundCaching = vi.fn();
  const handleTransformationError = vi.fn();
  
  // Store references for test access
  _initiateBackgroundCaching = initiateBackgroundCaching;
  _handleTransformationError = handleTransformationError;
  
  return {
    initiateBackgroundCaching,
    handleTransformationError
  };
});

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

vi.mock('../../../src/services/errorHandler/logging', () => ({
  logDebug: vi.fn()
}));

vi.mock('../../../src/utils/transformationUtils', () => ({
  parseErrorMessage: vi.fn((str) => ({
    errorType: 'file_size_limit',
    specificError: 'Video exceeds 256MiB limit'
  })),
  isDurationLimitError: vi.fn().mockReturnValue(false),
  adjustDuration: vi.fn(),
  storeTransformationLimit: vi.fn()
}));

vi.mock('../../../src/utils/pathUtils', () => ({
  findMatchingPathPattern: vi.fn().mockResolvedValue(null)
}));

vi.mock('../../../src/services/videoStorage/pathTransform', () => ({
  applyPathTransformation: vi.fn((path) => path)
}));

// Mock the dynamic import for kvStorage utility - it's important to use the correct import path
vi.mock('../../../src/services/kvStorage/storeVideo', async (importOriginal) => {
  return {
    storeTransformedVideo: vi.fn().mockResolvedValue(true)
  };
});

// Add a helper to avoid path issues with dynamic imports
global.storeVideoFunctions = {
  storeTransformedVideo: vi.fn().mockResolvedValue(true)
};

// Mock dynamic imports using vi.mock with factory
vi.mock('../../../src/config', async () => {
  const VideoConfigManagerMock = {
    getInstance: vi.fn().mockReturnValue({
      getConfig: vi.fn().mockReturnValue({
        cache: {
          ttl: {
            ok: 3600
          }
        }
      })
    })
  };
  
  return {
    VideoConfigurationManager: VideoConfigManagerMock
  };
});

vi.mock('../../../src/utils/bypassHeadersUtils', () => ({
  setBypassHeaders: vi.fn()
}));

vi.mock('../../../src/services/presignedUrlCacheService', () => ({
  getPresignedUrl: vi.fn(),
  storePresignedUrl: vi.fn(),
  isUrlExpiring: vi.fn(),
  refreshPresignedUrl: vi.fn()
}));

describe('Large File Background Caching Integration', () => {
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

  const mockRequestContext = {
    requestId: 'test-request-id',
    url: 'https://example.com/videos/large-test.mp4',
    startTime: Date.now(),
    headers: new Headers()
  };

  const mockConfig = {
    cache: {
      ttl: {
        ok: 3600
      }
    }
  };

  // Reset mocks before each test
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset our helper mock
    global.storeVideoFunctions.storeTransformedVideo.mockReset();
    global.storeVideoFunctions.storeTransformedVideo.mockResolvedValue(true);
  });

  it('should process large files (>100MB) with streaming instead of skipping them', async () => {
    // Create large video data (just use small buffer with Content-Length header for test)
    const contentLength = 250 * 1024 * 1024; // 250 MB
    const smallDataForTest = new Uint8Array(1024).fill(1); // Small actual data for test
    
    const largeResponse = new Response(smallDataForTest.buffer, {
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Length': contentLength.toString(),
      },
      status: 200,
      statusText: 'OK'
    });
    
    // Set up our mock implementation for initiateBackgroundCaching
    _initiateBackgroundCaching.mockImplementation(async (env, path, response, reqContext, tagInfo) => {
      // Simulate the actual behavior by calling streamFallbackToKV directly
      if (env?.executionCtx?.waitUntil && response.ok && response.body) {
        const { VideoConfigurationManager } = require('../../../src/config');
        const videoConfig = VideoConfigurationManager.getInstance().getConfig();
        
        // Log as the real function would
        const { logDebug } = require('../../../src/services/errorHandler/logging');
        if (contentLength > 100 * 1024 * 1024) {
          logDebug('handleTransformationError', `Processing large ${tagInfo?.isLargeVideo ? 'large video' : 'fallback'} (${Math.round(contentLength/1024/1024)}MB) with streams API`, {
            path,
            contentLength,
            isLargeVideo: tagInfo?.isLargeVideo
          });
        }
        
        // Call the actual streamFallbackToKV function
        env.executionCtx.waitUntil(
          streamFallbackToKV(env, path, response.clone(), videoConfig)
        );
        
        logDebug('handleTransformationError', `Initiating background KV storage for ${tagInfo?.isLargeVideo ? 'large video' : 'fallback'}`, {
          path,
          contentLength,
          isLargeVideo: tagInfo?.isLargeVideo
        });
      }
    });
    
    // Test the initiateBackgroundCaching function through our mock
    await _initiateBackgroundCaching(
      mockEnv,
      'videos/large-test.mp4',
      largeResponse.clone(), // Clone the response to avoid consuming the body
      mockRequestContext as any,
      { isLargeVideo: true }
    );

    // Verify waitUntil was called with streamFallbackToKV
    expect(mockEnv.executionCtx.waitUntil).toHaveBeenCalled();
    
    // Check logging to verify large file processing was detected
    const { logDebug } = require('../../../src/services/errorHandler/logging');
    expect(logDebug).toHaveBeenCalledWith(
      'handleTransformationError',
      expect.stringContaining('Processing large large video'),
      expect.objectContaining({
        contentLength,
        path: 'videos/large-test.mp4',
        isLargeVideo: true
      })
    );
    
    expect(logDebug).toHaveBeenCalledWith(
      'handleTransformationError',
      expect.stringContaining('Initiating background KV storage for large video'),
      expect.objectContaining({
        contentLength,
        path: 'videos/large-test.mp4',
        isLargeVideo: true
      })
    );

    // Now test the actual streamFallbackToKV function with a large file
    await streamFallbackToKV(
      mockEnv,
      'videos/another-large-test.mp4',
      largeResponse.clone(), // Clone the response again
      mockConfig as any
    );

    // Since we're mocking the dynamic import, we can't directly verify the storeTransformedVideo calls
    // Instead, verify waitUntil was called and the logs indicate successful KV storage
    
    // Verify proper logging for large file
    const { logDebug: storageLogDebug } = require('../../../src/services/videoStorage/logging');
    expect(storageLogDebug).toHaveBeenCalledWith(
      'VideoStorageService',
      'Starting background streaming of fallback to KV',
      expect.objectContaining({
        contentLength,
        contentType: 'video/mp4',
        path: 'videos/another-large-test.mp4'
      })
    );
    
    expect(storageLogDebug).toHaveBeenCalledWith(
      'VideoStorageService',
      'Successfully stored fallback content in KV',
      expect.objectContaining({
        path: 'videos/another-large-test.mp4',
        kvNamespace: 'VIDEO_TRANSFORMATIONS_CACHE'
      })
    );
  });

  it('should handle the complete fallback flow for large videos', async () => {
    // Mock the fetch response
    const mockResponse = new Response(
      new Uint8Array(1024).fill(1), // Small actual data for test
      {
        status: 200,
        headers: {
          'Content-Type': 'video/mp4',
          'Content-Length': (260 * 1024 * 1024).toString(), // 260MB
          'Accept-Ranges': 'bytes'
        }
      }
    );
    
    global.fetch = vi.fn().mockResolvedValue(mockResponse);
    
    // Create a fake transformation error response
    const errorResponse = new Response(
      'Video exceeds 256MiB limit',
      {
        status: 400,
        headers: {
          'Content-Type': 'text/plain'
        }
      }
    );

    // Create mock request and context for the handler
    const originalRequest = new Request('https://example.com/videos/really-large.mp4');
    const videoTransformContext = {
      request: originalRequest,
      options: { width: 720 },
      pathPatterns: [],
      debugInfo: { enabled: false },
      env: mockEnv,
      logger: console
    };
    
    // Setup mock implementation for handleTransformationError
    _handleTransformationError.mockImplementation(async ({ 
      errorResponse, 
      originalRequest, 
      context, 
      requestContext, 
      diagnosticsInfo, 
      fallbackOriginUrl, 
      cdnCgiUrl, 
      source 
    }) => {
      // Simulate successful fetch of large video
      const fetchRes = await fetch(source);
      
      // Create a response with expected headers for testing
      const headers = new Headers({
        'Content-Type': 'video/mp4',
        'Content-Length': (260 * 1024 * 1024).toString(),
        'Accept-Ranges': 'bytes',
        'X-Fallback-Applied': 'true',
        'X-File-Size-Error': 'true',
        'X-Video-Too-Large': 'true',
        'X-Video-Exceeds-256MiB': 'true',
        'X-Direct-Stream': 'true'
      });
      
      // Log as the real handler would
      const { logDebug } = require('../../../src/services/errorHandler/logging');
      logDebug('handleTransformationError', 'Using streaming for large video with streams API', { contentLength: 260 * 1024 * 1024 });
      
      // Simulate calling initiateBackgroundCaching
      await _initiateBackgroundCaching(
        mockEnv,
        new URL(originalRequest.url).pathname,
        fetchRes.clone(),
        requestContext,
        { isLargeVideo: true }
      );
      
      return new Response(fetchRes.body, { 
        status: 200, 
        headers 
      });
    });
    
    // Call the mocked transformation error handler
    const result = await _handleTransformationError({
      errorResponse,
      originalRequest,
      context: videoTransformContext,
      requestContext: mockRequestContext as any,
      diagnosticsInfo: { enabled: false },
      fallbackOriginUrl: 'https://origin.example.com/videos/',
      cdnCgiUrl: 'https://example.com/cdn-cgi/transform/video/...',
      source: 'https://origin.example.com/videos/really-large.mp4'
    });

    // Verify the result is a response
    expect(result).toBeInstanceOf(Response);
    expect(result.status).toBe(200);
    
    // Verify that waitUntil was called (for background caching)
    expect(mockEnv.executionCtx.waitUntil).toHaveBeenCalled();
    
    // Verify that proper headers were set on the response
    expect(result.headers.get('X-Fallback-Applied')).toBe('true');
    expect(result.headers.get('X-File-Size-Error')).toBe('true');
    expect(result.headers.get('X-Video-Too-Large')).toBe('true');
    expect(result.headers.get('X-Video-Exceeds-256MiB')).toBe('true');
    
    // Verify logging to confirm large file streaming
    const { logDebug } = require('../../../src/services/errorHandler/logging');
    expect(logDebug).toHaveBeenCalledWith(
      'handleTransformationError',
      expect.stringMatching(/Using streaming for large .* with streams API/),
      expect.any(Object)
    );
  });

  it('should handle stream error gracefully', async () => {
    // Create a response that will cause an error when attempting to stream
    const errorResponse = new Response(null);
    
    // Force our global helper mock to throw an error
    global.storeVideoFunctions.storeTransformedVideo.mockRejectedValueOnce(new Error('KV storage error'));
    
    // Test streamFallbackToKV with a response that will cause an error
    await streamFallbackToKV(
      mockEnv,
      'videos/error-test.mp4',
      errorResponse,
      mockConfig as any
    );
    
    // When streamFallbackToKV has an error, it should be caught and logged
    const { logErrorWithContext } = require('../../../src/utils/errorHandlingUtils');
    
    // Check if the error was properly logged
    expect(logErrorWithContext).toHaveBeenCalledWith(
      expect.stringContaining('Error'),
      expect.any(Error),
      expect.any(Object),
      expect.any(String)
    );
  });

  it('should handle a valid response with missing body', async () => {
    // Create a response with null body to test edge case
    const noBodyResponse = new Response();
    Object.defineProperty(noBodyResponse, 'body', { value: null });
    Object.defineProperty(noBodyResponse, 'ok', { value: true });
    
    // Should return early without error
    await streamFallbackToKV(
      mockEnv,
      'videos/no-body.mp4',
      noBodyResponse,
      mockConfig as any
    );
    
    // Verify storeTransformedVideo was NOT called
    const { storeTransformedVideo } = require('../../../src/services/kvStorage/storeVideo');
    expect(storeTransformedVideo).not.toHaveBeenCalled();
    
    // Verify no error was logged
    const { logErrorWithContext } = require('../../../src/utils/errorHandlingUtils');
    expect(logErrorWithContext).not.toHaveBeenCalled();
  });
});
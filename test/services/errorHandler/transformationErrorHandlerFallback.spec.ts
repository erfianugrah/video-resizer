import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { handleTransformationError } from '../../../src/services/errorHandler/transformationErrorHandler';

// We'll manually define the mock implementation to properly test the integration
// Setup mock objects
const mockStreamFallbackToKV = vi.fn().mockResolvedValue(true);

// Setup mocks with hoisting
vi.mock('../../../src/services/videoStorage/fallbackStorage', async () => {
  return {
    streamFallbackToKV: mockStreamFallbackToKV
  };
});

vi.mock('../../../src/services/videoStorageService', async () => {
  return {
    fetchVideo: vi.fn().mockResolvedValue({
      response: new Response('mock video content', {
        status: 200,
        headers: {
          'Content-Type': 'video/mp4',
          'Content-Length': '1000'
        }
      }),
      sourceType: 'remote'
    })
  };
});

vi.mock('../../../src/services/cacheManagementService', async () => {
  return {
    cacheResponse: vi.fn(async (req, fetchFn) => fetchFn())
  };
});

vi.mock('../../../src/services/TransformationService', async () => {
  return {
    prepareVideoTransformation: vi.fn()
  };
});

vi.mock('../../../src/utils/pathUtils', async () => {
  return {
    findMatchingPathPattern: vi.fn().mockReturnValue(null)
  };
});

vi.mock('../../../src/config', async () => {
  return {
    VideoConfigurationManager: {
      getInstance: vi.fn().mockReturnValue({
        getConfig: vi.fn().mockReturnValue({
          cache: {
            ttl: {
              ok: 3600
            }
          }
        })
      })
    }
  };
});

vi.mock('../../../src/utils/transformationUtils', async () => {
  return {
    parseErrorMessage: vi.fn().mockReturnValue({
      errorType: 'file_size_limit',
      specificError: 'file size limit exceeded (256MiB)'
    }),
    isDurationLimitError: vi.fn().mockReturnValue(false),
    adjustDuration: vi.fn(),
    storeTransformationLimit: vi.fn()
  };
});

vi.mock('../../../src/utils/errorHandlingUtils', async () => {
  return {
    logErrorWithContext: vi.fn(),
    withErrorHandling: vi.fn(),
    tryOrDefault: vi.fn()
  };
});

vi.mock('../../../src/utils/requestContext', async () => {
  return {
    addBreadcrumb: vi.fn(),
    getCurrentContext: vi.fn()
  };
});

vi.mock('../../../src/utils/pinoLogger', async () => {
  return {
    createLogger: vi.fn().mockReturnValue({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    })
  };
});

vi.mock('../../../src/services/errorHandler/logging', async () => {
  return {
    logDebug: vi.fn()
  };
});

// Mock for the fetch function
const originalFetch = global.fetch;
let mockFetchImplementation: typeof fetch;

global.fetch = vi.fn();

describe('Transformation Error Handler - Background Fallback', () => {
  let mockEnv: any;
  let mockRequestContext: any;
  let mockContext: any;
  let mockError: Response;
  
  beforeEach(() => {
    // Reset mocks before each test
    vi.resetAllMocks();
    
    // Set up environment
    mockEnv = {
      VIDEO_TRANSFORMATIONS_CACHE: {
        put: vi.fn(),
        get: vi.fn(),
        getWithMetadata: vi.fn()
      },
      executionCtx: {
        waitUntil: vi.fn((promise) => promise)
      }
    };
    
    // Set up request context
    mockRequestContext = {
      requestId: 'test-request-id',
      breadcrumbs: []
    };
    
    // Set up transform context
    mockContext = {
      env: mockEnv,
      logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
      },
      request: new Request('https://example.com/test/video.mp4'),
      options: {},
      pathPatterns: [],
      debugInfo: {}
    };
    
    // Create a mock error response
    mockError = new Response('file size limit exceeded (256MiB)', {
      status: 400,
      statusText: 'Bad Request'
    });
    
    // Mock fetch successful response
    mockFetchImplementation = vi.fn().mockResolvedValue(new Response('mock video content', {
      status: 200,
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Length': '1000'
      }
    }));
    global.fetch = mockFetchImplementation;
    
    // For TransformStream
    global.TransformStream = vi.fn().mockImplementation(() => {
      const readers: any[] = [];
      const writers: any[] = [];
      
      return {
        readable: {
          getReader: () => {
            const reader = {
              read: vi.fn().mockResolvedValue({ done: true }),
              cancel: vi.fn().mockResolvedValue(undefined),
              closed: Promise.resolve(undefined)
            };
            readers.push(reader);
            return reader;
          }
        },
        writable: {
          getWriter: () => {
            const writer = {
              write: vi.fn().mockResolvedValue(undefined),
              close: vi.fn().mockResolvedValue(undefined),
              abort: vi.fn().mockResolvedValue(undefined),
              closed: Promise.resolve(undefined)
            };
            writers.push(writer);
            return writer;
          }
        }
      };
    });
  });
  
  afterEach(() => {
    global.fetch = originalFetch;
  });
  
  it('should initialize background caching for large video files', async () => {
    // Setup - large file size error
    mockError = new Response('file size limit exceeded (256MiB)', {
      status: 400,
      statusText: 'Bad Request'
    });
    
    // Call the handler with a fallback URL
    const response = await handleTransformationError({
      errorResponse: mockError,
      originalRequest: new Request('https://example.com/test/video.mp4'),
      context: mockContext,
      requestContext: mockRequestContext,
      diagnosticsInfo: {},
      fallbackOriginUrl: 'https://fallback.example.com',
      cdnCgiUrl: 'https://example.com/cdn-cgi/video/test/video.mp4'
    });
    
    // Verify the result is successful
    expect(response.status).toBe(200);
    
    // Verify waitUntil was called for background caching
    expect(mockEnv.executionCtx.waitUntil).toHaveBeenCalled();
    
    // Verify streamFallbackToKV was called with the correct parameters
    expect(mockStreamFallbackToKV).toHaveBeenCalled();
    
    // Check for fallback headers
    expect(response.headers.get('X-Fallback-Applied')).toBe('true');
    expect(response.headers.get('X-File-Size-Error')).toBe('true');
    expect(response.headers.get('X-Video-Too-Large')).toBe('true');
  });
  
  it('should initialize background caching for regular fallbacks', async () => {
    // Setup - server error
    mockError = new Response('Internal Server Error', {
      status: 500,
      statusText: 'Internal Server Error'
    });
    
    // Call the handler with a fallback URL
    const response = await handleTransformationError({
      errorResponse: mockError,
      originalRequest: new Request('https://example.com/test/video.mp4'),
      context: mockContext,
      requestContext: mockRequestContext,
      diagnosticsInfo: {},
      fallbackOriginUrl: 'https://fallback.example.com',
      cdnCgiUrl: 'https://example.com/cdn-cgi/video/test/video.mp4'
    });
    
    // Verify the result is successful
    expect(response.status).toBe(200);
    
    // Verify waitUntil was called for background caching
    expect(mockEnv.executionCtx.waitUntil).toHaveBeenCalled();
    
    // Verify streamFallbackToKV was called
    expect(mockStreamFallbackToKV).toHaveBeenCalled();
    
    // Check for fallback headers
    expect(response.headers.get('X-Fallback-Applied')).toBe('true');
    expect(response.headers.get('X-Server-Error-Fallback')).toBe('true');
  });
  
  it('should not block response waiting for background caching to complete', async () => {
    // Setup for a large file size error
    mockError = new Response('file size limit exceeded (256MiB)', {
      status: 400,
      statusText: 'Bad Request'
    });
    
    // Make streamFallbackToKV take a long time
    mockStreamFallbackToKV.mockImplementation(() => new Promise(resolve => {
      setTimeout(() => resolve(true), 1000);
    }));
    
    // Measure time to get the response
    const startTime = Date.now();
    
    // Call the handler with a fallback URL
    const response = await handleTransformationError({
      errorResponse: mockError,
      originalRequest: new Request('https://example.com/test/video.mp4'),
      context: mockContext,
      requestContext: mockRequestContext,
      diagnosticsInfo: {},
      fallbackOriginUrl: 'https://fallback.example.com',
      cdnCgiUrl: 'https://example.com/cdn-cgi/video/test/video.mp4'
    });
    
    const responseTime = Date.now() - startTime;
    
    // Verify response came back quickly
    expect(response.status).toBe(200);
    
    // Response should come back quickly as we're using waitUntil for background processing
    // We should see response in under ~100ms
    expect(responseTime).toBeLessThan(100);
    
    // Verify waitUntil was called
    expect(mockEnv.executionCtx.waitUntil).toHaveBeenCalled();
    
    console.log(`Response time: ${responseTime}ms - Background storage did not delay response`);
  });
  
  it('should handle missing executionCtx or KV namespace gracefully', async () => {
    // Setup - large file size error
    mockError = new Response('file size limit exceeded (256MiB)', {
      status: 400,
      statusText: 'Bad Request'
    });
    
    // Create context without executionCtx
    const limitedContext = {
      ...mockContext,
      env: {} // No executionCtx or KV namespace
    };
    
    // Call the handler with a fallback URL
    const response = await handleTransformationError({
      errorResponse: mockError,
      originalRequest: new Request('https://example.com/test/video.mp4'),
      context: limitedContext,
      requestContext: mockRequestContext,
      diagnosticsInfo: {},
      fallbackOriginUrl: 'https://fallback.example.com',
      cdnCgiUrl: 'https://example.com/cdn-cgi/video/test/video.mp4'
    });
    
    // Verify the response is still successful even without background caching
    expect(response.status).toBe(200);
    
    // Verify streamFallbackToKV was not called
    expect(mockStreamFallbackToKV).not.toHaveBeenCalled();
  });
});
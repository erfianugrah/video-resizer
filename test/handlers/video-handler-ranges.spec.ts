/**
 * Tests for range request handling in videoHandler
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleVideoRequest } from '../../src/handlers/videoHandler';

// Mock dependencies for videoHandler
vi.mock('../../src/utils/requestContext', () => {
  return {
    getCurrentContext: vi.fn(() => ({
      requestId: 'test-123',
      startTime: 0,
      diagnostics: {},
      activeStreams: new Map(),
      executionContext: {
        waitUntil: vi.fn((promise) => promise),
      },
    })),
    createRequestContext: vi.fn(req => ({
      requestId: 'test-123',
      url: req.url,
      startTime: 0,
      diagnostics: {},
      activeStreams: new Map(),
      executionContext: {
        waitUntil: vi.fn((promise) => promise),
      },
    })),
    addBreadcrumb: vi.fn(),
    startTimedOperation: vi.fn(),
    endTimedOperation: vi.fn(),
    setCurrentContext: vi.fn(),
  };
});

vi.mock('../../src/utils/pinoLogger', () => {
  return {
    createLogger: vi.fn(() => ({
      debug: vi.fn(),
      info: vi.fn(),
      error: vi.fn(),
    })),
    debug: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  };
});

vi.mock('../../src/services/videoTransformationService', () => {
  return {
    transformVideo: vi.fn(),
  };
});

// Mock other dependencies
vi.mock('../../src/utils/legacyLoggerAdapter', () => {
  return {
    initializeLegacyLogger: vi.fn(),
    getCurrentContext: vi.fn(() => ({
      requestId: 'test-123',
    })),
  };
});

vi.mock('../../src/utils/errorHandlingUtils', () => {
  return {
    logErrorWithContext: vi.fn(),
    withErrorHandling: vi.fn((fn, options) => {
      // Simple pass-through implementation for tests
      return fn;
    }),
    tryOrNull: vi.fn((fn) => {
      // Simple pass-through implementation for tests
      return (...args: any[]) => {
        try {
          return fn(...args);
        } catch (err) {
          return null;
        }
      };
    }),
  };
});

vi.mock('../../src/utils/pathUtils', () => {
  return {
    isCdnCgiMediaPath: vi.fn(() => false),
  };
});

vi.mock('../../src/utils/kvCacheUtils', () => {
  return {
    getFromKVCache: vi.fn().mockResolvedValue(null),
    storeInKVCache: vi.fn().mockResolvedValue(true),
  };
});

vi.mock('../../src/services/cacheManagementService', () => {
  return {
    getCachedResponse: vi.fn().mockResolvedValue(null),
    cacheResponse: vi.fn(async (req, handler) => handler()),
  };
});

vi.mock('../../src/config/CacheConfigurationManager', () => {
  return {
    CacheConfigurationManager: {
      getInstance: vi.fn(() => ({
        isKVCacheEnabled: vi.fn(() => true),
        getConfig: vi.fn(() => ({
          bypassQueryParameters: [],
          enableCacheTags: false,
          defaultMaxAge: 3600,
        })),
      })),
    },
  };
});

vi.mock('../../src/config/DebugConfigurationManager', () => {
  return {
    DebugConfigurationManager: {
      getInstance: vi.fn(() => ({
        isDebugEnabled: vi.fn(() => false),
        isVerboseEnabled: vi.fn(() => false),
      })),
    },
  };
});

vi.mock('../../src/config/VideoConfigurationManager', () => {
  return {
    VideoConfigurationManager: {
      getInstance: vi.fn(() => ({
        getConfig: vi.fn(() => ({})),
        getPathPatterns: vi.fn(() => []),
      })),
    },
  };
});

vi.mock('../../src/utils/responseBuilder', () => {
  return {
    ResponseBuilder: class MockResponseBuilder {
      constructor(public response: Response) {}
      withDebugInfo() { return this; }
      build() { return Promise.resolve(this.response); }
    },
  };
});

// Mock TransformStream for range request handling
class MockTransformStream {
  readable: any;
  writable: any;
  
  constructor() {
    this.readable = {
      // Mock properties needed for the test
    };
    this.writable = {
      getWriter: () => ({
        write: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
      }),
    };
  }
}

describe('VideoHandler Range Request Handling', () => {
  // Store original implementations
  let originalTransformStream: typeof TransformStream;
  
  beforeEach(() => {
    originalTransformStream = globalThis.TransformStream;
    // @ts-ignore - Type mismatch is expected in tests
    globalThis.TransformStream = MockTransformStream;
    
    // Mock the videoTransformationService for testing
    const { transformVideo } = require('../../src/services/videoTransformationService');
    transformVideo.mockImplementation(async () => {
      return new Response('video content', {
        status: 200,
        headers: {
          'Content-Type': 'video/mp4',
          'Content-Length': '10000',
          'Accept-Ranges': 'bytes',
        },
      });
    });
  });
  
  afterEach(() => {
    // Restore original implementations
    globalThis.TransformStream = originalTransformStream;
    vi.resetAllMocks();
  });
  
  it('should handle regular videos with Cache API for range requests', async () => {
    // Create a request with a range header
    const request = new Request('https://example.com/videos/test.mp4', {
      headers: {
        'Range': 'bytes=0-999',
      },
    });
    
    // Mock httpUtils.handleRangeRequestForInitialAccess
    vi.mock('../../src/utils/httpUtils', () => {
      return {
        handleRangeRequestForInitialAccess: vi.fn().mockImplementation(async (response, req) => {
          // Create a 206 response for testing
          const headers = new Headers(response.headers);
          headers.set('Content-Range', 'bytes 0-999/10000');
          headers.set('Content-Length', '1000');
          headers.set('X-Range-Handled-By', 'CacheAPI-Test');
          
          return new Response('partial content', {
            status: 206,
            headers,
          });
        }),
        parseRangeHeader: vi.fn(),
      };
    });
    
    // Execute the handler
    const response = await handleVideoRequest(
      request,
      { mode: 'development', isProduction: false, pathPatterns: [] },
      {},
      { waitUntil: vi.fn((promise) => promise) }
    );
    
    // Verify the response is a 206 Partial Content
    expect(response.status).toBe(206);
    expect(response.headers.get('Content-Range')).toBe('bytes 0-999/10000');
    expect(response.headers.get('X-Range-Handled-By')).toBe('CacheAPI-Test');
    
    // Verify httpUtils was used
    const { handleRangeRequestForInitialAccess } = require('../../src/utils/httpUtils');
    expect(handleRangeRequestForInitialAccess).toHaveBeenCalled();
  });
  
  it('should handle fallback videos with direct streaming for range requests', async () => {
    // Create a request with a range header
    const request = new Request('https://example.com/videos/large.mp4', {
      headers: {
        'Range': 'bytes=0-999',
      },
    });
    
    // Mock httpUtils.parseRangeHeader
    vi.mock('../../src/utils/httpUtils', () => {
      return {
        parseRangeHeader: vi.fn().mockImplementation((rangeHeader, contentLength) => {
          if (rangeHeader === 'bytes=0-999' && contentLength === 10000) {
            return { start: 0, end: 999, total: 10000 };
          }
          return null;
        }),
        handleRangeRequestForInitialAccess: vi.fn(),
      };
    });
    
    // Mock transformVideo to return a fallback response
    const { transformVideo } = require('../../src/services/videoTransformationService');
    transformVideo.mockImplementation(async () => {
      return new Response('fallback video content', {
        status: 200,
        headers: new Headers({
          'Content-Type': 'video/mp4',
          'Content-Length': '10000',
          'Accept-Ranges': 'bytes',
          'X-Fallback-Applied': 'true',
          'X-Bypass-Cache-API': 'true',
          'X-Direct-Stream-Only': 'true',
        }),
      });
    });
    
    // Create a mock response.clone method that returns a readstream
    const mockRead = vi.fn()
      .mockResolvedValueOnce({ done: false, value: new Uint8Array(1000) })
      .mockResolvedValueOnce({ done: true });
    
    const mockGetReader = vi.fn().mockReturnValue({
      read: mockRead
    });
    
    const originalClone = Response.prototype.clone;
    Response.prototype.clone = vi.fn(function(this: Response) {
      return {
        status: this.status,
        statusText: this.statusText,
        headers: new Headers(this.headers),
        body: {
          getReader: mockGetReader
        },
        clone: originalClone
      } as unknown as Response;
    });
    
    // Execute the handler
    const response = await handleVideoRequest(
      request,
      { mode: 'development', isProduction: false, pathPatterns: [] },
      {},
      { waitUntil: vi.fn((promise) => promise) }
    );
    
    // Restore original clone method
    Response.prototype.clone = originalClone;
    
    // Verify the response is a 206 Partial Content for direct stream
    expect(response.status).toBe(206);
    expect(response.headers.get('Content-Range')).toBe('bytes 0-999/10000');
    expect(response.headers.get('X-Range-Handled-By')).toBe('VideoHandler-Direct-Stream');
    expect(response.headers.get('X-Bypass-Cache-API')).toBe('true');
    expect(response.headers.get('X-Direct-Stream-Only')).toBe('true');
    expect(response.headers.get('X-Fallback-Applied')).toBe('true');
    
    // Verify httpUtils.handleRangeRequestForInitialAccess was NOT used (direct streaming)
    const { handleRangeRequestForInitialAccess } = require('../../src/utils/httpUtils');
    expect(handleRangeRequestForInitialAccess).not.toHaveBeenCalled();
    
    // Verify streaming was set up correctly
    expect(mockGetReader).toHaveBeenCalled();
  });
});
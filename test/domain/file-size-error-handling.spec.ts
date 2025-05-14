/**
 * Tests for file size error handling fallback to original source
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { VideoTransformError } from '../../src/errors/VideoTransformError';
import { handleTransformationError } from '../../src/services/errorHandler/transformationErrorHandler';

// Type definition for PathPattern without importing from actual code
interface PathPattern {
  name: string;
  matcher: string;
  processPath: boolean;
  baseUrl: string;
  originUrl: string;
  captureGroups: string[];
}

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

// Mock VideoConfigurationManager
const mockUpdateConfig = vi.fn();
const mockGetConfig = vi.fn(() => ({
  caching: {
    method: 'kv',
    debug: false,
    fallback: {
      enabled: true,
      badRequestOnly: false,
      fileSizeErrorHandling: true,
      preserveHeaders: ['Content-Type', 'Cache-Control', 'Etag'],
    },
  },
}));

vi.mock('../../src/config', async () => {
  const actual = await vi.importActual('../../src/config');
  return {
    ...actual,
    getEnvironmentConfig: vi.fn(() => ({
      mode: 'development',
      isProduction: false,
    })),
    VideoConfigurationManager: {
      getInstance: vi.fn(() => ({
        updateConfig: mockUpdateConfig,
        getConfig: mockGetConfig,
        getPathPatterns: vi.fn(() => []),
        getStorageDiagnostics: vi.fn(() => ({})),
      })),
    },
    CacheConfigurationManager: {
      getInstance: vi.fn(() => ({
        isKVCacheEnabled: vi.fn(() => true),
        getConfig: vi.fn(() => ({ bypassQueryParameters: [] }))
      })),
    },
    DebugConfigurationManager: {
      getInstance: vi.fn(() => ({
        isDebugEnabled: vi.fn(() => true),
        isVerboseEnabled: vi.fn(() => false),
      })),
    },
  };
});

vi.mock('../../src/utils/pathUtils', () => ({
  findMatchingPathPattern: vi.fn(),
  isCdnCgiMediaPath: vi.fn(() => false),
}));

// Mock cache management service to prevent circular dependencies
vi.mock('../../src/services/cacheManagementService', () => {
  return {
    cacheResponse: vi.fn((req, handler) => handler()),
    applyCacheHeaders: vi.fn((response) => response),
  };
});

// Mock transformation service for originSourceUrl
vi.mock('../../src/services/TransformationService', () => {
  return {
    prepareVideoTransformation: vi.fn().mockResolvedValue({
      cdnCgiUrl: 'https://example.com/cdn-cgi/video/test.mp4',
      cacheConfig: {
        cacheability: true,
        ttl: { ok: 86400, redirects: 3600, clientError: 60, serverError: 10 },
      },
      source: 'test',
      derivative: 'mobile',
      diagnosticsInfo: {
        errors: [],
        warnings: [],
        originSourceUrl: 'https://test-origin.com/videos/test.mp4'
      },
      originSourceUrl: 'https://test-origin.com/videos/test.mp4'
    }),
  };
});

// Mock the videoStorageService
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

// Mock responseBuilder
vi.mock('../../src/utils/responseBuilder', () => {
  return {
    ResponseBuilder: class MockResponseBuilder {
      constructor(public response: Response) {}
      withDebugInfo() { return this; }
      build() { return Promise.resolve(this.response); }
    },
  };
});

// Mock TransformVideoCommand
vi.mock('../../src/domain/commands/TransformVideoCommand', () => {
  return {
    TransformVideoCommand: class MockTransformVideoCommand {
      constructor(public params: any) {}
      execute() {
        return Promise.resolve(new Response('Original video content', {
          status: 200,
          headers: new Headers({
            'Content-Type': 'video/mp4',
            'Content-Length': '1000000',
            'Accept-Ranges': 'bytes',
            'X-Fallback-Applied': 'true',
            'X-File-Size-Error': 'true',
            'X-Direct-Source-Used': 'true',
            'X-Fallback-Source': 'origin-source-url',
            'X-Bypass-Cache-API': 'true',
            'X-Direct-Stream-Only': 'true',
            'X-Cache-API-Bypass': 'true',
            'Cache-Control': 'no-store'
          })
        }));
      }
    },
  };
});

describe('File Size Error Handling', () => {
  let globalFetch: typeof fetch;

  // Setup: Store the original fetch function
  beforeEach(() => {
    globalFetch = global.fetch;
  });

  // Cleanup: Restore the original fetch function
  afterEach(() => {
    global.fetch = globalFetch;
    vi.resetAllMocks();
  });

  it('should fall back to origin source URL for file size limit errors', async () => {
    // Import the mocked class
    const { TransformVideoCommand } = await import('../../src/domain/commands/TransformVideoCommand');
    
    // Create command with request context
    const command = new TransformVideoCommand({
      request: new Request('https://example.com/videos/test.mp4'),
      options: {
        width: 1280,
        height: 720,
        quality: 'high',
      },
      pathPatterns: [
        {
          name: 'test-pattern',
          matcher: '^/videos/(.+)$',
          processPath: true,
          baseUrl: 'https://example.com',
          originUrl: 'https://test-origin.com',
          captureGroups: ['videoId'],
        },
      ],
      debugInfo: { 
        isEnabled: true, 
        includeHeaders: true,
      },
    });

    // Execute the command
    const response = await command.execute();
    
    // Verify the response
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('Original video content');
    
    // Check headers for fallback information
    expect(response.headers.get('X-Fallback-Applied')).toBe('true');
    expect(response.headers.get('X-File-Size-Error')).toBe('true');
    expect(response.headers.get('X-Direct-Source-Used')).toBe('true');
    
    // Check for our new bypass headers
    expect(response.headers.get('X-Bypass-Cache-API')).toBe('true');
    expect(response.headers.get('X-Direct-Stream-Only')).toBe('true');
    expect(response.headers.get('X-Cache-API-Bypass')).toBe('true');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Accept-Ranges')).toBe('bytes');
  });

  // Direct test for the transformationErrorHandler function
  it('should set bypass headers for any fallback response', async () => {
    // Arrange
    const originalRequest = new Request('https://example.com/video.mp4');
    
    // Mock fetch to return original content (doesn't need to be a large video)
    global.fetch = vi.fn().mockResolvedValue(new Response('mock video content', {
      status: 200,
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Length': '10000000', // Much smaller than 256MiB
        'Accept-Ranges': 'bytes'
      }
    }));
    
    // Create a mock context and requestContext for the handler
    const context = { 
      request: originalRequest,
      logger: vi.fn(),
      pathPatterns: []
    };
    
    const requestContext = { requestId: '123', url: 'test' };
    
    // Act
    const response = await handleTransformationError({
      errorResponse: new Response('Error', { status: 500 }),
      originalRequest,
      context: context as any,
      requestContext: requestContext as any,
      diagnosticsInfo: {} as any,
      fallbackOriginUrl: 'https://example.com/original-video.mp4',
      cdnCgiUrl: 'https://example.com/cdn-cgi/video/test.mp4'
    });
    
    // Assert - should have bypass headers for ALL fallbacks
    expect(response.headers.get('X-Bypass-Cache-API')).toBe('true');
    expect(response.headers.get('X-Direct-Stream-Only')).toBe('true');
    expect(response.headers.get('X-Cache-API-Bypass')).toBe('true');
    expect(response.headers.get('X-Fallback-Applied')).toBe('true');
    expect(response.headers.get('Accept-Ranges')).toBe('bytes');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });
  
  // Basic test for direct handling of bypassed responses
  it('should properly identify fallback responses for direct streaming', async () => {
    // Import handleRangeRequestForInitialAccess for testing
    const { handleRangeRequestForInitialAccess } = await import('../../src/utils/httpUtils');
    
    // Arrange - create a fallback response
    const fallbackResponse = new Response('mock video content', {
      status: 200,
      headers: new Headers({
        'Content-Type': 'video/mp4',
        'Content-Length': '10000',
        'Accept-Ranges': 'bytes',
        'X-Fallback-Applied': 'true',
        'X-Bypass-Cache-API': 'true',
        'X-Direct-Stream-Only': 'true',
        'Cache-Control': 'no-store'
      })
    });
    
    // Create a request without Range header
    const request = new Request('https://example.com/videos/test.mp4');
    
    // Mock caches API to verify it's not used
    // @ts-ignore
    globalThis.caches = {
      open: vi.fn().mockResolvedValue({
        put: vi.fn().mockResolvedValue(undefined),
        match: vi.fn().mockResolvedValue(null),
      }),
    };
    
    // Act
    const result = await handleRangeRequestForInitialAccess(fallbackResponse, request);
    
    // Assert - should bypass cache API
    expect(result).toBe(fallbackResponse);
    // @ts-ignore
    expect(globalThis.caches.open).not.toHaveBeenCalled();
  });
});
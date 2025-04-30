/**
 * Unit tests for handleTransformationError function
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleTransformationError } from '../../src/services/errorHandlerService';
import { VideoTransformError, ErrorType } from '../../src/errors';
import { ResponseBuilder } from '../../src/utils/responseBuilder';

// Mock modules
vi.mock('../../src/utils/legacyLoggerAdapter', () => ({
  getCurrentContext: vi.fn().mockReturnValue({
    requestId: 'test-request-id',
    breadcrumbs: [],
    diagnostics: { errors: [], warnings: [] },
    url: 'https://example.com/videos/test.mp4',
    startTime: 0,
    componentTiming: {},
    debugEnabled: false
  })
}));

vi.mock('../../src/utils/pinoLogger', () => ({
  createLogger: vi.fn().mockReturnValue({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }),
  debug: vi.fn(),
  error: vi.fn()
}));

vi.mock('../../src/utils/requestContext', () => ({
  addBreadcrumb: vi.fn(),
  getCurrentContext: vi.fn().mockReturnValue({
    requestId: 'test-request-id',
    breadcrumbs: [],
    diagnostics: { errors: [], warnings: [] },
    url: 'https://example.com/videos/test.mp4',
    startTime: 0,
    componentTiming: {},
    debugEnabled: false
  })
}));

vi.mock('../../src/utils/errorHandlingUtils', () => ({
  logErrorWithContext: vi.fn(),
  withErrorHandling: vi.fn((impl) => impl),
  tryOrNull: vi.fn((impl) => impl),
  tryOrDefault: vi.fn((impl, _, defaultValue) => impl)
}));

vi.mock('../../src/utils/transformationUtils', () => ({
  parseErrorMessage: vi.fn().mockReturnValue({
    errorType: 'transformation_failed',
    specificError: 'Error transforming video',
    parameter: null
  }),
  isDurationLimitError: vi.fn().mockReturnValue(false),
  adjustDuration: vi.fn((duration) => duration),
  storeTransformationLimit: vi.fn()
}));

vi.mock('../../src/utils/pathUtils', () => ({
  findMatchingPathPattern: vi.fn().mockImplementation((path, patterns) => {
    // Find matching pattern based on path
    return patterns.find(p => path.match(new RegExp(p.matcher)));
  })
}));

vi.mock('../../src/services/videoStorageService', () => ({
  fetchVideo: vi.fn().mockResolvedValue({
    response: new Response('Global fallback response', {
      status: 200,
      headers: { 'Content-Type': 'video/mp4' }
    }),
    sourceType: 'remote',
    contentType: 'video/mp4',
    size: 1000
  })
}));

vi.mock('../../src/utils/presignedUrlUtils', () => ({
  getOrGeneratePresignedUrl: vi.fn().mockImplementation((env, url, config) => {
    // Generate presigned URL by adding a token query parameter
    const presignedUrl = new URL(url);
    presignedUrl.searchParams.set('token', 'test-presigned-token');
    presignedUrl.searchParams.set('Expires', '1600000000');
    presignedUrl.searchParams.set('Signature', 'test-signature');
    return Promise.resolve(presignedUrl.toString());
  }),
  encodePresignedUrl: vi.fn(url => url)
}));

// Mock the config module
vi.mock('../../src/config', () => {
  const VideoConfigurationManager = {
    getInstance: vi.fn().mockReturnValue({
      getConfig: vi.fn().mockReturnValue({
        storage: {
          priority: ['remote', 'fallback'],
          remoteUrl: 'https://videos.example.com',
          fallbackUrl: 'https://fallback.example.com'
        },
        pathPatterns: [
          {
            name: 'standard',
            matcher: '^/videos/.*',
            processPath: true,
            baseUrl: 'https://example.com',
            originUrl: 'https://storage.example.com',
            auth: {
              type: 'aws-s3-presigned-url',
              enabled: true,
              accessKeyVar: 'STANDARD_AWS_ACCESS_KEY_ID',
              secretKeyVar: 'STANDARD_AWS_SECRET_ACCESS_KEY',
              region: 'us-east-1'
            }
          },
          {
            name: 'premium',
            matcher: '^/premium/.*',
            processPath: true,
            baseUrl: 'https://premium.example.com',
            originUrl: 'https://premium-storage.example.com',
            auth: {
              type: 'aws-s3',
              enabled: true,
              accessKeyVar: 'PREMIUM_AWS_ACCESS_KEY_ID',
              secretKeyVar: 'PREMIUM_AWS_SECRET_ACCESS_KEY',
              region: 'us-east-1'
            }
          },
          {
            name: 'test',
            matcher: '^/test/.*',
            processPath: true,
            baseUrl: 'https://test.example.com',
            originUrl: 'https://test-storage.example.com'
          }
        ]
      }),
      getCachingConfig: vi.fn().mockReturnValue({
        fallback: {
          enabled: true,
          badRequestOnly: false
        }
      }),
      getCdnCgiConfig: vi.fn().mockReturnValue({
        basePath: '/cdn-cgi/media'
      }),
      getPathPatterns: vi.fn().mockImplementation(function() {
        return this.getConfig().pathPatterns;
      })
    })
  };
  
  return {
    VideoConfigurationManager,
    CacheConfigurationManager: {
      getInstance: vi.fn().mockReturnValue({
        getConfig: vi.fn().mockReturnValue({
          enableCacheTags: true,
          cacheTagPrefix: 'video-'
        }),
        shouldBypassCache: vi.fn().mockReturnValue(false)
      })
    }
  };
});

// Mock ResponseBuilder
vi.mock('../../src/utils/responseBuilder', () => ({
  ResponseBuilder: vi.fn().mockImplementation(() => ({
    withDebugInfo: vi.fn().mockReturnThis(),
    withCaching: vi.fn().mockReturnThis(),
    withCdnErrorInfo: vi.fn().mockReturnThis(),
    build: vi.fn().mockImplementation(async () => new Response('Mocked response', { status: 200 }))
  }))
}));

describe('handleTransformationError', () => {
  // Store original fetch
  const originalFetch = global.fetch;
  
  beforeEach(() => {
    // Mock fetch to track calls
    global.fetch = vi.fn().mockImplementation(req => {
      const url = typeof req === 'string' ? req : req.url;
      
      // Return different responses based on URL
      if (url.includes('storage.example.com')) {
        return Promise.resolve(new Response('Pattern-specific response (standard)', {
          status: 200,
          headers: { 'Content-Type': 'video/mp4' }
        }));
      } else if (url.includes('premium-storage.example.com')) {
        return Promise.resolve(new Response('Pattern-specific response (premium)', {
          status: 200,
          headers: { 'Content-Type': 'video/mp4' }
        }));
      } else if (url.includes('test-storage.example.com')) {
        return Promise.resolve(new Response('Pattern-specific response (test)', {
          status: 200,
          headers: { 'Content-Type': 'video/mp4' }
        }));
      } else {
        return Promise.resolve(new Response('Default response', {
          status: 200,
          headers: { 'Content-Type': 'video/mp4' }
        }));
      }
    });
    
    vi.clearAllMocks();
  });
  
  afterEach(() => {
    // Restore original fetch
    global.fetch = originalFetch;
  });
  
  it('should use pattern-specific origin and auth for fallback when available (aws-s3-presigned-url)', async () => {
    // Create mock error response
    const errorResponse = new Response('Transformation failed', { status: 500 });
    
    // Create test request for standard pattern (/videos/...)
    const request = new Request('https://example.com/videos/test.mp4');
    
    // Get path patterns from the mock
    const { VideoConfigurationManager } = await import('../../src/config');
    const pathPatterns = VideoConfigurationManager.getInstance().getPathPatterns();
    
    // Create context
    const context = {
      request,
      options: { width: 640, height: 360 },
      pathPatterns,
      debugInfo: { isEnabled: false }
    };
    
    // Create request context
    const requestContext = {
      requestId: 'test-request-id',
      breadcrumbs: [],
      diagnostics: { errors: [], warnings: [] },
      url: request.url,
      startTime: 0,
      componentTiming: {},
      debugEnabled: false
    };
    
    // Create diagnostics info
    const diagnosticsInfo = { errors: [], warnings: [] };
    
    // Set environment variables
    const env = {
      STANDARD_AWS_ACCESS_KEY_ID: 'test-key',
      STANDARD_AWS_SECRET_ACCESS_KEY: 'test-secret'
    };
    
    // Add env to context
    context.env = env;
    
    // Execute handleTransformationError
    const result = await handleTransformationError({
      errorResponse,
      originalRequest: request,
      context,
      requestContext,
      diagnosticsInfo,
      fallbackOriginUrl: null,
      cdnCgiUrl: 'https://example.com/cdn-cgi/media/width=640,height=360/videos/test.mp4',
      source: null
    });
    
    // Verify presignedUrlUtils.getOrGeneratePresignedUrl was called
    const { getOrGeneratePresignedUrl } = await import('../../src/utils/presignedUrlUtils');
    expect(getOrGeneratePresignedUrl).toHaveBeenCalled();
    expect(getOrGeneratePresignedUrl).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('storage.example.com'),
      expect.objectContaining({
        remoteUrl: 'https://storage.example.com',
        remoteAuth: expect.objectContaining({
          type: 'aws-s3-presigned-url'
        })
      })
    );
    
    // Verify fetch was called with the presigned URL
    expect(fetch).toHaveBeenCalled();
    const fetchCalls = vi.mocked(fetch).mock.calls;
    const lastCall = fetchCalls[fetchCalls.length - 1];
    expect(lastCall[0].url).toContain('storage.example.com');
    
    // Verify the response headers
    expect(result.headers.get('X-Pattern-Fallback-Applied')).toBeTruthy();
    expect(result.headers.get('X-Pattern-Name')).toBe('standard');
  });
  
  it('should use pattern-specific origin and auth for fallback when available (aws-s3)', async () => {
    // Create mock error response
    const errorResponse = new Response('Transformation failed', { status: 500 });
    
    // Create test request for premium pattern (/premium/...)
    const request = new Request('https://example.com/premium/special.mp4');
    
    // Get path patterns from the mock
    const { VideoConfigurationManager } = await import('../../src/config');
    const pathPatterns = VideoConfigurationManager.getInstance().getPathPatterns();
    
    // Create context
    const context = {
      request,
      options: { width: 640, height: 360 },
      pathPatterns,
      debugInfo: { isEnabled: false }
    };
    
    // Create request context
    const requestContext = {
      requestId: 'test-request-id',
      breadcrumbs: [],
      diagnostics: { errors: [], warnings: [] },
      url: request.url,
      startTime: 0,
      componentTiming: {},
      debugEnabled: false
    };
    
    // Create diagnostics info
    const diagnosticsInfo = { errors: [], warnings: [] };
    
    // Set environment variables
    const env = {
      PREMIUM_AWS_ACCESS_KEY_ID: 'test-key',
      PREMIUM_AWS_SECRET_ACCESS_KEY: 'test-secret'
    };
    
    // Add env to context
    context.env = env;
    
    // Set up AWS client mock
    vi.mock('aws4fetch', () => ({
      AwsClient: vi.fn().mockImplementation(() => ({
        sign: vi.fn().mockImplementation(req => {
          const headers = new Headers(req.headers);
          headers.set('Authorization', 'AWS4-HMAC-SHA256 Credential=test');
          headers.set('x-amz-date', '20250430T000000Z');
          return new Request(req.url, {
            method: req.method,
            headers
          });
        })
      }))
    }));
    
    // Execute handleTransformationError
    const result = await handleTransformationError({
      errorResponse,
      originalRequest: request,
      context,
      requestContext,
      diagnosticsInfo,
      fallbackOriginUrl: null,
      cdnCgiUrl: 'https://example.com/cdn-cgi/media/width=640,height=360/premium/special.mp4',
      source: null
    });
    
    // Verify fetch was called
    expect(fetch).toHaveBeenCalled();
    const fetchCalls = vi.mocked(fetch).mock.calls;
    const lastCall = fetchCalls[fetchCalls.length - 1];
    expect(lastCall[0].url).toContain('premium-storage.example.com');
    
    // Verify the response headers
    expect(result.headers.get('X-Pattern-Fallback-Applied')).toBeTruthy();
    expect(result.headers.get('X-Pattern-Name')).toBe('premium');
  });
  
  it('should use pattern-specific origin without auth when auth is not configured', async () => {
    // Create mock error response
    const errorResponse = new Response('Transformation failed', { status: 500 });
    
    // Create test request for test pattern (/test/...)
    const request = new Request('https://example.com/test/video.mp4');
    
    // Get path patterns from the mock
    const { VideoConfigurationManager } = await import('../../src/config');
    const pathPatterns = VideoConfigurationManager.getInstance().getPathPatterns();
    
    // Create context
    const context = {
      request,
      options: { width: 640, height: 360 },
      pathPatterns,
      debugInfo: { isEnabled: false }
    };
    
    // Create request context
    const requestContext = {
      requestId: 'test-request-id',
      breadcrumbs: [],
      diagnostics: { errors: [], warnings: [] },
      url: request.url,
      startTime: 0,
      componentTiming: {},
      debugEnabled: false
    };
    
    // Create diagnostics info
    const diagnosticsInfo = { errors: [], warnings: [] };
    
    // Execute handleTransformationError
    const result = await handleTransformationError({
      errorResponse,
      originalRequest: request,
      context,
      requestContext,
      diagnosticsInfo,
      fallbackOriginUrl: null,
      cdnCgiUrl: 'https://example.com/cdn-cgi/media/width=640,height=360/test/video.mp4',
      source: null
    });
    
    // Verify fetch was called with the pattern origin
    expect(fetch).toHaveBeenCalled();
    const fetchCalls = vi.mocked(fetch).mock.calls;
    const lastCall = fetchCalls[fetchCalls.length - 1];
    expect(lastCall[0].url).toContain('test-storage.example.com');
    
    // Verify the response headers
    expect(result.status).toBe(200);
  });
  
  it('should fall back to global storage if pattern-specific fetch fails', async () => {
    // Create mock error response
    const errorResponse = new Response('Transformation failed', { status: 500 });
    
    // Create test request for standard pattern (/videos/...)
    const request = new Request('https://example.com/videos/test.mp4');
    
    // Get path patterns from the mock
    const { VideoConfigurationManager } = await import('../../src/config');
    const pathPatterns = VideoConfigurationManager.getInstance().getPathPatterns();
    
    // Create context
    const context = {
      request,
      options: { width: 640, height: 360 },
      pathPatterns,
      debugInfo: { isEnabled: false }
    };
    
    // Create request context
    const requestContext = {
      requestId: 'test-request-id',
      breadcrumbs: [],
      diagnostics: { errors: [], warnings: [] },
      url: request.url,
      startTime: 0,
      componentTiming: {},
      debugEnabled: false
    };
    
    // Create diagnostics info
    const diagnosticsInfo = { errors: [], warnings: [] };
    
    // Configure fetch to fail for pattern-specific requests
    global.fetch = vi.fn().mockImplementation(req => {
      const url = typeof req === 'string' ? req : req.url;
      
      if (url.includes('storage.example.com')) {
        // Simulate failure for pattern-specific fetch
        return Promise.resolve(new Response('Not found', { status: 404 }));
      } else {
        // Succeed for global storage fetch
        return Promise.resolve(new Response('Global storage response', { 
          status: 200,
          headers: { 'Content-Type': 'video/mp4' }
        }));
      }
    });
    
    // Mock videoStorageService.fetchVideo to return successful response
    const { fetchVideo } = await import('../../src/services/videoStorageService');
    vi.mocked(fetchVideo).mockResolvedValueOnce({
      response: new Response('Global storage fallback content', {
        status: 200,
        headers: { 'Content-Type': 'video/mp4' }
      }),
      sourceType: 'remote',
      contentType: 'video/mp4',
      size: 1000
    });
    
    // Execute handleTransformationError
    const result = await handleTransformationError({
      errorResponse,
      originalRequest: request,
      context,
      requestContext,
      diagnosticsInfo,
      fallbackOriginUrl: null,
      cdnCgiUrl: 'https://example.com/cdn-cgi/media/width=640,height=360/videos/test.mp4',
      source: null
    });
    
    // Verify pattern-specific fetch was attempted
    expect(fetch).toHaveBeenCalledWith(
      expect.objectContaining({
        url: expect.stringContaining('storage.example.com')
      })
    );
    
    // Verify fetchVideo was called as fallback
    expect(fetchVideo).toHaveBeenCalled();
    
    // Verify response came from global storage
    expect(result.headers.get('X-Storage-Source')).toBe('remote');
  });
});
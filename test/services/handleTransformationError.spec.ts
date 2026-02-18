/**
 * Unit tests for handleTransformationError function
 *
 * After refactoring, pattern-based fallback was removed from handleTransformationError.
 * The function now:
 * 1. Attempts direct fetch from fallbackOriginUrl or source (if valid HTTP URL) for server/file-size errors
 * 2. Falls back to fetchVideoWithOrigins (storage service) if direct fetch fails or isn't available
 * 3. 404 errors are handled by retryWithAlternativeOrigins in TransformVideoCommand
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleTransformationError } from '../../src/services/errorHandlerService';

// Mock modules
vi.mock('../../src/utils/legacyLoggerAdapter', () => ({
  getCurrentContext: vi.fn().mockReturnValue({
    requestId: 'test-request-id',
    breadcrumbs: [],
    diagnostics: { errors: [], warnings: [] },
    url: 'https://example.com/videos/test.mp4',
    startTime: 0,
    componentTiming: {},
    debugEnabled: false,
  }),
}));

vi.mock('../../src/utils/pinoLogger', () => ({
  createLogger: vi.fn().mockReturnValue({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
  debug: vi.fn(),
  error: vi.fn(),
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
    debugEnabled: false,
  }),
}));

vi.mock('../../src/utils/errorHandlingUtils', () => ({
  logErrorWithContext: vi.fn(),
  withErrorHandling: vi.fn((impl) => impl),
  tryOrNull: vi.fn((impl) => impl),
  tryOrDefault: vi.fn((impl, _, defaultValue) => impl),
}));

vi.mock('../../src/utils/transformationUtils', () => ({
  parseErrorMessage: vi.fn().mockReturnValue({
    errorType: 'transformation_failed',
    specificError: 'Error transforming video',
    parameter: null,
  }),
  isDurationLimitError: vi.fn().mockReturnValue(false),
  adjustDuration: vi.fn((duration) => duration),
  storeTransformationLimit: vi.fn(),
}));

vi.mock('../../src/utils/bypassHeadersUtils', () => ({
  setBypassHeaders: vi.fn(),
}));

vi.mock('../../src/utils/flexibleBindings', () => ({
  getCacheKV: vi.fn().mockReturnValue(null),
  getPresignedUrlKV: vi.fn().mockReturnValue(null),
}));

// Mock the config module
vi.mock('../../src/config', () => {
  const VideoConfigurationManager = {
    getInstance: vi.fn().mockReturnValue({
      getConfig: vi.fn().mockReturnValue({
        storage: {
          priority: ['remote', 'fallback'],
          remoteUrl: 'https://videos.example.com',
          fallbackUrl: 'https://fallback.example.com',
        },
      }),
      getCachingConfig: vi.fn().mockReturnValue({
        fallback: {
          enabled: true,
          badRequestOnly: false,
        },
      }),
    }),
  };

  return {
    VideoConfigurationManager,
    CacheConfigurationManager: {
      getInstance: vi.fn().mockReturnValue({
        getConfig: vi.fn().mockReturnValue({
          enableCacheTags: true,
          cacheTagPrefix: 'video-',
        }),
        shouldBypassCache: vi.fn().mockReturnValue(false),
      }),
    },
  };
});

// Mock fetchVideoWithOrigins (used as storage service fallback)
const mockFetchVideoWithOrigins = vi.fn().mockResolvedValue({
  response: new Response('Storage service fallback response', {
    status: 200,
    headers: { 'Content-Type': 'video/mp4' },
  }),
  sourceType: 'remote',
  contentType: 'video/mp4',
  size: 1000,
  error: undefined,
});

vi.mock('../../src/services/videoStorage/fetchVideoWithOrigins', () => ({
  fetchVideoWithOrigins: (...args: any[]) => mockFetchVideoWithOrigins(...args),
}));

// Mock fallbackStorage streamFallbackToKV
vi.mock('../../src/services/videoStorage/fallbackStorage', () => ({
  streamFallbackToKV: vi.fn().mockResolvedValue(undefined),
}));

describe('handleTransformationError', () => {
  // Store original fetch
  const originalFetch = global.fetch;

  beforeEach(() => {
    // Mock fetch to track calls
    global.fetch = vi.fn().mockImplementation((req) => {
      const url = typeof req === 'string' ? req : req.url;
      return Promise.resolve(
        new Response('Direct fetch response', {
          status: 200,
          headers: { 'Content-Type': 'video/mp4' },
        })
      );
    });

    vi.clearAllMocks();

    // Reset the fetchVideoWithOrigins mock
    mockFetchVideoWithOrigins.mockResolvedValue({
      response: new Response('Storage service fallback response', {
        status: 200,
        headers: { 'Content-Type': 'video/mp4' },
      }),
      sourceType: 'remote',
      contentType: 'video/mp4',
      size: 1000,
      error: undefined,
    });
  });

  afterEach(() => {
    // Restore original fetch
    global.fetch = originalFetch;
  });

  it('should use pattern-specific origin and auth for fallback when available (aws-s3-presigned-url)', async () => {
    // Create mock error response - 500 triggers direct fetch path
    const errorResponse = new Response('Transformation failed', { status: 500 });

    // Create test request for standard pattern (/videos/...)
    const request = new Request('https://example.com/videos/test.mp4');

    // Create context with env
    const context = {
      request,
      options: { width: 640, height: 360 },
      pathPatterns: [],
      debugInfo: { isEnabled: false },
      env: {
        STANDARD_AWS_ACCESS_KEY_ID: 'test-key',
        STANDARD_AWS_SECRET_ACCESS_KEY: 'test-secret',
      },
    };

    // Create request context
    const requestContext = {
      requestId: 'test-request-id',
      breadcrumbs: [],
      diagnostics: { errors: [], warnings: [] },
      url: request.url,
      startTime: 0,
      componentTiming: {},
      debugEnabled: false,
    };

    // Provide a valid fallbackOriginUrl to trigger direct fetch with presigned URL origin
    const result = await handleTransformationError({
      errorResponse,
      originalRequest: request,
      context: context as any,
      requestContext: requestContext as any,
      diagnosticsInfo: { errors: [], warnings: [] } as any,
      fallbackOriginUrl: 'https://storage.example.com/videos/test.mp4',
      cdnCgiUrl: 'https://example.com/cdn-cgi/media/width=640,height=360/videos/test.mp4',
      source: undefined,
    });

    // Verify fetch was called with the fallbackOriginUrl (direct fetch path)
    expect(fetch).toHaveBeenCalled();
    const fetchCalls = vi.mocked(fetch).mock.calls;
    // The direct fetch creates a new Request from the source URL
    const firstCallArg = fetchCalls[0][0] as any;
    const fetchedUrl = typeof firstCallArg === 'string' ? firstCallArg : firstCallArg.url;
    expect(fetchedUrl).toContain('storage.example.com');

    // Verify the response indicates fallback was applied
    expect(result.headers.get('X-Fallback-Applied')).toBe('true');
    expect(result.status).toBe(200);
  });

  it('should use pattern-specific origin and auth for fallback when available (aws-s3)', async () => {
    // Create mock error response
    const errorResponse = new Response('Transformation failed', { status: 500 });

    // Create test request for premium pattern (/premium/...)
    const request = new Request('https://example.com/premium/special.mp4');

    // Create context
    const context = {
      request,
      options: { width: 640, height: 360 },
      pathPatterns: [],
      debugInfo: { isEnabled: false },
      env: {
        PREMIUM_AWS_ACCESS_KEY_ID: 'test-key',
        PREMIUM_AWS_SECRET_ACCESS_KEY: 'test-secret',
      },
    };

    // Create request context
    const requestContext = {
      requestId: 'test-request-id',
      breadcrumbs: [],
      diagnostics: { errors: [], warnings: [] },
      url: request.url,
      startTime: 0,
      componentTiming: {},
      debugEnabled: false,
    };

    // Provide a valid source URL (premium origin) to trigger direct fetch
    const result = await handleTransformationError({
      errorResponse,
      originalRequest: request,
      context: context as any,
      requestContext: requestContext as any,
      diagnosticsInfo: { errors: [], warnings: [] } as any,
      fallbackOriginUrl: null,
      cdnCgiUrl: 'https://example.com/cdn-cgi/media/width=640,height=360/premium/special.mp4',
      source: 'https://premium-storage.example.com/premium/special.mp4',
    });

    // Verify fetch was called with the source URL (direct fetch path)
    expect(fetch).toHaveBeenCalled();
    const fetchCalls = vi.mocked(fetch).mock.calls;
    const firstCallArg = fetchCalls[0][0] as any;
    const fetchedUrl = typeof firstCallArg === 'string' ? firstCallArg : firstCallArg.url;
    expect(fetchedUrl).toContain('premium-storage.example.com');

    // Verify the response indicates fallback was applied
    expect(result.headers.get('X-Fallback-Applied')).toBe('true');
    expect(result.status).toBe(200);
  });

  it('should use pattern-specific origin without auth when auth is not configured', async () => {
    // Create mock error response
    const errorResponse = new Response('Transformation failed', { status: 500 });

    // Create test request for test pattern (/test/...)
    const request = new Request('https://example.com/test/video.mp4');

    // Create context (no auth env vars needed)
    const context = {
      request,
      options: { width: 640, height: 360 },
      pathPatterns: [],
      debugInfo: { isEnabled: false },
      env: {},
    };

    // Create request context
    const requestContext = {
      requestId: 'test-request-id',
      breadcrumbs: [],
      diagnostics: { errors: [], warnings: [] },
      url: request.url,
      startTime: 0,
      componentTiming: {},
      debugEnabled: false,
    };

    // Provide a valid source URL to trigger direct fetch (no auth needed)
    const result = await handleTransformationError({
      errorResponse,
      originalRequest: request,
      context: context as any,
      requestContext: requestContext as any,
      diagnosticsInfo: { errors: [], warnings: [] } as any,
      fallbackOriginUrl: null,
      cdnCgiUrl: 'https://example.com/cdn-cgi/media/width=640,height=360/test/video.mp4',
      source: 'https://test-storage.example.com/test/video.mp4',
    });

    // Verify fetch was called with the source URL
    expect(fetch).toHaveBeenCalled();
    const fetchCalls = vi.mocked(fetch).mock.calls;
    const firstCallArg = fetchCalls[0][0] as any;
    const fetchedUrl = typeof firstCallArg === 'string' ? firstCallArg : firstCallArg.url;
    expect(fetchedUrl).toContain('test-storage.example.com');

    // Verify the response is successful
    expect(result.status).toBe(200);
    expect(result.headers.get('X-Fallback-Applied')).toBe('true');
  });

  it('should fall back to global storage if pattern-specific fetch fails', async () => {
    // Create mock error response
    const errorResponse = new Response('Transformation failed', { status: 500 });

    // Create test request for standard pattern (/videos/...)
    const request = new Request('https://example.com/videos/test.mp4');

    // Create context
    const context = {
      request,
      options: { width: 640, height: 360 },
      pathPatterns: [],
      debugInfo: { isEnabled: false },
      env: {},
    };

    // Create request context
    const requestContext = {
      requestId: 'test-request-id',
      breadcrumbs: [],
      diagnostics: { errors: [], warnings: [] },
      url: request.url,
      startTime: 0,
      componentTiming: {},
      debugEnabled: false,
    };

    // Configure fetch to fail for direct fetch attempts
    global.fetch = vi.fn().mockImplementation(() => {
      return Promise.resolve(new Response('Not found', { status: 404 }));
    });

    // Mock fetchVideoWithOrigins to return successful response (storage service fallback)
    mockFetchVideoWithOrigins.mockResolvedValueOnce({
      response: new Response('Storage service fallback content', {
        status: 200,
        headers: { 'Content-Type': 'video/mp4' },
      }),
      sourceType: 'remote',
      contentType: 'video/mp4',
      size: 1000,
      error: undefined,
    });

    // Execute handleTransformationError with a valid source URL that will fail
    const result = await handleTransformationError({
      errorResponse,
      originalRequest: request,
      context: context as any,
      requestContext: requestContext as any,
      diagnosticsInfo: { errors: [], warnings: [] } as any,
      fallbackOriginUrl: 'https://storage.example.com/videos/test.mp4',
      cdnCgiUrl: 'https://example.com/cdn-cgi/media/width=640,height=360/videos/test.mp4',
      source: undefined,
    });

    // Verify direct fetch was attempted
    expect(fetch).toHaveBeenCalled();

    // Verify fetchVideoWithOrigins was called as fallback (storage service)
    expect(mockFetchVideoWithOrigins).toHaveBeenCalled();

    // Verify response came from storage service fallback
    expect(result.headers.get('X-Fallback-Applied')).toBe('true');
    expect(result.headers.get('X-Storage-Source')).toBe('remote');
  });
});

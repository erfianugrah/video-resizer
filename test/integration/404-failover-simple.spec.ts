import { describe, it, expect, vi, beforeEach } from 'vitest';
import { retryWithAlternativeOrigins } from '../../src/services/transformation/retryWithAlternativeOrigins';

// Mock dependencies
vi.mock('../../src/utils/pinoLogger', () => ({
  createLogger: vi.fn().mockReturnValue({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  })
}));

vi.mock('../../src/services/errorHandler/logging', () => ({
  logDebug: vi.fn()
}));

vi.mock('../../src/utils/errorHandlingUtils', () => ({
  logErrorWithContext: vi.fn()
}));

vi.mock('../../src/utils/requestContext', () => ({
  addBreadcrumb: vi.fn()
}));

describe('404 Failover - Simple Test', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should handle retry with alternative origins correctly', async () => {
    // Mock fetchVideoWithOrigins to return success
    vi.mock('../../src/services/videoStorage/fetchVideoWithOrigins', () => ({
      fetchVideoWithOrigins: vi.fn().mockResolvedValue({
        response: new Response('Video content', {
          status: 200,
          headers: { 'Content-Type': 'video/mp4' }
        }),
        sourceType: 'remote',
        contentType: 'video/mp4',
        size: 1000,
        originalUrl: 'https://backup.example.com/videos/test.mp4',
        path: 'test.mp4'
      })
    }));

    // Mock VideoConfigurationManager
    vi.mock('../../src/config/VideoConfigurationManager', () => ({
      VideoConfigurationManager: {
        getInstance: () => ({
          getConfig: () => ({
            origins: {
              items: [{
                name: 'videos',
                matcher: '^/videos/(.+)$',
                sources: [
                  { type: 'r2', priority: 1 },
                  { type: 'remote', priority: 2 }
                ]
              }]
            }
          })
        })
      }
    }));

    // Mock prepareVideoTransformation
    vi.mock('../../src/services/TransformationService', () => ({
      prepareVideoTransformation: vi.fn().mockReturnValue({
        cdnCgiUrl: 'https://example.com/cdn-cgi/media/v1/videos/test.mp4?width=1920'
      })
    }));

    // Mock cacheResponse
    vi.mock('../../src/services/cacheManagementService', () => ({
      cacheResponse: vi.fn().mockImplementation(async (req, fetchFn) => {
        return new Response('Transformed video', {
          status: 200,
          headers: { 'Content-Type': 'video/mp4' }
        });
      })
    }));

    const { retryWithAlternativeOrigins } = await import('../../src/services/transformation/retryWithAlternativeOrigins');
    const { fetchVideoWithOrigins } = await import('../../src/services/videoStorage/fetchVideoWithOrigins');

    const mockRequest = new Request('https://example.com/videos/test.mp4?imwidth=1920');
    const mockOrigin = {
      name: 'videos',
      matcher: '^/videos/(.+)$',
      sources: [
        { type: 'r2', priority: 1, bucketBinding: 'VIDEO_ASSETS', pathTemplate: '{1}', path: '{1}' },
        { type: 'remote', priority: 2, url: 'https://backup.example.com', pathTemplate: 'videos/{1}', path: 'videos/{1}' }
      ]
    };
    
    const mockFailedSource = mockOrigin.sources[0]; // R2 source failed
    
    const mockContext = {
      request: mockRequest,
      options: { width: 1920 },
      origin: mockOrigin,
      env: { VIDEO_ASSETS: {} }
    };

    const mockRequestContext = {
      requestId: 'test-123',
      url: mockRequest.url,
      startTime: Date.now(),
      breadcrumbs: [],
      diagnostics: {
        errors: [],
        warnings: [],
        originalUrl: mockRequest.url
      },
      componentTiming: {},
      debugEnabled: false,
      verboseEnabled: false
    };

    const response = await retryWithAlternativeOrigins({
      originalRequest: mockRequest,
      transformOptions: { width: 1920 },
      failedOrigin: mockOrigin,
      failedSource: mockFailedSource,
      context: mockContext,
      env: { VIDEO_ASSETS: {} } as any,
      requestContext: mockRequestContext,
      pathPatterns: [],
      debugInfo: {}
    });

    // Verify the response
    expect(response).toBeDefined();
    expect(response.status).toBe(200);
    expect(response.headers.get('X-Retry-Applied')).toBe('true');
    expect(response.headers.get('X-Failed-Source')).toBe('r2');
    expect(response.headers.get('X-Alternative-Source')).toBe('remote');

    // Verify fetchVideoWithOrigins was called with exclusions
    expect(vi.mocked(fetchVideoWithOrigins)).toHaveBeenCalledWith(
      '/videos/test.mp4',
      expect.any(Object),
      expect.any(Object),
      mockRequest,
      {
        excludeSources: [{
          originName: 'videos',
          sourceType: 'r2',
          sourcePriority: 1
        }]
      }
    );
  });
});
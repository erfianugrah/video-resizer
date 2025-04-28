/**
 * Tests for file size error handling fallback to original source
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TransformVideoCommand } from '../../src/domain/commands/TransformVideoCommand';
import { VideoConfigurationManager } from '../../src/config';
import { PathPattern } from '../../src/utils/pathUtils';

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
  };
});

vi.mock('../../src/config', () => {
  const actual = vi.importActual('../../src/config');
  return {
    ...actual,
    getEnvironmentConfig: vi.fn(() => ({
      mode: 'development',
      isProduction: false,
    })),
  };
});

describe('File Size Error Handling', () => {
  let globalFetch: typeof fetch;

  // Setup: Store the original fetch function
  beforeEach(() => {
    globalFetch = global.fetch;
    
    // Initialize configuration with file size error handling enabled
    const configManager = VideoConfigurationManager.getInstance();
    configManager.updateConfig({
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

    // Mock cache management service to prevent circular dependencies
    vi.mock('../../src/services/cacheManagementService', () => {
      return {
        cacheResponse: vi.fn((req, handler) => handler()),
        applyCacheHeaders: vi.fn((response) => response),
      };
    });
  });

  // Cleanup: Restore the original fetch function
  afterEach(() => {
    global.fetch = globalFetch;
    vi.resetAllMocks();
  });

  it('should fall back to origin source URL for file size limit errors', async () => {
    // Mock fetch to return a file size error from CDN-CGI
    global.fetch = vi.fn()
      .mockImplementationOnce(() => {
        // First call - return a file size error response
        return Promise.resolve(new Response(
          'Error: file size limit exceeded (12MB). Maximum allowed size is 10MB.',
          {
            status: 413,
            statusText: 'Request Entity Too Large',
            headers: {
              'Content-Type': 'text/plain',
            },
          }
        ));
      })
      .mockImplementationOnce(() => {
        // Second call - direct source fetch success
        return Promise.resolve(new Response(
          'Original video content',
          {
            status: 200,
            headers: {
              'Content-Type': 'video/mp4',
              'Content-Length': '1000000',
            },
          }
        ));
      });

    // Setup test path patterns
    const pathPatterns: PathPattern[] = [
      {
        name: 'test-pattern',
        matcher: '^/videos/(.+)$',
        processPath: true,
        baseUrl: 'https://example.com',
        originUrl: 'https://test-origin.com',
        captureGroups: ['videoId'],
      },
    ];

    // Create command with request context
    const command = new TransformVideoCommand({
      request: new Request('https://example.com/videos/test.mp4'),
      options: {
        width: 1280,
        height: 720,
        quality: 'high',
      },
      pathPatterns,
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
    expect(response.headers.get('X-Fallback-Source')).toBe('origin-source-url');
    
    // Ensure fetch was called correctly
    expect(global.fetch).toHaveBeenCalledTimes(2);
    
    // First call should be to CDN-CGI URL
    const firstCallUrl = (global.fetch as any).mock.calls[0][0];
    expect(typeof firstCallUrl).toBe('string');
    expect(firstCallUrl).toContain('cdn-cgi');
    
    // Second call should use the origin source URL directly
    const secondCallUrl = (global.fetch as any).mock.calls[1][0].url;
    expect(secondCallUrl).toBe('https://test-origin.com/videos/test.mp4');
  });
});
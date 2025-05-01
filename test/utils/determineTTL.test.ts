import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { determineTTL } from '../../src/utils/determineTTL-no-profiles';

// Mock dependencies
vi.mock('../../src/utils/legacyLoggerAdapter', () => ({
  getCurrentContext: vi.fn(() => ({
    url: 'https://example.com/videos/test-video.mp4',
    requestId: 'test-request-id'
  }))
}));

vi.mock('../../src/utils/pinoLogger', () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  })),
  debug: vi.fn()
}));

vi.mock('../../src/config/VideoConfigurationManager', () => {
  const mockGetInstance = vi.fn().mockReturnValue({
    getConfig: vi.fn().mockReturnValue({
      pathPatterns: [
        {
          name: 'videos',
          matcher: '^/videos/',
          ttl: {
            ok: 300,
            redirects: 300,
            clientError: 60,
            serverError: 10
          }
        },
        {
          name: 'popular',
          matcher: '^/popular/(.*\\.mp4)',
          ttl: {
            ok: 604800,
            redirects: 300,
            clientError: 60,
            serverError: 10
          }
        },
        {
          name: 'default',
          matcher: '.*',
          ttl: {
            ok: 300,
            redirects: 300,
            clientError: 60,
            serverError: 10
          }
        }
      ]
    })
  });

  return {
    VideoConfigurationManager: {
      getInstance: mockGetInstance
    }
  };
});

describe('determineTTL - No Profiles Version', () => {
  let mockResponse: Response;
  let mockConfig: any;
  
  beforeEach(() => {
    // Create a mock response
    mockResponse = new Response('test data', {
      status: 200,
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Length': '1000'
      }
    });
    
    // Create a mock config
    mockConfig = {
      ttl: {
        ok: 86400,
        redirects: 300,
        clientError: 60,
        serverError: 10
      }
    };
    
    // Reset getCurrentContext mock to default URL
    vi.mocked(require('../../src/utils/legacyLoggerAdapter').getCurrentContext).mockReturnValue({
      url: 'https://example.com/videos/test-video.mp4',
      requestId: 'test-request-id'
    });
  });
  
  afterEach(() => {
    vi.resetAllMocks();
  });
  
  it('should use path pattern TTL for /videos/ path', () => {
    // The mocked URL is videos path
    const ttl = determineTTL(mockResponse, mockConfig);
    
    // Should use videos pattern TTL (300) instead of global TTL (86400)
    expect(ttl).toBe(300);
  });
  
  it('should use path pattern TTL for /popular/ path', () => {
    // Mock the URL to be popular path
    vi.mocked(require('../../src/utils/legacyLoggerAdapter').getCurrentContext).mockReturnValue({
      url: 'https://example.com/popular/trending-video.mp4',
      requestId: 'test-request-id'
    });
    
    const ttl = determineTTL(mockResponse, mockConfig);
    
    // Should use popular pattern TTL (604800 = 7 days)
    expect(ttl).toBe(604800);
  });
  
  it('should use default path pattern TTL for unmatched paths', () => {
    // Mock the URL to be an unmatched path
    vi.mocked(require('../../src/utils/legacyLoggerAdapter').getCurrentContext).mockReturnValue({
      url: 'https://example.com/other/random-path.html',
      requestId: 'test-request-id'
    });
    
    const ttl = determineTTL(mockResponse, mockConfig);
    
    // Should use default pattern TTL (300) instead of global TTL (86400)
    expect(ttl).toBe(300);
  });
  
  it('should use global TTL if no path patterns match and no default pattern exists', () => {
    // Mock the VideoConfigurationManager to return no patterns
    vi.mocked(require('../../src/config/VideoConfigurationManager').VideoConfigurationManager.getInstance).mockReturnValue({
      getConfig: vi.fn().mockReturnValue({
        pathPatterns: []
      })
    });
    
    const ttl = determineTTL(mockResponse, mockConfig);
    
    // Should use global TTL (86400)
    expect(ttl).toBe(86400);
  });
  
  it('should handle different status codes correctly', () => {
    // Create responses with different status codes
    const redirectResponse = new Response('', { status: 302 });
    const clientErrorResponse = new Response('', { status: 404 });
    const serverErrorResponse = new Response('', { status: 500 });
    
    // Use the ttl from the videos pattern which is the default test URL
    expect(determineTTL(redirectResponse, mockConfig)).toBe(300); // redirects
    expect(determineTTL(clientErrorResponse, mockConfig)).toBe(60); // clientError
    expect(determineTTL(serverErrorResponse, mockConfig)).toBe(10); // serverError
  });
  
  it('should handle missing config gracefully', () => {
    const ttl = determineTTL(mockResponse, {});
    
    // Should use hardcoded defaults - ok status code is 200, so 300 seconds
    expect(ttl).toBe(300);
  });
});
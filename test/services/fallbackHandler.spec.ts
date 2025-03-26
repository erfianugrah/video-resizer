import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchOriginalContentFallback } from '../../src/services/errorHandlerService';
import { VideoTransformError, ErrorType } from '../../src/errors';

// Mock legacy logger adapter
vi.mock('../../src/utils/legacyLoggerAdapter', () => ({
  error: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
  getCurrentContext: vi.fn().mockReturnValue(null)
}));

// Mock Pino logger
vi.mock('../../src/utils/pinoLogger', () => ({
  createLogger: vi.fn().mockReturnValue({}),
  error: vi.fn(),
  debug: vi.fn(),
  info: vi.fn()
}));

describe('Fallback Handler', () => {
  // Mock the VideoConfigurationManager to control fallback settings
  vi.mock('../../src/config', () => ({
    VideoConfigurationManager: {
      getInstance: vi.fn().mockReturnValue({
        getCachingConfig: vi.fn().mockReturnValue({
          fallback: {
            enabled: true,
            badRequestOnly: true,
            preserveHeaders: ['Content-Type', 'Content-Length']
          }
        })
      })
    }
  }));
  
  // Mock global fetch to return a test response
  const originalFetch = global.fetch;
  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response('Original video content', {
        status: 200,
        headers: {
          'Content-Type': 'video/mp4',
          'Content-Length': '1000'
        }
      })
    );
  });
  
  afterEach(() => {
    global.fetch = originalFetch;
  });
  
  it('should fetch original content when a 400 error occurs', async () => {
    const originalUrl = 'https://example.com/original-video.mp4';
    const error = new VideoTransformError('Invalid width', ErrorType.INVALID_DIMENSION);
    error.statusCode = 400;
    
    const request = new Request('https://example.com/cdn-cgi/video.mp4');
    
    const response = await fetchOriginalContentFallback(originalUrl, error, request);
    
    expect(response).not.toBeNull();
    expect(global.fetch).toHaveBeenCalledWith(
      expect.objectContaining({
        url: originalUrl
      })
    );
    
    expect(response?.headers.get('X-Fallback-Applied')).toBe('true');
    expect(response?.headers.get('X-Fallback-Reason')).toBe('Invalid width');
    expect(response?.headers.get('X-Original-Error-Type')).toBe(ErrorType.INVALID_DIMENSION);
    expect(response?.headers.get('Content-Type')).toBe('video/mp4');
  });
  
  it('should not fetch original content for non-400 errors when badRequestOnly is true', async () => {
    const originalUrl = 'https://example.com/original-video.mp4';
    const error = new VideoTransformError('Server error', ErrorType.TRANSFORMATION_FAILED);
    error.statusCode = 500;
    
    const request = new Request('https://example.com/cdn-cgi/video.mp4');
    
    const response = await fetchOriginalContentFallback(originalUrl, error, request);
    
    expect(response).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });
  
  it('should not fetch original content when fallback is disabled', async () => {
    // Override mock to disable fallback
    const configMock = await import('../../src/config');
    vi.mocked(configMock.VideoConfigurationManager.getInstance).mockReturnValueOnce({
      getCachingConfig: vi.fn().mockReturnValue({
        fallback: {
          enabled: false,
          badRequestOnly: true
        }
      })
    });
    
    const originalUrl = 'https://example.com/original-video.mp4';
    const error = new VideoTransformError('Invalid width', ErrorType.INVALID_DIMENSION);
    error.statusCode = 400;
    
    const request = new Request('https://example.com/cdn-cgi/video.mp4');
    
    const response = await fetchOriginalContentFallback(originalUrl, error, request);
    
    expect(response).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
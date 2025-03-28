/**
 * Tests for TransformVideoCommand
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMockRequest,
  createMockPathPatterns,
  getLastFetchedUrl,
} from '../utils/test-utils';
import { TransformVideoCommand } from '../../src/domain/commands/TransformVideoCommand';

// Mock fetch
const mockFetchResponse = new Response('Video content', {
  status: 200,
  headers: { 'Content-Type': 'video/mp4' },
});

global.fetch = vi.fn().mockResolvedValue(mockFetchResponse);

describe('TransformVideoCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(global, 'fetch').mockResolvedValue(mockFetchResponse);
  });

  it('should transform video URLs based on path patterns', async () => {
    // Arrange
    const request = createMockRequest('https://example.com/videos/sample.mp4?width=640&height=360');
    const pathPatterns = createMockPathPatterns();
    const options = {
      width: 640,
      height: 360,
      mode: 'video',
    };

    const command = new TransformVideoCommand({
      request,
      options,
      pathPatterns,
      debugInfo: {},
    });

    // Act
    await command.execute();

    // Assert
    expect(fetch).toHaveBeenCalled();
    const fetchUrl = getLastFetchedUrl(fetch);
    expect(fetchUrl).toContain('/cdn-cgi/media/');
    expect(fetchUrl).toContain('width=640');
    expect(fetchUrl).toContain('height=360');
    expect(fetchUrl).toContain('mode=video');
    expect(fetchUrl).toContain('/videos/sample.mp4');
  });

  it('should transform URLs with custom origin based on path pattern', async () => {
    // Arrange
    const request = createMockRequest('https://example.com/custom/video1.mp4?width=500');
    const pathPatterns = createMockPathPatterns();
    const options = {
      width: 500,
      mode: 'video',
    };

    const command = new TransformVideoCommand({
      request,
      options,
      pathPatterns,
      debugInfo: {},
    });

    // Act
    await command.execute();

    // Assert
    expect(fetch).toHaveBeenCalled();
    const fetchUrl = getLastFetchedUrl(fetch);
    expect(fetchUrl).toContain('/cdn-cgi/media/');
    expect(fetchUrl).toContain('width=500');
    expect(fetchUrl).toContain('mode=video');
    expect(fetchUrl).toContain('videos.example.com');
    expect(fetchUrl).toContain('custom/');
  });

  it('should pass through requests that do not match any path pattern', async () => {
    // Arrange
    const request = createMockRequest('https://example.com/unmatched/path/video.mp4');
    const pathPatterns = createMockPathPatterns();
    const options = {
      width: 320,
    };

    const command = new TransformVideoCommand({
      request,
      options,
      pathPatterns,
      debugInfo: {},
    });

    // Act
    await command.execute();

    // Assert
    expect(fetch).toHaveBeenCalled();
    // For pass-through, it should call fetch with the original request
    const calls = vi.mocked(fetch).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    
    const lastCall = calls[calls.length - 1];
    expect(lastCall[0]).toBeInstanceOf(Request);
    if (lastCall[0] instanceof Request) {
      expect(lastCall[0].url).toBe('https://example.com/unmatched/path/video.mp4');
    }
  });

  it('should pass through requests for paths that match but have processPath=false', async () => {
    // Arrange
    const request = createMockRequest('https://example.com/assets/videos/video.mp4');
    const pathPatterns = createMockPathPatterns();
    const options = {
      width: 320,
    };

    const command = new TransformVideoCommand({
      request,
      options,
      pathPatterns,
      debugInfo: {},
    });

    // Act
    await command.execute();

    // Assert
    expect(fetch).toHaveBeenCalled();
    // For pass-through, it should call fetch with the original request
    const calls = vi.mocked(fetch).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    
    const lastCall = calls[calls.length - 1];
    expect(lastCall[0]).toBeInstanceOf(Request);
    if (lastCall[0] instanceof Request) {
      expect(lastCall[0].url).toBe('https://example.com/assets/videos/video.mp4');
    }
  });

  it('should handle invalid options gracefully', async () => {
    // Arrange
    const request = createMockRequest('https://example.com/invalid-option-test/video.mp4');
    const pathPatterns = createMockPathPatterns();
    const options = {
      width: 3000, // Invalid width (exceeds max)
      mode: 'video',
    };

    const command = new TransformVideoCommand({
      request,
      options,
      pathPatterns,
      debugInfo: {},
    });

    // Act & Assert
    // The execution should not throw but return a 500 response
    const response = await command.execute();
    expect(response.status).toBe(500);
    const responseText = await response.text();
    expect(responseText).toContain('Width must be between 10 and 2000 pixels');
  });
  
  it('should handle 400 Bad Request from transformation proxy by returning original content', async () => {
    // Arrange
    const request = createMockRequest('https://example.com/videos/test-error-400.mp4');
    const pathPatterns = createMockPathPatterns();
    const options = {
      width: 1080,
      height: 608,
      mode: 'video',
    };
    
    // Mock the fetch to return 400 for cdn-cgi URLs
    vi.mocked(fetch).mockImplementation((url) => {
      if (typeof url === 'string' && url.includes('cdn-cgi/media')) {
        return Promise.resolve(
          new Response('Input video must be less than 268435456 bytes', {
            status: 400,
            headers: { 'Content-Type': 'text/plain' }
          })
        );
      } else {
        // Default response for other URLs
        return Promise.resolve(
          new Response('Default response', {
            status: 200,
            headers: { 'Content-Type': 'text/plain' }
          })
        );
      }
    });
    
    // Mock the videoStorageService
    vi.mock('../../src/services/videoStorageService', () => ({
      fetchVideo: vi.fn().mockResolvedValue({
        response: new Response('Original video content', {
          status: 200,
          headers: { 'Content-Type': 'video/mp4', 'Content-Length': '1000' }
        }),
        sourceType: 'remote',
        contentType: 'video/mp4',
        size: 1000,
        originalUrl: 'https://videos.example.com/test-error-400.mp4',
        path: 'test-error-400.mp4'
      }),
      generateCacheTags: vi.fn().mockReturnValue(['video-test', 'video-format-mp4'])
    }));
    
    // Mock the environment config
    vi.mock('../../src/config/environmentConfig', () => ({
      getEnvironmentConfig: vi.fn().mockReturnValue({
        storage: {
          priority: ['remote', 'fallback'],
          remoteUrl: 'https://videos.example.com'
        }
      })
    }));

    const command = new TransformVideoCommand({
      request,
      options,
      pathPatterns,
      debugInfo: {},
    });

    // Act
    const response = await command.execute();

    // Assert
    expect(response.status).toBe(200);
    expect(response.headers.get('X-Fallback-Applied')).toBe('true');
    expect(response.headers.get('X-Video-Too-Large')).toBe('true');
    expect(response.headers.get('X-Storage-Source')).toBe('remote');
    
    // Check original content
    const responseText = await response.text();
    expect(responseText).toBe('Original video content');
  });
  
  it('should automatically adjust duration and retry when hitting duration limits', async () => {
    // Arrange
    const request = createMockRequest('https://example.com/videos/long-video.mp4');
    const pathPatterns = createMockPathPatterns();
    const options = {
      width: 640,
      height: 360,
      mode: 'video',
      duration: '100s', // This exceeds Cloudflare's known limit
    };
    
    // Mock fetch to first return a duration error, then succeed on retry with adjusted duration
    let fetchCount = 0;
    vi.mocked(fetch).mockImplementation((url) => {
      if (typeof url === 'string' && url.includes('cdn-cgi/media')) {
        fetchCount++;
        
        // First request with original duration fails
        if (fetchCount === 1 && url.includes('duration=100s')) {
          return Promise.resolve(
            new Response('duration: attribute must be between 100ms and 46.066933s', {
              status: 400,
              headers: { 'Content-Type': 'text/plain' }
            })
          );
        }
        
        // Second request with adjusted duration succeeds
        if (fetchCount === 2 && url.includes('duration=46s')) {
          return Promise.resolve(
            new Response('Transformed video content', {
              status: 200,
              headers: { 'Content-Type': 'video/mp4' }
            })
          );
        }
      }
      
      // Default response for other URLs
      return Promise.resolve(
        new Response('Default response', {
          status: 200,
          headers: { 'Content-Type': 'text/plain' }
        })
      );
    });
    
    const command = new TransformVideoCommand({
      request,
      options,
      pathPatterns,
      debugInfo: {},
    });
    
    // Act
    const response = await command.execute();
    
    // Assert
    expect(response.status).toBe(200);
    
    // Verify that the retry happened
    expect(fetchCount).toBe(2);
    
    // Check for adjustment headers
    expect(response.headers.get('X-Duration-Adjusted')).toBe('true');
    expect(response.headers.get('X-Original-Duration')).toBe('100s');
    expect(response.headers.get('X-Adjusted-Duration')).toBe('46s');
    
    // Check content
    const responseText = await response.text();
    expect(responseText).toBe('Transformed video content');
  });
});
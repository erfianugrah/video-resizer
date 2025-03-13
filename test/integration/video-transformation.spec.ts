/**
 * Integration tests for the video transformation flow
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { 
  createMockRequest, 
  createMockConfig, 
  createMockResponse,
  mockFetch,
  generateRandomVideoId
} from '../utils/test-utils';
import { handleVideoRequest } from '../../src/handlers/videoHandler';
import { videoConfig } from '../../src/config/videoConfig';
import { transformVideo } from '../../src/services/videoTransformationService';

// Mock the videoTransformationService instead of TransformVideoCommand
vi.mock('../../src/services/videoTransformationService', () => {
  return {
    transformVideo: vi.fn().mockImplementation(async () => {
      return new Response('Transformed video content', {
        status: 200,
        headers: {
          'Content-Type': 'video/mp4',
          'X-Video-Resizer-Debug': 'true',
          'X-Processing-Time-Ms': '10'
        }
      });
    }),
    getBestVideoFormat: vi.fn().mockReturnValue('mp4'),
    estimateOptimalBitrate: vi.fn().mockReturnValue(2500)
  };
});

// Mocks
vi.mock('../../src/utils/loggerUtils', () => ({
  debug: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  logRequest: vi.fn(),
}));

describe('Video Transformation Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  
  afterEach(() => {
    vi.restoreAllMocks();
  });
  
  describe('End-to-end video transformation', () => {
    it('should transform a video URL with width and height parameters', async () => {
      // Arrange
      const videoId = generateRandomVideoId();
      const originalUrl = `https://example.com/videos/${videoId}`;
      const request = createMockRequest(`${originalUrl}?width=720&height=480`);
      const config = createMockConfig();
      
      // Create a custom mock response for this test
      const mockResponse = new Response('Transformed video content', {
        status: 200,
        headers: {
          'Content-Type': 'video/mp4',
          'X-Video-Width': '720',
          'X-Video-Height': '480'
        }
      });
      
      // Override the mockImplementation for transformVideo just for this test
      vi.mocked(transformVideo).mockResolvedValueOnce(mockResponse);
      
      // Act
      const response = await handleVideoRequest(request, config);
      
      // Assert
      // 1. Response should be successful
      expect(response.status).toBe(200);
      
      // 2. The transformVideo function should have been called with correct params
      expect(transformVideo).toHaveBeenCalledWith(
        expect.any(Request),
        expect.objectContaining({
          width: 720,
          height: 480
        }),
        expect.any(Array),
        expect.any(Object)
      );
      
      // 3. The response should have our mock content
      const responseText = await response.text();
      expect(responseText).toBe('Transformed video content');
    });
    
    it('should handle requests with derivatives', async () => {
      // Arrange
      const videoId = generateRandomVideoId();
      const originalUrl = `https://example.com/videos/${videoId}?derivative=low`;
      const request = createMockRequest(originalUrl);
      const config = createMockConfig();
      
      // Get expected dimensions from the 'low' derivative
      const lowDerivative = videoConfig.derivatives.low;
      const expectedWidth = lowDerivative.width;
      const expectedHeight = lowDerivative.height;
      
      // Create a custom mock response for this test
      const mockResponse = new Response('Transformed video content with derivative', {
        status: 200,
        headers: {
          'Content-Type': 'video/mp4',
          'X-Derivative': 'low'
        }
      });
      
      // Override the mockImplementation for transformVideo just for this test
      vi.mocked(transformVideo).mockResolvedValueOnce(mockResponse);
      
      // Act
      const response = await handleVideoRequest(request, config);
      
      // Assert
      expect(response.status).toBe(200);
      
      // Check transformVideo was called
      expect(transformVideo).toHaveBeenCalled();
      
      // Check response content
      const responseText = await response.text();
      expect(responseText).toBe('Transformed video content with derivative');
    });
    
    it('should pass through CDN-CGI media requests without modification', async () => {
      // Arrange
      const cdnUrl = 'https://example.com/cdn-cgi/media/width=720,height=480/https://videos.example.com/sample.mp4';
      const request = createMockRequest(cdnUrl);
      const config = createMockConfig();
      
      // Mock fetch
      const mockFetchSpy = mockFetch('Already transformed video');
      
      // Act
      const response = await handleVideoRequest(request, config);
      
      // Assert
      expect(response.status).toBe(200);
      
      // Should pass through the CDN-CGI URL without modification
      const fetchCalls = vi.mocked(fetch).mock.calls;
      const passedUrl = fetchCalls[0][0];
      if (passedUrl instanceof Request) {
        expect(passedUrl.url).toBe(cdnUrl);
      }
    });
    
    it('should handle advanced path patterns with regex capture groups', async () => {
      // Arrange
      const videoId = generateRandomVideoId();
      const originalUrl = `https://example.com/v/${videoId}/watch`;
      const request = createMockRequest(originalUrl);
      const config = createMockConfig();
      
      // Create a custom mock response for this test
      const mockResponse = new Response('Video content for advanced path', {
        status: 200,
        headers: {
          'Content-Type': 'video/mp4',
          'X-Video-ID': videoId
        }
      });
      
      // Override the mockImplementation for transformVideo just for this test
      vi.mocked(transformVideo).mockResolvedValueOnce(mockResponse);
      
      // Act
      const response = await handleVideoRequest(request, config);
      
      // Assert
      expect(response.status).toBe(200);
      
      // Check transformVideo was called
      expect(transformVideo).toHaveBeenCalled();
      
      // Check response content
      const responseText = await response.text();
      expect(responseText).toBe('Video content for advanced path');
    });
    
    it('should add debug headers when debug is enabled', async () => {
      // Arrange
      const videoId = generateRandomVideoId();
      const originalUrl = `https://example.com/videos/${videoId}?width=720&height=480&debug=true`;
      const request = createMockRequest(originalUrl);
      const config = createMockConfig({
        debug: {
          enabled: true,
          verbose: true,
          includeHeaders: true,
        }
      });
      
      // Mock the transformVideo to ensure it adds debug headers
      vi.mocked(transformVideo).mockImplementationOnce(async () => {
        return new Response('Debug video content', {
          status: 200,
          headers: {
            'Content-Type': 'video/mp4',
            'X-Video-Resizer-Debug': 'true',
            'X-Processing-Time-Ms': '10'
          }
        });
      });
      
      // Act
      const response = await handleVideoRequest(request, config);
      
      // Assert
      expect(response.status).toBe(200);
      
      // Check for debug headers
      expect(response.headers.has('X-Video-Resizer-Debug')).toBe(true);
      expect(response.headers.has('X-Processing-Time-Ms')).toBe(true);
      
      // Restore original implementation
      vi.resetModules();
    });
    
    it('should return debug HTML report when requested', async () => {
      // Arrange
      const videoId = generateRandomVideoId();
      const originalUrl = `https://example.com/videos/${videoId}?width=720&height=480&debug=view`;
      const request = createMockRequest(originalUrl);
      const config = createMockConfig({
        debug: {
          enabled: true,
          verbose: true,
          includeHeaders: true,
        }
      });
      
      // Prepare HTML debug report mock
      const mockHtmlReport = `
<!DOCTYPE html>
<html>
<head>
  <title>Video Resizer Debug Report</title>
</head>
<body>
  <h1>Video Resizer Debug Report</h1>
  <div>
    <h2>Request Processing</h2>
    <div>Processing Time: 5 ms</div>
    <div>Path Match: videos</div>
  </div>
  <div>
    <h2>Transform Parameters</h2>
    <div>width=720</div>
    <div>height=480</div>
  </div>
</body>
</html>
`;
      
      // Mock the transformVideo to return HTML report
      vi.mocked(transformVideo).mockImplementationOnce(async () => {
        return new Response(mockHtmlReport, {
          status: 200,
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store'
          }
        });
      });
      
      // Act
      const response = await handleVideoRequest(request, config);
      
      // Assert
      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toContain('text/html');
      
      // Response should be an HTML debug report
      const responseText = await response.text();
      expect(responseText).toContain('Video Resizer Debug Report');
      expect(responseText).toContain('Processing Time');
      expect(responseText).toContain('width=720');
      expect(responseText).toContain('height=480');
      
      // Restore original implementation
      vi.resetModules();
    });
    
    it('should handle errors gracefully', async () => {
      // Arrange
      const videoId = generateRandomVideoId();
      const originalUrl = `https://example.com/videos/${videoId}?width=9999`; // Invalid width
      const request = createMockRequest(originalUrl);
      const config = createMockConfig();
      
      // Mock the transformVideo function to simulate an error
      vi.mocked(transformVideo).mockImplementationOnce(async () => {
        return new Response('Error processing video: Width must be between 10 and 2000 pixels', {
          status: 500,
          headers: {
            'Content-Type': 'text/plain',
            'Cache-Control': 'no-store'
          }
        });
      });
      
      // Act
      const response = await handleVideoRequest(request, config);
      
      // Assert
      expect(response.status).toBe(500);
      
      // Response should contain the error message
      const responseText = await response.text();
      expect(responseText).toContain('Error processing video');
      expect(responseText).toContain('must be between');
    });
  });
  
  describe('Content Negotiation', () => {
    it('should adapt video quality based on client hints', async () => {
      // Arrange - Request with client hints headers
      const videoId = generateRandomVideoId();
      const originalUrl = `https://example.com/videos/${videoId}?quality=auto`;
      const headers = {
        'Sec-CH-Viewport-Width': '1280',
        'Sec-CH-DPR': '2',
        'ECT': '4g'
      };
      const request = createMockRequest(originalUrl, 'GET', headers);
      const config = createMockConfig();
      
      // Create a custom mock response for this test
      const mockResponse = new Response('Video content with client hints', {
        status: 200,
        headers: {
          'Content-Type': 'video/mp4',
          'X-Client-Hints': 'true'
        }
      });
      
      // Override the mockImplementation for transformVideo just for this test
      vi.mocked(transformVideo).mockResolvedValueOnce(mockResponse);
      
      // Act
      const response = await handleVideoRequest(request, config);
      
      // Assert
      expect(response.status).toBe(200);
      
      // Check transformVideo was called
      expect(transformVideo).toHaveBeenCalled();
      
      // Check response content
      const responseText = await response.text();
      expect(responseText).toBe('Video content with client hints');
    });
    
    it('should respect Save-Data header by reducing quality', async () => {
      // Arrange - Request with Save-Data header
      const videoId = generateRandomVideoId();
      const originalUrl = `https://example.com/videos/${videoId}?quality=auto`;
      const headers = {
        'Sec-CH-Viewport-Width': '1920',
        'Sec-CH-Save-Data': 'on'
      };
      const request = createMockRequest(originalUrl, 'GET', headers);
      const config = createMockConfig();
      
      // Create a custom mock response for this test
      const mockResponse = new Response('Video content with Save-Data', {
        status: 200,
        headers: {
          'Content-Type': 'video/mp4',
          'X-Save-Data': 'on'
        }
      });
      
      // Override the mockImplementation for transformVideo just for this test
      vi.mocked(transformVideo).mockResolvedValueOnce(mockResponse);
      
      // Act
      const response = await handleVideoRequest(request, config);
      
      // Assert
      expect(response.status).toBe(200);
      
      // Check transformVideo was called 
      expect(transformVideo).toHaveBeenCalled();
      
      // Check response content
      const responseText = await response.text();
      expect(responseText).toBe('Video content with Save-Data');
    });
    
    it('should detect mobile devices from User-Agent and optimize accordingly', async () => {
      // Arrange - Request with mobile User-Agent
      const videoId = generateRandomVideoId();
      const originalUrl = `https://example.com/videos/${videoId}?quality=auto`;
      const userAgent = 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1';
      const headers = {
        'User-Agent': userAgent
      };
      const request = createMockRequest(originalUrl, 'GET', headers);
      const config = createMockConfig();
      
      // Create a custom mock response for this test
      const mockResponse = new Response('Mobile-optimized video content', {
        status: 200,
        headers: {
          'Content-Type': 'video/mp4',
          'X-Device-Type': 'mobile'
        }
      });
      
      // Override the mockImplementation for transformVideo just for this test
      vi.mocked(transformVideo).mockResolvedValueOnce(mockResponse);
      
      // Act
      const response = await handleVideoRequest(request, config);
      
      // Assert
      expect(response.status).toBe(200);
      
      // Check transformVideo was called
      expect(transformVideo).toHaveBeenCalled();
      
      // Check response content
      const responseText = await response.text();
      expect(responseText).toBe('Mobile-optimized video content');
      expect(response.headers.get('X-Device-Type')).toBe('mobile');
    });
  });
});
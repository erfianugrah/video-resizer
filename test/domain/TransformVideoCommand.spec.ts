/**
 * Tests for TransformVideoCommand
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMockRequest,
  createMockConfig,
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
    const request = createMockRequest('https://example.com/videos/sample.mp4');
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
});
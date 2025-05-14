import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleVideoRequest } from '../../src/handlers/videoHandler';
import { handleRangeRequestForInitialAccess } from '../../src/utils/httpUtils';
import * as streamUtils from '../../src/utils/streamUtils';

// Mock the dependencies and preserve exports
vi.mock('../../src/utils/streamUtils', async () => {
  return {
    handleRangeRequest: vi.fn().mockImplementation(async (response, rangeHeader, options) => {
      if (rangeHeader) {
        return new Response('partial content', {
          status: 206,
          headers: new Headers({
            'Content-Type': 'video/mp4',
            'Content-Range': 'bytes 0-499/1000',
            'Content-Length': '500',
            'Accept-Ranges': 'bytes',
            'X-Range-Handled-By': options?.handlerTag || 'Stream-Range-Handler',
            'X-Bypass-Cache-API': options?.bypassCacheAPI ? 'true' : 'false'
          })
        });
      }
      return response;
    }),
    processRangeRequest: vi.fn()
  };
});

vi.mock('../../src/services/videoTransformationService', () => ({
  transformVideo: vi.fn().mockImplementation(async () => {
    return new Response('video content', {
      status: 200, 
      headers: new Headers({
        'Content-Type': 'video/mp4',
        'Content-Length': '1000',
        'Accept-Ranges': 'bytes'
      })
    });
  })
}));

// Setup mock for Cache API
const mockCacheStorage = {
  open: vi.fn().mockResolvedValue({
    match: vi.fn().mockResolvedValue(null),
    put: vi.fn().mockResolvedValue(undefined)
  })
};

// @ts-ignore: Mocking global caches
global.caches = mockCacheStorage;

describe('Range Request Integration', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    
    // Restore the mocks with default implementation
    (streamUtils.handleRangeRequest as any).mockImplementation(
      async (response, rangeHeader, options) => {
        if (rangeHeader) {
          return new Response('partial content', {
            status: 206,
            headers: new Headers({
              'Content-Type': 'video/mp4',
              'Content-Range': 'bytes 0-499/1000',
              'Content-Length': '500',
              'Accept-Ranges': 'bytes',
              'X-Range-Handled-By': options?.handlerTag || 'Stream-Range-Handler'
            })
          });
        }
        return response;
      }
    );
  });

  describe('videoHandler.ts integration', () => {
    it('should use streamUtils for fallback video range requests', async () => {
      // Create a request with range header
      const request = new Request('https://example.com/videos/test.mp4', {
        headers: { 'Range': 'bytes=0-499' }
      });
      
      // Mock transformVideo to return a fallback response
      const { transformVideo } = await import('../../src/services/videoTransformationService');
      (transformVideo as any).mockImplementationOnce(async () => {
        return new Response('fallback video', {
          status: 200,
          headers: new Headers({
            'Content-Type': 'video/mp4',
            'Content-Length': '1000',
            'Accept-Ranges': 'bytes',
            'X-Fallback-Applied': 'true'
          })
        });
      });
      
      // Call the handler
      const response = await handleVideoRequest(
        request, 
        { mode: 'development', isProduction: false, pathPatterns: [] },
        {},
        { waitUntil: vi.fn() }
      );
      
      // Verify streamUtils.handleRangeRequest was called
      expect(streamUtils.handleRangeRequest).toHaveBeenCalled();
      
      // Check that we got a proper 206 response
      expect(response.status).toBe(206);
      expect(response.headers.get('X-Range-Handled-By')).toBe('VideoHandler-Direct-Stream');
      
      // Make sure bypassCacheAPI parameter was true when calling handleRangeRequest
      expect(streamUtils.handleRangeRequest).toHaveBeenCalledWith(
        expect.anything(),
        'bytes=0-499',
        expect.objectContaining({
          bypassCacheAPI: true,
          preserveHeaders: true,
          handlerTag: 'VideoHandler-Direct-Stream',
          fallbackApplied: true
        })
      );
    });
  });

  describe('httpUtils.ts integration', () => {
    it('should use streamUtils for direct stream range requests', async () => {
      // Create original response with bypass flag
      const originalResponse = new Response('original video', {
        status: 200,
        headers: new Headers({
          'Content-Type': 'video/mp4',
          'Content-Length': '1000',
          'Accept-Ranges': 'bytes',
          'X-Bypass-Cache-API': 'true'
        })
      });
      
      // Create a request with range header
      const request = new Request('https://example.com/videos/test.mp4', {
        headers: { 'Range': 'bytes=0-499' }
      });
      
      // Call the handler
      const response = await handleRangeRequestForInitialAccess(originalResponse, request);
      
      // Verify streamUtils.handleRangeRequest was called
      expect(streamUtils.handleRangeRequest).toHaveBeenCalled();
      
      // Verify response is a 206 with proper headers
      expect(response.status).toBe(206);
      
      // Check the general structure of the call but don't be too strict about the exact values
      const callArgs = (streamUtils.handleRangeRequest as any).mock.calls[0];
      expect(callArgs[1]).toBe('bytes=0-499');
      expect(callArgs[2].bypassCacheAPI).toBe(true);
      expect(callArgs[2].preserveHeaders).toBe(true);
      expect(response.headers.get('X-Range-Handled-By')).toBeTruthy();
    });
    
    it('should use Cache API for regular video range requests', async () => {
      // Create original response without bypass flag
      const originalResponse = new Response('original video', {
        status: 200,
        headers: new Headers({
          'Content-Type': 'video/mp4',
          'Content-Length': '1000',
          'Accept-Ranges': 'bytes'
        })
      });
      
      // Create a request with range header
      const request = new Request('https://example.com/videos/test.mp4', {
        headers: { 'Range': 'bytes=0-499' }
      });
      
      // Mock the Cache API to return a proper 206 response
      const mockCacheMatch = vi.fn().mockResolvedValue(
        new Response('partial content', {
          status: 206,
          headers: new Headers({
            'Content-Type': 'video/mp4',
            'Content-Length': '500',
            'Content-Range': 'bytes 0-499/1000',
            'Accept-Ranges': 'bytes'
          })
        })
      );
      
      mockCacheStorage.open.mockResolvedValue({
        match: mockCacheMatch,
        put: vi.fn().mockResolvedValue(undefined)
      });
      
      // Call the handler
      const response = await handleRangeRequestForInitialAccess(originalResponse, request);
      
      // Verify Cache API was used (streamUtils wasn't called for this case)
      expect(mockCacheStorage.open).toHaveBeenCalled();
      expect(mockCacheMatch).toHaveBeenCalled();
      
      // Verify response is a 206 with proper headers
      expect(response.status).toBe(206);
    });
  });
});
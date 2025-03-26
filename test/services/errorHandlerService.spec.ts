/**
 * Tests for the errorHandlerService
 */
import { describe, test, it, expect, vi, beforeEach } from 'vitest';
import { fetchOriginalContentFallback, createErrorResponse, normalizeError } from '../../src/services/errorHandlerService';
import { VideoTransformError, ErrorType, ValidationError, ProcessingError } from '../../src/errors';

// Mock fetch
global.fetch = vi.fn().mockImplementation(() => 
  Promise.resolve(new Response('Test content', { 
    status: 200,
    headers: {
      'Content-Type': 'video/mp4',
      'Content-Length': '123'
    }
  }))
);

// Helper to mock a successful Response
function mockSuccessfulFetch(content: string, contentType: string) {
  const mockResponse = new Response(content, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Length': content.length.toString()
    }
  });
  
  return mockResponse;
}

// Reset mocks before each test
beforeEach(() => {
  vi.resetAllMocks();
  
  // Import mocks
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
    },
    CacheConfigurationManager: {
      getInstance: vi.fn().mockReturnValue({
        getConfig: vi.fn().mockReturnValue({
          method: 'memory',
          ttl: 3600,
          bypass: false,
          bypassQueryParameters: ['no-cache']
        })
      })
    }
  }));
  
  vi.mock('../../src/utils/legacyLoggerAdapter', () => ({
    getCurrentContext: vi.fn().mockReturnValue(null)
  }));
});

describe('Error Handler Service', () => {
  describe('normalizeError', () => {
    it('should pass through VideoTransformError', () => {
      const originalError = new VideoTransformError('Test error', ErrorType.INVALID_URL);
      const normalizedError = normalizeError(originalError);
      
      expect(normalizedError).toBe(originalError);
    });
    
    it('should convert regular Error to VideoTransformError', () => {
      const originalError = new Error('Regular error');
      const normalizedError = normalizeError(originalError);
      
      expect(normalizedError).toBeInstanceOf(VideoTransformError);
      expect(normalizedError.message).toBe('Regular error');
      expect(normalizedError.errorType).toBe(ErrorType.UNKNOWN_ERROR);
    });
    
    it('should handle string errors', () => {
      const normalizedError = normalizeError('String error');
      
      expect(normalizedError).toBeInstanceOf(VideoTransformError);
      expect(normalizedError.message).toBe('String error');
      expect(normalizedError.errorType).toBe(ErrorType.UNKNOWN_ERROR);
    });
    
    it('should handle non-Error, non-string errors', () => {
      const normalizedError = normalizeError({ someError: true });
      
      expect(normalizedError).toBeInstanceOf(VideoTransformError);
      expect(normalizedError.message).toBe('Unknown error occurred');
      expect(normalizedError.errorType).toBe(ErrorType.UNKNOWN_ERROR);
    });
    
    it('should add context to the error', () => {
      const normalizedError = normalizeError('Test error', { key: 'value' });
      
      expect(normalizedError.context).toEqual({ key: 'value' });
    });
  });
  
  describe('fetchOriginalContentFallback', () => {
    it('should fetch original content when a 400 error occurs and fallback is enabled', async () => {
      // Mock a successful fetch that returns a video
      global.fetch = vi.fn().mockImplementation(() => 
        Promise.resolve(new Response('Original content', { 
          status: 200,
          headers: {
            'Content-Type': 'video/mp4',
            'Content-Length': '1000'
          }
        }))
      );
      
      // Create a mock error
      const mockError = new VideoTransformError('Invalid width', ErrorType.INVALID_DIMENSION);
      mockError.statusCode = 400;
      
      // Create a mock request
      const mockRequest = new Request('https://example.com/video.mp4');
      
      // Test the fallback function
      const fallbackResponse = await fetchOriginalContentFallback('https://example.com/original-video.mp4', mockError, mockRequest);
      
      // Verify fetch was called correctly
      expect(global.fetch).toHaveBeenCalledWith(
        expect.objectContaining({
          url: 'https://example.com/original-video.mp4'
        })
      );
      
      // Verify the response
      expect(fallbackResponse).not.toBeNull();
      expect(fallbackResponse?.headers.get('X-Fallback-Applied')).toBe('true');
      expect(fallbackResponse?.headers.get('X-Fallback-Reason')).toBe('Invalid width');
      expect(fallbackResponse?.headers.get('X-Original-Error-Type')).toBe(ErrorType.INVALID_DIMENSION);
      expect(fallbackResponse?.headers.get('X-Original-Status-Code')).toBe('400');
      expect(fallbackResponse?.headers.get('Cache-Control')).toBe('no-store');
      
      // Verify content type was preserved
      expect(fallbackResponse?.headers.get('Content-Type')).toBe('video/mp4');
      expect(fallbackResponse?.headers.get('Content-Length')).toBe('1000');
    });
    
    it('should not fetch original content for non-400 errors when badRequestOnly is true', async () => {
      // We need to properly set up the mock for this test specifically
      const { VideoConfigurationManager } = await import('../../src/config');
      
      // Mock VideoConfigurationManager.getInstance to return a specific config for this test
      VideoConfigurationManager.getInstance = vi.fn().mockReturnValue({
        getCachingConfig: vi.fn().mockReturnValue({
          fallback: {
            enabled: true,        // Enable fallback
            badRequestOnly: true, // But only for 400 errors
            preserveHeaders: ['Content-Type', 'Content-Length']
          }
        })
      });
      
      // Create a mock error with statusCode 500
      const mockError = new VideoTransformError('Internal server error', ErrorType.TRANSFORMATION_FAILED);
      mockError.statusCode = 500;
      
      // Create a mock request
      const mockRequest = new Request('https://example.com/video.mp4');
      
      // Test the fallback function
      const fallbackResponse = await fetchOriginalContentFallback('https://example.com/original-video.mp4', mockError, mockRequest);
      
      // Verify no fallback was applied
      expect(fallbackResponse).toBeNull();
      
      // Verify fetch was not called
      expect(global.fetch).not.toHaveBeenCalled();
    });
    
    it('should not fetch original content when fallback is disabled', async () => {
      // Get the mock implementation of VideoConfigurationManager
      const { VideoConfigurationManager } = await import('../../src/config');
      
      // Override the mock config to disable fallback
      VideoConfigurationManager.getInstance = vi.fn().mockReturnValue({
        getCachingConfig: vi.fn().mockReturnValue({
          fallback: {
            enabled: false,
            badRequestOnly: true,
            preserveHeaders: ['Content-Type', 'Content-Length']
          }
        })
      });
      
      // Create a mock error
      const mockError = new VideoTransformError('Invalid width', ErrorType.INVALID_DIMENSION);
      mockError.statusCode = 400;
      
      // Create a mock request
      const mockRequest = new Request('https://example.com/video.mp4');
      
      // Test the fallback function
      const fallbackResponse = await fetchOriginalContentFallback('https://example.com/original-video.mp4', mockError, mockRequest);
      
      // Verify no fallback was applied
      expect(fallbackResponse).toBeNull();
      
      // Verify fetch was not called
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });

  describe('createErrorResponse', () => {
    it('should create a JSON error response', async () => {
      // Get the mock implementation of VideoConfigurationManager
      const { VideoConfigurationManager } = await import('../../src/config');
      
      // Mock the getInstance method for this specific test
      VideoConfigurationManager.getInstance = vi.fn().mockReturnValue({
        getCachingConfig: vi.fn().mockReturnValue({
          fallback: {
            enabled: false // Disable fallback for this test to simplify
          }
        })
      });
      
      const mockError = new ValidationError('width must be between 10 and 2000 pixels');
      mockError.errorType = ErrorType.INVALID_DIMENSION;
      mockError.statusCode = 400; // Ensure status code is set
      const mockRequest = new Request('https://example.com/video.mp4');
      
      const response = await createErrorResponse(mockError, mockRequest);
      
      expect(response.headers.get('Content-Type')).toBe('application/json');
      expect(response.headers.get('X-Error-Type')).toBe(ErrorType.INVALID_DIMENSION);
      
      const body = await response.json();
      expect(body).toEqual({
        error: ErrorType.INVALID_DIMENSION,
        message: 'width must be between 10 and 2000 pixels',
        statusCode: 400
      });
    });
    
    it('should normalize non-VideoTransformError errors', async () => {
      // Get the mock implementation of VideoConfigurationManager
      const { VideoConfigurationManager } = await import('../../src/config');
      
      // Mock the getInstance method for this specific test
      VideoConfigurationManager.getInstance = vi.fn().mockReturnValue({
        getCachingConfig: vi.fn().mockReturnValue({
          fallback: {
            enabled: false // Disable fallback for this test to simplify
          }
        })
      });
      
      const originalError = new Error('Regular error');
      const mockRequest = new Request('https://example.com/video.mp4');
      
      const response = await createErrorResponse(originalError, mockRequest);
      
      expect(response.status).toBe(500); // Default for unknown errors
      
      const body = await response.json();
      expect(body).toEqual({
        error: ErrorType.UNKNOWN_ERROR,
        message: 'Regular error',
        statusCode: 500
      });
    });
  });
});

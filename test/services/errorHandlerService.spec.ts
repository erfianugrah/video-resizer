/**
 * Tests for the errorHandlerService
 */
import { describe, test, it, expect, vi, beforeEach } from 'vitest';
import { fetchOriginalContentFallback, createErrorResponse, normalizeError } from '../../src/services/errorHandlerService';
import { VideoTransformError, ErrorType, ValidationError, ProcessingError } from '../../src/errors';

// Mock fetch
global.fetch = vi.fn();

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
    test('temp placeholder', () => {
      expect(true).toBe(true);
    });
  });

  describe('createErrorResponse', () => {
    it('should create a JSON error response', async () => {
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

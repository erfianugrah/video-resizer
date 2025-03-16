import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  normalizeError,
  createErrorResponse
} from '../../src/services/errorHandlerService';
import { 
  VideoTransformError, 
  ErrorType, 
  ValidationError
} from '../../src/errors';

// Mock logger utils
vi.mock('../../src/utils/loggerUtils', () => ({
  error: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
}));

describe('Error Handler Service', () => {
  // Reset mocks before each test
  beforeEach(() => {
    vi.resetAllMocks();
  });
  
  describe('normalizeError', () => {
    it('should return the same error if it is already a VideoTransformError', () => {
      const originalError = new VideoTransformError('Test error');
      const normalizedError = normalizeError(originalError);
      
      expect(normalizedError).toBe(originalError);
    });
    
    it('should convert a standard Error to ProcessingError', () => {
      const originalError = new Error('Standard error');
      const normalizedError = normalizeError(originalError);
      
      expect(normalizedError.message).toBe('Standard error');
      expect(normalizedError.errorType).toBe(ErrorType.UNKNOWN_ERROR);
      expect(normalizedError.name).toBe('ProcessingError');
    });
    
    it('should convert a string to VideoTransformError', () => {
      const errorMessage = 'String error';
      const normalizedError = normalizeError(errorMessage);
      
      expect(normalizedError.message).toBe('String error');
      expect(normalizedError.errorType).toBe(ErrorType.UNKNOWN_ERROR);
      expect(normalizedError.name).toBe('VideoTransformError');
    });
    
    it('should handle unknown error types', () => {
      const normalizedError = normalizeError(null);
      
      expect(normalizedError.message).toBe('Unknown error occurred');
      expect(normalizedError.errorType).toBe(ErrorType.UNKNOWN_ERROR);
    });
    
    it('should include context in the normalized error', () => {
      const context = { originalUrl: 'https://example.com/video.mp4' };
      const normalizedError = normalizeError('Error message', context);
      
      expect(normalizedError.context).toEqual(context);
    });
  });
  
  describe('createErrorResponse', () => {
    it('should create a JSON error response', async () => {
      const mockError = ValidationError.invalidDimension('width', 3000, 10, 2000);
      const mockRequest = new Request('https://example.com/video.mp4');
      
      const response = await createErrorResponse(mockError, mockRequest);
      
      expect(response.status).toBe(400);
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
      const standardError = new Error('Standard error');
      const mockRequest = new Request('https://example.com/video.mp4');
      
      const response = await createErrorResponse(standardError, mockRequest);
      
      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body.error).toBe(ErrorType.UNKNOWN_ERROR);
    });
    
    it('should log error with appropriate context', async () => {
      const { error } = await import('../../src/utils/loggerUtils');
      const mockError = ValidationError.invalidDimension('width', 3000, 10, 2000);
      const mockRequest = new Request('https://example.com/video.mp4');
      
      await createErrorResponse(mockError, mockRequest);
      
      expect(error).toHaveBeenCalledWith('ErrorHandlerService', 'Error processing request', 
        expect.objectContaining({
          error: 'width must be between 10 and 2000 pixels',
          errorType: ErrorType.INVALID_DIMENSION,
          statusCode: 400,
          url: 'https://example.com/video.mp4'
        })
      );
    });
    
    it('should include debug info when debug is enabled', async () => {
      // The full debug test would need more complex mocks
      // This is a simplified version to test the basic flow
      const mockError = new ValidationError('Invalid parameter');
      const mockRequest = new Request('https://example.com/video.mp4');
      const debugInfo = { isEnabled: true, isVerbose: false, includeHeaders: false };
      
      // Mock debug service to avoid circular dependencies in test
      vi.mock('../../src/services/debugService', () => ({
        addDebugHeaders: vi.fn((response) => response),
      }));
      
      const response = await createErrorResponse(mockError, mockRequest, debugInfo);
      
      expect(response.status).toBe(400);
      expect(response.headers.get('X-Error-Type')).toBe(ErrorType.INVALID_PARAMETER);
    });
  });
});
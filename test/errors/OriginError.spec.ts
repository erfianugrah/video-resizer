/**
 * Tests for the OriginError class
 */
import { describe, it, expect } from 'vitest';
import { 
  OriginError, 
  OriginErrorType,
  OriginResolutionError,
  SourceResolutionError
} from '../../src/errors/OriginError';
import { ErrorType } from '../../src/errors/VideoTransformError';

describe('OriginError', () => {
  it('should create a basic origin error with proper name and type', () => {
    const error = new OriginError(
      'Test origin error', 
      OriginErrorType.ORIGIN_NOT_FOUND
    );
    
    expect(error.message).toBe('Test origin error');
    expect(error.errorType).toBe(OriginErrorType.ORIGIN_NOT_FOUND);
    expect(error.name).toBe('OriginError');
    // It inherits from VideoTransformError with CONFIG_ERROR type, which has status 500
    expect(error.statusCode).toBe(500);
  });
  
  it('should include context information', () => {
    const context = { 
      originalUrl: 'https://example.com/videos/sample.mp4', 
      parameters: { path: '/videos/sample.mp4' } 
    };
    const error = new OriginError(
      'Origin not found', 
      OriginErrorType.ORIGIN_NOT_FOUND, 
      context
    );
    
    expect(error.context).toEqual(context);
  });
  
  it('should create not found error correctly', () => {
    const path = '/videos/unknown.mp4';
    const error = OriginError.notFound(path);
    
    expect(error.message).toBe('No matching origin found for path: /videos/unknown.mp4');
    expect(error.errorType).toBe(OriginErrorType.ORIGIN_NOT_FOUND);
    expect(error.context.parameters.path).toBe(path);
  });
  
  it('should create source resolution failed error correctly', () => {
    const originName = 'videos';
    const path = '/videos/sample.mp4';
    const reason = 'Source type not supported';
    
    const error = OriginError.sourceResolutionFailed(originName, path, reason);
    
    expect(error.message).toBe(
      'Failed to resolve source for origin \'videos\' and path \'/videos/sample.mp4\': Source type not supported'
    );
    expect(error.errorType).toBe(OriginErrorType.SOURCE_RESOLUTION_FAILED);
    expect(error.context.parameters).toEqual({
      originName,
      path,
      reason
    });
  });
  
  it('should create source type not supported error correctly', () => {
    const sourceType = 'invalid';
    const originName = 'videos';
    
    const error = OriginError.sourceTypeNotSupported(sourceType, originName);
    
    expect(error.message).toBe(
      'Source type \'invalid\' is not supported in origin \'videos\''
    );
    expect(error.errorType).toBe(OriginErrorType.SOURCE_TYPE_NOT_SUPPORTED);
    expect(error.context.parameters).toEqual({
      sourceType,
      originName
    });
  });
  
  it('should create validation failed error correctly', () => {
    const originName = 'videos';
    const validationError = 'Missing required property: sources';
    
    const error = OriginError.validationFailed(originName, validationError);
    
    expect(error.message).toBe(
      'Validation failed for origin \'videos\': Missing required property: sources'
    );
    expect(error.errorType).toBe(OriginErrorType.ORIGIN_VALIDATION_FAILED);
    expect(error.context.parameters).toEqual({
      originName,
      validationError
    });
  });
  
  it('should create path resolution failed error correctly', () => {
    const path = '/videos/sample.mp4';
    const originName = 'videos';
    const reason = 'Invalid capture group reference';
    
    const error = OriginError.pathResolutionFailed(path, originName, reason);
    
    expect(error.message).toBe(
      'Failed to resolve path \'/videos/sample.mp4\' for origin \'videos\': Invalid capture group reference'
    );
    expect(error.errorType).toBe(OriginErrorType.PATH_RESOLUTION_FAILED);
    expect(error.context.parameters).toEqual({
      path,
      originName,
      reason
    });
  });
  
  it('should create auth configuration error correctly', () => {
    const sourceType = 'remote';
    const originName = 'premium-videos';
    const reason = 'Missing required credentials';
    
    const error = OriginError.authConfigurationError(sourceType, originName, reason);
    
    expect(error.message).toBe(
      'Authentication configuration error for remote source in origin \'premium-videos\': Missing required credentials'
    );
    expect(error.errorType).toBe(OriginErrorType.AUTH_CONFIGURATION_ERROR);
    expect(error.context.parameters).toEqual({
      sourceType,
      originName,
      reason
    });
  });
});

describe('OriginResolutionError', () => {
  it('should create an origin resolution error with proper name and type', () => {
    const path = '/videos/unknown.mp4';
    const error = new OriginResolutionError(
      'No matching origin found', 
      path
    );
    
    expect(error.message).toBe('No matching origin found');
    expect(error.errorType).toBe(OriginErrorType.ORIGIN_NOT_FOUND);
    expect(error.name).toBe('OriginResolutionError');
    expect(error.context.parameters.path).toBe(path);
  });
});

describe('SourceResolutionError', () => {
  it('should create a source resolution error with proper name and type', () => {
    const originName = 'videos';
    const sourceType = 'r2';
    const error = new SourceResolutionError(
      'Failed to resolve R2 source', 
      originName,
      sourceType
    );
    
    expect(error.message).toBe('Failed to resolve R2 source');
    expect(error.errorType).toBe(OriginErrorType.SOURCE_RESOLUTION_FAILED);
    expect(error.name).toBe('SourceResolutionError');
    expect(error.context.parameters).toEqual({
      originName,
      sourceType
    });
  });
});
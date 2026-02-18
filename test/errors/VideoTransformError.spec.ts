import { describe, it, expect } from 'vitest';
import {
  VideoTransformError,
  ErrorType,
  ValidationError,
  ProcessingError,
  ConfigurationError,
  NotFoundError,
} from '../../src/errors';

describe('VideoTransformError', () => {
  it('should create a basic error with default error type', () => {
    const error = new VideoTransformError('Test error');

    expect(error.message).toBe('Test error');
    expect(error.errorType).toBe(ErrorType.UNKNOWN_ERROR);
    expect(error.statusCode).toBe(500);
    expect(error.name).toBe('VideoTransformError');
  });

  it('should create an error with specified error type', () => {
    const error = new VideoTransformError('Invalid parameter', ErrorType.INVALID_PARAMETER);

    expect(error.message).toBe('Invalid parameter');
    expect(error.errorType).toBe(ErrorType.INVALID_PARAMETER);
    expect(error.statusCode).toBe(400);
    expect(error.name).toBe('VideoTransformError');
  });

  it('should include context information', () => {
    const context = { originalUrl: 'https://example.com/video.mp4', parameters: { width: 3000 } };
    const error = new VideoTransformError('Invalid width', ErrorType.INVALID_DIMENSION, context);

    expect(error.context).toEqual(context);
  });

  it('should convert to JSON representation', () => {
    const error = new VideoTransformError('Test error', ErrorType.INVALID_PARAMETER, {
      test: 'value',
    });
    const json = error.toJSON();

    expect(json).toEqual({
      name: 'VideoTransformError',
      errorType: ErrorType.INVALID_PARAMETER,
      message: 'Test error',
      statusCode: 400,
      context: { test: 'value' },
    });
  });

  it('should create a response with correct status code and headers', () => {
    const error = new VideoTransformError('Test error', ErrorType.INVALID_PARAMETER);
    const response = error.toResponse();

    expect(response.status).toBe(400);
    expect(response.headers.get('Content-Type')).toBe('application/json');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('X-Error-Type')).toBe(ErrorType.INVALID_PARAMETER);

    // Check response body
    const bodyPromise = response.json();
    return expect(bodyPromise).resolves.toEqual({
      error: ErrorType.INVALID_PARAMETER,
      message: 'Test error',
      statusCode: 400,
    });
  });
});

describe('ValidationError', () => {
  it('should create a validation error with proper name', () => {
    const error = new ValidationError('Invalid value');

    expect(error.message).toBe('Invalid value');
    expect(error.errorType).toBe(ErrorType.INVALID_PARAMETER);
    expect(error.statusCode).toBe(400);
    expect(error.name).toBe('ValidationError');
  });

  it('should create invalid mode error correctly', () => {
    const error = ValidationError.invalidMode('unknown', ['video', 'frame']);

    expect(error.message).toBe('Invalid mode: unknown. Must be one of: video, frame');
    expect(error.errorType).toBe(ErrorType.INVALID_MODE);
    expect(error.context.parameters).toEqual({ mode: 'unknown', validModes: ['video', 'frame'] });
  });

  it('should create invalid dimension error correctly', () => {
    const error = ValidationError.invalidDimension('width', 3000, 10, 2000);

    expect(error.message).toBe('width must be between 10 and 2000 pixels');
    expect(error.errorType).toBe(ErrorType.INVALID_DIMENSION);
    expect(error.context.parameters).toEqual({ width: 3000, min: 10, max: 2000 });
  });
});

describe('ProcessingError', () => {
  it('should create a processing error with proper name', () => {
    const error = new ProcessingError('Processing failed');

    expect(error.message).toBe('Processing failed');
    expect(error.errorType).toBe(ErrorType.TRANSFORMATION_FAILED);
    expect(error.statusCode).toBe(500);
    expect(error.name).toBe('ProcessingError');
  });

  it('should create fetch failed error correctly', () => {
    const error = ProcessingError.fetchFailed('Connection failed', 502);

    expect(error.message).toBe('Fetch failed with status 502: Connection failed');
    expect(error.errorType).toBe(ErrorType.FETCH_FAILED);
    expect(error.context.parameters).toEqual({ statusCode: 502 });
  });

  it('should create error from original error', () => {
    const originalError = new Error('Original error');
    originalError.stack = 'Error: Original error\n  at function\n  at file';

    const error = ProcessingError.fromError(originalError);

    expect(error.message).toBe('Original error');
    expect(error.errorType).toBe(ErrorType.TRANSFORMATION_FAILED);
    expect(error.context.originalError).toEqual({
      message: originalError.message,
      name: originalError.name,
      stack: originalError.stack,
    });
  });
});

describe('ConfigurationError', () => {
  it('should create a configuration error with proper name', () => {
    const error = new ConfigurationError('Config error');

    expect(error.message).toBe('Config error');
    expect(error.errorType).toBe(ErrorType.CONFIG_ERROR);
    expect(error.statusCode).toBe(500);
    expect(error.name).toBe('ConfigurationError');
  });

  it('should create missing property error correctly', () => {
    const error = ConfigurationError.missingProperty('config.cache.method');

    expect(error.message).toBe('Missing required configuration property: config.cache.method');
    expect(error.context.parameters).toEqual({ propertyPath: 'config.cache.method' });
  });
});

describe('NotFoundError', () => {
  it('should create a not found error with proper name', () => {
    const error = new NotFoundError('Not found');

    expect(error.message).toBe('Not found');
    expect(error.errorType).toBe(ErrorType.RESOURCE_NOT_FOUND);
    expect(error.statusCode).toBe(404);
    expect(error.name).toBe('NotFoundError');
  });

  it('should create pattern not found error correctly', () => {
    const error = NotFoundError.patternNotFound('/unknown/path');

    expect(error.message).toBe('No matching path pattern found for: /unknown/path');
    expect(error.errorType).toBe(ErrorType.PATTERN_NOT_FOUND);
    expect(error.context.parameters).toEqual({ path: '/unknown/path' });
  });
});

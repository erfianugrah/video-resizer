/**
 * Specialized error class for processing errors
 */
import { VideoTransformError, ErrorType, ErrorContext } from './VideoTransformError';

export class ProcessingError extends VideoTransformError {
  constructor(
    message: string,
    errorType: ErrorType = ErrorType.TRANSFORMATION_FAILED,
    context: ErrorContext = {}
  ) {
    super(message, errorType, context);
    this.name = 'ProcessingError';
  }
  
  /**
   * Create a processing error for transformation failures
   */
  static transformationFailed(
    message: string,
    context: ErrorContext = {}
  ): ProcessingError {
    return new ProcessingError(
      `Transformation failed: ${message}`,
      ErrorType.TRANSFORMATION_FAILED,
      context
    );
  }
  
  /**
   * Create a processing error for URL construction failures
   */
  static urlConstructionFailed(
    message: string,
    context: ErrorContext = {}
  ): ProcessingError {
    return new ProcessingError(
      `Failed to construct URL: ${message}`,
      ErrorType.URL_CONSTRUCTION_FAILED,
      context
    );
  }
  
  /**
   * Create a processing error for fetch failures
   */
  static fetchFailed(
    message: string,
    statusCode?: number,
    context: ErrorContext = {}
  ): ProcessingError {
    const errorMessage = statusCode 
      ? `Fetch failed with status ${statusCode}: ${message}`
      : `Fetch failed: ${message}`;
    
    return new ProcessingError(
      errorMessage,
      ErrorType.FETCH_FAILED,
      {
        ...context,
        parameters: {
          ...context.parameters,
          statusCode
        }
      }
    );
  }
  
  /**
   * Create a processing error from an original error
   */
  static fromError(
    originalError: Error,
    errorType: ErrorType = ErrorType.TRANSFORMATION_FAILED,
    context: ErrorContext = {}
  ): ProcessingError {
    return new ProcessingError(
      originalError.message,
      errorType,
      {
        ...context,
        additionalInfo: originalError.stack
      }
    );
  }
}
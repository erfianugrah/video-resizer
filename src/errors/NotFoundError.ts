/**
 * Specialized error class for not found errors
 */
import { VideoTransformError, ErrorType, ErrorContext } from './VideoTransformError';

export class NotFoundError extends VideoTransformError {
  constructor(
    message: string,
    errorType: ErrorType = ErrorType.RESOURCE_NOT_FOUND,
    context: ErrorContext = {}
  ) {
    super(message, errorType, context);
    this.name = 'NotFoundError';
  }
  
  /**
   * Create a not found error for a missing pattern
   */
  static patternNotFound(
    path: string,
    context: ErrorContext = {}
  ): NotFoundError {
    return new NotFoundError(
      `No matching path pattern found for: ${path}`,
      ErrorType.PATTERN_NOT_FOUND,
      {
        ...context,
        parameters: {
          ...context.parameters,
          path
        }
      }
    );
  }
  
  /**
   * Create a not found error for a missing resource
   */
  static resourceNotFound(
    resourceType: string,
    resourceId: string,
    context: ErrorContext = {}
  ): NotFoundError {
    return new NotFoundError(
      `${resourceType} not found: ${resourceId}`,
      ErrorType.RESOURCE_NOT_FOUND,
      {
        ...context,
        parameters: {
          ...context.parameters,
          resourceType,
          resourceId
        }
      }
    );
  }
}
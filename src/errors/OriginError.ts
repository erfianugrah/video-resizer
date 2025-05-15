/**
 * Specialized error classes for Origins-related errors
 * 
 * These error classes handle specific error cases related to the Origins
 * configuration, resolution, and source handling.
 */

import { VideoTransformError, ErrorType, ErrorContext } from './VideoTransformError';

// Add new error types to the existing enum
export enum OriginErrorType {
  ORIGIN_NOT_FOUND = 'ORIGIN_NOT_FOUND',
  SOURCE_RESOLUTION_FAILED = 'SOURCE_RESOLUTION_FAILED',
  SOURCE_TYPE_NOT_SUPPORTED = 'SOURCE_TYPE_NOT_SUPPORTED',
  ORIGIN_VALIDATION_FAILED = 'ORIGIN_VALIDATION_FAILED',
  PATH_RESOLUTION_FAILED = 'PATH_RESOLUTION_FAILED',
  AUTH_CONFIGURATION_ERROR = 'AUTH_CONFIGURATION_ERROR'
}

/**
 * Base class for all Origins-related errors
 */
export class OriginError extends VideoTransformError {
  constructor(
    message: string,
    originErrorType: OriginErrorType,
    context: ErrorContext = {}
  ) {
    super(message, ErrorType.CONFIG_ERROR, context);
    this.name = 'OriginError';
    this.errorType = originErrorType as unknown as ErrorType;
  }

  /**
   * Create an error for when no matching origin is found for a path
   */
  static notFound(
    path: string,
    context: ErrorContext = {}
  ): OriginError {
    return new OriginError(
      `No matching origin found for path: ${path}`,
      OriginErrorType.ORIGIN_NOT_FOUND,
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
   * Create an error for when source resolution fails for an origin
   */
  static sourceResolutionFailed(
    originName: string,
    path: string,
    reason: string,
    context: ErrorContext = {}
  ): OriginError {
    return new OriginError(
      `Failed to resolve source for origin '${originName}' and path '${path}': ${reason}`,
      OriginErrorType.SOURCE_RESOLUTION_FAILED,
      {
        ...context,
        parameters: {
          ...context.parameters,
          originName,
          path,
          reason
        }
      }
    );
  }

  /**
   * Create an error for when a source type is not supported
   */
  static sourceTypeNotSupported(
    sourceType: string,
    originName: string,
    context: ErrorContext = {}
  ): OriginError {
    return new OriginError(
      `Source type '${sourceType}' is not supported in origin '${originName}'`,
      OriginErrorType.SOURCE_TYPE_NOT_SUPPORTED,
      {
        ...context,
        parameters: {
          ...context.parameters,
          sourceType,
          originName
        }
      }
    );
  }

  /**
   * Create an error for when origin validation fails
   */
  static validationFailed(
    originName: string,
    validationError: string,
    context: ErrorContext = {}
  ): OriginError {
    return new OriginError(
      `Validation failed for origin '${originName}': ${validationError}`,
      OriginErrorType.ORIGIN_VALIDATION_FAILED,
      {
        ...context,
        parameters: {
          ...context.parameters,
          originName,
          validationError
        }
      }
    );
  }

  /**
   * Create an error for when path resolution fails
   */
  static pathResolutionFailed(
    path: string,
    originName: string,
    reason: string,
    context: ErrorContext = {}
  ): OriginError {
    return new OriginError(
      `Failed to resolve path '${path}' for origin '${originName}': ${reason}`,
      OriginErrorType.PATH_RESOLUTION_FAILED,
      {
        ...context,
        parameters: {
          ...context.parameters,
          path,
          originName,
          reason
        }
      }
    );
  }

  /**
   * Create an error for authentication configuration errors
   */
  static authConfigurationError(
    sourceType: string,
    originName: string,
    reason: string,
    context: ErrorContext = {}
  ): OriginError {
    return new OriginError(
      `Authentication configuration error for ${sourceType} source in origin '${originName}': ${reason}`,
      OriginErrorType.AUTH_CONFIGURATION_ERROR,
      {
        ...context,
        parameters: {
          ...context.parameters,
          sourceType,
          originName,
          reason
        }
      }
    );
  }
}

/**
 * Error class for issues with Origin resolution
 */
export class OriginResolutionError extends OriginError {
  constructor(
    message: string,
    path: string,
    context: ErrorContext = {}
  ) {
    super(
      message,
      OriginErrorType.ORIGIN_NOT_FOUND,
      {
        ...context,
        parameters: {
          ...context.parameters,
          path
        }
      }
    );
    this.name = 'OriginResolutionError';
  }
}

/**
 * Error class for issues with Source resolution within an Origin
 */
export class SourceResolutionError extends OriginError {
  constructor(
    message: string,
    originName: string,
    sourceType: string,
    context: ErrorContext = {}
  ) {
    super(
      message,
      OriginErrorType.SOURCE_RESOLUTION_FAILED,
      {
        ...context,
        parameters: {
          ...context.parameters,
          originName,
          sourceType
        }
      }
    );
    this.name = 'SourceResolutionError';
  }
}
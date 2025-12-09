/**
 * Specialized error class for validation errors
 */
import { VideoTransformError, ErrorType, ErrorContext } from './VideoTransformError';

export class ValidationError extends VideoTransformError {
  constructor(
    message: string,
    errorType: ErrorType = ErrorType.INVALID_PARAMETER,
    context: ErrorContext = {}
  ) {
    super(message, errorType, context);
    this.name = 'ValidationError';
  }
  
  /**
   * Create a validation error for an invalid mode
   */
  static invalidMode(
    mode: string,
    validModes: string[],
    context: ErrorContext = {}
  ): ValidationError {
    return new ValidationError(
      `Invalid mode: ${mode}. Must be one of: ${validModes.join(', ')}`,
      ErrorType.INVALID_MODE,
      {
        ...context,
        parameters: {
          ...context.parameters,
          mode,
          validModes
        }
      }
    );
  }
  
  /**
   * Create a validation error for an invalid format
   */
  static invalidFormat(
    format: string,
    validFormats: string[],
    context: ErrorContext = {}
  ): ValidationError {
    return new ValidationError(
      `Invalid format: ${format}. Must be one of: ${validFormats.join(', ')}`,
      ErrorType.INVALID_FORMAT,
      {
        ...context,
        parameters: {
          ...context.parameters,
          format,
          validFormats
        }
      }
    );
  }
  
  /**
   * Create a validation error for invalid dimensions
   */
  static invalidDimension(
    dimensionName: string,
    value: number,
    min: number,
    max: number,
    context: ErrorContext = {}
  ): ValidationError {
    return new ValidationError(
      `${dimensionName} must be between ${min} and ${max} pixels`,
      ErrorType.INVALID_DIMENSION,
      {
        ...context,
        parameters: {
          ...context.parameters,
          [dimensionName]: value,
          min,
          max
        }
      }
    );
  }
  
  /**
   * Create a validation error for an invalid time value
   */
  static invalidTimeValue(
    paramName: string,
    value: string,
    context: ErrorContext = {}
  ): ValidationError {
    let message = `Invalid ${paramName} parameter: ${value}`;
    if (paramName === 'time') {
      message += '. Must be between 0s and 10m (e.g., "5s", "2m")';
    } else if (paramName === 'duration') {
      message += '. Must be between 1s and 300s (5m) (e.g., "5s", "1m", "5m")';
    }
    
    return new ValidationError(
      message,
      ErrorType.INVALID_TIME_VALUE,
      {
        ...context,
        parameters: {
          ...context.parameters,
          [paramName]: value
        }
      }
    );
  }
  
  /**
   * Create a validation error for an invalid option combination
   */
  static invalidOptionCombination(
    message: string,
    parameters: Record<string, unknown>,
    context: ErrorContext = {}
  ): ValidationError {
    return new ValidationError(
      message,
      ErrorType.INVALID_OPTION_COMBINATION,
      {
        ...context,
        parameters: {
          ...context.parameters,
          ...parameters
        }
      }
    );
  }
}

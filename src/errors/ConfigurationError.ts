/**
 * Specialized error class for configuration errors
 */
import { VideoTransformError, ErrorType, ErrorContext } from './VideoTransformError';

export class ConfigurationError extends VideoTransformError {
  constructor(
    message: string,
    context: ErrorContext = {}
  ) {
    super(message, ErrorType.CONFIG_ERROR, context);
    this.name = 'ConfigurationError';
  }
  
  /**
   * Create a configuration error for a missing configuration property
   */
  static missingProperty(
    propertyPath: string,
    context: ErrorContext = {}
  ): ConfigurationError {
    return new ConfigurationError(
      `Missing required configuration property: ${propertyPath}`,
      {
        ...context,
        parameters: {
          ...context.parameters,
          propertyPath
        }
      }
    );
  }
  
  /**
   * Create a configuration error for an invalid configuration value
   */
  static invalidValue(
    propertyPath: string,
    value: unknown,
    expectedType: string,
    context: ErrorContext = {}
  ): ConfigurationError {
    return new ConfigurationError(
      `Invalid configuration value for ${propertyPath}: expected ${expectedType}, got ${typeof value}`,
      {
        ...context,
        parameters: {
          ...context.parameters,
          propertyPath,
          value,
          expectedType
        }
      }
    );
  }
  
  /**
   * Create a configuration error for a pattern matching error
   */
  static patternError(
    message: string,
    patternName?: string,
    context: ErrorContext = {}
  ): ConfigurationError {
    const errorMessage = patternName
      ? `Pattern '${patternName}' error: ${message}`
      : `Pattern error: ${message}`;
    
    return new ConfigurationError(
      errorMessage,
      {
        ...context,
        parameters: {
          ...context.parameters,
          patternName
        }
      }
    );
  }
}
/**
 * Base error class for all video transformation errors
 * Provides enhanced error information and HTTP status code mapping
 */

export enum ErrorType {
  // Validation errors - 400 range
  INVALID_PARAMETER = 'INVALID_PARAMETER',
  INVALID_MODE = 'INVALID_MODE',
  INVALID_FORMAT = 'INVALID_FORMAT',
  INVALID_DIMENSION = 'INVALID_DIMENSION',
  INVALID_TIME_VALUE = 'INVALID_TIME_VALUE',
  INVALID_OPTION_COMBINATION = 'INVALID_OPTION_COMBINATION',
  
  // Processing errors - 500 range
  TRANSFORMATION_FAILED = 'TRANSFORMATION_FAILED',
  URL_CONSTRUCTION_FAILED = 'URL_CONSTRUCTION_FAILED',
  FETCH_FAILED = 'FETCH_FAILED',
  
  // Not found errors - 404
  PATTERN_NOT_FOUND = 'PATTERN_NOT_FOUND',
  RESOURCE_NOT_FOUND = 'RESOURCE_NOT_FOUND',
  
  // Configuration errors - 500 range
  CONFIG_ERROR = 'CONFIG_ERROR',
  
  // Unknown errors
  UNKNOWN_ERROR = 'UNKNOWN_ERROR'
}

export interface ErrorContext {
  originalUrl?: string;
  parameters?: Record<string, unknown>;
  source?: string;
  additionalInfo?: string;
}

export class VideoTransformError extends Error {
  public errorType: ErrorType;
  public statusCode: number;
  public context: ErrorContext;
  
  constructor(
    message: string,
    errorType: ErrorType = ErrorType.UNKNOWN_ERROR,
    context: ErrorContext = {}
  ) {
    super(message);
    this.name = 'VideoTransformError';
    this.errorType = errorType;
    this.context = context;
    
    // Automatically determine HTTP status code based on error type
    this.statusCode = this.mapErrorTypeToStatusCode(errorType);
    
    // Capture stack trace in V8 environments
    // This check is needed for environments where captureStackTrace isn't available
    // TypeScript doesn't know about V8's captureStackTrace, so we need to use type assertions
    if (typeof Error.captureStackTrace === 'function') {
      (Error.captureStackTrace as (thisArg: object, constructorOpt?: { new(...args: any[]): any }) => void)(this, VideoTransformError);
    }
  }
  
  /**
   * Map error types to appropriate HTTP status codes
   */
  private mapErrorTypeToStatusCode(errorType: ErrorType): number {
    // Client errors (400 range)
    const clientErrors = [
      ErrorType.INVALID_PARAMETER,
      ErrorType.INVALID_MODE,
      ErrorType.INVALID_FORMAT,
      ErrorType.INVALID_DIMENSION,
      ErrorType.INVALID_TIME_VALUE,
      ErrorType.INVALID_OPTION_COMBINATION,
    ];
    
    // Not found errors (404)
    const notFoundErrors = [
      ErrorType.PATTERN_NOT_FOUND,
      ErrorType.RESOURCE_NOT_FOUND,
    ];
    
    // Server errors (500 range)
    const serverErrors = [
      ErrorType.TRANSFORMATION_FAILED,
      ErrorType.URL_CONSTRUCTION_FAILED,
      ErrorType.FETCH_FAILED,
      ErrorType.CONFIG_ERROR,
    ];
    
    if (clientErrors.includes(errorType)) {
      return 400; // Bad Request
    } else if (notFoundErrors.includes(errorType)) {
      return 404; // Not Found
    } else if (serverErrors.includes(errorType)) {
      return 500; // Internal Server Error
    }
    
    // Default to internal server error for unknown errors
    return 500;
  }
  
  /**
   * Convert the error to a plain object for logging and diagnostics
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      errorType: this.errorType,
      message: this.message,
      statusCode: this.statusCode,
      context: this.context
    };
  }
  
  /**
   * Create an HTTP response from this error
   */
  toResponse(): Response {
    const responseBody = {
      error: this.errorType,
      message: this.message,
      statusCode: this.statusCode,
    };
    
    return new Response(JSON.stringify(responseBody), {
      status: this.statusCode,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'X-Error-Type': this.errorType,
      },
    });
  }
}
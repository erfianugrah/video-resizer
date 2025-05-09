/**
 * Error handling and parsing utilities
 */
import { tryOrDefault, logErrorWithContext } from '../errorHandlingUtils';
import { storeTransformationLimit } from './timeUtils';

/**
 * Implementation of parseErrorMessage that might throw errors
 */
function parseErrorMessageImpl(errorText: string): {
  originalMessage: string;
  specificError?: string;
  errorType?: string;
  limitType?: string;
  parameter?: string;
} {
  const result = {
    originalMessage: errorText,
  };
  
  // Log the start of parsing
  import('../legacyLoggerAdapter').then(({ debug }) => {
    debug('TransformationUtils', 'Parsing API error message', {
      errorText: errorText.substring(0, 100) // Truncate for safety
    });
  }).catch((err) => {
    // Log error with standardized error handling
    logErrorWithContext(
      'Failed to import logger for error message parsing',
      err,
      { errorTextSample: errorText.substring(0, 50) },
      'TransformationUtils'
    );
    console.debug(`[TransformationUtils] Parsing API error: ${errorText.substring(0, 50)}...`);
  });

  // Check for duration validation errors
  const durationMatch = errorText.match(/duration: attribute must be between (\d+)ms and ([\d.]+)s/i);
  if (durationMatch) {
    const minMs = parseInt(durationMatch[1], 10);
    const maxS = parseFloat(durationMatch[2]);
    
    // Log the discovered limits
    import('../legacyLoggerAdapter').then(({ info }) => {
      info('TransformationUtils', 'Discovered duration limits from API error', {
        minMs,
        maxSeconds: maxS,
        convertedMinSeconds: minMs / 1000,
        errorType: 'duration_limit',
        pattern: 'duration validation error'
      });
    }).catch((err) => {
      // Log error with standardized error handling
      logErrorWithContext(
        'Failed to import logger for duration limit discovery',
        err,
        { 
          minMs, 
          maxS, 
          convertedMinSeconds: minMs / 1000 
        },
        'TransformationUtils'
      );
    });
    
    // Store the discovered limits
    storeTransformationLimit('duration', 'min', minMs / 1000); // Convert ms to seconds
    storeTransformationLimit('duration', 'max', maxS);
    
    return {
      ...result,
      specificError: `Duration must be between ${minMs}ms and ${maxS}s`,
      errorType: 'duration_limit',
      limitType: 'duration',
      parameter: 'duration'
    };
  }
  
  // Check for file size validation errors
  const fileSizeMatch = errorText.match(/Input video must be less than (\d+) bytes/i);
  if (fileSizeMatch) {
    const maxBytes = parseInt(fileSizeMatch[1], 10);
    const maxMB = Math.round(maxBytes / (1024 * 1024) * 10) / 10; // Convert to MB with 1 decimal
    
    // Log the discovered limit
    import('../legacyLoggerAdapter').then(({ info }) => {
      info('TransformationUtils', 'Discovered file size limit from API error', {
        maxBytes,
        maxMB,
        errorType: 'file_size_limit',
        pattern: 'file size validation error'
      });
    }).catch((err) => {
      // Log error with standardized error handling
      logErrorWithContext(
        'Failed to import logger for file size limit discovery',
        err,
        { maxBytes, maxMB },
        'TransformationUtils'
      );
    });
    
    // Store the discovered limit
    storeTransformationLimit('fileSize', 'max', maxBytes);
    
    return {
      ...result,
      specificError: `Video file size must be less than ${maxMB}MB`,
      errorType: 'file_size_limit',
      limitType: 'fileSize',
      parameter: 'fileSize'
    };
  }
  
  // Log that no specific error pattern was matched
  import('../legacyLoggerAdapter').then(({ debug }) => {
    debug('TransformationUtils', 'No specific error pattern matched', {
      errorText: errorText.substring(0, 100) // Truncate for safety
    });
  }).catch((err) => {
    // For debug level, we can skip detailed error logging to reduce noise
    console.debug(`[TransformationUtils] No specific error pattern matched in: ${errorText.substring(0, 50)}...`);
  });
  
  // Add more error patterns as they are discovered
  
  return result;
}

/**
 * Parse error messages from Cloudflare's API to extract specific validation issues
 * Using tryOrDefault for safe error parsing with proper error handling
 * 
 * @param errorText - The error message text from Cloudflare's API
 * @returns An object with parsed error details and original error message
 */
export const parseErrorMessage = tryOrDefault<
  [string],
  {
    originalMessage: string;
    specificError?: string;
    errorType?: string;
    limitType?: string;
    parameter?: string;
  }
>(
  parseErrorMessageImpl,
  {
    functionName: 'parseErrorMessage',
    component: 'TransformationUtils',
    logErrors: true
  },
  { originalMessage: 'Error parsing failed' } // Default to a simple error message if parsing fails
);
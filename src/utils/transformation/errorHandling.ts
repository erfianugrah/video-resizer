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
  import('../logger')
    .then(({ logDebug: debug }) => {
      debug('TransformationUtils', 'Parsing API error message', {
        errorText: errorText.substring(0, 100), // Truncate for safety
      });
    })
    .catch((err) => {
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
  const durationMatch = errorText.match(
    /duration: attribute must be between (\d+)ms and ([\d.]+)s/i
  );
  if (durationMatch) {
    const minMs = parseInt(durationMatch[1], 10);
    const maxS = parseFloat(durationMatch[2]);

    // Log the discovered limits
    import('../logger')
      .then(({ logInfo: info }) => {
        info('TransformationUtils', 'Discovered duration limits from API error', {
          minMs,
          maxSeconds: maxS,
          convertedMinSeconds: minMs / 1000,
          errorType: 'duration_limit',
          pattern: 'duration validation error',
        });
      })
      .catch((err) => {
        // Log error with standardized error handling
        logErrorWithContext(
          'Failed to import logger for duration limit discovery',
          err,
          {
            minMs,
            maxS,
            convertedMinSeconds: minMs / 1000,
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
      parameter: 'duration',
    };
  }

  // Check for file size validation errors
  const fileSizeMatch = errorText.match(/Input video must be less than (\d+) bytes/i);
  if (fileSizeMatch) {
    const maxBytes = parseInt(fileSizeMatch[1], 10);
    const maxMB = Math.round((maxBytes / (1024 * 1024)) * 10) / 10; // Convert to MB with 1 decimal

    // Log the discovered limit
    import('../logger')
      .then(({ logInfo: info }) => {
        info('TransformationUtils', 'Discovered file size limit from API error', {
          maxBytes,
          maxMB,
          errorType: 'file_size_limit',
          pattern: 'file size validation error',
        });
      })
      .catch((err) => {
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
      parameter: 'fileSize',
    };
  }

  // Check for seek time exceeding video duration
  const seekTimeMatch = errorText.match(/seek time exceeds video duration/i);
  if (seekTimeMatch) {
    // Log the discovered error
    import('../logger')
      .then(({ logInfo: info }) => {
        info('TransformationUtils', 'Detected seek time error from API', {
          errorType: 'seek_time_error',
          pattern: 'seek time exceeds video duration',
        });
      })
      .catch((err) => {
        // Log error with standardized error handling
        logErrorWithContext(
          'Failed to import logger for seek time error',
          err,
          { errorType: 'seek_time_error' },
          'TransformationUtils'
        );
      });

    return {
      ...result,
      specificError: 'The specified timestamp (time parameter) exceeds the video duration',
      errorType: 'seek_time_error',
      limitType: 'time',
      parameter: 'time',
    };
  }

  // Check for invalid mode combinations
  const invalidModeMatch = errorText.match(/invalid (?:mode|combination)/i);
  if (invalidModeMatch) {
    // Log the discovered error
    import('../logger')
      .then(({ logInfo: info }) => {
        info('TransformationUtils', 'Detected invalid mode error from API', {
          errorType: 'invalid_mode_error',
          pattern: 'invalid mode combination',
        });
      })
      .catch((err) => {
        // Log error with standardized error handling
        logErrorWithContext(
          'Failed to import logger for mode error',
          err,
          { errorType: 'invalid_mode_error' },
          'TransformationUtils'
        );
      });

    return {
      ...result,
      specificError: 'Invalid parameter combination for the specified mode',
      errorType: 'invalid_mode_error',
      limitType: 'mode',
      parameter: 'mode',
    };
  }

  // Check for invalid parameter format or validation errors
  const invalidParameterMatch = errorText.match(
    /invalid (?:parameter|value|format)(?:\s+for\s+(\w+))?/i
  );
  if (invalidParameterMatch) {
    // Extract the specific parameter if mentioned in the error
    const parameterName = invalidParameterMatch[1]
      ? invalidParameterMatch[1].toLowerCase()
      : 'unknown';

    // Log the discovered error
    import('../logger')
      .then(({ logInfo: info }) => {
        info('TransformationUtils', 'Detected invalid parameter error from API', {
          errorType: 'invalid_parameter_error',
          pattern: 'invalid parameter format or value',
          parameter: parameterName,
        });
      })
      .catch((err) => {
        // Log error with standardized error handling
        logErrorWithContext(
          'Failed to import logger for parameter validation error',
          err,
          {
            errorType: 'invalid_parameter_error',
            parameter: parameterName,
          },
          'TransformationUtils'
        );
      });

    return {
      ...result,
      specificError:
        parameterName !== 'unknown'
          ? `Invalid value or format for the "${parameterName}" parameter`
          : 'Invalid parameter value or format',
      errorType: 'invalid_parameter_error',
      limitType: 'validation',
      parameter: parameterName,
    };
  }

  // Check for video not found or unreadable
  const videoNotReadableMatch = errorText.match(
    /(?:video not found|unable to read video|unable to process video|404 not found|resource not found|source does not exist)/i
  );
  if (videoNotReadableMatch) {
    // Log the discovered error
    import('../logger')
      .then(({ logInfo: info }) => {
        info('TransformationUtils', 'Detected video not readable error from API', {
          errorType: 'video_not_readable',
          pattern: 'video not found or not readable',
          hasNotFound:
            errorText.toLowerCase().includes('404 not found') ||
            errorText.toLowerCase().includes('resource not found'),
          matchedPattern: videoNotReadableMatch[0],
        });
      })
      .catch((err) => {
        // Log error with standardized error handling
        logErrorWithContext(
          'Failed to import logger for video not readable error',
          err,
          {
            errorType: 'video_not_readable',
            hasNotFound:
              errorText.toLowerCase().includes('404 not found') ||
              errorText.toLowerCase().includes('resource not found'),
            matchedPattern: videoNotReadableMatch[0],
          },
          'TransformationUtils'
        );
      });

    let specificErrorMessage = 'The source video could not be found or is not in a readable format';

    // For 404 errors, provide a more specific message
    if (
      errorText.toLowerCase().includes('404 not found') ||
      errorText.toLowerCase().includes('resource not found')
    ) {
      specificErrorMessage = 'The source video URL returned a 404 Not Found response';
    } else if (errorText.toLowerCase().includes('source does not exist')) {
      specificErrorMessage = 'The source video does not exist at the specified location';
    }

    return {
      ...result,
      specificError: specificErrorMessage,
      errorType: 'video_not_readable',
      limitType: 'source',
      parameter: 'source',
    };
  }

  // Log that no specific error pattern was matched
  import('../logger')
    .then(({ logDebug: debug }) => {
      debug('TransformationUtils', 'No specific error pattern matched', {
        errorText: errorText.substring(0, 100), // Truncate for safety
      });
    })
    .catch((err) => {
      // For debug level, we can skip detailed error logging to reduce noise
      console.debug(
        `[TransformationUtils] No specific error pattern matched in: ${errorText.substring(0, 50)}...`
      );
    });

  // Check for codec or format incompatibility errors
  const codecError = errorText.match(
    /(?:unsupported codec|unsupported format|codec not supported|format not supported|incompatible format)/i
  );
  if (codecError) {
    // Log the discovered error
    import('../logger')
      .then(({ logInfo: info }) => {
        info('TransformationUtils', 'Detected codec/format compatibility error from API', {
          errorType: 'codec_error',
          pattern: 'unsupported codec or format',
          matchedPattern: codecError[0],
        });
      })
      .catch((err) => {
        // Log error with standardized error handling
        logErrorWithContext(
          'Failed to import logger for codec error',
          err,
          {
            errorType: 'codec_error',
            matchedPattern: codecError[0],
          },
          'TransformationUtils'
        );
      });

    return {
      ...result,
      specificError: 'The video codec or format is not supported for transformation',
      errorType: 'codec_error',
      limitType: 'format',
      parameter: 'format',
    };
  }

  // Check for time format errors
  const timeFormatError = errorText.match(
    /(?:invalid time format|time format not recognized|malformed time|time: attribute must be in the format)/i
  );
  if (timeFormatError) {
    // Log the discovered error
    import('../logger')
      .then(({ logInfo: info }) => {
        info('TransformationUtils', 'Detected time format error from API', {
          errorType: 'time_format_error',
          pattern: 'invalid time format',
          matchedPattern: timeFormatError[0],
        });
      })
      .catch((err) => {
        // Log error with standardized error handling
        logErrorWithContext(
          'Failed to import logger for time format error',
          err,
          {
            errorType: 'time_format_error',
            matchedPattern: timeFormatError[0],
          },
          'TransformationUtils'
        );
      });

    return {
      ...result,
      specificError: 'The time parameter has an invalid format. Use format like "10s" or "1m30s"',
      errorType: 'time_format_error',
      limitType: 'format',
      parameter: 'time',
    };
  }

  // Check for resource limits or rate limiting
  const resourceLimitError = errorText.match(
    /(?:resource limit exceeded|rate limit exceeded|too many requests|service unavailable temporarily)/i
  );
  if (resourceLimitError) {
    // Log the discovered error
    import('../logger')
      .then(({ logInfo: info }) => {
        info('TransformationUtils', 'Detected resource/rate limit error from API', {
          errorType: 'resource_limit_error',
          pattern: 'resource limit or rate limit exceeded',
          matchedPattern: resourceLimitError[0],
        });
      })
      .catch((err) => {
        // Log error with standardized error handling
        logErrorWithContext(
          'Failed to import logger for resource limit error',
          err,
          {
            errorType: 'resource_limit_error',
            matchedPattern: resourceLimitError[0],
          },
          'TransformationUtils'
        );
      });

    return {
      ...result,
      specificError:
        'The service is currently experiencing high load or rate limits have been reached',
      errorType: 'resource_limit_error',
      limitType: 'service',
      parameter: 'service',
    };
  }

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
    logErrors: true,
  },
  { originalMessage: 'Error parsing failed' } // Default to a simple error message if parsing fails
);

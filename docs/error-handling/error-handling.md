# Error Handling in Video Resizer

This document outlines the error handling approach in the Video Resizer service, particularly for Cloudflare's Media Transformation API.

## Recent Updates

- **Worker Timeout Fix**: Resolved timeout issues by making KV storage asynchronous
- **Configuration Errors**: Removed fallback configuration that was causing "Invalid URL" errors
- **KV-Only Configuration**: Configuration now only loads from KV storage with clear error messages

## Error Categories

The error handling system identifies and handles the following categories of errors:

### 1. Resource Not Found Errors
- Pattern: `video not found`, `unable to read video`, `404 not found`, `resource not found`, `source does not exist`
- Status Code: 404
- Error Type: `video_not_readable`

### 2. Parameter Validation Errors
- Pattern: `invalid parameter`, `invalid value`, `invalid format`
- Status Code: 400
- Error Type: `invalid_parameter_error`

### 3. Mode Compatibility Errors
- Pattern: `invalid mode`, `invalid combination`
- Status Code: 400
- Error Type: `invalid_mode_error`

### 4. Time-Related Errors
- **Seek Time Errors**
  - Pattern: `seek time exceeds video duration`
  - Error Type: `seek_time_error`
  
- **Time Format Errors**
  - Pattern: `invalid time format`, `time format not recognized`, `malformed time`
  - Error Type: `time_format_error`
  
- **Duration Limit Errors**
  - Pattern: `duration: attribute must be between X and Y`
  - Error Type: `duration_limit`

### 5. Format and Codec Errors
- Pattern: `unsupported codec`, `unsupported format`, `codec not supported`, `format not supported`
- Status Code: 415
- Error Type: `codec_error`

### 6. Size Limitations
- Pattern: `Input video must be less than X bytes`
- Status Code: 413
- Error Type: `file_size_limit`

### 7. Service Resource Limitations
- Pattern: `resource limit exceeded`, `rate limit exceeded`, `too many requests`
- Status Code: 429
- Error Type: `resource_limit_error`

## Error Processing Flow

1. **Error Detection**: Errors from Cloudflare Media Transformation API are captured and identified using pattern matching.

2. **Error Classification**: Based on the error text, the error is classified into specific categories.

3. **Parameter Identification**: Where possible, the specific parameter causing the error is identified (e.g., `time`, `duration`, `mode`).

4. **Error Response**: A structured error response is generated with:
   - Original error message
   - Specific error message (user-friendly)
   - Error type classification
   - Affected parameter
   - Limit type (for validation errors)

5. **Headers Enhancement**: Error responses include detailed headers for easier client debugging:
   - `X-Error-Status`: HTTP status code
   - `X-Error-Type`: Error category
   - `X-Error-Subtype`: Specific error type
   - `X-Error-Parameter`: Parameter causing the error
   - Status-specific headers (e.g., `X-Video-Too-Large` for size limits)

## Fallback Mechanisms

When errors occur, the system attempts fallbacks in the following order:

1. **Duration Adjustment**: For duration limit errors, adjusts duration and retries.

2. **Pattern-Specific Origin Fallback**: Tries pattern-specific origins with authentication.

3. **Direct Source Fetch**: Attempts direct fetch from source URL.

4. **Storage Service Fallback**: Uses storage service as a last resort.

## Debugging Support

- Detailed error logging with original and parsed error information
- Diagnostic information collection for debugging
- Support for `debug=view` URL parameter to view detailed error information

## Testing

Error handling patterns are verified with tests to ensure correct identification and classification of different error types.
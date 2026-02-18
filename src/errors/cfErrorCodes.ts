/**
 * Cloudflare Media Transformations error codes
 *
 * These codes appear in the `Cf-Resized` response header as `err=XXXX`
 * when Cloudflare's CDN-CGI media transformation endpoint returns an error.
 *
 * @see https://developers.cloudflare.com/images/transform-images/troubleshoot-images/
 */

import { ErrorType } from './VideoTransformError';

/** All known Cloudflare Media Transformation error codes */
export enum CfErrorCode {
  /** Missing or invalid required options (e.g., width/height out of range) */
  INVALID_OPTIONS = 9401,
  /** Origin server returned a response body too large or didn't respond at all */
  ORIGIN_TOO_LARGE_OR_NO_RESPONSE = 9402,
  /** Resource does not exist at origin */
  RESOURCE_NOT_FOUND = 9404,
  /** URL contains spaces or unescaped Unicode characters */
  MALFORMED_URL = 9406,
  /** DNS lookup error for the origin hostname */
  DNS_ERROR = 9407,
  /** Origin returned an HTTP 4xx error */
  ORIGIN_CLIENT_ERROR = 9408,
  /** Origin returned content that is not video/image (e.g., HTML error page) */
  ORIGIN_NOT_MEDIA = 9412,
  /** Non-HTTPS URL in the source or URL formatting error */
  URL_FORMAT_ERROR = 9419,
  /** Origin server is unreachable (connection timeout, refused, etc.) */
  ORIGIN_UNREACHABLE = 9504,
  /** Origin returned an HTTP 5xx error */
  ORIGIN_SERVER_ERROR = 9509,
  /** Cloudflare internal error (transformation worker) */
  CF_INTERNAL_ERROR_A = 9517,
  /** Cloudflare internal error (transformation pipeline) */
  CF_INTERNAL_ERROR_B = 9523,
}

/**
 * Metadata for each CF error code: human-readable description,
 * mapping to our ErrorType, whether it's retryable, and whether
 * the system should attempt a fallback to the original source.
 */
export interface CfErrorInfo {
  /** The numeric CF error code */
  code: CfErrorCode;
  /** Short human-readable label */
  label: string;
  /** Longer description of the error */
  description: string;
  /** Our internal ErrorType mapping */
  errorType: ErrorType;
  /** HTTP status code we should return to the client */
  httpStatus: number;
  /** Whether this error is worth retrying (transient) */
  retryable: boolean;
  /** Whether we should attempt a direct-source fallback */
  shouldFallback: boolean;
}

/**
 * Complete mapping of CF error codes to their metadata.
 */
export const CF_ERROR_MAP: ReadonlyMap<CfErrorCode, CfErrorInfo> = new Map<
  CfErrorCode,
  CfErrorInfo
>([
  [
    CfErrorCode.INVALID_OPTIONS,
    {
      code: CfErrorCode.INVALID_OPTIONS,
      label: 'Invalid Options',
      description:
        'Missing or invalid required transformation options (e.g., width/height out of range)',
      errorType: ErrorType.INVALID_PARAMETER,
      httpStatus: 400,
      retryable: false,
      shouldFallback: false,
    },
  ],
  [
    CfErrorCode.ORIGIN_TOO_LARGE_OR_NO_RESPONSE,
    {
      code: CfErrorCode.ORIGIN_TOO_LARGE_OR_NO_RESPONSE,
      label: 'Origin Too Large / No Response',
      description:
        'The origin returned a response body that is too large for transformation, or the origin did not respond',
      errorType: ErrorType.TRANSFORMATION_FAILED,
      httpStatus: 502,
      retryable: false,
      shouldFallback: true,
    },
  ],
  [
    CfErrorCode.RESOURCE_NOT_FOUND,
    {
      code: CfErrorCode.RESOURCE_NOT_FOUND,
      label: 'Resource Not Found',
      description: 'The requested resource does not exist at the origin',
      errorType: ErrorType.RESOURCE_NOT_FOUND,
      httpStatus: 404,
      retryable: false,
      shouldFallback: false,
    },
  ],
  [
    CfErrorCode.MALFORMED_URL,
    {
      code: CfErrorCode.MALFORMED_URL,
      label: 'Malformed URL',
      description: 'Source URL contains spaces or unescaped Unicode characters',
      errorType: ErrorType.INVALID_PARAMETER,
      httpStatus: 400,
      retryable: false,
      shouldFallback: false,
    },
  ],
  [
    CfErrorCode.DNS_ERROR,
    {
      code: CfErrorCode.DNS_ERROR,
      label: 'DNS Error',
      description: 'DNS lookup failed for the origin hostname',
      errorType: ErrorType.FETCH_FAILED,
      httpStatus: 502,
      retryable: true,
      shouldFallback: true,
    },
  ],
  [
    CfErrorCode.ORIGIN_CLIENT_ERROR,
    {
      code: CfErrorCode.ORIGIN_CLIENT_ERROR,
      label: 'Origin Client Error',
      description: 'The origin server returned an HTTP 4xx error',
      errorType: ErrorType.FETCH_FAILED,
      httpStatus: 502,
      retryable: false,
      shouldFallback: true,
    },
  ],
  [
    CfErrorCode.ORIGIN_NOT_MEDIA,
    {
      code: CfErrorCode.ORIGIN_NOT_MEDIA,
      label: 'Origin Not Media',
      description: 'The origin returned content that is not video or image (e.g., HTML error page)',
      errorType: ErrorType.TRANSFORMATION_FAILED,
      httpStatus: 502,
      retryable: false,
      shouldFallback: true,
    },
  ],
  [
    CfErrorCode.URL_FORMAT_ERROR,
    {
      code: CfErrorCode.URL_FORMAT_ERROR,
      label: 'URL Format Error',
      description: 'Non-HTTPS URL in the source, or URL formatting problem',
      errorType: ErrorType.INVALID_PARAMETER,
      httpStatus: 400,
      retryable: false,
      shouldFallback: false,
    },
  ],
  [
    CfErrorCode.ORIGIN_UNREACHABLE,
    {
      code: CfErrorCode.ORIGIN_UNREACHABLE,
      label: 'Origin Unreachable',
      description: 'The origin server is unreachable (connection timeout, refused, etc.)',
      errorType: ErrorType.FETCH_FAILED,
      httpStatus: 502,
      retryable: true,
      shouldFallback: true,
    },
  ],
  [
    CfErrorCode.ORIGIN_SERVER_ERROR,
    {
      code: CfErrorCode.ORIGIN_SERVER_ERROR,
      label: 'Origin Server Error',
      description: 'The origin server returned an HTTP 5xx error',
      errorType: ErrorType.FETCH_FAILED,
      httpStatus: 502,
      retryable: true,
      shouldFallback: true,
    },
  ],
  [
    CfErrorCode.CF_INTERNAL_ERROR_A,
    {
      code: CfErrorCode.CF_INTERNAL_ERROR_A,
      label: 'CF Internal Error',
      description: 'Cloudflare internal error in the transformation worker',
      errorType: ErrorType.TRANSFORMATION_FAILED,
      httpStatus: 500,
      retryable: true,
      shouldFallback: true,
    },
  ],
  [
    CfErrorCode.CF_INTERNAL_ERROR_B,
    {
      code: CfErrorCode.CF_INTERNAL_ERROR_B,
      label: 'CF Internal Error',
      description: 'Cloudflare internal error in the transformation pipeline',
      errorType: ErrorType.TRANSFORMATION_FAILED,
      httpStatus: 500,
      retryable: true,
      shouldFallback: true,
    },
  ],
]);

/**
 * Extract a CF error code from the `Cf-Resized` response header.
 *
 * The header value looks like: `err=9404` or `internal=ok err=9404`
 * or on success: `internal=ok q=85 n=1234`
 *
 * @returns The numeric error code, or null if no error code is present
 */
export function extractCfErrorCode(response: Response): CfErrorCode | null {
  const cfResized = response.headers.get('Cf-Resized') || response.headers.get('cf-resized');
  if (!cfResized) return null;

  const match = cfResized.match(/err=(\d+)/);
  if (!match) return null;

  const code = parseInt(match[1], 10);

  // Validate it's a known code
  if (CF_ERROR_MAP.has(code as CfErrorCode)) {
    return code as CfErrorCode;
  }

  // Return the code even if unknown — callers can handle unknown codes
  return code as CfErrorCode;
}

/**
 * Look up the metadata for a CF error code.
 * Returns undefined for unknown codes.
 */
export function getCfErrorInfo(code: CfErrorCode): CfErrorInfo | undefined {
  return CF_ERROR_MAP.get(code);
}

/**
 * Check whether a CF error code indicates a retryable failure.
 * Unknown codes are treated as retryable (fail-safe).
 */
export function isCfErrorRetryable(code: CfErrorCode): boolean {
  const info = CF_ERROR_MAP.get(code);
  return info?.retryable ?? true;
}

/**
 * Check whether a CF error code suggests we should try
 * serving the original (untransformed) source as a fallback.
 * Unknown codes default to true (fail-safe: prefer showing something).
 */
export function shouldCfErrorFallback(code: CfErrorCode): boolean {
  const info = CF_ERROR_MAP.get(code);
  return info?.shouldFallback ?? true;
}

/**
 * Error classification and enhanced header logic for Origins-based transformation
 *
 * Handles error classification for different HTTP status codes,
 * enhanced error response headers, and retry logic for alternative sources.
 * Extracted from TransformVideoCommand.executeWithOrigins().
 *
 * Phase 6: Integrates Cloudflare Media Transformation error codes from the
 * `Cf-Resized` response header for precise error classification.
 */
import { DiagnosticsInfo } from '../../utils/debugHeadersUtils';
import { RequestContext } from '../../utils/requestContext';
import { createCategoryLogger } from '../../utils/logger';
import { addVersionToUrl } from '../../utils/urlVersionUtils';
import { handleTransformationError } from '../../services/errorHandlerService';
import { logErrorWithContext } from '../../utils/errorHandlingUtils';
import { Origin } from '../../services/videoStorage/interfaces';
import { SourceResolutionResult } from '../../services/origins/OriginResolver';
import { EnvVariables } from '../../config/environmentConfig';
import { VideoTransformContext, VideoTransformOptions, WorkerEnvironment } from './types';
import { retryWithAlternativeOrigins } from '../../services/transformation/retryWithAlternativeOrigins';
import {
  extractCfErrorCode,
  getCfErrorInfo,
  CfErrorCode,
  type CfErrorInfo,
} from '../../errors/cfErrorCodes';

const errLogger = createCategoryLogger('OriginsErrorHandler');

/**
 * Parameters for classifyAndHandleOriginError
 */
export interface OriginErrorParams {
  response: Response;
  request: Request;
  options: VideoTransformOptions;
  origin: Origin;
  sourceResolution: SourceResolutionResult;
  context: VideoTransformContext;
  requestContext: RequestContext;
  diagnosticsInfo: DiagnosticsInfo;
  cdnCgiUrl: string;
  env: WorkerEnvironment | undefined;
}

/**
 * Classify an error response and add diagnostics, then handle it.
 * Handles R2 not found, HTTP 400/404/413/415/429/5xx errors,
 * enhanced error response headers (X-Error-Code, X-Source-Info, etc.),
 * and retry logic for alternative sources.
 *
 * Phase 6: First checks the `Cf-Resized` header for a Cloudflare error code.
 * When present, the CF code provides authoritative error classification that
 * overrides the HTTP-status-based heuristics.
 */
export async function classifyAndHandleOriginError(params: OriginErrorParams): Promise<Response> {
  const {
    response,
    request,
    options,
    origin,
    sourceResolution,
    context,
    requestContext,
    diagnosticsInfo,
    cdnCgiUrl,
    env,
  } = params;

  // --- Phase 6: Extract CF error code from Cf-Resized header ---
  const cfErrorCode = extractCfErrorCode(response);
  const cfErrorInfo = cfErrorCode !== null ? getCfErrorInfo(cfErrorCode) : undefined;

  if (cfErrorCode !== null) {
    // Record CF error code in diagnostics for downstream consumers
    diagnosticsInfo.cfErrorCode = cfErrorCode;
    if (cfErrorInfo) {
      diagnosticsInfo.cfErrorInfo = {
        label: cfErrorInfo.label,
        description: cfErrorInfo.description,
        retryable: cfErrorInfo.retryable,
        shouldFallback: cfErrorInfo.shouldFallback,
      };
    }

    errLogger.debug('Extracted Cloudflare error code from Cf-Resized header', {
      cfErrorCode,
      cfErrorLabel: cfErrorInfo?.label,
      httpStatus: response.status,
      retryable: cfErrorInfo?.retryable,
      shouldFallback: cfErrorInfo?.shouldFallback,
      origin: origin.name,
    });
  }

  // --- Error classification ---
  // CF error code takes priority for classification when available;
  // we still fall through to HTTP status code handling for the control flow
  // (e.g., 404 triggers retry, 400 triggers body inspection), but diagnostics
  // are enriched with the authoritative CF error information.

  if (response.status === 404 || cfErrorCode === CfErrorCode.RESOURCE_NOT_FOUND) {
    diagnosticsInfo.errors = diagnosticsInfo.errors || [];
    diagnosticsInfo.errors.push(
      cfErrorCode === CfErrorCode.RESOURCE_NOT_FOUND
        ? `Source video not found (CF error ${cfErrorCode})`
        : 'Source video not found (404)'
    );
    diagnosticsInfo.errorDetails = {
      status: cfErrorInfo?.httpStatus || 404,
      type: 'not_found',
      message: cfErrorInfo?.description || 'The source video URL returned a 404 Not Found response',
      source: sourceResolution.sourceUrl || 'unknown',
      originType: sourceResolution.originType,
      ...(cfErrorCode !== null && { cfErrorCode }),
    };

    errLogger.debug('Handling 404/not-found error with retry mechanism', {
      origin: origin.name,
      failedSource: sourceResolution.source.type,
      failedPriority: sourceResolution.source.priority,
      cfErrorCode,
    });

    return await retryWithAlternativeOrigins({
      originalRequest: request,
      transformOptions: options as any,
      failedOrigin: origin,
      failedSource: sourceResolution.source,
      context: context,
      env: env as EnvVariables,
      requestContext: requestContext,
      pathPatterns: context.pathPatterns,
      debugInfo: context.debugInfo,
    });
  } else if (response.status === 400) {
    await classifyBadRequestError(response, options, diagnosticsInfo, cfErrorCode, cfErrorInfo);
  } else if (response.status === 413) {
    diagnosticsInfo.errors = diagnosticsInfo.errors || [];
    diagnosticsInfo.errors.push('Payload too large (413) - Video file size exceeds limits');
    diagnosticsInfo.errorDetails = {
      status: 413,
      type: 'file_size_limit',
      message:
        cfErrorInfo?.description ||
        'The video file size exceeds the maximum allowed for transformation',
      ...(cfErrorCode !== null && { cfErrorCode }),
    };
  } else if (response.status === 415) {
    diagnosticsInfo.errors = diagnosticsInfo.errors || [];
    diagnosticsInfo.errors.push('Unsupported Media Type (415) - Video format not supported');
    diagnosticsInfo.errorDetails = {
      status: 415,
      type: 'unsupported_format',
      message:
        cfErrorInfo?.description || 'The video format or codec is not supported for transformation',
      ...(cfErrorCode !== null && { cfErrorCode }),
    };
  } else if (response.status === 429) {
    diagnosticsInfo.errors = diagnosticsInfo.errors || [];
    diagnosticsInfo.errors.push('Too Many Requests (429) - Rate limit exceeded');
    diagnosticsInfo.errorDetails = {
      status: 429,
      type: 'rate_limit',
      message: 'Rate limit exceeded for video transformation requests',
      ...(cfErrorCode !== null && { cfErrorCode }),
    };
  } else if (
    response.status >= 500 ||
    cfErrorCode === CfErrorCode.CF_INTERNAL_ERROR_A ||
    cfErrorCode === CfErrorCode.CF_INTERNAL_ERROR_B
  ) {
    diagnosticsInfo.errors = diagnosticsInfo.errors || [];

    const errorLabel = cfErrorInfo
      ? `${cfErrorInfo.label} (CF ${cfErrorCode})`
      : `Server Error (${response.status})`;

    diagnosticsInfo.errors.push(`${errorLabel} - Cloudflare transformation service error`);
    diagnosticsInfo.errorDetails = {
      status: cfErrorInfo?.httpStatus || response.status,
      type: 'server_error',
      message:
        cfErrorInfo?.description ||
        'The Cloudflare transformation service encountered an internal error',
      ...(cfErrorCode !== null && { cfErrorCode }),
    };
  } else if (cfErrorInfo) {
    // CF error code is present but HTTP status didn't match any of the above categories.
    // Use the CF error info for classification.
    diagnosticsInfo.errors = diagnosticsInfo.errors || [];
    diagnosticsInfo.errors.push(`${cfErrorInfo.label} (CF ${cfErrorCode})`);
    diagnosticsInfo.errorDetails = {
      status: cfErrorInfo.httpStatus,
      type: cfErrorInfo.errorType,
      message: cfErrorInfo.description,
      cfErrorCode: cfErrorCode!,
    };
  }

  // --- Compute fallback URL ---
  let fallbackOriginUrl = sourceResolution.sourceUrl || null;
  if (fallbackOriginUrl && options.version !== undefined) {
    fallbackOriginUrl = addVersionToUrl(fallbackOriginUrl, options.version);
    errLogger.debug('Applied version to fallback URL in CDN-CGI error handler', {
      fallbackOriginUrl,
      version: options.version,
    });
  }

  // --- Enhanced error headers ---
  if (response.status !== 200) {
    try {
      const enhancedResponse = await buildEnhancedErrorResponse(
        response,
        sourceResolution,
        diagnosticsInfo
      );

      return await handleTransformationError({
        errorResponse: enhancedResponse,
        originalRequest: request,
        context: context,
        requestContext: requestContext,
        diagnosticsInfo,
        fallbackOriginUrl,
        cdnCgiUrl,
        source: sourceResolution.originType,
      });
    } catch (headerError) {
      logErrorWithContext(
        'Error adding detailed error headers',
        headerError,
        { status: response.status },
        'TransformVideoCommand.executeWithOrigins'
      );
    }
  }

  // Default case - use original response if header enhancement failed
  return await handleTransformationError({
    errorResponse: response,
    originalRequest: request,
    context: context,
    requestContext: requestContext,
    diagnosticsInfo,
    fallbackOriginUrl,
    cdnCgiUrl,
    source: sourceResolution.originType,
  });
}

/**
 * Classify a 400 Bad Request error by inspecting the response body.
 * Phase 6: When a CF error code is available, use it for authoritative
 * classification before falling back to body-text heuristics.
 */
async function classifyBadRequestError(
  response: Response,
  options: VideoTransformOptions,
  diagnosticsInfo: DiagnosticsInfo,
  cfErrorCode?: CfErrorCode | null,
  cfErrorInfo?: CfErrorInfo
): Promise<void> {
  diagnosticsInfo.errors = diagnosticsInfo.errors || [];
  diagnosticsInfo.errors.push('Bad request (400) - Possible parameter issue');

  // Phase 6: If we have a CF error code, use it for authoritative classification
  if (cfErrorCode !== null && cfErrorCode !== undefined && cfErrorInfo) {
    diagnosticsInfo.errorDetails = {
      status: 400,
      type: cfErrorInfo.errorType,
      message: cfErrorInfo.description,
      cfErrorCode,
      cfErrorLabel: cfErrorInfo.label,
    };

    errLogger.debug('Classified 400 error using CF error code', {
      cfErrorCode,
      cfErrorLabel: cfErrorInfo.label,
      description: cfErrorInfo.description,
    });

    // Still try to read the body for rawErrorText (useful for debugging)
    try {
      const clonedResponse = response.clone();
      const errorResponseBody = await clonedResponse.text();
      diagnosticsInfo.rawErrorText = errorResponseBody.substring(0, 500);
    } catch {
      // Body read failure is fine — we already have CF-based classification
    }
    return;
  }

  // Fallback: inspect the response body with text-matching heuristics
  const clonedResponse = response.clone();
  let errorResponseBody = '';

  try {
    errorResponseBody = await clonedResponse.text();

    if (errorResponseBody.includes('time') && errorResponseBody.includes('exceeds')) {
      diagnosticsInfo.errorDetails = {
        status: 400,
        type: 'seek_time_error',
        message: 'The specified timestamp (time parameter) exceeds the video duration',
        parameter: 'time',
        requestedTime: options.time || 'unknown',
      };
    } else if (
      errorResponseBody.includes('invalid') &&
      (errorResponseBody.includes('mode') || errorResponseBody.includes('combination'))
    ) {
      diagnosticsInfo.errorDetails = {
        status: 400,
        type: 'invalid_mode_error',
        message: 'Invalid parameter combination for the specified mode',
        parameter: 'mode',
        requestedMode: options.mode || 'video',
      };
    } else if (errorResponseBody.includes('format') && errorResponseBody.includes('invalid')) {
      diagnosticsInfo.errorDetails = {
        status: 400,
        type: 'format_error',
        message: 'Invalid format specified for transformation',
        parameter: 'format',
        requestedFormat: options.format || 'unknown',
      };
    } else {
      diagnosticsInfo.errorDetails = {
        status: 400,
        type: 'parameter_error',
        message: 'The transformation request was rejected, possibly due to invalid parameters',
        errorText: errorResponseBody.substring(0, 200),
      };
    }

    diagnosticsInfo.rawErrorText = errorResponseBody.substring(0, 500);
  } catch (bodyReadError) {
    diagnosticsInfo.errorDetails = {
      status: 400,
      type: 'parameter_error',
      message: 'The transformation request was rejected, possibly due to invalid parameters',
      bodyReadError: 'Failed to read error response body',
    };
  }
}

/**
 * Build a response with enhanced error headers for better client debugging.
 */
async function buildEnhancedErrorResponse(
  response: Response,
  sourceResolution: SourceResolutionResult,
  diagnosticsInfo: DiagnosticsInfo
): Promise<Response> {
  const enhancedResponse = new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });

  const enhancedHeaders = new Headers(enhancedResponse.headers);

  // Add generic error headers
  enhancedHeaders.set('X-Error-Status', String(response.status));

  // Phase 6: Add CF error code header when available
  if (diagnosticsInfo.cfErrorCode) {
    enhancedHeaders.set('X-CF-Error-Code', String(diagnosticsInfo.cfErrorCode));
  }
  if (
    diagnosticsInfo.cfErrorInfo &&
    typeof diagnosticsInfo.cfErrorInfo === 'object' &&
    'label' in diagnosticsInfo.cfErrorInfo
  ) {
    enhancedHeaders.set('X-CF-Error-Label', String(diagnosticsInfo.cfErrorInfo.label));
  }

  // Use the error body text from diagnostics if available, otherwise try to read it
  let errorResponseBody = '';

  if (diagnosticsInfo.rawErrorText && typeof diagnosticsInfo.rawErrorText === 'string') {
    errorResponseBody = diagnosticsInfo.rawErrorText;
  } else {
    try {
      const clonedResponse = response.clone();
      errorResponseBody = await clonedResponse.text();
    } catch (readError) {
      logErrorWithContext(
        'Error reading error response body',
        readError,
        { status: response.status },
        'TransformVideoCommand.executeWithOrigins'
      );
    }
  }

  // Add specific error headers based on status code
  if (response.status === 404) {
    enhancedHeaders.set('X-Error-Type', 'not_found');
    enhancedHeaders.set('X-Error-Source', sourceResolution.originType);
  } else if (response.status === 400) {
    enhancedHeaders.set('X-Error-Type', 'parameter_error');

    if (
      diagnosticsInfo.errorDetails &&
      typeof diagnosticsInfo.errorDetails === 'object' &&
      'type' in diagnosticsInfo.errorDetails
    ) {
      enhancedHeaders.set('X-Error-Subtype', String(diagnosticsInfo.errorDetails.type));
    }

    if (
      diagnosticsInfo.errorDetails &&
      typeof diagnosticsInfo.errorDetails === 'object' &&
      'parameter' in diagnosticsInfo.errorDetails
    ) {
      enhancedHeaders.set('X-Error-Parameter', String(diagnosticsInfo.errorDetails.parameter));
    }
  } else if (response.status === 413) {
    enhancedHeaders.set('X-Error-Type', 'file_size_limit');
    enhancedHeaders.set('X-Video-Too-Large', 'true');
  } else if (response.status === 415) {
    enhancedHeaders.set('X-Error-Type', 'unsupported_format');
  } else if (response.status === 429) {
    enhancedHeaders.set('X-Error-Type', 'rate_limit');
    enhancedHeaders.set('X-Rate-Limit-Exceeded', 'true');
  } else if (response.status >= 500) {
    enhancedHeaders.set('X-Error-Type', 'server_error');
    enhancedHeaders.set('X-Server-Error', 'true');
  }

  // Create a new response with enhanced headers and the original error text
  return new Response(errorResponseBody, {
    status: enhancedResponse.status,
    statusText: enhancedResponse.statusText,
    headers: enhancedHeaders,
  });
}

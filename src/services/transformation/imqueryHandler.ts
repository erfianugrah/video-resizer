/**
 * IMQuery/derivative handling logic for video transformation
 *
 * Extracted from TransformationService.ts to reduce file size.
 * Handles IMQuery dimension mapping, derivative size application,
 * and CDN-CGI URL rebuilding with derivative dimensions.
 */
import { VideoTransformOptions } from '../../domain/commands/TransformVideoCommand';
import { DiagnosticsInfo } from '../../utils/debugHeadersUtils';
import { PathPattern, buildCdnCgiMediaUrlAsync } from '../../utils/pathUtils';
import { TransformParams } from '../../domain/strategies/TransformationStrategy';
import { RequestContext, addBreadcrumb } from '../../utils/requestContext';
import { CacheConfig } from '../../utils/cacheUtils';
import { getDerivativeDimensions } from '../../utils/imqueryUtils';
import { addVersionToUrl } from '../../utils/urlVersionUtils';
import { EnvVariables } from '../../config/environmentConfig';
import { createCategoryLogger } from '../../utils/logger';

// Create a category-specific logger
const logger = createCategoryLogger('TransformationService');
const { debug: logDebug } = logger;

/**
 * Result from handleIMQueryDerivative.
 * If `handled` is true, the caller should short-circuit and return `result`.
 * If `handled` is false, normal flow continues.
 */
export interface IMQueryHandlerResult {
  handled: boolean;
  result?: {
    cdnCgiUrl: string;
    cacheConfig: CacheConfig;
    source: string;
    derivative: string;
    diagnosticsInfo: DiagnosticsInfo;
    originSourceUrl: string;
  };
}

/**
 * Handle IMQuery derivative logic — detect IMQuery parameters, apply derivative
 * dimensions, rebuild the CDN-CGI URL, and optionally short-circuit the transformation.
 *
 * @returns An object indicating whether the IMQuery handling produced a final result
 *          (short-circuit) or whether normal flow should continue.
 */
export async function handleIMQueryDerivative(
  url: URL,
  options: VideoTransformOptions,
  cdnParams: TransformParams,
  videoUrl: string,
  cacheConfig: CacheConfig,
  diagnosticsInfo: DiagnosticsInfo,
  env: EnvVariables | undefined,
  pathPattern: PathPattern | null,
  requestContext: RequestContext | null,
  source: string
): Promise<IMQueryHandlerResult> {
  // Check if this is an IMQuery request with a derivative
  const isIMQuery = url.searchParams.has('imwidth') || url.searchParams.has('imheight');
  const hasDerivative = !!options.derivative;

  if (!isIMQuery || !hasDerivative || !options.derivative) {
    return { handled: false };
  }

  logDebug('IMQuery with derivative found - checking cache config', {
    url: url.toString(),
    derivative: options.derivative,
    cacheability: cacheConfig.cacheability,
    hasIMQuery: isIMQuery,
    imwidth: url.searchParams.get('imwidth'),
    imheight: url.searchParams.get('imheight'),
  });

  // Ensure cacheability is set to true for IMQuery derivatives
  if (!cacheConfig.cacheability) {
    logDebug('Forcing cacheability for IMQuery derivative', {
      derivative: options.derivative,
      originalCacheability: cacheConfig.cacheability,
    });
    cacheConfig.cacheability = true;
  }

  // CRITICAL: When we have a derivative, use the derivative's dimensions in the transformation
  // rather than the original requested dimensions
  const derivativeDimensions = getDerivativeDimensions(options.derivative);

  if (!derivativeDimensions) {
    return { handled: false };
  }

  // Replace the width/height with the derivative's dimensions in the transformation parameters
  if (derivativeDimensions.width) {
    cdnParams.width = derivativeDimensions.width;
  }

  if (derivativeDimensions.height) {
    cdnParams.height = derivativeDimensions.height;
  }

  // Log detailed information about derivative application
  logDebug('Applied derivative dimensions to CDN params', {
    derivative: options.derivative,
    originalWidth: options.width,
    originalHeight: options.height,
    derivativeWidth: derivativeDimensions.width,
    derivativeHeight: derivativeDimensions.height,
    finalCdnWidth: cdnParams.width,
    finalCdnHeight: cdnParams.height,
    hasImQueryParams: isIMQuery,
    isUsingDerivative: hasDerivative,
  });

  // Add breadcrumb if request context is available
  if (requestContext) {
    addBreadcrumb(requestContext, 'Transform', 'Applied derivative dimensions', {
      derivative: options.derivative,
      derivativeWidth: derivativeDimensions.width,
      derivativeHeight: derivativeDimensions.height,
      finalCdnWidth: cdnParams.width,
      finalCdnHeight: cdnParams.height,
    });
  }

  // Rebuild the CDN-CGI media URL with the derivative's dimensions
  // Pass the environment variables and path pattern for presigning
  let updatedCdnCgiUrl = await buildCdnCgiMediaUrlAsync(
    cdnParams,
    videoUrl,
    url.toString(),
    env,
    pathPattern // For backward compatibility
  );

  // Apply versioning if available
  if (diagnosticsInfo.cacheVersion && diagnosticsInfo.cacheVersion > 1) {
    updatedCdnCgiUrl = addVersionToUrl(updatedCdnCgiUrl, diagnosticsInfo.cacheVersion);

    // Log version application to IMQuery URL
    logDebug('Applied version to IMQuery URL', {
      version: diagnosticsInfo.cacheVersion,
      url: updatedCdnCgiUrl,
    });
  }

  // We need to reassign cdnCgiUrl to a variable that's not a constant
  const finalCdnCgiUrl = updatedCdnCgiUrl;

  // Update diagnostics to include actual dimensions used
  if (diagnosticsInfo.transformParams) {
    diagnosticsInfo.transformParams.width = derivativeDimensions.width;
    diagnosticsInfo.transformParams.height = derivativeDimensions.height;
  }

  // Also add imquery mapping info to diagnostics
  diagnosticsInfo.imqueryParams = {
    requestedWidth: parseFloat(url.searchParams.get('imwidth') || '0') || options.width,
    requestedHeight: parseFloat(url.searchParams.get('imheight') || '0') || options.height,
    mappedToDerivative: options.derivative,
    actualWidth: derivativeDimensions.width,
    actualHeight: derivativeDimensions.height,
  };

  // Log this substitution for debugging
  logDebug('Using derivative dimensions instead of requested dimensions', {
    requestedWidth: options.width,
    requestedHeight: options.height,
    derivativeWidth: cdnParams.width,
    derivativeHeight: cdnParams.height,
    derivative: options.derivative,
    originalUrl: url.toString(),
    updatedUrl: finalCdnCgiUrl,
  });

  // Return the transformation result with the updated URL
  return {
    handled: true,
    result: {
      cdnCgiUrl: finalCdnCgiUrl,
      cacheConfig,
      source,
      derivative: options.derivative,
      diagnosticsInfo,
      originSourceUrl: videoUrl, // Include the original source URL
    },
  };
}

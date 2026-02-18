/**
 * Service that orchestrates the video transformation process
 * Acts as a facade for the transformation strategies
 *
 * Delegates to extracted modules in ./transformation/ for:
 * - URL construction (urlConstruction.ts)
 * - Cache versioning (cacheVersioning.ts)
 * - IMQuery/derivative handling (imqueryHandler.ts)
 * - Origin resolution (originResolution.ts)
 */
import { VideoTransformOptions } from '../domain/commands/TransformVideoCommand';
import { DebugInfo, DiagnosticsInfo } from '../utils/debugHeadersUtils';
import { PathPattern, extractVideoId } from '../utils/pathUtils';
import { addBreadcrumb, RequestContext, getCurrentContext } from '../utils/requestContext';
import { determineCacheConfig, CacheConfig } from '../utils/cacheUtils';
import { logErrorWithContext, withErrorHandling } from '../utils/errorHandlingUtils';
import { addVersionToUrl } from '../utils/urlVersionUtils';
import { EnvVariables } from '../config/environmentConfig';
import { cacheResponse } from './cacheManagementService';
import { VideoConfigurationManager } from '../config';

/**
 * Use centralized logger for all logging operations
 */
import { createCategoryLogger } from '../utils/logger';

// Create a category-specific logger for TransformationService
const logger = createCategoryLogger('TransformationService');
const { debug: logDebug, info: logInfo } = logger;
import { TransformationContext } from '../domain/strategies/TransformationStrategy';
import { createTransformationStrategy } from '../domain/strategies/StrategyFactory';

// Import extracted modules
import {
  constructVideoUrlFromOrigin,
  constructVideoUrl,
  QUALITY_PRESETS,
} from './transformation/urlConstruction';
import { applyCacheVersioning } from './transformation/cacheVersioning';
import { handleIMQueryDerivative } from './transformation/imqueryHandler';
import { resolveOriginOrPathPattern } from './transformation/originResolution';

/**
 * Orchestrate the video transformation process
 *
 * @param request The original request
 * @param options Video transformation options
 * @param path URL path
 * @param debugInfo Debug configuration
 * @param env Environment variables
 * @returns Transformation result with URL and cache configuration
 */
export const prepareVideoTransformation = withErrorHandling<
  [Request, VideoTransformOptions, PathPattern[], DebugInfo | undefined, EnvVariables | undefined],
  {
    cdnCgiUrl: string;
    cacheConfig: CacheConfig;
    source: string;
    derivative: string;
    diagnosticsInfo: DiagnosticsInfo;
    originSourceUrl: string; // Added to return the specific origin URL used for transformation
  }
>(
  async function prepareVideoTransformationImpl(
    request: Request,
    options: VideoTransformOptions,
    pathPatterns: PathPattern[],
    debugInfo?: DebugInfo,
    env?: EnvVariables
  ): Promise<{
    cdnCgiUrl: string;
    cacheConfig: CacheConfig;
    source: string;
    derivative: string;
    diagnosticsInfo: DiagnosticsInfo;
    originSourceUrl: string;
  }> {
    // Log transformation startup
    logDebug('Starting video transformation preparation', {
      url: request.url,
      options: { ...options },
      hasPathPatterns: Array.isArray(pathPatterns) && pathPatterns.length > 0,
      debugEnabled: !!debugInfo?.isEnabled,
    });

    // Initialize diagnostics with required arrays
    const diagnosticsInfo: DiagnosticsInfo = {
      errors: [],
      warnings: [],
    };

    // Extract path and URL information
    const url = new URL(request.url);
    const path = url.pathname;

    // Log URL information
    logDebug('Processing URL information', {
      url: url.toString(),
      path,
      search: url.search || '',
    });

    // Get request context for breadcrumbs
    const requestContext = getCurrentContext() ?? null;

    // Resolve origin or path pattern using extracted module
    const configManager = VideoConfigurationManager.getInstance();
    const { pathPattern, originMatch, sourceResolution, useOrigins } = resolveOriginOrPathPattern(
      path,
      url,
      pathPatterns,
      configManager,
      requestContext,
      diagnosticsInfo
    );

    // Create transformation context - supporting both approaches
    const context: TransformationContext = {
      request,
      options,
      pathPattern: pathPattern!, // Type assertion since we've checked pathPattern isn't null above when !useOrigins
      url,
      path,
      diagnosticsInfo,
      env,
      // Add Origins-specific context if using Origins
      origin: originMatch?.origin,
      sourceResolution: sourceResolution || undefined,
    };

    // Get the appropriate strategy for the transformation type
    const strategy = createTransformationStrategy(options);

    // Log strategy creation
    logDebug('Created transformation strategy', {
      strategyType: options.mode || 'video',
      derivative: options.derivative,
      format: options.format,
      width: options.width,
      height: options.height,
      quality: options.quality,
    });

    // Add breadcrumb for strategy creation
    if (requestContext) {
      addBreadcrumb(requestContext, 'Transform', 'Created transformation strategy', {
        strategyType: options.mode || 'video',
        derivative: options.derivative,
        format: options.format,
        width: options.width,
        height: options.height,
        quality: options.quality,
      });
    }

    // Validate options
    try {
      await strategy.validateOptions(options);

      // Log successful validation
      if (requestContext) {
        addBreadcrumb(requestContext, 'Transform', 'Options validated successfully', {
          strategyType: options.mode || 'video',
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Validation error';

      // Log validation failure with context
      logErrorWithContext('Transformation options validation failed', error, {
        strategyType: options.mode || 'video',
        errorType: 'ValidationError',
        severity: 'high',
      });

      // Add breadcrumb for tracking
      if (requestContext) {
        addBreadcrumb(requestContext, 'Error', 'Transformation options validation failed', {
          error: message,
          strategyType: options.mode || 'video',
          errorType: 'ValidationError',
          severity: 'high',
        });
      }

      if (!diagnosticsInfo.errors) {
        diagnosticsInfo.errors = [];
      }
      diagnosticsInfo.errors.push(message);
      throw error;
    }

    // Update diagnostics with strategy-specific information
    strategy.updateDiagnostics(context);
    logDebug('Strategy updated diagnostics');

    // Store version in diagnostics for proper tracking
    if (options.version) {
      diagnosticsInfo.cacheVersion = options.version;
    }

    // Map options to CDN-CGI parameters
    const cdnParams = strategy.prepareTransformParams(context);
    diagnosticsInfo.transformParams = cdnParams;

    // Log the transformation parameters (comprehensive for debugging)
    logDebug('Prepared transformation parameters', {
      hasParams: Object.keys(cdnParams).length > 0,
      params: cdnParams,
      paramCount: Object.keys(cdnParams).length,
      strategy: options.mode || 'video',
      derivative: options.derivative,
    });

    // Add breadcrumb for CDN parameters - include ALL parameters for complete debug information
    if (requestContext) {
      addBreadcrumb(requestContext, 'Transform', 'Prepared CDN-CGI parameters', {
        // All core parameters for detailed debugging
        params: cdnParams,
        paramCount: Object.keys(cdnParams).length,
        // Common parameters as individual fields for easier filtering
        width: cdnParams.width,
        height: cdnParams.height,
        format: cdnParams.format,
        quality: cdnParams.quality,
        mode: cdnParams.mode,
        fit: cdnParams.fit,
        // Performance metrics
        paramGenerationTimeMs: Math.round(performance.now() - requestContext.startTime),
        // Request info
        hasQuery: url.search.length > 0,
        derivative: options.derivative,
      });
    }

    // Construct the video URL - using different approaches based on context
    let videoUrl: string;
    if (useOrigins && originMatch && sourceResolution) {
      // Use Origins approach
      const constructedUrl = constructVideoUrlFromOrigin(
        path,
        url,
        originMatch,
        sourceResolution,
        options
      );

      if (constructedUrl === null) {
        throw new Error('Failed to construct video URL from Origin');
      }
      videoUrl = constructedUrl;

      // If Origin has transformationOverrides, apply them
      const origin = originMatch.origin;
      if (origin.transformOptions) {
        logDebug('Applying Origin transformation overrides', origin.transformOptions);

        // Apply quality from Origin if available
        if (origin.quality) {
          const preset = QUALITY_PRESETS[origin.quality] || QUALITY_PRESETS.medium;

          // Apply quality preset to the options
          options.width = preset.width;
          options.height = preset.height;

          logDebug('Applied Origin-based quality preset', {
            quality: origin.quality,
            width: preset.width,
            height: preset.height,
          });
        }
      }
    } else if (pathPattern?.originUrl) {
      // Use legacy path pattern approach
      const constructedUrl = constructVideoUrl(path, url, pathPattern, options);
      if (constructedUrl === null) {
        throw new Error('Failed to construct video URL');
      }
      videoUrl = constructedUrl;

      // Add breadcrumb for URL construction
      if (requestContext) {
        addBreadcrumb(requestContext, 'Transform', 'Constructed origin URL', {
          originalUrl: url.toString(),
          constructedUrl: videoUrl,
          patternName: pathPattern.name,
          hasCaptures: !!pathPattern.captureGroups,
        });
      }
    } else {
      videoUrl = url.toString();

      // Add breadcrumb for passthrough URL
      if (requestContext) {
        addBreadcrumb(requestContext, 'Transform', 'Using passthrough URL', {
          url: videoUrl,
          reason: 'No originUrl in pattern or Origin',
        });
      }
    }

    // Try to extract video ID using the appropriate method
    let extractedVideoId: string | null = null;
    if (useOrigins && originMatch) {
      // With Origins, use the videoId capture if available
      extractedVideoId = originMatch.captures['videoId'] || originMatch.captures['1'] || null;
    } else if (pathPattern) {
      // Legacy approach - use pathUtils
      extractedVideoId = extractVideoId(path, pathPattern);
    }

    diagnosticsInfo.videoId = extractedVideoId || undefined;

    // Import path utils module to get buildCdnCgiMediaUrlAsync
    const { buildCdnCgiMediaUrlAsync } = await import('../utils/pathUtils');

    // CRITICAL: Add version to the video URL for CDN cache busting BEFORE building CDN-CGI URL
    // This ensures that when cache version increments (v=1 to v=2), the CDN sees it as a different URL
    let versionedVideoUrl = videoUrl;
    if (options.version) {
      versionedVideoUrl = addVersionToUrl(videoUrl, options.version);

      logDebug('Added version to video URL for CDN cache busting', {
        originalUrl: videoUrl,
        versionedUrl: versionedVideoUrl,
        version: options.version,
        willBustCdnCache: options.version > 1,
      });

      // Add breadcrumb for version application
      if (requestContext) {
        addBreadcrumb(requestContext, 'Transform', 'Applied version to origin URL', {
          version: options.version,
          originalUrl: videoUrl,
          versionedUrl: versionedVideoUrl,
          purpose: 'CDN cache busting',
        });
      }
    }

    // Build the CDN-CGI media URL asynchronously
    // If using Origins, pass the Origin and source resolution information
    let cdnCgiUrl = await buildCdnCgiMediaUrlAsync(
      cdnParams,
      versionedVideoUrl, // Pass the versioned origin URL for proper cache busting
      url.toString(),
      env,
      pathPattern // For backward compatibility
    );

    // Get cache configuration for the video URL
    let cacheConfig = determineCacheConfig(videoUrl);

    // If using Origins, override cacheConfig with Origin TTL values
    if (useOrigins && originMatch) {
      const origin = originMatch.origin;
      if (origin.ttl) {
        // Override TTL values from Origin
        cacheConfig.ttl = {
          ...cacheConfig.ttl,
          ok: origin.ttl.ok,
          redirects: origin.ttl.redirects,
          clientError: origin.ttl.clientError,
          serverError: origin.ttl.serverError,
        };

        // Log override
        logDebug('Using Origin-specific TTL values', {
          originName: origin.name,
          ttl: cacheConfig.ttl,
        });

        // Add breadcrumb for Origin TTL
        if (requestContext) {
          addBreadcrumb(requestContext, 'Cache', 'Using Origin-specific TTL values', {
            originName: origin.name,
            ttl: cacheConfig.ttl.ok,
            sourceType: sourceResolution?.originType,
          });
        }
      }
    }

    // Check if we should attempt to get previous version for cache busting
    const skipCache = url.searchParams.has('debug') || !cacheConfig?.cacheability;

    // Only proceed with versioning if env is available and we're not skipping cache
    if (env && !skipCache) {
      cdnCgiUrl = await applyCacheVersioning(
        env,
        videoUrl,
        cdnCgiUrl,
        options,
        cacheConfig,
        diagnosticsInfo,
        requestContext,
        path
      );
    }

    // Add timing information for transformation operation
    const transformationTime = performance.now() - (requestContext?.startTime || 0);

    // Add detailed breadcrumb for URL transformation
    if (requestContext) {
      // Timer for URL construction performance
      const urlConstructionTime =
        performance.now() - (requestContext.startTime + transformationTime);

      addBreadcrumb(requestContext, 'Transform', 'Transformed URL', {
        // Original URL info
        original: url.toString(),
        // Include FULL URL for debugging - essential for troubleshooting
        transformed: cdnCgiUrl,
        transformedWithoutParams: cdnCgiUrl.split('?')[0],
        videoUrl: videoUrl,
        videoUrlSafe: videoUrl.split('?')[0],
        // Parameters info
        hasTransformParams: Object.keys(cdnParams).length > 0,
        paramCount: Object.keys(cdnParams).length,
        // Performance metrics
        transformationTimeMs: Math.round(transformationTime),
        urlConstructionTimeMs: Math.round(urlConstructionTime),
        totalTimeMs: Math.round(performance.now() - requestContext.startTime),
        // Other useful details
        originOrPatternName: useOrigins ? originMatch?.origin.name : pathPattern?.name,
        videoId: diagnosticsInfo.videoId,
        derivative: options.derivative,
        usingOrigins: useOrigins,
      });
    }

    // Format params for logging
    const cdnParamsFormatted = Object.entries(cdnParams)
      .map(([key, value]) => `${key}=${value}`)
      .join(',');

    // Setup source for cache tagging
    const source = useOrigins
      ? originMatch?.origin.name || 'unknown'
      : pathPattern?.name || 'unknown';

    // IMPORTANT: Special handling for IMQuery - ensure it's cacheable
    // Delegate to extracted IMQuery handler
    const imqueryResult = await handleIMQueryDerivative(
      url,
      options,
      cdnParams,
      videoUrl,
      cacheConfig,
      diagnosticsInfo,
      env,
      pathPattern,
      requestContext,
      source
    );

    if (imqueryResult.handled && imqueryResult.result) {
      return imqueryResult.result;
    }

    // Comprehensive logging for the complete transformation process
    logDebug('Transformed URL - COMPLETE DETAILS', {
      // Original request details
      original: url.toString(),
      path: path,
      // Complete transformation details - IMPORTANT FOR DEBUGGING
      transformed: cdnCgiUrl,
      transformedParams: cdnParamsFormatted,
      // Video parameters
      options: {
        ...options,
        source: options.source ? '[source url omitted]' : undefined,
      },
      // Pattern details
      useOrigins,
      originOrPatternName: useOrigins ? originMatch?.origin.name : pathPattern?.name,
      // Cache config
      cacheablility: !!cacheConfig?.cacheability,
      cacheTtl: cacheConfig?.ttl?.ok,
      // Performance and tracking
      transformationTimeMs: Math.round(transformationTime),
      timestamp: new Date().toISOString(),
    });

    // If using the legacy path pattern and it has a specific cache TTL, override the config
    if (!useOrigins && pathPattern) {
      // Check for both legacy cacheTtl property and modern ttl object structure
      const hasLegacyTtl = pathPattern.cacheTtl !== undefined;
      const hasModernTtl = pathPattern.ttl && typeof pathPattern.ttl === 'object';

      if ((hasLegacyTtl || hasModernTtl) && cacheConfig) {
        const updatedTtl = { ...cacheConfig.ttl };

        // Source of TTL value for logging
        let ttlSource = 'unknown';

        // Priority: Use ttl object if available, otherwise use cacheTtl
        if (hasModernTtl && pathPattern.ttl) {
          // Modern ttl object structure - merge with existing ttl
          if (pathPattern.ttl.ok !== undefined) {
            updatedTtl.ok = pathPattern.ttl.ok;
          }
          if (pathPattern.ttl.redirects !== undefined) {
            updatedTtl.redirects = pathPattern.ttl.redirects;
          }
          if (pathPattern.ttl.clientError !== undefined) {
            updatedTtl.clientError = pathPattern.ttl.clientError;
          }
          if (pathPattern.ttl.serverError !== undefined) {
            updatedTtl.serverError = pathPattern.ttl.serverError;
          }
          ttlSource = 'ttl object';
        } else if (hasLegacyTtl && pathPattern.cacheTtl !== undefined) {
          // Legacy cacheTtl property - only update ok status
          updatedTtl.ok = pathPattern.cacheTtl;
          ttlSource = 'legacy cacheTtl';
        }

        // Update cache config with new TTL values
        cacheConfig = {
          ...cacheConfig,
          ttl: updatedTtl,
        };

        // Add breadcrumb for path-specific cache TTL
        if (requestContext) {
          addBreadcrumb(requestContext, 'Cache', 'Using path-specific cache TTL', {
            pathName: pathPattern.name,
            ttlSource: ttlSource,
            ttl: updatedTtl.ok,
            originalTtl: cacheConfig.ttl?.ok || undefined,
            reason: 'Pattern override',
          });
        }

        logDebug('Using path-specific cache TTL', {
          pathName: pathPattern.name,
          ttlSource: ttlSource,
          ttl: updatedTtl.ok,
        });
      }
    }

    // Add cache info to diagnostics
    diagnosticsInfo.cacheability = cacheConfig?.cacheability;
    if (cacheConfig?.ttl.ok !== undefined) {
      diagnosticsInfo.cacheTtl = cacheConfig.ttl.ok;
    }

    // Assign the derivative value here
    const derivative = options.derivative || '';

    // Store the original source URL used for this transformation
    const originSourceUrl = videoUrl;

    // Return the transformation result
    return {
      cdnCgiUrl,
      cacheConfig,
      source,
      derivative,
      diagnosticsInfo,
      originSourceUrl,
    };
  },
  {
    functionName: 'prepareVideoTransformation',
    component: 'TransformationService',
    logErrors: true,
  }
);

/**
 * Interface for executing transformation parameters
 */
export interface ExecuteTransformParams {
  request: Request;
  options: VideoTransformOptions;
  pathPatterns: PathPattern[];
  env: EnvVariables;
  requestContext: RequestContext;
  diagnosticsInfo: DiagnosticsInfo;
  debugInfo?: DebugInfo;
}

/**
 * Result structure for executeTransformation
 */
export interface ExecuteTransformResult {
  response: Response;
  cacheConfig: CacheConfig | null;
  source?: string;
  derivative?: string;
  cdnCgiUrl: string; // URL used for the fetch
}

/**
 * Executes the core video transformation process
 *
 * This function prepares and executes the transformation, handling the actual
 * fetch from the CDN-CGI endpoint. It is responsible for:
 * 1. Preparing the transformation URL and parameters
 * 2. Making the fetch request
 * 3. Returning the response with all required metadata for further processing
 *
 * @param params Parameters for executing the transformation
 * @returns Transformation result including response and metadata
 */
export async function executeTransformation({
  request,
  options,
  pathPatterns,
  env,
  requestContext,
  diagnosticsInfo,
  debugInfo,
}: ExecuteTransformParams): Promise<ExecuteTransformResult> {
  addBreadcrumb(requestContext, 'Transform', 'Executing core transformation');

  // Prepare the transformation URL and get cache config
  const {
    cdnCgiUrl,
    cacheConfig,
    source,
    derivative,
    diagnosticsInfo: transformDiagnostics,
  } = await prepareVideoTransformation(request, options, pathPatterns, debugInfo, env);

  // Merge diagnostics information
  Object.assign(diagnosticsInfo, transformDiagnostics);

  addBreadcrumb(requestContext, 'Transform', 'Transformation prepared', {
    cdnUrl: cdnCgiUrl.split('?')[0],
    source,
    derivative,
  });

  // Fetch from CDN-CGI using cacheResponse for range support
  const fetchOptions = { method: request.method, headers: request.headers };

  addBreadcrumb(requestContext, 'Transform', 'Fetching from CDN-CGI', {
    url: cdnCgiUrl,
    options: JSON.stringify(fetchOptions),
    hasIMQuery: options.derivative ? true : false,
    derivative: options.derivative || 'none',
    width: options.width,
    height: options.height,
  });

  // Use the proper logger at INFO level for visibility
  logInfo(`Fetching media from CDN-CGI URL: ${cdnCgiUrl}`, {
    url: cdnCgiUrl,
    derivative: options.derivative || 'none',
    width: options.width,
    height: options.height,
    imquery: options.source === 'imquery',
    category: 'CDN-CGI', // Explicitly set category for consistent filtering
    originSourceUrl: options.source || 'none',
  });

  // Use the original request as the key for cacheResponse
  const response = await cacheResponse(request, async () => fetch(cdnCgiUrl, fetchOptions));

  addBreadcrumb(requestContext, 'Response', 'CDN-CGI response received', {
    status: response.status,
    contentType: response.headers.get('Content-Type'),
    contentLength: response.headers.get('Content-Length'),
    isRangeRequest: response.status === 206 || response.headers.has('Content-Range'),
    cfRay: response.headers.get('CF-Ray'),
    cacheStatus: response.headers.get('CF-Cache-Status'),
  });

  // Return the response along with data needed for post-processing
  return {
    response,
    cacheConfig,
    source,
    derivative,
    cdnCgiUrl,
  };
}

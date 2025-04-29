/**
 * Service that orchestrates the video transformation process
 * Acts as a facade for the transformation strategies
 */
import { VideoTransformOptions } from '../domain/commands/TransformVideoCommand';
import { DebugInfo, DiagnosticsInfo } from '../utils/debugHeadersUtils';
import { PathPattern, findMatchingPathPattern, matchPathWithCaptures, buildCdnCgiMediaUrl, extractVideoId } from '../utils/pathUtils';
import { getCurrentContext } from '../utils/legacyLoggerAdapter';
import { createLogger, debug as pinoDebug } from '../utils/pinoLogger';
import { addBreadcrumb, RequestContext } from '../utils/requestContext';
import { determineCacheConfig, CacheConfig } from '../utils/cacheUtils';
import { logErrorWithContext, withErrorHandling, tryOrNull } from '../utils/errorHandlingUtils';
import { getDerivativeDimensions } from '../utils/imqueryUtils';
import { getCacheKeyVersion, getNextCacheKeyVersion, storeCacheKeyVersion } from './cacheVersionService';
import { addVersionToUrl, normalizeUrlForCaching } from '../utils/urlVersionUtils';
import { generateKVKey } from './kvStorageService';
import { EnvVariables } from '../config/environmentConfig';
import { cacheResponse } from './cacheManagementService';

/**
 * Helper functions for consistent logging throughout this file
 * These helpers handle context availability and fallback gracefully
 */

/**
 * Log a debug message with proper context handling
 */
function logDebug(message: string, data?: Record<string, unknown>): void {
  const requestContext = getCurrentContext();
  if (requestContext) {
    const logger = createLogger(requestContext);
    pinoDebug(requestContext, logger, 'TransformationService', message, data);
  } else {
    // Fall back to console as a last resort
    console.debug(`TransformationService: ${message}`, data || {});
  }
}
import { TransformationContext } from '../domain/strategies/TransformationStrategy';
import { createTransformationStrategy } from '../domain/strategies/StrategyFactory';
import { videoConfig } from '../config/videoConfig';
import { VideoConfigurationManager } from '../config';

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
    originSourceUrl: string;  // Added to return the specific origin URL used for transformation
  }
>(async function prepareVideoTransformationImpl(
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
    debugEnabled: !!debugInfo?.isEnabled
  });
    
    // Initialize diagnostics
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
      search: url.search || ''
    });

    // Find matching path pattern for the URL
    const pathPattern = findMatchingPathPattern(path, pathPatterns);
    
    // Add breadcrumb for path pattern matching
    const requestContext = getCurrentContext();
    if (requestContext) {
      addBreadcrumb(requestContext, 'Transform', 'Path pattern matching', {
        path,
        url: url.toString(),
        matchFound: !!pathPattern,
        patternName: pathPattern ? pathPattern.name : undefined,
        patternCount: pathPatterns.length
      });
    }
    
    if (!pathPattern) {
      throw new Error('No matching path pattern found');
    }

    // Create transformation context
    const context: TransformationContext = {
      request,
      options,
      pathPattern,
      url,
      path,
      diagnosticsInfo,
      env
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
      quality: options.quality
    });
    
    // Add breadcrumb for strategy creation
    if (requestContext) {
      addBreadcrumb(requestContext, 'Transform', 'Created transformation strategy', {
        strategyType: options.mode || 'video',
        derivative: options.derivative,
        format: options.format,
        width: options.width,
        height: options.height,
        quality: options.quality
      });
    }

    // Validate options
    try {
      await strategy.validateOptions(options);
      
      // Log successful validation
      if (requestContext) {
        addBreadcrumb(requestContext, 'Transform', 'Options validated successfully', {
          strategyType: options.mode || 'video'
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Validation error';
      
      // Log validation failure with context
      logErrorWithContext('Transformation options validation failed', error, {
        strategyType: options.mode || 'video',
        errorType: 'ValidationError',
        severity: 'high'
      });
      
      // Add breadcrumb for tracking
      if (requestContext) {
        addBreadcrumb(requestContext, 'Error', 'Transformation options validation failed', {
          error: message,
          strategyType: options.mode || 'video',
          errorType: 'ValidationError',
          severity: 'high'
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

    // Map options to CDN-CGI parameters
    const cdnParams = strategy.prepareTransformParams(context);
    diagnosticsInfo.transformParams = cdnParams;
    
    // Log the transformation parameters (comprehensive for debugging)
    logDebug('Prepared transformation parameters', {
      hasParams: Object.keys(cdnParams).length > 0,
      params: cdnParams,
      paramCount: Object.keys(cdnParams).length,
      strategy: options.mode || 'video',
      derivative: options.derivative
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
        derivative: options.derivative
      });
    }

    // Construct the video URL
    let videoUrl: string;
    if (pathPattern.originUrl) {
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
          hasCaptures: !!pathPattern.captureGroups
        });
      }
    } else {
      videoUrl = url.toString();
      
      // Add breadcrumb for passthrough URL
      if (requestContext) {
        addBreadcrumb(requestContext, 'Transform', 'Using passthrough URL', {
          url: videoUrl,
          reason: 'No originUrl in path pattern'
        });
      }
    }

    // Try to extract video ID
    const extractedVideoId = extractVideoId(path, pathPattern);
    diagnosticsInfo.videoId = extractedVideoId || undefined;

    // Build the CDN-CGI media URL
    // Pass parameters: transformation options, origin URL, and request URL
    // This ensures we use the request host while accessing content from origin URL
    let cdnCgiUrl = buildCdnCgiMediaUrl(cdnParams, videoUrl, url.toString());
    
    // Get cache configuration for the video URL
    let cacheConfig = determineCacheConfig(videoUrl);
    
    // Check if we should attempt to get previous version for cache busting
    const skipCache = url.searchParams.has('debug') || !cacheConfig?.cacheability;
    
    // Only proceed with versioning if env is available and we're not skipping cache
    if (env && !skipCache) {
      try {
        // Generate a consistent cache key for this transformation
        const cacheKey = generateKVKey(normalizeUrlForCaching(videoUrl), options);
        
        // Check if the content exists in the cache
        let shouldIncrement = false;
        
        if (env.VIDEO_TRANSFORMATIONS_CACHE) {
          try {
            // Check if the entry exists by trying to get it
            // We'll use list with a prefix to be more efficient and avoid fetching the actual data
            const keys = await env.VIDEO_TRANSFORMATIONS_CACHE.list({ prefix: cacheKey, limit: 1 });
            const exists = keys.keys.length > 0;
            
            // If the entry doesn't exist, we should increment the version
            shouldIncrement = !exists;
            
            logDebug('Checking if cache entry exists for version increment', {
              cacheKey,
              exists,
              shouldIncrement,
              checkMethod: 'head request'
            });
          } catch (err) {
            // If error occurs during check, assume cache miss to be safe
            shouldIncrement = true;
            logDebug('Error checking cache existence, assuming cache miss', {
              cacheKey,
              error: err instanceof Error ? err.message : String(err),
              shouldIncrement: true
            });
          }
        }
        
        // Get next version number - if shouldIncrement is true, we'll force an increment
        const nextVersion = await getNextCacheKeyVersion(env, cacheKey, shouldIncrement);
        
        // Calculate TTL - double the video cache TTL for longer persistence
        const versionTtl = (cacheConfig?.ttl?.ok || 300) * 2;

        // ALWAYS store the updated version in KV when it changes
        if (shouldIncrement) {
          logDebug('Storing incremented version in KV', {
            cacheKey,
            previousVersion: nextVersion - 1,
            nextVersion,
            ttl: versionTtl
          });
          
          // Store updated version in background if possible
          if (env && 'executionCtx' in env && (env as any).executionCtx?.waitUntil) {
            (env as any).executionCtx.waitUntil(
              storeCacheKeyVersion(env, cacheKey, nextVersion, versionTtl)
            );
          } else {
            // Fall back to direct storage
            await storeCacheKeyVersion(env, cacheKey, nextVersion, versionTtl);
          }
        }
        
        // Only add version param for version > 1 to avoid unnecessary params
        if (nextVersion > 1) {
          // Create a modified URL with version parameter
          const versionedCdnCgiUrl = addVersionToUrl(cdnCgiUrl, nextVersion);
          
          // Log the version addition
          logDebug('Added version parameter for cache busting', {
            originalUrl: cdnCgiUrl,
            versionedUrl: versionedCdnCgiUrl,
            cacheKey,
            nextVersion,
            shouldIncrement
          });
          
          // Add a breadcrumb for tracking
          if (requestContext) {
            addBreadcrumb(requestContext, 'Cache', 'Added version for cache busting', {
              cacheKey, 
              nextVersion,
              path,
              originalUrl: url.toString()
            });
          }
          
          // Add version info to diagnostics
          diagnosticsInfo.cacheVersion = nextVersion;
          
          // Store version in options for use in kvStorageService
          options.version = nextVersion;
          
          // Update the URL with version
          cdnCgiUrl = versionedCdnCgiUrl;
        } else {
          // First version - add to diagnostics but don't modify URL
          // Store version in options
          options.version = nextVersion;
          
          // Add version info to diagnostics
          diagnosticsInfo.cacheVersion = nextVersion;
          
          logDebug('Using first version (no URL parameter needed)', {
            cacheKey,
            version: nextVersion,
            url: cdnCgiUrl
          });
        }
      } catch (err) {
        // Log error but continue with unversioned URL
        logDebug('Error adding version parameter', {
          error: err instanceof Error ? err.message : String(err),
          path
        });
      }
    }

    // Add timing information for transformation operation
    const transformationTime = performance.now() - (requestContext?.startTime || 0);
    
    // Add detailed breadcrumb for URL transformation
    if (requestContext) {
      // Timer for URL construction performance
      const urlConstructionTime = performance.now() - (requestContext.startTime + transformationTime);
      
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
        patternName: pathPattern.name,
        videoId: diagnosticsInfo.videoId,
        derivative: options.derivative,
        hasOriginUrl: !!pathPattern.originUrl
      });
    }
    
    // Format params for logging
    const cdnParamsFormatted = Object.entries(cdnParams)
      .map(([key, value]) => `${key}=${value}`)
      .join(',');
    
    // Setup source for cache tagging
    const source = pathPattern.name;
    
    // IMPORTANT: Special handling for IMQuery - ensure it's cacheable
    // If this is an IMQuery request with derivative, log and ensure cacheability
    const isIMQuery = url.searchParams.has('imwidth') || url.searchParams.has('imheight');
    const hasDerivative = !!options.derivative;
    
    if (isIMQuery && hasDerivative && options.derivative) {
      logDebug('IMQuery with derivative found - checking cache config', {
        url: url.toString(),
        derivative: options.derivative,
        cacheability: cacheConfig.cacheability,
        hasIMQuery: isIMQuery,
        imwidth: url.searchParams.get('imwidth'),
        imheight: url.searchParams.get('imheight')
      });
      
      // Ensure cacheability is set to true for IMQuery derivatives
      if (!cacheConfig.cacheability) {
        logDebug('Forcing cacheability for IMQuery derivative', {
          derivative: options.derivative,
          originalCacheability: cacheConfig.cacheability
        });
        cacheConfig.cacheability = true;
      }
      
      // CRITICAL: When we have a derivative, use the derivative's dimensions in the transformation
      // rather than the original requested dimensions
      const derivativeDimensions = getDerivativeDimensions(options.derivative);
      
      if (derivativeDimensions) {
        // Replace the width/height with the derivative's dimensions in the transformation parameters
        if (derivativeDimensions.width) {
          cdnParams.width = derivativeDimensions.width;
        }
        
        if (derivativeDimensions.height) {
          cdnParams.height = derivativeDimensions.height;
        }
        
        // Rebuild the CDN-CGI media URL with the derivative's dimensions
        let updatedCdnCgiUrl = buildCdnCgiMediaUrl(cdnParams, videoUrl, url.toString());
        
        // Apply versioning if available
        if (diagnosticsInfo.cacheVersion && diagnosticsInfo.cacheVersion > 1) {
          updatedCdnCgiUrl = addVersionToUrl(updatedCdnCgiUrl, diagnosticsInfo.cacheVersion);
          
          // Log version application to IMQuery URL
          logDebug('Applied version to IMQuery URL', {
            version: diagnosticsInfo.cacheVersion,
            url: updatedCdnCgiUrl
          });
        }
        
        // We need to reassign cdnCgiUrl to a variable that's not a constant
        let finalCdnCgiUrl = updatedCdnCgiUrl;
        
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
          actualHeight: derivativeDimensions.height
        };
        
        // Log this substitution for debugging
        logDebug('Using derivative dimensions instead of requested dimensions', {
          requestedWidth: options.width,
          requestedHeight: options.height,
          derivativeWidth: cdnParams.width,
          derivativeHeight: cdnParams.height,
          derivative: options.derivative,
          originalUrl: url.toString(),
          updatedUrl: finalCdnCgiUrl
        });
        
        // Return the transformation result with the updated URL
        return {
          cdnCgiUrl: finalCdnCgiUrl,
          cacheConfig,
          source,
          derivative: options.derivative,
          diagnosticsInfo,
          originSourceUrl: videoUrl  // Include the original source URL
        };
      }
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
        source: options.source ? '[source url omitted]' : undefined
      },
      // Pattern details
      pattern: pathPattern.name,
      patternMatcher: pathPattern.matcher,
      // Cache config
      cacheablility: !!cacheConfig?.cacheability,
      cacheTtl: cacheConfig?.ttl?.ok,
      // Performance and tracking
      transformationTimeMs: Math.round(transformationTime),
      timestamp: new Date().toISOString()
    });
    
    // If the path pattern has a specific cache TTL, override the config
    // Check for both legacy cacheTtl property and modern ttl object structure
    const hasLegacyTtl = pathPattern.cacheTtl !== undefined;
    const hasModernTtl = pathPattern.ttl && typeof pathPattern.ttl === 'object';
    
    if ((hasLegacyTtl || hasModernTtl) && cacheConfig) {
      let updatedTtl = { ...cacheConfig.ttl };
      
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
        ttl: updatedTtl
      };
      
      // Add breadcrumb for path-specific cache TTL
      if (requestContext) {
        addBreadcrumb(requestContext, 'Cache', 'Using path-specific cache TTL', {
          pathName: pathPattern.name,
          ttlSource: ttlSource,
          ttl: updatedTtl.ok,
          originalTtl: cacheConfig.ttl?.ok || undefined,
          reason: 'Pattern override'
        });
      }
      
      logDebug('Using path-specific cache TTL', {
        pathName: pathPattern.name,
        ttlSource: ttlSource,
        ttl: updatedTtl.ok
      });
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
      originSourceUrl
    };
},
{
  functionName: 'prepareVideoTransformation',
  component: 'TransformationService',
  logErrors: true
});

/**
 * Construct the video URL using the path pattern
 */
const constructVideoUrl = tryOrNull<
  [string, URL, PathPattern, VideoTransformOptions],
  string
>(function constructVideoUrlImpl(
    path: string, 
    url: URL, 
    pattern: PathPattern,
    options: VideoTransformOptions
  ): string {
  // Log start of URL construction
  logDebug('Constructing video URL', {
    path,
    url: url.toString(),
    patternName: pattern.name,
    hasOriginUrl: !!pattern.originUrl,
    hasCaptureGroups: !!pattern.captureGroups
  });
  // Create a new URL using the originUrl from the pattern
  if (!pattern.originUrl) {
    throw new Error('Origin URL is required for path transformation');
  }
  
  // Use enhanced path matching with captures
  const pathMatch = matchPathWithCaptures(path, [pattern]);
  if (!pathMatch) {
    throw new Error('Failed to match path with pattern');
  }
  
  // Create a new URL with the pattern's origin
  const videoUrl = new URL(pattern.originUrl);
  
  // Use advanced path matching logic
  if (pattern.captureGroups && pathMatch.captures) {
    // Check if we have a videoId capture
    if (pathMatch.captures['videoId']) {
      // Use videoId in the origin URL's format
      videoUrl.pathname = `/videos/${pathMatch.captures['videoId']}`;
    }
    // Check if we have a category capture
    else if (pathMatch.captures['category'] && pathMatch.captures['filename']) {
      videoUrl.pathname = `/${pathMatch.captures['category']}/${pathMatch.captures['filename']}`;
    }
    // We have captures but no special handling, use first capture
    else if (pathMatch.captures['1']) {
      videoUrl.pathname = pathMatch.captures['1'];
    }
  }
  // Legacy behavior - use regex match directly
  else {
    const regex = new RegExp(pattern.matcher);
    const match = path.match(regex);

    if (match && match[0]) {
      const matchedPath = match[0];

      // If there's a captured group, use it as the path
      if (match.length > 1) {
        // Use the first capture group if available
        videoUrl.pathname = match[1];
      } else {
        // Otherwise use the full matched path
        videoUrl.pathname = matchedPath;
      }
    } else {
      // Fallback to the original path
      videoUrl.pathname = path;
    }
  }

  // If pattern has transformation overrides, apply them to options
  if (pattern.transformationOverrides) {
    logDebug('Applying path-specific overrides', pattern.transformationOverrides);
    
    // Path-based quality presets get highest priority
    if (pattern.quality) {
      // Extract dimensions based on named quality preset
      const qualityPresets: Record<string, { width: number, height: number }> = {
        'low': { width: 640, height: 360 },
        'medium': { width: 854, height: 480 },
        'high': { width: 1280, height: 720 },
        'hd': { width: 1920, height: 1080 },
        '4k': { width: 3840, height: 2160 },
      };
      
      const preset = qualityPresets[pattern.quality] || qualityPresets.medium;
      
      // Apply quality preset to the options
      options.width = preset.width;
      options.height = preset.height;
      
      logDebug('Applied path-based quality preset', {
        quality: pattern.quality,
        width: preset.width,
        height: preset.height
      });
    }
  }

  // Copy query parameters from the original URL
  url.searchParams.forEach((value, key) => {
    // Skip video parameter names
    const videoParamNames = Object.keys(videoConfig.paramMapping);
    if (!videoParamNames.includes(key) && key !== 'derivative') {
      videoUrl.searchParams.set(key, value);
    }
  });

  // Get final URL string
  const finalUrl = videoUrl.toString();
  
  // Log the constructed URL
  logDebug('Video URL constructed', {
    originalPath: path,
    constructedUrl: finalUrl,
    transformedParams: options !== undefined
  });
  
  return finalUrl;
  },
  {
    functionName: 'constructVideoUrl',
    component: 'TransformationService'
  },
  null // default return value when error occurs
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
  debugInfo
}: ExecuteTransformParams): Promise<ExecuteTransformResult> {
  addBreadcrumb(requestContext, 'Transform', 'Executing core transformation');

  // Prepare the transformation URL and get cache config
  const {
    cdnCgiUrl,
    cacheConfig,
    source,
    derivative,
    diagnosticsInfo: transformDiagnostics
  } = await prepareVideoTransformation(
    request, options, pathPatterns, debugInfo, env
  );

  // Merge diagnostics information
  Object.assign(diagnosticsInfo, transformDiagnostics);
  
  addBreadcrumb(requestContext, 'Transform', 'Transformation prepared', { 
    cdnUrl: cdnCgiUrl.split('?')[0], 
    source, 
    derivative 
  });

  // Fetch from CDN-CGI using cacheResponse for range support
  const fetchOptions = { method: request.method, headers: request.headers };
  
  addBreadcrumb(requestContext, 'Transform', 'Fetching from CDN-CGI', { 
    url: cdnCgiUrl.split('?')[0] 
  });

  // Use the original request as the key for cacheResponse
  const response = await cacheResponse(request, async () => fetch(cdnCgiUrl, fetchOptions));

  addBreadcrumb(requestContext, 'Response', 'CDN-CGI response received', { 
    status: response.status,
    contentType: response.headers.get('Content-Type'),
    contentLength: response.headers.get('Content-Length'),
    isRangeRequest: response.status === 206 || response.headers.has('Content-Range'),
    cfRay: response.headers.get('CF-Ray'),
    cacheStatus: response.headers.get('CF-Cache-Status')
  });

  // Return the response along with data needed for post-processing
  return { 
    response, 
    cacheConfig, 
    source, 
    derivative, 
    cdnCgiUrl 
  };
}
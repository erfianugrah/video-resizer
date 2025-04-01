/**
 * Service that orchestrates the video transformation process
 * Acts as a facade for the transformation strategies
 */
import { VideoTransformOptions } from '../domain/commands/TransformVideoCommand';
import { DebugInfo, DiagnosticsInfo } from '../utils/debugHeadersUtils';
import { PathPattern, findMatchingPathPattern, matchPathWithCaptures, buildCdnCgiMediaUrl, extractVideoId } from '../utils/pathUtils';
import { getCurrentContext } from '../utils/legacyLoggerAdapter';
import { createLogger, debug as pinoDebug, error as pinoError } from '../utils/pinoLogger';
import { addBreadcrumb } from '../utils/requestContext';
import { determineCacheConfig, CacheConfig } from '../utils/cacheUtils';

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

/**
 * Log an error message with proper context handling
 */
function logError(message: string, data?: Record<string, unknown>): void {
  const requestContext = getCurrentContext();
  if (requestContext) {
    const logger = createLogger(requestContext);
    pinoError(requestContext, logger, 'TransformationService', message, data);
  } else {
    // Fall back to console as a last resort
    console.error(`TransformationService: ${message}`, data || {});
  }
}
import { TransformationContext } from '../domain/strategies/TransformationStrategy';
import { createTransformationStrategy } from '../domain/strategies/StrategyFactory';
import { videoConfig } from '../config/videoConfig';

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
export async function prepareVideoTransformation(
  request: Request,
  options: VideoTransformOptions,
  pathPatterns: PathPattern[],
  debugInfo?: DebugInfo,
  env?: { 
    ASSETS?: { 
      fetch: (request: Request) => Promise<Response> 
    } 
  }
): Promise<{
  cdnCgiUrl: string;
  cacheConfig: CacheConfig;
  source: string;
  derivative: string;
  diagnosticsInfo: DiagnosticsInfo;
}> {
  try {
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
      
      // Log validation failure
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
      videoUrl = constructVideoUrl(path, url, pathPattern, options);
      
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
    const cdnCgiUrl = buildCdnCgiMediaUrl(cdnParams, videoUrl);

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
      
    // Get cache configuration for the video URL
    let cacheConfig = determineCacheConfig(videoUrl);
      
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
    if (pathPattern.cacheTtl && cacheConfig) {
      // Create a new cache config with the pattern's TTL for successful responses
      cacheConfig = {
        ...cacheConfig,
        ttl: {
          ...cacheConfig.ttl,
          ok: pathPattern.cacheTtl
        }
      };
      
      // Add breadcrumb for path-specific cache TTL
      if (requestContext) {
        addBreadcrumb(requestContext, 'Cache', 'Using path-specific cache TTL', {
          pathName: pathPattern.name,
          ttl: pathPattern.cacheTtl,
          originalTtl: cacheConfig.ttl?.ok || undefined,
          reason: 'Pattern override'
        });
      }
      
      logDebug('Using path-specific cache TTL', {
        pathName: pathPattern.name,
        ttl: pathPattern.cacheTtl
      });
    }
    
    // Add cache info to diagnostics
    diagnosticsInfo.cacheability = cacheConfig?.cacheability;
    diagnosticsInfo.cacheTtl = cacheConfig?.ttl.ok;
    
    // Setup source and derivative for cache tagging
    const source = pathPattern.name;
    const derivative = options.derivative || '';

    // Return the transformation result
    return {
      cdnCgiUrl,
      cacheConfig,
      source,
      derivative,
      diagnosticsInfo
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    logError('Error preparing video transformation', {
      error: errorMessage,
      stack: err instanceof Error ? err.stack : undefined
    });
    throw err;
  }
}

/**
 * Construct the video URL using the path pattern
 */
function constructVideoUrl(
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
}
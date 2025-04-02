/**
 * Service for transforming videos using CDN-CGI paths
 * Abstracts the command pattern implementation behind a service interface
 */
import { VideoTransformOptions } from '../domain/commands/TransformVideoCommand';
import { PathPattern } from '../utils/pathUtils';
import { DebugInfo } from '../utils/debugHeadersUtils';
import { getCurrentContext } from '../utils/legacyLoggerAdapter';
import { createLogger, debug as pinoDebug, error as pinoError, warn as pinoWarn } from '../utils/pinoLogger';
import { logErrorWithContext, withErrorHandling } from '../utils/errorHandlingUtils';

/**
 * Helper functions for consistent logging throughout this file
 * These helpers handle context availability and fallback gracefully
 * 
 * These use dynamic imports to prevent circular dependency issues
 * and properly access the most up-to-date request context.
 */

/**
 * Log a debug message with proper context handling
 */
async function logDebug(message: string, data?: Record<string, unknown>): Promise<void> {
  try {
    // Use requestContext.ts getCurrentContext which is more reliable
    const { getCurrentContext } = await import('../utils/requestContext');
    const requestContext = getCurrentContext();
    
    if (requestContext) {
      const logger = createLogger(requestContext);
      pinoDebug(requestContext, logger, 'VideoTransformationService', message, data);
      return;
    }
  } catch (err) {
    // Silent fail and continue to fallbacks
  }

  // Fall back to legacy adapter
  try {
    const { debug } = await import('../utils/legacyLoggerAdapter');
    debug('VideoTransformationService', message, data || {});
  } catch {
    // Fall back to console as a last resort
    console.debug(`VideoTransformationService: ${message}`, data || {});
  }
}

/**
 * Log a warning message with proper context handling
 */
async function logWarn(message: string, data?: Record<string, unknown>): Promise<void> {
  try {
    // Use requestContext.ts getCurrentContext which is more reliable
    const { getCurrentContext } = await import('../utils/requestContext');
    const requestContext = getCurrentContext();
    
    if (requestContext) {
      const logger = createLogger(requestContext);
      pinoWarn(requestContext, logger, 'VideoTransformationService', message, data);
      return;
    }
  } catch (err) {
    // Silent fail and continue to fallbacks
  }

  // Fall back to legacy adapter
  try {
    const { warn } = await import('../utils/legacyLoggerAdapter');
    warn('VideoTransformationService', message, data || {});
  } catch {
    // Fall back to console as a last resort
    console.warn(`VideoTransformationService: ${message}`, data || {});
  }
}

// This function is replaced by logErrorWithContext from errorHandlingUtils

/**
 * Transform a video using CDN-CGI media format
 * 
 * @param request - The original request
 * @param options - Video transformation options
 * @param pathPatterns - Path patterns for matching URLs
 * @param debugInfo - Debug information settings
 * @returns A response containing the transformed video
 */
export const transformVideo = withErrorHandling<
  [Request, VideoTransformOptions, PathPattern[], DebugInfo | undefined, { ASSETS?: { fetch: (request: Request) => Promise<Response> } } | undefined],
  Response
>(
  async function transformVideoImpl(
    request: Request,
    options: VideoTransformOptions,
    pathPatterns: PathPattern[],
    debugInfo?: DebugInfo,
    env?: { 
      ASSETS?: { 
        fetch: (request: Request) => Promise<Response> 
      } 
    }
  ): Promise<Response> {
  try {
    // Use dynamic import to get the context modules
    const { getCurrentContext } = await import('../utils/requestContext');
    
    // Get the current request context - should be available from the handler
    const requestContext = getCurrentContext();
    let logger;
    
    // Create a detailed options object for logging that doesn't include sensitive information
    const logOptions = {
      width: options.width,
      height: options.height,
      format: options.format,
      quality: options.quality,
      derivative: options.derivative,
      hasLoop: options.loop !== undefined,
      hasAutoplay: options.autoplay !== undefined,
      hasMuted: options.muted !== undefined,
      hasAudio: options.audio !== undefined
    };
    
    // Start a timer to measure performance
    const startTime = performance.now();
    
    // Log the transformation request
    await logDebug('Transforming video', {
      url: request.url,
      options: logOptions,
      timestamp: new Date().toISOString(),
      hasRequestContext: !!requestContext
    });
    
    // Create logger if we have a context
    if (requestContext) {
      logger = createLogger(requestContext);
      const { addBreadcrumb } = await import('../utils/requestContext');
      
      // Add breadcrumb for the transformation
      addBreadcrumb(requestContext, 'VideoTransformationService', 'Starting video transformation', {
        options: logOptions,
        pathPatternCount: pathPatterns.length,
        debugEnabled: debugInfo?.isEnabled
      });
    }

    // Import dynamically to avoid circular dependencies
    const { TransformVideoCommand } = await import('../domain/commands/TransformVideoCommand');
    
    // Create and execute the command - pass the request context
    const command = new TransformVideoCommand({
      request,
      options,
      pathPatterns,
      debugInfo,
      env,
      requestContext,
      logger
    });

    // Execute the command
    const result = await command.execute();
    
    // Calculate and log performance metrics
    const duration = Math.round(performance.now() - startTime);
    
    // Log the successful transformation
    await logDebug('Video transformation successful', {
      url: request.url,
      status: result.status,
      contentType: result.headers.get('Content-Type'),
      contentLength: result.headers.get('Content-Length'),
      durationMs: duration,
      cacheStatus: result.headers.get('CF-Cache-Status') || 'unknown'
    });
    
    // Add a performance breadcrumb if we have a context
    if (requestContext) {
      const { addBreadcrumb } = await import('../utils/requestContext');
      addBreadcrumb(requestContext, 'Performance', 'Video transformation completed', {
        operation: 'transformVideo',
        durationMs: duration,
        status: result.status
      });
    }

    return result;
  } catch (err: unknown) {
    // Use standardized error handling
    logErrorWithContext('Error transforming video', err, {
      url: request.url,
      options: {
        width: options.width,
        height: options.height,
        format: options.format
      }
    }, 'VideoTransformationService');
    
    // Add an error breadcrumb if we have a context
    try {
      const { getCurrentContext, addBreadcrumb } = await import('../utils/requestContext');
      const requestContext = getCurrentContext();
      
      if (requestContext) {
        addBreadcrumb(requestContext, 'Error', 'Video transformation failed', {
          error: err instanceof Error ? err.message : 'Unknown error',
          errorType: err instanceof Error ? err.constructor.name : 'Unknown',
          url: request.url
        });
      }
    } catch (breadcrumbErr) {
      // Silently fail if we can't add the breadcrumb
    }

    throw err; // Rethrow to be handled by the caller
  }
},
{
  functionName: 'transformVideo',
  component: 'VideoTransformationService',
  logErrors: true
});

/**
 * Get the format to use for the transformed video
 * 
 * @param request - The original request
 * @returns The best format based on Accept header
 */
export function getBestVideoFormat(request: Request): string {
  // Get Accept header
  const accept = request.headers.get('Accept') || '';
  
  // Log the format determination
  logDebug('Determining best video format', {
    accept,
    url: request.url,
    hasAcceptHeader: !!request.headers.get('Accept')
  }).catch(() => {});
  
  // Check for specific video formats in Accept header
  if (accept.includes('video/webm')) {
    return 'webm';
  } else if (accept.includes('video/mp4')) {
    return 'mp4';
  }
  
  // Default to mp4 as it's most widely supported
  return 'mp4';
}

/**
 * Estimate the optimal bitrate for video streaming
 * 
 * @param width - Video width
 * @param height - Video height
 * @param networkQuality - Network quality string
 * @returns Estimated bitrate in kbps
 */
export function estimateOptimalBitrate(
  width: number, 
  height: number, 
  networkQuality: string
): number {
  // Base bitrate calculation based on resolution
  const pixels = width * height;
  let baseBitrate = 0;
  let resolutionCategory = '';
  
  // Start time for performance measurement
  const startTime = performance.now();
  
  // Adjust base bitrate based on resolution
  if (pixels <= 230400) { // 480p (640x360)
    baseBitrate = 1000; // 1 Mbps
    resolutionCategory = '480p';
  } else if (pixels <= 921600) { // 720p (1280x720)
    baseBitrate = 2500; // 2.5 Mbps
    resolutionCategory = '720p';
  } else if (pixels <= 2073600) { // 1080p (1920x1080)
    baseBitrate = 5000; // 5 Mbps
    resolutionCategory = '1080p';
  } else {
    baseBitrate = 8000; // 8+ Mbps for higher resolutions
    resolutionCategory = '4K+';
  }
  
  // Apply network quality adjustments
  const qualityMultipliers: Record<string, number> = {
    'slow': 0.5,     // Reduce bitrate by 50% for slow connections
    'medium': 0.8,   // Reduce bitrate by 20% for medium connections
    'fast': 1.0,     // Keep full bitrate for fast connections
    'ultrafast': 1.2 // Allow higher bitrate for very fast connections
  };
  
  const multiplier = qualityMultipliers[networkQuality] || 0.8;
  const finalBitrate = Math.round(baseBitrate * multiplier);
  
  // Log the bitrate calculation
  logDebug('Estimated optimal bitrate', {
    width,
    height,
    pixels,
    resolutionCategory,
    networkQuality,
    baseBitrate,
    multiplier,
    finalBitrate,
    durationMs: Math.round(performance.now() - startTime)
  }).catch(() => {});
  
  // Add a breadcrumb if the context is available
  Promise.resolve().then(async () => {
    try {
      const { getCurrentContext, addBreadcrumb } = await import('../utils/requestContext');
      const requestContext = getCurrentContext();
      
      if (requestContext) {
        addBreadcrumb(requestContext, 'VideoTransformationService', 'Bitrate calculation', {
          width,
          height,
          resolutionCategory,
          networkQuality,
          bitrate: finalBitrate
        });
      }
    } catch {
      // Silently fail if we can't access the context
    }
  });
  
  return finalBitrate;
}
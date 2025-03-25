/**
 * Service for transforming videos using CDN-CGI paths
 * Abstracts the command pattern implementation behind a service interface
 */
import { VideoTransformOptions } from '../domain/commands/TransformVideoCommand';
import { PathPattern } from '../utils/pathUtils';
import { DebugInfo } from '../utils/debugHeadersUtils';
import { getCurrentContext } from '../utils/legacyLoggerAdapter';
import { createLogger, debug as pinoDebug, error as pinoError } from '../utils/pinoLogger';

/**
 * Transform a video using CDN-CGI media format
 * 
 * @param request - The original request
 * @param options - Video transformation options
 * @param pathPatterns - Path patterns for matching URLs
 * @param debugInfo - Debug information settings
 * @returns A response containing the transformed video
 */
export async function transformVideo(
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
    // Get the current request context - should be available from the handler
    const requestContext = getCurrentContext() || undefined;
    let logger;
    
    // Create logger if we have a context
    if (requestContext) {
      logger = createLogger(requestContext);
      
      // Log with Pino
      pinoDebug(requestContext, logger, 'VideoTransformationService', 'Transforming video', {
        url: request.url
      });
    } else {
      // Legacy logging fallback - this branch should not typically be hit
      // since request context should be available
      console.warn('VideoTransformationService: No request context available');
      const { debug } = await import('../utils/legacyLoggerAdapter');
      debug('VideoTransformationService', 'Transforming video', {
        url: request.url,
        options,
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

    return await command.execute();
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    
    // Get the request context and log the error using the new system if available
    const requestContext = getCurrentContext();
    if (requestContext) {
      const logger = createLogger(requestContext);
      pinoError(requestContext, logger, 'VideoTransformationService', 'Error transforming video', {
        error: errorMessage,
        stack: err instanceof Error ? err.stack : undefined,
      });
    } else {
      // Legacy logging fallback - this branch should not typically be hit
      // since request context should be available
      console.warn('VideoTransformationService: No request context available for error');
      const { error } = await import('../utils/legacyLoggerAdapter');
      error('VideoTransformationService', 'Error transforming video', {
        error: errorMessage,
        stack: err instanceof Error ? err.stack : undefined,
      });
    }

    throw err; // Rethrow to be handled by the caller
  }
}

/**
 * Get the format to use for the transformed video
 * 
 * @param request - The original request
 * @returns The best format based on Accept header
 */
export function getBestVideoFormat(request: Request): string {
  // Get Accept header
  const accept = request.headers.get('Accept') || '';
  
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
  
  // Adjust base bitrate based on resolution
  if (pixels <= 230400) { // 480p (640x360)
    baseBitrate = 1000; // 1 Mbps
  } else if (pixels <= 921600) { // 720p (1280x720)
    baseBitrate = 2500; // 2.5 Mbps
  } else if (pixels <= 2073600) { // 1080p (1920x1080)
    baseBitrate = 5000; // 5 Mbps
  } else {
    baseBitrate = 8000; // 8+ Mbps for higher resolutions
  }
  
  // Apply network quality adjustments
  const qualityMultipliers: Record<string, number> = {
    'slow': 0.5,     // Reduce bitrate by 50% for slow connections
    'medium': 0.8,   // Reduce bitrate by 20% for medium connections
    'fast': 1.0,     // Keep full bitrate for fast connections
    'ultrafast': 1.2 // Allow higher bitrate for very fast connections
  };
  
  const multiplier = qualityMultipliers[networkQuality] || 0.8;
  return Math.round(baseBitrate * multiplier);
}
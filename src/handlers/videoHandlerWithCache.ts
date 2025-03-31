/**
 * Video handler implementation with KV caching integration
 */

import { EnvVariables } from '../config/environmentConfig';
import { withCaching } from '../utils/cacheOrchestrator';
import { transformVideo } from '../services/videoTransformationService';
import { getVideoPathPatterns } from '../config';
import { createLogger } from '../utils/pinoLogger';
import { getCurrentContext, addBreadcrumb } from '../utils/requestContext';

/**
 * Handle video transformation requests with integrated caching
 * 
 * This handler adds a caching layer around the standard video handler
 * to improve performance for frequently requested video transformations.
 * 
 * @param request - The incoming request
 * @param env - Environment variables including KV bindings
 * @param ctx - Execution context
 * @returns The response with the transformed video
 */
export async function handleRequestWithCaching(
  request: Request, 
  env: EnvVariables, 
  ctx: ExecutionContext
): Promise<Response> {
  // Pass execution context to environment for waitUntil usage in caching
  (env as any).executionCtx = ctx;
  const url = new URL(request.url);
  const pathPatterns = getVideoPathPatterns();
  
  // Parse debug information from query parameters
  const debugInfo = {
    isEnabled: url.searchParams.has('debug'),
    isVerbose: url.searchParams.get('debug') === 'verbose',
    includeHeaders: true,
    format: url.searchParams.get('debug_format') || 'json'
  };
  
  // Get transformation options from query parameters
  const videoOptions = {
    quality: url.searchParams.get('quality') || undefined,
    compression: url.searchParams.get('compression') || undefined,
    width: url.searchParams.get('width') ? parseInt(url.searchParams.get('width') || '', 10) : undefined,
    height: url.searchParams.get('height') ? parseInt(url.searchParams.get('height') || '', 10) : undefined,
    derivative: url.searchParams.get('derivative') || undefined,
    format: url.searchParams.get('format') || undefined,
    loop: url.searchParams.has('loop') ? url.searchParams.get('loop') === 'true' : undefined,
    autoplay: url.searchParams.has('autoplay') ? url.searchParams.get('autoplay') === 'true' : undefined,
    muted: url.searchParams.has('muted') ? url.searchParams.get('muted') === 'true' : undefined,
    duration: url.searchParams.has('duration') ? url.searchParams.get('duration') || '' : undefined,
    fps: url.searchParams.has('fps') ? parseInt(url.searchParams.get('fps') || '', 10) : undefined
  };
  
  // Log the request parameters
  const requestContext = getCurrentContext();
  if (requestContext) {
    const logger = createLogger(requestContext);
    logger.info('Video transformation request with caching', {
      path: url.pathname,
      options: videoOptions
    });
    
    addBreadcrumb(requestContext, 'VideoHandler', 'Processing video request with caching', {
      url: request.url,
      options: videoOptions
    });
  } else {
    // Fallback logging when request context isn't available
    console.info('Video transformation request with caching', {
      path: url.pathname,
      options: videoOptions
    });
  }
  
  // Wrap with caching middleware
  return withCaching(
    request,
    env,
    () => transformVideo(request, videoOptions, pathPatterns, debugInfo, env),
    videoOptions
  );
}
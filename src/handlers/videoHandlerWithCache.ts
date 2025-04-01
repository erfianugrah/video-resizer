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
  
  // Import dynamically to avoid circular references
  try {
    // Use dynamic import to access the context modules
    const { createRequestContext, setCurrentContext, addBreadcrumb, getCurrentContext } = 
      await import('../utils/requestContext');
    
    // Create a request context if one doesn't exist
    let requestContext = getCurrentContext();
    
    if (!requestContext) {
      // Create a new context and set it as the current one
      requestContext = createRequestContext(request, ctx);
      setCurrentContext(requestContext);
      
      console.debug('videoHandlerWithCache: Created and set new request context', {
        requestId: requestContext.requestId,
        url: request.url
      });
    }
    
    // Now we should have a valid request context
    const logger = createLogger(requestContext);
    
    // Log detailed request information
    logger.info('Video transformation request with caching', {
      path: url.pathname,
      requestId: requestContext.requestId,
      method: request.method,
      hasOptions: Object.values(videoOptions).some(v => v !== undefined),
      options: {
        ...videoOptions,
        // Only include non-sensitive options in logs
        width: videoOptions.width,
        height: videoOptions.height,
        derivative: videoOptions.derivative,
        format: videoOptions.format
      }
    });
    
    // Add detailed breadcrumb for request tracing
    addBreadcrumb(requestContext, 'VideoHandler', 'Processing video request with caching', {
      url: request.url,
      path: url.pathname,
      options: videoOptions,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    // Fallback logging when request context initialization fails
    console.info('Video transformation request with caching (fallback logging)', {
      path: url.pathname,
      options: videoOptions,
      error: err instanceof Error ? err.message : String(err)
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
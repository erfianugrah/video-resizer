/**
 * Main video handling entry point
 */
import { determineVideoOptions } from './videoOptionsService';
import { TransformVideoCommand } from '../domain/commands/TransformVideoCommand';
import { debug, error, info } from '../utils/loggerUtils';
import { isCdnCgiMediaPath } from '../utils/pathUtils';
import { videoConfig } from '../config/videoConfig';
import { EnvironmentConfig } from '../config/environmentConfig';

/**
 * Main handler for video requests
 * @param request The incoming request
 * @param config Environment configuration
 * @returns A response with the processed video
 */
export async function handleVideoRequest(request: Request, config: EnvironmentConfig): Promise<Response> {
  try {
    const url = new URL(request.url);
    const path = url.pathname;

    // Check if the request is already a CDN-CGI media request
    if (isCdnCgiMediaPath(path)) {
      info('VideoHandler', 'Request is already a CDN-CGI media request, passing through');
      return fetch(request);
    }

    // Get path patterns from config or use defaults
    const pathPatterns = config.pathPatterns || videoConfig.pathPatterns;

    // Get URL parameters
    const urlParams = url.searchParams;

    // Determine video options from URL parameters
    const videoOptions = determineVideoOptions(request, urlParams, path);

    debug('VideoHandler', 'Processing video request', {
      url: url.toString(),
      path,
      options: videoOptions,
    });

    // Create and execute the transform video command
    const command = new TransformVideoCommand({
      request,
      options: videoOptions,
      pathPatterns,
      debugInfo: {
        isDebugEnabled: config.debug?.enabled,
        isVerboseEnabled: config.debug?.verbose,
      },
    });

    return await command.execute();
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    const errorStack = err instanceof Error ? err.stack : undefined;
    
    error('VideoHandler', 'Error handling video request', {
      error: errorMessage,
      stack: errorStack,
    });

    return new Response(`Error processing video: ${errorMessage}`, {
      status: 500,
      headers: {
        'Content-Type': 'text/plain',
        'Cache-Control': 'no-store',
      },
    });
  }
}

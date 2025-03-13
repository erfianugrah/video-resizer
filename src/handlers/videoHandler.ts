/**
 * Main video handling entry point
 * Using service-oriented architecture for better separation of concerns
 */
import { determineVideoOptions } from './videoOptionsService';
import { transformVideo } from '../services/videoTransformationService';
import { debug, error, info } from '../utils/loggerUtils';
import { isCdnCgiMediaPath } from '../utils/pathUtils';
import { videoConfig } from '../config/videoConfig';
import { EnvironmentConfig, EnvVariables } from '../config/environmentConfig';

/**
 * Main handler for video requests
 * @param request The incoming request
 * @param config Environment configuration
 * @returns A response with the processed video
 */
export async function handleVideoRequest(
  request: Request, 
  config: EnvironmentConfig, 
  env?: EnvVariables
): Promise<Response> {
  try {
    const url = new URL(request.url);
    const path = url.pathname;

    // Check if the request is already a CDN-CGI media request
    if (isCdnCgiMediaPath(path)) {
      info('VideoHandler', 'Request is already a CDN-CGI media request, passing through');
      return fetch(request);
    }
    
    // Import the cache management service
    const { getCachedResponse, cacheResponse } = await import('../services/cacheManagementService');

    // Try to get the response from cache first
    const cachedResponse = await getCachedResponse(request);
    if (cachedResponse) {
      info('VideoHandler', 'Serving from cache', {
        url: url.toString(),
        cacheControl: cachedResponse.headers.get('Cache-Control'),
      });
      return cachedResponse;
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

    // Prepare debug information
    const debugInfo = {
      isEnabled: config.debug?.enabled,
      isVerbose: config.debug?.verbose,
      includeHeaders: config.debug?.includeHeaders,
      includePerformance: true,
    };

    // Use the video transformation service
    const response = await transformVideo(request, videoOptions, pathPatterns, debugInfo, env);
    
    // Store the response in cache if it's cacheable
    if (response.headers.get('Cache-Control')?.includes('max-age=')) {
      // Use a non-blocking cache write to avoid delaying the response
      cacheResponse(request, response.clone()).catch(err => {
        error('VideoHandler', 'Error caching response', {
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      });
    }

    return response;
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

/**
 * Enhanced video fetching functionality using the Origins system
 */

import { withErrorHandling, logErrorWithContext } from '../../utils/errorHandlingUtils';
import { VideoResizerConfig, StorageResult, OriginsConfig, Origin } from './interfaces';
import { EnvVariables } from '../../config/environmentConfig';
import { getCurrentContext } from '../../utils/legacyLoggerAdapter';
import { addBreadcrumb } from '../../utils/requestContext';
import { logDebug } from './logging';
import { fetchFromR2 } from './r2Storage';
import { fetchFromRemote } from './remoteStorage';
import { fetchFromFallback } from './fallbackStorage';
import { OriginResolver } from '../origins/OriginResolver';

/**
 * Helper function to check if origins is an array or config object, and if it has items
 */
function getOriginsCount(origins: Origin[] | OriginsConfig | undefined): number {
  if (!origins) {
    return 0;
  }
  
  if (Array.isArray(origins)) {
    return origins.length;
  }
  
  if (origins.items && Array.isArray(origins.items)) {
    return origins.items.length;
  }
  
  return 0;
}

/**
 * Implementation of fetchVideo that uses the Origins system for path resolution
 * 
 * @param path The path to the video
 * @param config The video resizer configuration
 * @param env The Cloudflare environment
 * @param request Optional request object for conditional requests
 * @returns A StorageResult object with the fetched video
 */
async function fetchVideoWithOriginsImpl(
  path: string,
  config: VideoResizerConfig,
  env: EnvVariables,
  request?: Request
): Promise<StorageResult> {
  // Create a request ID for tracing this fetch operation
  const requestId = Math.random().toString(36).substring(2, 10);
  const startTime = Date.now();
  
  // Add detailed logging for the operation start
  const requestContext = getCurrentContext();
  if (requestContext) {
    addBreadcrumb(requestContext, 'Storage', 'Starting video fetch operation (Origins)', {
      path,
      requestId,
      usesOrigins: !!config.origins
    });
  }
  
  // Get origins count for logging
  const originsCount = getOriginsCount(config.origins);
  
  logDebug('VideoStorageService', `[${requestId}] Starting video fetch operation with Origins`, {
    path,
    hasRequest: !!request,
    url: request?.url,
    hasOrigins: !!config.origins,
    originsCount,
    timestamp: new Date().toISOString()
  });
  
  // Check if we have Origins configuration
  if (!config.origins || getOriginsCount(config.origins) === 0) {
    logDebug('VideoStorageService', 'No Origins configuration found, falling back to legacy method', {
      path,
      hasLegacyStorage: !!config.storage
    });
    
    // Import the legacy fetchVideo function dynamically to avoid circular dependencies
    const { fetchVideo } = await import('./fetchVideo');
    return fetchVideo(path, config, env, request);
  }
  
  // Initialize the OriginResolver with our configuration
  const originResolver = new OriginResolver(config);
  
  // Check if this is a media transformation subrequest
  const via = request?.headers.get('via') || '';
  const isMediaTransformationSubrequest = via.includes('media-transformation');
  
  // Log the request type for debugging
  logDebug('VideoStorageService', 'Video fetch request analysis with Origins', { 
    path, 
    isMediaTransformationSubrequest,
    via
  });
  
  // First, handle special case for Media Transformation subrequests
  if (isMediaTransformationSubrequest) {
    logDebug('VideoStorageService', 'Detected media-transformation subrequest with Origins', { path });
    
    // Try to resolve directly to an R2 source for subrequests
    const r2Resolution = originResolver.resolvePathToSource(path, { originType: 'r2' });
    
    if (r2Resolution && env.VIDEOS_BUCKET) {
      logDebug('VideoStorageService', 'Using R2 for media-transformation subrequest', { 
        path,
        resolvedPath: r2Resolution.resolvedPath
      });
      
      const bucket = env.VIDEOS_BUCKET;
      
      try {
        if (!bucket) {
          throw new Error('R2 bucket is undefined');
        }
        
        const result = await fetchFromR2(r2Resolution.resolvedPath, bucket, request, config);
        
        if (result) {
          logDebug('VideoStorageService', 'Found video in R2 bucket for subrequest', { 
            key: r2Resolution.resolvedPath 
          });
          
          if (requestContext) {
            addBreadcrumb(requestContext, 'Storage', 'R2 fetch successful for subrequest (Origins)', {
              key: r2Resolution.resolvedPath,
              contentType: result.contentType,
              size: result.size
            });
          }
          
          return result;
        }
      } catch (err) {
        // Error handling is done by fetchFromR2, continue with normal flow
      }
    }
  }
  
  // Find matching origin and get path resolution
  const originMatch = originResolver.matchOriginWithCaptures(path);
  
  if (!originMatch) {
    logDebug('VideoStorageService', 'No matching origin found for path', { path });
    
    // Return a standardized error result
    return {
      response: new Response('Video not found - No matching origin', { status: 404 }),
      sourceType: 'error',
      contentType: null,
      size: null,
      error: new Error('No matching origin found for path'),
      path: path
    };
  }
  
  // Get sources from the matching origin, sorted by priority
  const origin = originMatch.origin;
  const sources = [...origin.sources].sort((a, b) => a.priority - b.priority);
  
  logDebug('VideoStorageService', 'Found matching origin for path', { 
    path,
    originName: origin.name,
    sourceCount: sources.length,
    sourceTypes: sources.map(s => s.type)
  });
  
  // Try each source in priority order
  for (const source of sources) {
    let result: StorageResult | null = null;
    
    // Resolve the path for this source
    const resolvedPath = originResolver.resolvePathForSource(path, source, originMatch.captures);
    
    logDebug('VideoStorageService', `Trying ${source.type} source`, { 
      originalPath: path,
      resolvedPath: resolvedPath,
      sourceType: source.type
    });
    
    // Try R2 storage
    if (source.type === 'r2' && env.VIDEOS_BUCKET) {
      const bucket = env.VIDEOS_BUCKET;
      
      if (!bucket) {
        logErrorWithContext(
          'R2 bucket is undefined',
          new Error('Missing R2 bucket binding'),
          { path: resolvedPath },
          'VideoStorageService'
        );
        continue;
      }
      
      result = await fetchFromR2(resolvedPath, bucket, request, config);
      
      if (result) {
        logDebug('VideoStorageService', 'R2 fetch successful (Origins)', {
          size: result.size,
          contentType: result.contentType
        });
        
        if (requestContext) {
          addBreadcrumb(requestContext, 'Storage', 'R2 fetch successful (Origins)', {
            path: resolvedPath,
            contentType: result.contentType,
            size: result.size
          });
        }
      }
    }
    
    // Try remote URL
    else if (source.type === 'remote' && source.url) {
      result = await fetchFromRemote(resolvedPath, source.url, config, env);
      
      if (result) {
        logDebug('VideoStorageService', 'Remote fetch successful (Origins)', {
          size: result.size,
          contentType: result.contentType
        });
        
        if (requestContext) {
          addBreadcrumb(requestContext, 'Storage', 'Remote fetch successful (Origins)', {
            path: resolvedPath,
            url: source.url,
            contentType: result.contentType,
            size: result.size
          });
        }
      }
    }
    
    // Try fallback URL
    else if (source.type === 'fallback' && source.url) {
      result = await fetchFromFallback(resolvedPath, source.url, config, env);
      
      if (result) {
        logDebug('VideoStorageService', 'Fallback fetch successful (Origins)', {
          size: result.size,
          contentType: result.contentType
        });
        
        if (requestContext) {
          addBreadcrumb(requestContext, 'Storage', 'Fallback fetch successful (Origins)', {
            path: resolvedPath,
            url: source.url,
            contentType: result.contentType,
            size: result.size
          });
        }
      }
    }
    
    // If we found the video, return it
    if (result) {
      const elapsedTime = Date.now() - startTime;
      logDebug('VideoStorageService', `[${requestId}] Successfully found video with Origins`, { 
        sourceType: result.sourceType, 
        contentType: result.contentType, 
        size: result.size,
        storage: source.type,
        elapsedMs: elapsedTime,
        success: true,
        timestamp: new Date().toISOString()
      });
      return result;
    }
  }
  
  // If we couldn't find the video anywhere, create an error response
  const elapsedTime = Date.now() - startTime;
  
  // Log detailed error information
  logErrorWithContext(
    'Video not found in any source (Origins)',
    new Error('Video not found'),
    { 
      path, 
      requestId,
      elapsedMs: elapsedTime,
      originName: origin.name,
      sourceCount: sources.length,
      sourceTypes: sources.map(s => s.type),
      timestamp: new Date().toISOString()
    },
    'VideoStorageService'
  );
  
  if (requestContext) {
    addBreadcrumb(requestContext, 'Error', 'Video not found in any source (Origins)', {
      path,
      originName: origin.name,
      severity: 'high'
    });
  }
  
  // Return a standardized error result
  return {
    response: new Response('Video not found', { status: 404 }),
    sourceType: 'error',
    contentType: null,
    size: null,
    error: new Error('Video not found in any source'),
    path: path
  };
}

/**
 * Fetch a video using the Origins system for path resolution
 * Uses standardized error handling for consistent logging and robust error handling
 * 
 * @param path The path to the video
 * @param config The video resizer configuration
 * @param env The Cloudflare environment
 * @param request Optional request object
 * @returns A StorageResult object or an error response if not found
 */
export const fetchVideoWithOrigins = withErrorHandling<
  [string, VideoResizerConfig, EnvVariables, Request | undefined],
  Promise<StorageResult>
>(
  fetchVideoWithOriginsImpl,
  {
    functionName: 'fetchVideoWithOrigins',
    component: 'VideoStorageService',
    logErrors: true
  },
  {
    operation: 'fetch'
  }
);
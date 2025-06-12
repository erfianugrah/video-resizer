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

export interface FetchOptions {
  excludeSources?: Array<{
    originName: string;
    sourceType: string;
    sourcePriority?: number;
  }>;
}

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
 * @param options Optional fetch options including source exclusions
 * @returns A StorageResult object with the fetched video
 */
async function fetchVideoWithOriginsImpl(
  path: string,
  config: VideoResizerConfig,
  env: EnvVariables,
  request?: Request,
  options?: FetchOptions
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
  
  // Get all origins from configuration to allow multi-origin retry
  let allOrigins: Origin[] = [];
  if (config.origins) {
    if ('items' in config.origins && Array.isArray(config.origins.items)) {
      allOrigins = config.origins.items;
    } else if (Array.isArray(config.origins)) {
      allOrigins = config.origins;
    }
  }
  
  // Find all matching origins for the path (for multi-origin retry)
  const matchingOrigins: Array<{ origin: Origin; match: any }> = [];
  
  for (const origin of allOrigins) {
    try {
      const regex = new RegExp(origin.matcher);
      const match = path.match(regex);
      
      if (match) {
        const captures: Record<string, string> = {};
        
        // Add numbered captures
        for (let i = 1; i < match.length; i++) {
          captures[i.toString()] = match[i];
          
          // If there are named capture groups defined, use those names too
          if (origin.captureGroups && i <= origin.captureGroups.length) {
            const name = origin.captureGroups[i - 1];
            if (name) {
              captures[name] = match[i];
            }
          }
        }
        
        matchingOrigins.push({
          origin,
          match: {
            origin,
            matched: true,
            captures,
            originalPath: path
          }
        });
      }
    } catch (err) {
      logErrorWithContext(
        `Error matching origin pattern: ${origin.name}`,
        err,
        { path, matcher: origin.matcher },
        'VideoStorageService'
      );
    }
  }
  
  if (matchingOrigins.length === 0) {
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
  
  logDebug('VideoStorageService', 'Found matching origins for path', { 
    path,
    matchingOriginCount: matchingOrigins.length,
    originNames: matchingOrigins.map(m => m.origin.name)
  });
  
  // Try each matching origin in order
  for (const { origin, match: originMatch } of matchingOrigins) {
    // Get sources from the matching origin, sorted by priority
    let sources = [...origin.sources].sort((a, b) => a.priority - b.priority);
    
    // Apply source exclusions if provided
    if (options?.excludeSources && options.excludeSources.length > 0) {
      const originalCount = sources.length;
      sources = sources.filter(source => {
        return !options.excludeSources!.some(excluded => 
          excluded.originName === origin.name &&
          excluded.sourceType === source.type &&
          (excluded.sourcePriority === undefined || excluded.sourcePriority === source.priority)
        );
      });
      
      logDebug('VideoStorageService', 'Applied source exclusions', {
        originName: origin.name,
        originalSourceCount: originalCount,
        filteredSourceCount: sources.length,
        excludedSources: options.excludeSources.map(e => `${e.originName}:${e.sourceType}`)
      });
    }
    
    // Skip this origin if all sources are excluded
    if (sources.length === 0) {
      logDebug('VideoStorageService', 'All sources excluded for origin, trying next', { 
        originName: origin.name
      });
      continue;
    }
    
    logDebug('VideoStorageService', 'Trying origin for path', { 
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
      
      // Log the R2 URL being tried
      const r2Url = `r2://videos-bucket/${resolvedPath}`;
      logDebug('VideoStorageService', 'Attempting R2 fetch', {
        r2Url,
        bucket: 'videos-bucket',
        key: resolvedPath
      });
      
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
      // Construct the full remote URL
      const remoteUrl = source.url.endsWith('/') 
        ? `${source.url}${resolvedPath}` 
        : `${source.url}/${resolvedPath}`;
      
      logDebug('VideoStorageService', 'Attempting remote fetch', {
        remoteUrl,
        baseUrl: source.url,
        path: resolvedPath
      });
      
      // Check if source has authentication configuration
      // We need to ensure the source.auth configuration is correctly passed to fetchFromRemote
      if (source.auth?.enabled) {
        logDebug('VideoStorageService', 'Remote source requires authentication', {
          sourceType: source.type,
          authType: source.auth.type,
          authEnabled: source.auth.enabled
        });
        
        // Merge the source-specific auth configuration into the config.storage.remoteAuth field
        // This ensures that the existing fetchFromRemote function can use the auth configuration
        const configWithAuth = { ...config };
        if (!configWithAuth.storage) {
          configWithAuth.storage = {};
        }
        
        // Set remoteAuth in storage config to use the source's auth configuration
        configWithAuth.storage.remoteAuth = {
          enabled: source.auth.enabled,
          type: source.auth.type,
          accessKeyVar: source.auth.accessKeyVar,
          secretKeyVar: source.auth.secretKeyVar,
          headers: source.auth.headers,
          region: source.auth.region,
          service: source.auth.service,
          expiresInSeconds: source.auth.expiresInSeconds,
          sessionTokenVar: source.auth.sessionTokenVar
        };
        
        // If we have auth.useOriginAuth in the global config, preserve it
        if (config.storage?.auth?.useOriginAuth) {
          if (!configWithAuth.storage.auth) {
            configWithAuth.storage.auth = {};
          }
          configWithAuth.storage.auth.useOriginAuth = config.storage.auth.useOriginAuth;
        }
        
        // Use the enhanced config with merged auth settings
        result = await fetchFromRemote(resolvedPath, source.url, configWithAuth, env);
      } else {
        // No auth needed, use standard config
        result = await fetchFromRemote(resolvedPath, source.url, config, env);
      }
      
      if (result) {
        logDebug('VideoStorageService', 'Remote fetch successful (Origins)', {
          size: result.size,
          contentType: result.contentType,
          hasAuth: !!source.auth?.enabled
        });
        
        if (requestContext) {
          addBreadcrumb(requestContext, 'Storage', 'Remote fetch successful (Origins)', {
            path: resolvedPath,
            url: source.url,
            contentType: result.contentType,
            size: result.size,
            authType: source.auth?.type
          });
        }
      }
    }
    
    // Try fallback URL
    else if (source.type === 'fallback' && source.url) {
      // Construct the full fallback URL
      const fallbackUrl = source.url.endsWith('/') 
        ? `${source.url}${resolvedPath}` 
        : `${source.url}/${resolvedPath}`;
      
      logDebug('VideoStorageService', 'Attempting fallback fetch', {
        fallbackUrl,
        baseUrl: source.url,
        path: resolvedPath
      });
      
      // Check if source has authentication configuration (similar to remote source)
      if (source.auth?.enabled) {
        logDebug('VideoStorageService', 'Fallback source requires authentication', {
          sourceType: source.type,
          authType: source.auth.type,
          authEnabled: source.auth.enabled
        });
        
        // Merge the source-specific auth configuration into the config.storage.fallbackAuth field
        const configWithAuth = { ...config };
        if (!configWithAuth.storage) {
          configWithAuth.storage = {};
        }
        
        // Set fallbackAuth in storage config to use the source's auth configuration
        configWithAuth.storage.fallbackAuth = {
          enabled: source.auth.enabled,
          type: source.auth.type,
          accessKeyVar: source.auth.accessKeyVar,
          secretKeyVar: source.auth.secretKeyVar,
          headers: source.auth.headers,
          region: source.auth.region,
          service: source.auth.service,
          expiresInSeconds: source.auth.expiresInSeconds,
          sessionTokenVar: source.auth.sessionTokenVar
        };
        
        // If we have auth.useOriginAuth in the global config, preserve it
        if (config.storage?.auth?.useOriginAuth) {
          if (!configWithAuth.storage.auth) {
            configWithAuth.storage.auth = {};
          }
          configWithAuth.storage.auth.useOriginAuth = config.storage.auth.useOriginAuth;
        }
        
        // Use the enhanced config with merged auth settings
        result = await fetchFromFallback(resolvedPath, source.url, configWithAuth, env);
      } else {
        // No auth needed, use standard config
        result = await fetchFromFallback(resolvedPath, source.url, config, env);
      }
      
      if (result) {
        logDebug('VideoStorageService', 'Fallback fetch successful (Origins)', {
          size: result.size,
          contentType: result.contentType,
          hasAuth: !!source.auth?.enabled
        });
        
        if (requestContext) {
          addBreadcrumb(requestContext, 'Storage', 'Fallback fetch successful (Origins)', {
            path: resolvedPath,
            url: source.url,
            contentType: result.contentType,
            size: result.size,
            authType: source.auth?.type
          });
        }
      }
    }
    
      // If we found the video, return it
      if (result) {
        const elapsedTime = Date.now() - startTime;
        
        // Construct the source URL that was successful
        let successUrl = '';
        if (source.type === 'r2') {
          successUrl = `r2://videos-bucket/${resolvedPath}`;
        } else if (source.type === 'remote' || source.type === 'fallback') {
          successUrl = source.url?.endsWith('/') 
            ? `${source.url}${resolvedPath}` 
            : `${source.url}/${resolvedPath}`;
        }
        
        logDebug('VideoStorageService', `[${requestId}] Successfully found video with Origins`, { 
          sourceType: result.sourceType, 
          contentType: result.contentType, 
          size: result.size,
          storage: source.type,
          originName: origin.name,
          successUrl,
          elapsedMs: elapsedTime,
          success: true,
          timestamp: new Date().toISOString()
        });
        
        return result;
      }
    }
    
    // Log that this origin didn't have the video
    logDebug('VideoStorageService', 'Video not found in origin, trying next', { 
      originName: origin.name,
      triedSources: sources.map(s => s.type)
    });
  }
  
  // If we couldn't find the video in any origin, create an error response
  const elapsedTime = Date.now() - startTime;
  
  // Log detailed error information
  logErrorWithContext(
    'Video not found in any origin or source',
    new Error('Video not found'),
    { 
      path, 
      requestId,
      elapsedMs: elapsedTime,
      matchingOriginCount: matchingOrigins.length,
      triedOrigins: matchingOrigins.map(m => m.origin.name),
      timestamp: new Date().toISOString()
    },
    'VideoStorageService'
  );
  
  if (requestContext) {
    addBreadcrumb(requestContext, 'Error', 'Video not found in any origin', {
      path,
      triedOrigins: matchingOrigins.map(m => m.origin.name),
      severity: 'high'
    });
  }
  
  // Return a standardized error result
  return {
    response: new Response('Video not found in any origin', { status: 404 }),
    sourceType: 'error',
    contentType: null,
    size: null,
    error: new Error('Video not found in any origin or source'),
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
  [string, VideoResizerConfig, EnvVariables, Request | undefined, FetchOptions | undefined],
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
/**
 * Main video fetching functionality for the Video Storage Service
 */

import { withErrorHandling, logErrorWithContext } from '../../utils/errorHandlingUtils';
import { VideoResizerConfig, StorageResult } from './interfaces';
import { EnvVariables } from '../../config/environmentConfig';
import { getCurrentContext } from '../../utils/legacyLoggerAdapter';
import { addBreadcrumb } from '../../utils/requestContext';
import { logDebug } from './logging';
import { fetchFromR2 } from './r2Storage';
import { fetchFromRemote } from './remoteStorage';
import { fetchFromFallback } from './fallbackStorage';
import { applyPathTransformation } from './pathTransform';

/**
 * Implementation of fetchVideo that orchestrates fetching from multiple sources
 * 
 * @param path The path to the video
 * @param config The video resizer configuration
 * @param env The Cloudflare environment
 * @param request Optional request object for conditional requests
 * @returns A StorageResult object with the fetched video
 */
async function fetchVideoImpl(
  path: string,
  config: VideoResizerConfig,
  env: EnvVariables,
  request?: Request
): Promise<StorageResult> {
  // Create a request ID or tag for tracing this fetch operation
  const requestId = Math.random().toString(36).substring(2, 10);
  const startTime = Date.now();
  
  // Add detailed logging for the operation start
  const requestContext = getCurrentContext();
  if (requestContext) {
    addBreadcrumb(requestContext, 'Storage', 'Starting video fetch operation', {
      path,
      requestId,
      options: config.storage?.priority ?? []
    });
  }
  
  logDebug('VideoStorageService', `[${requestId}] Starting video fetch operation`, {
    path,
    hasRequest: !!request,
    url: request?.url,
    storageOptions: config.storage?.priority ?? [],
    timestamp: new Date().toISOString()
  });
  
  // First, check the request type to determine if this is a Cloudflare Media Transformation subrequest
  const via = request?.headers.get('via') || '';
  const isMediaTransformationSubrequest = via.includes('media-transformation');
  
  // Log the request type for debugging
  logDebug('VideoStorageService', 'Video fetch request analysis', { 
    path, 
    isMediaTransformationSubrequest,
    via
  });
  
  // Special handling for Media Transformation subrequests
  if (isMediaTransformationSubrequest) {
    logDebug('VideoStorageService', 'Detected media-transformation subrequest', { path });
    
    // First, determine if R2 should be used based on storage priority
    const shouldUseR2 = config.storage?.priority?.includes('r2') && 
                       config.storage?.r2?.enabled === true && 
                       env.VIDEOS_BUCKET;
                       
    logDebug('VideoStorageService', 'Subrequest storage evaluation', {
      path: path,
      storageOrder: config.storage?.priority?.join(',') ?? '',
      r2Available: (config.storage?.r2?.enabled === true && !!env.VIDEOS_BUCKET) ? true : false,
      shouldUseR2: shouldUseR2 ? true : false
    });
    
    // Check if R2 is available, enabled, and in the priority list
    if (shouldUseR2) {
      logDebug('VideoStorageService', 'Using R2 for media-transformation subrequest', { path });
      
      const bucket = env.VIDEOS_BUCKET;
      const fetchStart = Date.now();
      
      // Apply path transformations for R2 storage
      const r2Key = applyPathTransformation(path, config, 'r2');
      
      logDebug('VideoStorageService', 'Video key for subrequest', { 
        originalPath: path,
        transformedKey: r2Key,
        url: request?.url
      });
      
      // Try to get the object from R2
      try {
        // Make sure bucket is defined before using it
        if (!bucket) {
          logErrorWithContext(
            'R2 bucket is undefined', 
            new Error('Missing R2 bucket binding'),
            { path: r2Key },
            'VideoStorageService'
          );
          throw new Error('R2 bucket is undefined');
        }
        
        const result = await fetchFromR2(r2Key, bucket, request, config);
        const fetchEnd = Date.now();
        
        if (result) {
          logDebug('VideoStorageService', 'Found video in R2 bucket for subrequest', { r2Key });
          
          if (requestContext) {
            addBreadcrumb(requestContext, 'Storage', 'R2 fetch successful for subrequest', {
              key: r2Key,
              contentType: result.contentType,
              size: result.size
            });
          }
          
          return result;
        }
        
        // If the video is not found with transformed path, try the simple normalized path as fallback
        const normalizedPath = path.startsWith('/') ? path.substring(1) : path;
        if (r2Key !== normalizedPath) {
          logDebug('VideoStorageService', 'Video not found with transformed key, trying normalized path', { 
            r2Key, 
            normalizedPath 
          });
          
          if (!bucket) {
            logErrorWithContext(
              'R2 bucket is undefined', 
              new Error('Missing R2 bucket binding'),
              { path: normalizedPath },
              'VideoStorageService'
            );
            throw new Error('R2 bucket is undefined');
          }
          
          const fallbackResult = await fetchFromR2(normalizedPath, bucket, request, config);
          if (fallbackResult) {
            logDebug('VideoStorageService', 'Found video in R2 bucket using normalized path', { normalizedPath });
            
            if (requestContext) {
              addBreadcrumb(requestContext, 'Storage', 'R2 fallback fetch successful', {
                key: normalizedPath,
                contentType: fallbackResult.contentType,
                size: fallbackResult.size
              });
            }
            
            return fallbackResult;
          }
        }
      } catch (err) {
        // Error is already logged by fetchFromR2 with standardized error handling
        // Continue with other storage options
      }
    } else {
      logDebug('VideoStorageService', 'R2 not available for media-transformation subrequest', { 
        r2Enabled: config.storage?.r2?.enabled,
        hasBucket: !!env.VIDEOS_BUCKET
      });
    }
  }

  // Determine available storage options
  const availableStorage = config.storage?.priority ?? ['remote', 'fallback'];
  
  logDebug('VideoStorageService', 'Trying storage options in priority order', { 
    storageOrder: availableStorage,
    r2Enabled: (config.storage?.r2?.enabled === true && !!env.VIDEOS_BUCKET) ? true : false,
    remoteUrlSet: !!config.storage?.remoteUrl,
    fallbackUrlSet: !!config.storage?.fallbackUrl
  });
  
  // Log more detailed information about storage configuration before trying each option
  logDebug('VideoStorageService', 'Detailed storage configuration', { 
    storageTypes: availableStorage,
    r2Config: config.storage?.r2 || {},
    r2Bucket: env.VIDEOS_BUCKET ? 'defined' : 'undefined',
    remoteUrl: config.storage?.remoteUrl ? 'defined' : 'undefined',
    fallbackUrl: config.storage?.fallbackUrl ? 'defined' : 'undefined',
    hasPathTransforms: !!config.storage?.pathTransforms,
    path
  });
  
  // Try each storage option in order of priority
  for (const storageType of availableStorage) {
    let result: StorageResult | null = null;
    
    // Try to fetch from R2
    if (storageType === 'r2' && config.storage?.r2?.enabled === true && env.VIDEOS_BUCKET) {
      logDebug('VideoStorageService', 'Trying R2 storage', { path });
      
      // Apply path transformations for R2
      const transformedPath = applyPathTransformation(path, config, 'r2');
      
      logDebug('VideoStorageService', 'R2 path after transformation', { 
        originalPath: path, 
        transformedPath 
      });
      
      const bucket = env.VIDEOS_BUCKET;
      
      if (!bucket) {
        logErrorWithContext(
          'R2 bucket is undefined',
          new Error('Missing R2 bucket binding'),
          { path: transformedPath },
          'VideoStorageService'
        );
        // Continue with next storage type
        continue;
      }
      
      result = await fetchFromR2(transformedPath, bucket, request, config);
      
      if (result) {
        logDebug('VideoStorageService', 'R2 fetch successful', {
          size: result.size,
          contentType: result.contentType
        });
        
        if (requestContext) {
          addBreadcrumb(requestContext, 'Storage', 'R2 fetch successful', {
            path: transformedPath,
            contentType: result.contentType,
            size: result.size
          });
        }
      }
    }
    
    // Try to fetch from remote URL
    if (!result && storageType === 'remote' && config.storage?.remoteUrl) {
      // Add detailed diagnostics about remote URL attempt
      logDebug('VideoStorageService', 'Trying remote URL with detailed diagnostics', { 
        path, 
        remoteUrl: config.storage.remoteUrl,
        remoteAuth: config.storage?.remoteAuth ? {
          enabled: config.storage.remoteAuth.enabled,
          type: config.storage.remoteAuth.type
        } : 'undefined',
        hasOriginAuth: config.storage?.auth?.useOriginAuth,
        securityLevel: config.storage?.auth?.securityLevel
      });
      
      // Apply path transformations for remote
      const transformedPath = applyPathTransformation(path, config, 'remote');
      
      result = await fetchFromRemote(transformedPath, config.storage.remoteUrl, config, env);
      
      if (result) {
        logDebug('VideoStorageService', 'Remote fetch successful', {
          size: result.size,
          contentType: result.contentType
        });
        
        if (requestContext) {
          addBreadcrumb(requestContext, 'Storage', 'Remote fetch successful', {
            path: transformedPath,
            url: config.storage.remoteUrl,
            contentType: result.contentType,
            size: result.size
          });
        }
      }
    }
    
    // Try to fetch from fallback URL
    if (!result && storageType === 'fallback' && config.storage?.fallbackUrl) {
      // Add detailed diagnostics about fallback URL attempt
      logDebug('VideoStorageService', 'Trying fallback URL with detailed diagnostics', { 
        path, 
        fallbackUrl: config.storage.fallbackUrl,
        fallbackAuth: config.storage?.fallbackAuth ? {
          enabled: config.storage.fallbackAuth.enabled,
          type: config.storage.fallbackAuth.type
        } : 'undefined',
        hasOriginAuth: config.storage?.auth?.useOriginAuth,
        securityLevel: config.storage?.auth?.securityLevel,
        hasPathTransforms: !!config.storage?.pathTransforms
      });
      
      // Apply path transformations for fallback
      const transformedPath = applyPathTransformation(path, config, 'fallback');
      
      result = await fetchFromFallback(transformedPath, config.storage.fallbackUrl, config, env);
      
      if (result) {
        logDebug('VideoStorageService', 'Fallback fetch successful', {
          size: result.size,
          contentType: result.contentType
        });
        
        if (requestContext) {
          addBreadcrumb(requestContext, 'Storage', 'Fallback fetch successful', {
            path: transformedPath,
            url: config.storage.fallbackUrl,
            contentType: result.contentType,
            size: result.size
          });
        }
      }
    }
    
    // If we found the video, return it
    if (result) {
      const elapsedTime = Date.now() - startTime;
      logDebug('VideoStorageService', `[${requestId}] Successfully found video in storage`, { 
        sourceType: result.sourceType, 
        contentType: result.contentType, 
        size: result.size,
        storage: storageType,
        elapsedMs: elapsedTime,
        success: true,
        timestamp: new Date().toISOString()
      });
      return result;
    }
  }
  
  // If we couldn't find the video anywhere, create an error response
  const elapsedTime = Date.now() - startTime;
  
  // Log detailed error information with expanded diagnostics
  logErrorWithContext(
    'Video not found in any storage location',
    new Error('Video not found'),
    { 
      path, 
      requestId,
      elapsedMs: elapsedTime,
      storageOptions: config.storage?.priority ?? [],
      storageConfig: {
        r2Enabled: config.storage?.r2?.enabled === true,
        hasBucket: !!env.VIDEOS_BUCKET,
        remoteUrl: config.storage?.remoteUrl,
        fallbackUrl: config.storage?.fallbackUrl,
        r2BucketName: env.VIDEOS_BUCKET ? 'defined' : 'undefined'
      },
      pathTransforms: config.storage?.pathTransforms ? 
        Object.keys(config.storage.pathTransforms) : [],
      timestamp: new Date().toISOString()
    },
    'VideoStorageService'
  );
  
  if (requestContext) {
    addBreadcrumb(requestContext, 'Error', 'Video not found in any storage location', {
      path,
      storageOptions: config.storage?.priority?.join(',') ?? '',
      severity: 'high'
    });
  }
  
  // Return a standardized error result
  return {
    response: new Response('Video not found', { status: 404 }),
    sourceType: 'error',
    contentType: null,
    size: null,
    error: new Error('Video not found in any storage location'),
    path: path
  };
}

/**
 * Fetch a video from any available storage source
 * Uses standardized error handling for consistent logging and robust error handling
 * 
 * @param path The path to the video
 * @param config The video resizer configuration
 * @param env The Cloudflare environment
 * @param request Optional request object
 * @returns A StorageResult object or an error response if not found
 */
export const fetchVideo = withErrorHandling<
  [string, VideoResizerConfig, EnvVariables, Request | undefined],
  Promise<StorageResult>
>(
  fetchVideoImpl,
  {
    functionName: 'fetchVideo',
    component: 'VideoStorageService',
    logErrors: true
  },
  {
    operation: 'fetch'
  }
);
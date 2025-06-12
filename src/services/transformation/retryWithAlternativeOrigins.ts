/**
 * Retry transformation with alternative origins after a 404 error
 * 
 * This module provides a clean approach to handle 404 errors from the CDN-CGI transformation
 * service by leveraging the Origins system's built-in failover capabilities.
 */

import { VideoTransformContext } from '../../domain/commands/TransformVideoCommand';
import { Origin, Source } from '../videoStorage/interfaces';
import { EnvVariables } from '../../config/environmentConfig';
import { VideoOptions } from '../videoStorage/interfaces';
import { RequestContext, addBreadcrumb } from '../../utils/requestContext';
import { createLogger } from '../../utils/pinoLogger';
import { logDebug } from '../errorHandler/logging';
import { logErrorWithContext } from '../../utils/errorHandlingUtils';
import { fetchVideoWithOrigins, FetchOptions } from '../videoStorage/fetchVideoWithOrigins';
import { VideoConfigurationManager } from '../../config/VideoConfigurationManager';
import { buildCdnCgiMediaUrl } from '../../utils/pathUtils';
import { TransformParams } from '../../domain/strategies/TransformationStrategy';
import { cacheResponse } from '../cacheManagementService';

export interface RetryOptions {
  originalRequest: Request;
  transformOptions: VideoOptions;
  failedOrigin: Origin;
  failedSource: Source;
  context: VideoTransformContext;
  env: EnvVariables;
  requestContext: RequestContext;
  pathPatterns?: any[];
  debugInfo?: any;
}

/**
 * Retry transformation with alternative origins after a 404 error
 * 
 * This function handles 404 errors from the CDN-CGI transformation service by:
 * 1. Excluding the failed source from the origin
 * 2. Using fetchVideoWithOrigins to try remaining sources
 * 3. If successful, transforming the result through CDN-CGI
 * 4. If the current origin fails completely, trying other matching origins
 * 
 * @param options Retry options including the failed source and transformation parameters
 * @returns Response with the transformed video or an error
 */
export async function retryWithAlternativeOrigins(options: RetryOptions): Promise<Response> {
  const { 
    originalRequest, 
    transformOptions, 
    failedOrigin, 
    failedSource, 
    context, 
    env,
    requestContext,
    pathPatterns = [],
    debugInfo = {}
  } = options;
  
  const logger = createLogger(requestContext);
  const url = new URL(originalRequest.url);
  const path = url.pathname;
  
  // Log the retry attempt
  logDebug('retryWithAlternativeOrigins', 'Starting retry after 404 error', {
    path,
    failedOrigin: failedOrigin.name,
    failedSource: failedSource.type,
    failedPriority: failedSource.priority,
    totalSources: failedOrigin.sources.length
  });
  
  addBreadcrumb(requestContext, 'Retry', 'Attempting alternative origins after 404', {
    failedOrigin: failedOrigin.name,
    failedSource: failedSource.type
  });
  
  // Get video configuration
  const videoConfigManager = VideoConfigurationManager.getInstance();
  const videoConfig = videoConfigManager.getConfig();
  
  // Create exclusion for the failed source
  const excludeSources = [{
    originName: failedOrigin.name,
    sourceType: failedSource.type,
    sourcePriority: failedSource.priority
  }];
  
  logDebug('retryWithAlternativeOrigins', 'Fetching video with exclusions', {
    path,
    excludedSource: `${failedOrigin.name}:${failedSource.type}`
  });
  
  try {
    // Try to fetch from alternative sources using the Origins system
    // This will automatically try remaining sources in the same origin,
    // and if all fail, try other matching origins
    const fetchOptions: FetchOptions = { excludeSources };
    const storageResult = await fetchVideoWithOrigins(
      path,
      videoConfig,
      env,
      originalRequest,
      fetchOptions
    );
    
    if (storageResult.sourceType === 'error' || !storageResult.response) {
      // All origins failed
      logDebug('retryWithAlternativeOrigins', 'All alternative origins failed', {
        path,
        error: storageResult.error?.message
      });
      
      addBreadcrumb(requestContext, 'Retry', 'All alternative origins exhausted', {
        error: storageResult.error?.message
      });
      
      // Return a 404 error indicating all origins were tried
      return new Response('Video not found in any configured origin', {
        status: 404,
        headers: {
          'Content-Type': 'text/plain',
          'Cache-Control': 'no-store',
          'X-All-Origins-Failed': 'true',
          'X-Failed-Origin': failedOrigin.name,
          'X-Failed-Source': failedSource.type,
          'X-Retry-Attempted': 'true'
        }
      });
    }
    
    // Success! We found the video in an alternative source
    logDebug('retryWithAlternativeOrigins', 'Found video in alternative source', {
      path,
      newSourceType: storageResult.sourceType,
      contentType: storageResult.contentType,
      size: storageResult.size
    });
    
    addBreadcrumb(requestContext, 'Retry', 'Alternative source successful', {
      sourceType: storageResult.sourceType,
      size: storageResult.size
    });
    
    // Now we need to transform the video through CDN-CGI
    // We need to construct the proper origin URL based on the successful source
    
    // Get all matching origins for this path to find which one succeeded
    const originsArray = Array.isArray(videoConfig.origins) 
      ? videoConfig.origins 
      : (videoConfig.origins?.items || []);
    
    const matchingOrigins = originsArray.filter((origin: Origin) => {
      try {
        const regex = new RegExp(origin.matcher);
        return regex.test(path);
      } catch {
        return false;
      }
    });
    
    // Find which origin/source combination succeeded
    let successfulOrigin: Origin | undefined;
    let successfulSource: Source | undefined;
    
    for (const origin of matchingOrigins) {
      for (const source of origin.sources) {
        // Check if this source was excluded
        const isExcluded = excludeSources.some(exc => 
          exc.originName === origin.name && 
          exc.sourceType === source.type &&
          (exc.sourcePriority === undefined || exc.sourcePriority === source.priority)
        );
        
        // If not excluded and matches the successful source type, this is likely our source
        if (!isExcluded && source.type === storageResult.sourceType) {
          successfulOrigin = origin;
          successfulSource = source;
          break;
        }
      }
      if (successfulSource) break;
    }
    
    if (!successfulOrigin || !successfulSource) {
      logDebug('retryWithAlternativeOrigins', 'Could not determine successful origin/source, returning direct response', {
        path,
        sourceType: storageResult.sourceType
      });
      
      // Add retry headers to the response
      const headers = new Headers(storageResult.response.headers);
      headers.set('X-Retry-Applied', 'true');
      headers.set('X-Failed-Origin', failedOrigin.name);
      headers.set('X-Failed-Source', failedSource.type);
      headers.set('X-Alternative-Source', storageResult.sourceType);
      headers.set('X-No-Transform', 'true');
      
      return new Response(storageResult.response.body, {
        status: storageResult.response.status,
        statusText: storageResult.response.statusText,
        headers
      });
    }
    
    // Construct the origin URL based on the source type
    let originUrl: string;
    
    if (successfulSource.type === 'r2') {
      // For R2, use the r2: protocol
      originUrl = `r2:${path}`;
    } else if ((successfulSource.type === 'remote' || successfulSource.type === 'fallback') && successfulSource.url) {
      // For remote/fallback, construct the full URL
      const baseUrl = successfulSource.url;
      // Apply path template if available
      const pathTemplate = (successfulSource as any).pathTemplate || '{path}';
      const resolvedPath = pathTemplate.replace('{path}', path);
      
      // Construct the full URL
      if (baseUrl.endsWith('/')) {
        originUrl = baseUrl + (resolvedPath.startsWith('/') ? resolvedPath.slice(1) : resolvedPath);
      } else {
        originUrl = baseUrl + (resolvedPath.startsWith('/') ? resolvedPath : '/' + resolvedPath);
      }
    } else {
      throw new Error(`Cannot construct origin URL for source type: ${successfulSource.type}`);
    }
    
    logDebug('retryWithAlternativeOrigins', 'Preparing transformation with alternative origin', {
      path,
      originUrl,
      sourceType: successfulSource.type,
      originName: successfulOrigin.name
    });
    
    try {
      // Build the CDN-CGI URL with the new origin
      // Convert VideoOptions to TransformParams
      const transformParams: TransformParams = {};
      
      // Copy only defined values with proper type handling
      if (transformOptions.width !== undefined) transformParams.width = transformOptions.width;
      if (transformOptions.height !== undefined) transformParams.height = transformOptions.height;
      if (transformOptions.quality !== undefined) transformParams.quality = transformOptions.quality;
      if (transformOptions.fit !== undefined) transformParams.fit = transformOptions.fit as string;
      if (transformOptions.gravity !== undefined) transformParams.gravity = transformOptions.gravity as string;
      if (transformOptions.format !== undefined) transformParams.format = transformOptions.format;
      if (transformOptions.acodec !== undefined) transformParams.acodec = transformOptions.acodec as string;
      if (transformOptions.vcodec !== undefined) transformParams.vcodec = transformOptions.vcodec as string;
      if (transformOptions.duration !== undefined) transformParams.duration = transformOptions.duration as string;
      if (transformOptions['start-time'] !== undefined) transformParams['start-time'] = transformOptions['start-time'] as string;
      
      const cdnCgiUrl = buildCdnCgiMediaUrl(
        transformParams,
        originUrl,
        originalRequest.url
      );
      
      logDebug('retryWithAlternativeOrigins', 'Attempting transformation with alternative origin', {
        cdnCgiUrl,
        originUrl,
        transformOptions
      });
      
      // Transform through CDN-CGI
      const transformedResponse = await cacheResponse(
        originalRequest,
        async () => fetch(cdnCgiUrl)
      );
      
      if (transformedResponse.ok) {
        logDebug('retryWithAlternativeOrigins', 'Transformation successful with alternative source', {
          status: transformedResponse.status,
          contentType: transformedResponse.headers.get('Content-Type'),
          originUrl,
          cdnCgiUrl
        });
        
        // Add retry success headers
        const headers = new Headers(transformedResponse.headers);
        headers.set('X-Retry-Applied', 'true');
        headers.set('X-Retry-Success', 'true');
        headers.set('X-Failed-Origin', failedOrigin.name);
        headers.set('X-Failed-Source', failedSource.type);
        headers.set('X-Alternative-Source', storageResult.sourceType);
        
        return new Response(transformedResponse.body, {
          status: transformedResponse.status,
          statusText: transformedResponse.statusText,
          headers
        });
      } else {
        // Transformation failed with alternative source
        logDebug('retryWithAlternativeOrigins', 'Transformation failed with alternative source', {
          status: transformedResponse.status,
          statusText: transformedResponse.statusText,
          originUrl
        });
        
        // Return the transformation error
        return transformedResponse;
      }
    } catch (transformError) {
      logErrorWithContext(
        'Error transforming with alternative source',
        transformError,
        { path, originUrl },
        'retryWithAlternativeOrigins'
      );
      
      // Return error response
      return new Response('Failed to transform video from alternative source', {
        status: 500,
        headers: {
          'Content-Type': 'text/plain',
          'Cache-Control': 'no-store',
          'X-Transform-Error': 'true',
          'X-Error-Message': transformError instanceof Error ? transformError.message : 'Unknown error'
        }
      });
    }
  } catch (error) {
    logErrorWithContext(
      'Error in retry with alternative origins',
      error,
      { path, failedOrigin: failedOrigin.name },
      'retryWithAlternativeOrigins'
    );
    
    // Return error response
    return new Response('Internal error during origin retry', {
      status: 500,
      headers: {
        'Content-Type': 'text/plain',
        'Cache-Control': 'no-store',
        'X-Retry-Error': 'true',
        'X-Error-Message': error instanceof Error ? error.message : 'Unknown error'
      }
    });
  }
}
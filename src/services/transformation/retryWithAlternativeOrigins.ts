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
import { prepareVideoTransformation } from '../TransformationService';
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
    // First, we need to prepare the transformation with the new source URL
    
    // Extract the source URL from the response if available
    let sourceUrl: string | undefined;
    if (storageResult.response.headers.get('X-Source-URL')) {
      sourceUrl = storageResult.response.headers.get('X-Source-URL') || undefined;
    }
    
    // If we don't have a source URL, we'll need to use the response directly
    // This is a limitation we'll need to handle
    if (!sourceUrl) {
      logDebug('retryWithAlternativeOrigins', 'No source URL available, returning direct response', {
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
    
    // Prepare transformation with the new source URL
    logDebug('retryWithAlternativeOrigins', 'Preparing transformation with alternative source', {
      path,
      sourceUrl: sourceUrl.substring(0, 50) + '...'
    });
    
    try {
      const transformResult = await prepareVideoTransformation(
        originalRequest,
        transformOptions,
        pathPatterns,
        debugInfo,
        env
      );
      
      const cdnCgiUrl = transformResult.cdnCgiUrl;
      
      logDebug('retryWithAlternativeOrigins', 'Attempting transformation with alternative source', {
        cdnCgiUrl: cdnCgiUrl.substring(0, 100) + '...'
      });
      
      // Transform through CDN-CGI
      const transformedResponse = await cacheResponse(
        originalRequest,
        async () => fetch(cdnCgiUrl)
      );
      
      if (transformedResponse.ok) {
        logDebug('retryWithAlternativeOrigins', 'Transformation successful with alternative source', {
          status: transformedResponse.status,
          contentType: transformedResponse.headers.get('Content-Type')
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
          statusText: transformedResponse.statusText
        });
        
        // Return the transformation error
        return transformedResponse;
      }
    } catch (transformError) {
      logErrorWithContext(
        'Error transforming with alternative source',
        transformError,
        { path, sourceUrl },
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
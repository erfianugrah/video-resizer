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
import { logDebug } from '../../utils/logger';
import { logErrorWithContext } from '../../utils/errorHandlingUtils';
import { fetchVideoWithOrigins, FetchOptions } from '../videoStorage/fetchVideoWithOrigins';
import { VideoConfigurationManager } from '../../config/VideoConfigurationManager';
import { buildCdnCgiMediaUrl } from '../../utils/pathUtils';
import { TransformParams, TransformParamValue } from '../../domain/strategies/TransformationStrategy';
import { cacheResponse } from '../cacheManagementService';
import { storeInKVCache, TransformOptions } from '../../utils/kvCacheUtils';
import { getCacheKV } from '../../utils/flexibleBindings';
import { CacheConfigurationManager } from '../../config/CacheConfigurationManager';

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
  const { originalRequest, transformOptions, failedOrigin, failedSource, env, requestContext } = options;
  
  const url = new URL(originalRequest.url);
  const path = url.pathname;
  
  logDebug('retryWithAlternativeOrigins', 'Starting retry after 404 error', {
    path,
    failedOrigin: failedOrigin.name,
    failedSource: failedSource.type,
    failedPriority: failedSource.priority,
    derivative: transformOptions.derivative,
    totalSources: failedOrigin.sources.length
  });
  
  // Add breadcrumb for retry attempt
  addBreadcrumb(requestContext, 'Retry', 'Attempting alternative origins after 404', {
    failedOrigin: failedOrigin.name,
    failedSource: failedSource.type,
    failedPriority: failedSource.priority,
    path,
    derivative: transformOptions.derivative
  });
  
  // Find the next available source
  // CRITICAL: Filter out r2 sources as they cannot be used with CDN-CGI transformations
  const availableSources = failedOrigin.sources
    .filter(s => s.type !== failedSource.type || s.priority !== failedSource.priority)
    .filter(s => s.type !== 'r2') // R2 uses special syntax that CDN-CGI cannot understand
    .sort((a, b) => a.priority - b.priority);
  
  logDebug('retryWithAlternativeOrigins', 'Available alternative sources', {
    count: availableSources.length,
    sources: availableSources.map(s => ({ type: s.type, priority: s.priority }))
  });
  
  const nextSource = availableSources[0];
  
  if (!nextSource) {
    addBreadcrumb(requestContext, 'Retry', 'No alternative sources available', {
      failedOrigin: failedOrigin.name,
      exhaustedSources: failedOrigin.sources.map(s => s.type)
    });
    
    return new Response('No alternative sources available', {
      status: 404,
      headers: {
        'Cache-Control': 'no-store',
        'X-All-Origins-Failed': 'true',
        'X-Failed-Origin': failedOrigin.name,
        'X-Exhausted-Sources': failedOrigin.sources.map(s => s.type).join(',')
      }
    });
  }
  
  // Build the new origin URL
  let newOriginUrl: string;
  try {
    // Since we filtered out r2 sources above, we should only have remote sources with URLs
    if (nextSource.url) {
      const pathTemplate = (nextSource as any).pathTemplate || '{path}';
      const resolvedPath = pathTemplate.replace('{path}', path).replace('{1}', path.split('/').pop() || '');
      newOriginUrl = new URL(resolvedPath, nextSource.url).toString();
      
      logDebug('retryWithAlternativeOrigins', 'Using remote URL as alternative', {
        sourceType: nextSource.type,
        baseUrl: nextSource.url,
        resolvedPath,
        newOriginUrl
      });
    } else {
      addBreadcrumb(requestContext, 'Retry', 'Failed to build alternative origin URL', {
        sourceType: nextSource.type,
        hasUrl: !!nextSource.url,
        source: JSON.stringify(nextSource)
      });
      
      return new Response('Cannot determine alternative origin URL', { 
        status: 500,
        headers: {
          'Cache-Control': 'no-store',
          'X-Error': 'InvalidAlternativeSource',
          'X-Source-Type': nextSource.type
        }
      });
    }
  } catch (error) {
    logDebug('retryWithAlternativeOrigins', 'Error building alternative origin URL', {
      error: error instanceof Error ? error.message : String(error),
      sourceType: nextSource.type,
      sourceUrl: nextSource.url
    });
    
    addBreadcrumb(requestContext, 'Retry', 'Exception building alternative origin URL', {
      error: error instanceof Error ? error.message : String(error),
      sourceType: nextSource.type
    });
    
    return new Response('Failed to construct alternative origin URL', { 
      status: 500,
      headers: {
        'Cache-Control': 'no-store',
        'X-Error': 'URLConstructionFailed',
        'X-Error-Message': error instanceof Error ? error.message : String(error)
      }
    });
  }
  
  // Build new CDN-CGI URL with ALL the original transform parameters
  const transformParams: TransformParams = {};
  Object.entries(transformOptions).forEach(([key, value]) => {
    if (value !== undefined && value !== null && key !== 'customData') {
      transformParams[key] = value as TransformParamValue;
    }
  });
  
  const cdnCgiUrl = buildCdnCgiMediaUrl(transformParams, newOriginUrl, originalRequest.url);
  
  logDebug('retryWithAlternativeOrigins', 'Retrying with alternative origin', {
    cdnCgiUrl,
    newOriginUrl,
    sourceType: nextSource.type,
    transformParams,
    derivative: transformParams.derivative
  });
  
  addBreadcrumb(requestContext, 'Retry', 'Attempting transformation with alternative source', {
    sourceType: nextSource.type,
    derivative: transformOptions.derivative,
    hasTransformParams: Object.keys(transformParams).length > 0
  });
  
  // Retry the transformation
  let response: Response;
  try {
    response = await fetch(cdnCgiUrl);
  } catch (fetchError) {
    logDebug('retryWithAlternativeOrigins', 'Fetch error during retry', {
      error: fetchError instanceof Error ? fetchError.message : String(fetchError),
      cdnCgiUrl,
      sourceType: nextSource.type
    });
    
    addBreadcrumb(requestContext, 'Retry', 'Fetch failed for alternative source', {
      error: fetchError instanceof Error ? fetchError.message : String(fetchError),
      sourceType: nextSource.type
    });
    
    return new Response('Failed to fetch from alternative source', {
      status: 502,
      headers: {
        'Cache-Control': 'no-store',
        'X-Error': 'AlternativeFetchFailed',
        'X-Alternative-Source': nextSource.type,
        'X-Error-Message': fetchError instanceof Error ? fetchError.message : String(fetchError)
      }
    });
  }
  
  logDebug('retryWithAlternativeOrigins', 'Alternative source response received', {
    status: response.status,
    ok: response.ok,
    sourceType: nextSource.type,
    contentType: response.headers.get('Content-Type'),
    contentLength: response.headers.get('Content-Length')
  });
  
  if (response.ok) {
    // Clone the response to avoid body consumption issues
    const responseClone = response.clone();
    
    addBreadcrumb(requestContext, 'Retry', 'Alternative source succeeded', {
      sourceType: nextSource.type,
      status: response.status,
      contentType: response.headers.get('Content-Type'),
      contentLength: response.headers.get('Content-Length'),
      derivative: transformOptions.derivative
    });
    
    // Add headers to indicate retry was successful
    const headers = new Headers(response.headers);
    headers.set('X-Retry-Applied', 'true');
    headers.set('X-Alternative-Source', nextSource.type);
    headers.set('X-Failed-Source', failedSource.type);
    headers.set('X-Failed-Origin', failedOrigin.name);
    
    const finalResponse = new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers
    });
    
    // Store in KV if enabled
    const cacheConfig = CacheConfigurationManager.getInstance();
    if (cacheConfig.isKVCacheEnabled() && (env as any).executionCtx?.waitUntil) {
      logDebug('retryWithAlternativeOrigins', 'Storing successful retry in KV cache', {
        path,
        derivative: transformOptions.derivative,
        sourceType: nextSource.type
      });
      
      (env as any).executionCtx.waitUntil(
        storeInKVCache(env, path, responseClone, transformOptions as TransformOptions)
          .then(stored => {
            if (stored) {
              logDebug('retryWithAlternativeOrigins', 'Successfully stored retry response in KV', {
                path,
                derivative: transformOptions.derivative
              });
            }
          })
          .catch(err => {
            logDebug('retryWithAlternativeOrigins', 'Failed to store retry response in KV', {
              error: err instanceof Error ? err.message : String(err),
              path
            });
          })
      );
    }
    
    return finalResponse;
  }
  
  // Alternative source also returned an error
  addBreadcrumb(requestContext, 'Retry', 'Alternative source failed', {
    sourceType: nextSource.type,
    status: response.status,
    statusText: response.statusText
  });
  
  // Add headers to indicate what was attempted
  const enhancedHeaders = new Headers(response.headers);
  enhancedHeaders.set('X-Retry-Attempted', 'true');
  enhancedHeaders.set('X-Alternative-Source', nextSource.type);
  enhancedHeaders.set('X-Failed-Source', failedSource.type);
  enhancedHeaders.set('X-Failed-Origin', failedOrigin.name);
  
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: enhancedHeaders
  });
}
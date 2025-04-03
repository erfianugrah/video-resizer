/**
 * Storage utilities for the video resizer worker
 * 
 * This module provides functions for retrieving videos from different storage sources
 * including R2 buckets, remote URLs, and fallback URLs.
 */

import { CacheConfigurationManager } from '../config';
import { EnvVariables } from '../config/environmentConfig';
import { createLogger, debug as pinoDebug, error as pinoError } from '../utils/pinoLogger';
import { getCurrentContext } from '../utils/legacyLoggerAdapter';
import { addBreadcrumb } from '../utils/requestContext';
import { 
  logErrorWithContext, 
  withErrorHandling, 
  tryOrNull, 
  tryOrDefault 
} from '../utils/errorHandlingUtils';

/**
 * Helper functions for consistent logging throughout this file
 * These helpers handle context availability and fallback gracefully
 */

/**
 * Log a debug message with proper context handling
 */
function logDebug(category: string, message: string, data?: Record<string, unknown>) {
  const requestContext = getCurrentContext();
  if (requestContext) {
    const logger = createLogger(requestContext);
    pinoDebug(requestContext, logger, category, message, data);
  } else {
    // Fall back to console as a last resort
    console.debug(`[${category}] ${message}`, data || {});
  }
}

// Type definitions for configuration objects
interface CacheTTLConfig {
  ok?: number;
  error?: number;
  redirect?: number;
  default?: number;
}

interface CacheConfig {
  ttl?: CacheTTLConfig;
  enableCacheTags?: boolean;
  bypassQueryParameters?: string[];
}

// Type for auth configuration
interface AuthConfig {
  enabled: boolean;
  type: string;
  accessKeyVar?: string;
  secretKeyVar?: string;
  region?: string;
  service?: string;
  headers?: Record<string, string>;
}

interface FetchOptions {
  userAgent?: string;
  headers?: Record<string, unknown>;
}

interface StorageAuthConfig {
  useOriginAuth?: boolean;
  securityLevel?: 'strict' | 'permissive';
  cacheTtl?: number;
}

interface R2Config {
  enabled?: boolean;
}

interface StorageConfig {
  priority?: string[];
  r2?: R2Config;
  remoteUrl?: string;
  fallbackUrl?: string;
  remoteAuth?: AuthConfig;
  fallbackAuth?: AuthConfig;
  auth?: StorageAuthConfig;
  fetchOptions?: FetchOptions;
}

interface PathTransformOriginConfig {
  removePrefix?: boolean;
  prefix?: string;
}

interface PathTransformSegmentConfig extends PathTransformOriginConfig {
  [originType: string]: PathTransformOriginConfig | boolean | string | undefined;
}

interface PathTransformConfig {
  [key: string]: PathTransformSegmentConfig;
}

interface VideoResizerConfig {
  storage?: StorageConfig;
  cache?: CacheConfig;
  pathTransforms?: PathTransformConfig;
}

/**
 * Result of a storage operation
 */
export interface StorageResult {
  response: Response;
  sourceType: 'r2' | 'remote' | 'fallback' | 'error';
  contentType: string | null;
  size: number | null;
  originalUrl?: string;
  error?: Error;
  path?: string;
  width?: number;
  height?: number;
  duration?: number;
}

/**
 * Implementation of path transformation that might throw errors
 */
function applyPathTransformationImpl(
  path: string,
  config: VideoResizerConfig,
  originType: 'r2' | 'remote' | 'fallback'
): string {
  // Skip if no pathTransforms in config
  if (!config.pathTransforms || typeof config.pathTransforms !== 'object') {
    return path;
  }
  
  // Normalize path by removing leading slash
  let normalizedPath = path.startsWith('/') ? path.substring(1) : path;
  
  // Get the original path segments to check for transforms
  const segments = path.split('/').filter(Boolean);
  
  // Check if any segment has a transform configuration
  for (const segment of segments) {
    const pathTransforms = config.pathTransforms;
    if (pathTransforms[segment] && typeof pathTransforms[segment] === 'object') {
      const transform = pathTransforms[segment];
      
      // Check for origin-specific transforms first, fall back to generic transform
      const originSpecificTransform = transform[originType];
      const originTransform = (
        originSpecificTransform && typeof originSpecificTransform === 'object' 
          ? originSpecificTransform 
          : transform
      ) as PathTransformOriginConfig;
      
      // If this segment should be removed and replaced with a prefix
      if (originTransform.removePrefix && originTransform.prefix !== undefined) {
        // Create a new path with the proper prefix and without the matched segment
        const pathWithoutSegment = segments
          .filter(s => s !== segment) // Remove the segment
          .join('/');
          
        // Apply the new prefix
        normalizedPath = String(originTransform.prefix) + pathWithoutSegment;
        
        // Use our helper to log with proper context handling
        logDebug('VideoStorageService', 'Applied path transformation', {
          segment,
          originalPath: path,
          transformed: normalizedPath
        });
        
        break; // Only apply one transformation
      }
    }
  }
  
  return normalizedPath;
}

/**
 * Apply path transformations for any origin type
 * This helper function is used to transform paths based on origin type
 * Uses standardized error handling to safely transform paths
 */
function applyPathTransformation(
  path: string,
  config: VideoResizerConfig,
  originType: 'r2' | 'remote' | 'fallback'
): string {
  try {
    return applyPathTransformationImpl(path, config, originType);
  } catch (err) {
    // Log with standardized error handling
    logErrorWithContext(
      `Error transforming path for ${originType}`,
      err,
      {
        path,
        originType,
        hasPathTransforms: !!config?.pathTransforms
      },
      'VideoStorageService'
    );
    
    // Return original path as fallback
    return path;
  }
}

/**
 * Implementation of fetchFromR2 that might throw errors
 */
async function fetchFromR2Impl(
  path: string, 
  bucket: R2Bucket,
  request?: Request,
  config?: VideoResizerConfig
): Promise<StorageResult | null> {
  // Normalize the path by removing leading slashes
  const normalizedPath = path.replace(/^\/+/, '');
  
  // Handle conditional requests if we have a request object
  if (request) {
    const ifNoneMatch = request.headers.get('If-None-Match');
    const ifModifiedSince = request.headers.get('If-Modified-Since');
    
    // Check for conditional request options
    const options: R2GetOptions = {};
    
    if (ifNoneMatch) {
      options.onlyIf = { etagDoesNotMatch: ifNoneMatch };
    } else if (ifModifiedSince) {
      const ifModifiedSinceDate = new Date(ifModifiedSince);
      if (!isNaN(ifModifiedSinceDate.getTime())) {
        options.onlyIf = { uploadedAfter: ifModifiedSinceDate };
      }
    }
    
    // Handle range requests
    const rangeHeader = request.headers.get('Range');
    if (rangeHeader && rangeHeader.startsWith('bytes=')) {
      try {
        const rangeValue = rangeHeader.substring(6);
        const [start, end] = rangeValue.split('-').map(v => parseInt(v, 10));
        
        if (!isNaN(start)) {
          const range: R2Range = { offset: start };
          
          if (!isNaN(end)) {
            range.length = end - start + 1;
          }
          
          options.range = range;
        }
      } catch (err) {
        // Invalid range header, ignore but still log it
        logDebug('VideoStorageService', 'Invalid range header', { rangeHeader });
      }
    }
    
    // Attempt to get the object from R2 with options
    const object = await bucket.get(normalizedPath, options);
    
    // Handle 304 Not Modified
    if (object === null && (ifNoneMatch || ifModifiedSince)) {
      return {
        response: new Response(null, { status: 304 }),
        sourceType: 'r2',
        contentType: null,
        size: 0
      };
    }
    
    if (!object) {
      return null;
    }
    
    // Create headers using R2 object's writeHttpMetadata
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    
    // Add additional headers
    // Get cache TTL with proper type narrowing
    const cacheTTL = config?.cache?.ttl?.ok ?? 86400;
    headers.set('Cache-Control', `public, max-age=${cacheTTL}`);
    headers.set('Accept-Ranges', 'bytes');
    
    // The Range response
    let status = 200;
    if (options.range && 'offset' in options.range) {
      status = 206;
      const offset = options.range.offset || 0;
      const length = options.range.length || 0;
      const end = offset + length - 1;
      const total = object.size;
      headers.set('Content-Range', `bytes ${offset}-${end}/${total}`);
    }
    
    // Return a successful result with the object details
    return {
      response: new Response(object.body, {
        headers,
        status
      }),
      sourceType: 'r2',
      contentType: object.httpMetadata?.contentType || null,
      size: object.size,
      path: normalizedPath
    };
  } else {
    // Simple case - no request object
    const object = await bucket.get(normalizedPath);
    
    if (!object) {
      return null;
    }
    
    // Create headers using R2 object's writeHttpMetadata
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    
    // Add additional headers with proper type narrowing
    const cacheTTL = config?.cache?.ttl?.ok ?? 86400;
    headers.set('Cache-Control', `public, max-age=${cacheTTL}`);
    headers.set('Accept-Ranges', 'bytes');
    
    // Return a successful result with the object details
    return {
      response: new Response(object.body, { headers }),
      sourceType: 'r2',
      contentType: object.httpMetadata?.contentType || null,
      size: object.size,
      path: normalizedPath
    };
  }
}

/**
 * Fetch a video from R2 storage
 * Uses standardized error handling for consistent logging and error normalization
 */
const fetchFromR2 = withErrorHandling<
  [string, R2Bucket, Request | undefined, VideoResizerConfig | undefined],
  Promise<StorageResult | null>
>(
  fetchFromR2Impl,
  {
    functionName: 'fetchFromR2',
    component: 'VideoStorageService',
    logErrors: true
  },
  {
    storageType: 'r2'
  }
);

/**
 * Implementation of fetchFromRemote that might throw errors
 */
async function fetchFromRemoteImpl(
  path: string, 
  baseUrl: string,
  config: VideoResizerConfig,
  env: EnvVariables
): Promise<StorageResult | null> {
  // Get the current request context if available
  const requestContext = getCurrentContext();
  
  // Build fetch options from config with proper type safety
  const fetchOptions: RequestInit & { cf?: Record<string, unknown> } = {
    cf: {
      cacheTtl: config?.cache?.ttl?.ok ?? 3600,
      cacheEverything: true,
    },
    headers: {
      'User-Agent': config?.storage?.fetchOptions?.userAgent ?? 'Cloudflare-Video-Resizer/1.0',
    },
  };
  
  // Add any additional headers from config if they exist
  if (config?.storage?.fetchOptions?.headers) {
    Object.entries(config.storage.fetchOptions.headers).forEach(([key, value]) => {
      if (fetchOptions.headers && typeof fetchOptions.headers === 'object') {
        // Add the headers from config
        (fetchOptions.headers as Record<string, string>)[key] = String(value);
      }
    });
  }
  
  // Apply path transformations for remote URLs
  const transformedPath = applyPathTransformation(path, config, 'remote');
  
  // Use our helper function for consistent logging
  logDebug('VideoStorageService', 'Remote path after transformation', { 
    originalPath: path, 
    transformedPath 
  });
  
  // Check if authentication is required for this origin
  // Set the base URL
  const finalUrl = new URL(transformedPath, baseUrl).toString();
  
  // Check if remote auth is enabled specifically for this remote URL
  if (config?.storage?.remoteAuth?.enabled) {
    // Use our helper function for consistent logging
    logDebug('VideoStorageService', 'Remote auth enabled', {
      type: config.storage.remoteAuth.type,
      url: finalUrl
    });
    
    const remoteAuth = config.storage.remoteAuth;
    
    // Handle different auth types
    if (remoteAuth.type === 'aws-s3') {
      // Check if we're using origin-auth
      if (config.storage?.auth?.useOriginAuth) {
        // With origin-auth, we sign the headers and let Cloudflare pass them through
        // Create an AWS-compatible signer
        const accessKeyVar = remoteAuth.accessKeyVar ?? 'AWS_ACCESS_KEY_ID';
        const secretKeyVar = remoteAuth.secretKeyVar ?? 'AWS_SECRET_ACCESS_KEY';
        
        // Access environment variables
        const envRecord = env as unknown as Record<string, string | undefined>;
        
        const accessKey = envRecord[accessKeyVar] as string;
        const secretKey = envRecord[secretKeyVar] as string;
        
        if (accessKey && secretKey) {
          try {
            // Import AwsClient
            const { AwsClient } = await import('aws4fetch');
            
            // Setup AWS client
            const aws = new AwsClient({
              accessKeyId: accessKey,
              secretAccessKey: secretKey,
              service: remoteAuth.service ?? 's3',
              region: remoteAuth.region ?? 'us-east-1'
            });
            
            // Create a request to sign
            const signRequest = new Request(finalUrl, {
              method: 'GET'
            });
            
            // Sign the request
            const signedRequest = await aws.sign(signRequest);
            
            // Extract the headers and add them to fetch options
            signedRequest.headers.forEach((value, key) => {
              // Only include AWS specific headers
              if (key.startsWith('x-amz-') || key === 'authorization') {
                if (fetchOptions.headers && typeof fetchOptions.headers === 'object') {
                  (fetchOptions.headers as Record<string, string>)[key] = value;
                }
              }
            });
            
            // Use our helper function for consistent logging
            logDebug('VideoStorageService', 'Added AWS signed headers', {
              url: finalUrl,
              headerCount: Object.keys(fetchOptions.headers || {}).length
            });
          } catch (err) {
            // Log error with standardized error handling
            logErrorWithContext(
              'Error signing AWS request',
              err,
              {
                url: finalUrl,
                accessKeyVar,
                secretKeyVar
              },
              'VideoStorageService'
            );
            
            // Continue without authentication if in permissive mode
            if (config.storage.auth?.securityLevel !== 'permissive') {
              return null;
            }
          }
        } else {
          // Log error with standardized error handling
          logErrorWithContext(
            'AWS credentials not found',
            new Error('Missing credentials'),
            {
              accessKeyVar,
              secretKeyVar
            },
            'VideoStorageService'
          );
          
          // Continue without authentication if in permissive mode
          if (config.storage.auth?.securityLevel !== 'permissive') {
            return null;
          }
        }
      } else {
        // Use our helper function for consistent logging
        logDebug('VideoStorageService', 'AWS S3 auth requires origin-auth to be enabled', {
          url: finalUrl
        });
      }
    } else if (remoteAuth.type === 'bearer') {
      // Implement bearer token auth
      if (remoteAuth.headers && 'Authorization' in remoteAuth.headers) {
        if (fetchOptions.headers && typeof fetchOptions.headers === 'object') {
          (fetchOptions.headers as Record<string, string>)['Authorization'] = 
            remoteAuth.headers['Authorization'];
        }
      }
    } else if (remoteAuth.type === 'header') {
      // Add custom headers
      if (remoteAuth.headers) {
        Object.entries(remoteAuth.headers).forEach(([key, value]) => {
          if (fetchOptions.headers && typeof fetchOptions.headers === 'object') {
            (fetchOptions.headers as Record<string, string>)[key] = value;
          }
        });
      }
    }
    
    // Set cache TTL for authenticated requests
    if (config.storage.auth?.cacheTtl && fetchOptions.cf) {
      fetchOptions.cf.cacheTtl = config.storage.auth.cacheTtl;
    }
  } else {
    // Use our helper function for consistent logging
    logDebug('VideoStorageService', 'Remote auth not enabled for this URL', {
      url: finalUrl
    });
  }
  
  // Fetch the video from the remote URL
  logDebug('VideoStorageService', 'Fetching from remote URL', { url: finalUrl });
  
  const response = await fetch(finalUrl, fetchOptions);
  
  if (!response.ok) {
    logDebug('VideoStorageService', 'Remote fetch failed', { 
      url: finalUrl, 
      status: response.status, 
      statusText: response.statusText 
    });
    return null;
  }
  
  // Clone the response to ensure we can access its body multiple times
  const clonedResponse = response.clone();
  
  return {
    response: clonedResponse,
    sourceType: 'remote',
    contentType: response.headers.get('Content-Type'),
    size: parseInt(response.headers.get('Content-Length') || '0', 10) || null,
    originalUrl: finalUrl,
    path: transformedPath
  };
}

/**
 * Fetch a video from a remote URL
 * Uses standardized error handling for consistent logging and error propagation
 */
const fetchFromRemote = withErrorHandling<
  [string, string, VideoResizerConfig, EnvVariables],
  Promise<StorageResult | null>
>(
  fetchFromRemoteImpl,
  {
    functionName: 'fetchFromRemote',
    component: 'VideoStorageService',
    logErrors: true
  },
  {
    storageType: 'remote'
  }
);

/**
 * Implementation of fetchFromFallback that might throw errors
 */
async function fetchFromFallbackImpl(
  path: string, 
  fallbackUrl: string,
  config: VideoResizerConfig,
  env: EnvVariables
): Promise<StorageResult | null> {
  // Get the current request context if available
  const requestContext = getCurrentContext();
  
  // Build fetch options from config with proper type safety
  const fetchOptions: RequestInit & { cf?: Record<string, unknown> } = {
    cf: {
      cacheTtl: config?.cache?.ttl?.ok ?? 3600,
      cacheEverything: true,
    },
    headers: {
      'User-Agent': config?.storage?.fetchOptions?.userAgent ?? 'Cloudflare-Video-Resizer/1.0',
    },
  };
  
  // Add any additional headers from config if they exist
  if (config?.storage?.fetchOptions?.headers) {
    Object.entries(config.storage.fetchOptions.headers).forEach(([key, value]) => {
      if (fetchOptions.headers && typeof fetchOptions.headers === 'object') {
        // Add the headers from config
        (fetchOptions.headers as Record<string, string>)[key] = String(value);
      }
    });
  }
  
  // Apply path transformations for fallback URLs
  const transformedPath = applyPathTransformation(path, config, 'fallback');
  
  logDebug('VideoStorageService', 'Fallback path after transformation', { 
    originalPath: path, 
    transformedPath 
  });
  
  // Set the base URL
  const finalUrl = new URL(transformedPath, fallbackUrl).toString();
  
  // Check if fallback auth is enabled specifically for this URL
  if (config?.storage?.fallbackAuth?.enabled) {
    logDebug('VideoStorageService', 'Fallback auth enabled', {
      type: config.storage.fallbackAuth.type,
      url: finalUrl
    });
    
    const fallbackAuth = config.storage.fallbackAuth;
    
    // Handle different auth types
    if (fallbackAuth.type === 'aws-s3') {
      // Check if we're using origin-auth
      if (config.storage?.auth?.useOriginAuth) {
        // With origin-auth, we sign the headers and let Cloudflare pass them through
        // Create an AWS-compatible signer
        const accessKeyVar = fallbackAuth.accessKeyVar ?? 'AWS_ACCESS_KEY_ID';
        const secretKeyVar = fallbackAuth.secretKeyVar ?? 'AWS_SECRET_ACCESS_KEY';
        
        // Access environment variables
        const envRecord = env as unknown as Record<string, string | undefined>;
        
        const accessKey = envRecord[accessKeyVar] as string;
        const secretKey = envRecord[secretKeyVar] as string;
        
        if (accessKey && secretKey) {
          try {
            // Import AwsClient
            const { AwsClient } = await import('aws4fetch');
            
            // Setup AWS client
            const aws = new AwsClient({
              accessKeyId: accessKey,
              secretAccessKey: secretKey,
              service: fallbackAuth.service ?? 's3',
              region: fallbackAuth.region ?? 'us-east-1'
            });
            
            // Create a request to sign
            const signRequest = new Request(finalUrl, {
              method: 'GET'
            });
            
            // Sign the request
            const signedRequest = await aws.sign(signRequest);
            
            // Extract the headers and add them to fetch options
            signedRequest.headers.forEach((value, key) => {
              // Only include AWS specific headers
              if (key.startsWith('x-amz-') || key === 'authorization') {
                if (fetchOptions.headers && typeof fetchOptions.headers === 'object') {
                  (fetchOptions.headers as Record<string, string>)[key] = value;
                }
              }
            });
            
            logDebug('VideoStorageService', 'Added AWS signed headers for fallback', {
              url: finalUrl,
              headerCount: Object.keys(fetchOptions.headers || {}).length
            });
          } catch (err) {
            // Log error with standardized error handling
            logErrorWithContext(
              'Error signing AWS request for fallback',
              err,
              {
                url: finalUrl,
                accessKeyVar,
                secretKeyVar
              },
              'VideoStorageService'
            );
            
            // Continue without authentication if in permissive mode
            if (config.storage.auth?.securityLevel !== 'permissive') {
              return null;
            }
          }
        } else {
          // Log error with standardized error handling
          logErrorWithContext(
            'AWS credentials not found for fallback',
            new Error('Missing credentials'),
            {
              accessKeyVar,
              secretKeyVar
            },
            'VideoStorageService'
          );
          
          // Continue without authentication if in permissive mode
          if (config.storage.auth?.securityLevel !== 'permissive') {
            return null;
          }
        }
      }
    } else if (fallbackAuth.type === 'bearer') {
      // Implement bearer token auth
      if (fallbackAuth.headers && 'Authorization' in fallbackAuth.headers) {
        if (fetchOptions.headers && typeof fetchOptions.headers === 'object') {
          (fetchOptions.headers as Record<string, string>)['Authorization'] = 
            fallbackAuth.headers['Authorization'];
        }
      }
    } else if (fallbackAuth.type === 'header') {
      // Add custom headers
      if (fallbackAuth.headers) {
        Object.entries(fallbackAuth.headers).forEach(([key, value]) => {
          if (fetchOptions.headers && typeof fetchOptions.headers === 'object') {
            (fetchOptions.headers as Record<string, string>)[key] = value;
          }
        });
      }
    }
    
    // Set cache TTL for authenticated requests
    if (config.storage.auth?.cacheTtl && fetchOptions.cf) {
      fetchOptions.cf.cacheTtl = config.storage.auth.cacheTtl;
    }
  } else {
    logDebug('VideoStorageService', 'Fallback auth not enabled for this URL', {
      url: finalUrl
    });
  }
  
  // Fetch the video from the fallback URL
  logDebug('VideoStorageService', 'Fetching from fallback URL', { url: finalUrl });
  
  const response = await fetch(finalUrl, fetchOptions);
  
  if (!response.ok) {
    logDebug('VideoStorageService', 'Fallback fetch failed', { 
      url: finalUrl, 
      status: response.status, 
      statusText: response.statusText 
    });
    return null;
  }
  
  // Clone the response to ensure we can access its body multiple times
  const clonedResponse = response.clone();
  
  return {
    response: clonedResponse,
    sourceType: 'fallback',
    contentType: response.headers.get('Content-Type'),
    size: parseInt(response.headers.get('Content-Length') || '0', 10) || null,
    originalUrl: finalUrl,
    path: transformedPath
  };
}

/**
 * Fetch a video from a fallback URL
 * Uses standardized error handling for consistent logging and error propagation
 */
const fetchFromFallback = withErrorHandling<
  [string, string, VideoResizerConfig, EnvVariables],
  Promise<StorageResult | null>
>(
  fetchFromFallbackImpl,
  {
    functionName: 'fetchFromFallback',
    component: 'VideoStorageService',
    logErrors: true
  },
  {
    storageType: 'fallback'
  }
);

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
      logDebug('VideoStorageService', 'Trying remote URL', { 
        path, 
        remoteUrl: config.storage.remoteUrl 
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
      logDebug('VideoStorageService', 'Trying fallback URL', { 
        path, 
        fallbackUrl: config.storage.fallbackUrl 
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
  
  // Log detailed error information
  logErrorWithContext(
    'Video not found in any storage location',
    new Error('Video not found'),
    { 
      path, 
      requestId,
      elapsedMs: elapsedTime,
      storageOptions: config.storage?.priority ?? [],
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

/**
 * Implementation of shouldBypassCache that might throw errors
 * @param request - The incoming request
 * @returns Boolean indicating whether the cache should be bypassed
 */
function shouldBypassCacheImpl(request: Request): boolean {
  // Check for cache-control header
  const cacheControl = request.headers.get('Cache-Control');
  if (cacheControl && (cacheControl.includes('no-cache') || cacheControl.includes('no-store'))) {
    return true;
  }
  
  // Check for cache bypass in query params using centralized configuration
  const url = new URL(request.url);
  
  // Use the centralized shouldBypassCache method from CacheConfigurationManager
  // This only checks for specific bypass parameters, not all query parameters
  const cacheConfig = CacheConfigurationManager.getInstance();
  return cacheConfig.shouldBypassCache(url);
}

/**
 * Determine if a response should bypass cache based on configuration and request
 * Uses standardized error handling for consistent logging and to ensure a safe default
 * 
 * @param request - The incoming request
 * @returns Boolean indicating whether the cache should be bypassed
 */
export const shouldBypassCache = tryOrDefault<[Request], boolean>(
  shouldBypassCacheImpl,
  {
    functionName: 'shouldBypassCache',
    component: 'VideoStorageService',
    logErrors: true
  },
  false // Default to not bypassing cache if there's an error determining status
);

/**
 * Interface for video options
 */
interface VideoOptions {
  mode?: string | null;
  derivative?: string | null;
  format?: string | null;
  width?: number | null;
  height?: number | null;
  quality?: string | null;
  compression?: string | null;
  time?: string | null;
  columns?: number | null;
  rows?: number | null;
  interval?: string | null;
  [key: string]: unknown;
}

/**
 * Implementation of generateCacheTags that might throw errors
 * @param videoPath - The path to the video
 * @param options - Video options (quality, format, etc.)
 * @param headers - Response headers for additional metadata
 * @returns Array of cache tags
 */
function generateCacheTagsImpl(
  videoPath: string,
  options: VideoOptions,
  headers?: Headers
): string[] {
  // Get the cache configuration manager
  const cacheConfig = CacheConfigurationManager.getInstance();
  
  // If cache tags are disabled, return empty array
  if (!cacheConfig.getConfig().enableCacheTags) {
    logDebug('VideoStorageService', 'Cache tags are disabled');
    return [];
  }
  
  const startTime = Date.now();
  const tags: string[] = [];
  const prefix = 'video-';
  
  // Add base tag for the video path (normalized to avoid special chars)
  const leadingSlashPattern = '^\/+';
  const invalidCharsPattern = '[^a-zA-Z0-9-_/.]';
  const replacementChar = '-';
  
  logDebug('VideoStorageService', 'Generating cache tags', {
    videoPath,
    hasOptions: !!options,
    hasHeaders: !!headers
  });
  
  // Normalize path to create safe tags
  const normalizedPath = videoPath
    .replace(new RegExp(leadingSlashPattern), '') // Remove leading slashes
    .replace(new RegExp(invalidCharsPattern, 'g'), replacementChar) // Replace special chars
    .split('/')
    .filter(Boolean);
  
  // Add a tag for the full path
  tags.push(`${prefix}path-${normalizedPath.join('-').replace(/\./g, '-')}`);
  
  // Add tags for each path segment
  normalizedPath.forEach((segment, index) => {
    // Only add segment tags if there are multiple segments
    if (normalizedPath.length > 1) {
      tags.push(`${prefix}segment-${index}-${segment.replace(/\./g, '-')}`);
    }
  });
  
  // Add a tag for the derivative if available
  if (options.derivative) {
    tags.push(`${prefix}derivative-${options.derivative}`);
  }
  
  // Add a tag for video format if available
  if (options.format) {
    tags.push(`${prefix}format-${options.format}`);
  }
  
  // Add mode-specific tags
  if (options.mode) {
    tags.push(`${prefix}mode-${options.mode}`);
    
    // Add frame-specific tags
    if (options.mode === 'frame' && options.time) {
      tags.push(`${prefix}time-${options.time.replace('s', '')}`);
    }
    
    // Add spritesheet-specific tags
    if (options.mode === 'spritesheet') {
      if (options.columns) tags.push(`${prefix}columns-${options.columns}`);
      if (options.rows) tags.push(`${prefix}rows-${options.rows}`);
      if (options.interval) tags.push(`${prefix}interval-${options.interval.replace('s', '')}`);
    }
  }
  
  // Add tags for dimensions if available
  if (options.width) {
    tags.push(`${prefix}width-${options.width}`);
  }
  
  if (options.height) {
    tags.push(`${prefix}height-${options.height}`);
  }
  
  // Add combined dimensions tag if both width and height are specified
  if (options.width && options.height) {
    tags.push(`${prefix}dimensions-${options.width}x${options.height}`);
  }
  
  // Add IMQuery-specific tags if present
  if (options.customData && typeof options.customData === 'object') {
    const customData = options.customData as Record<string, unknown>;
    
    if (customData.imwidth) {
      tags.push(`${prefix}imwidth-${customData.imwidth}`);
    }
    
    if (customData.imheight) {
      tags.push(`${prefix}imheight-${customData.imheight}`);
    }
    
    // Add a tag to identify IMQuery sourced transformations
    if (customData.imwidth || customData.imheight) {
      tags.push(`${prefix}source-imquery`);
    }
  }
  
  // Add a tag for quality if available
  if (options.quality) {
    tags.push(`${prefix}quality-${options.quality}`);
  }
  
  // Add a tag for compression if available
  if (options.compression) {
    tags.push(`${prefix}compression-${options.compression}`);
  }
  
  // Add tags for content type from headers if available
  if (headers && headers.get('Content-Type')) {
    const contentType = headers.get('Content-Type') || '';
    const [mainType, fullSubType] = contentType.split('/');
    const subType = fullSubType?.split(';')[0]; // Remove parameters
    
    if (mainType) {
      tags.push(`${prefix}type-${mainType}`);
    }
    
    if (subType) {
      tags.push(`${prefix}subtype-${subType}`);
    }
  }
  
  // Calculate processing time
  const endTime = Date.now();
  
  logDebug('VideoStorageService', 'Generated cache tags', {
    tagCount: tags.length,
    generationTime: endTime - startTime
  });
  
  return tags;
}

/**
 * Generate cache tags for a video resource
 * Uses standardized error handling to ensure consistent error logging and fallback behavior
 * 
 * @param videoPath - The path to the video
 * @param options - Video options (quality, format, etc.)
 * @param headers - Response headers for additional metadata
 * @returns Array of cache tags, or empty array on error
 */
export const generateCacheTags = tryOrDefault<
  [string, VideoOptions, Headers | undefined],
  string[]
>(
  generateCacheTagsImpl,
  {
    functionName: 'generateCacheTags',
    component: 'VideoStorageService',
    logErrors: true
  },
  [] // Default to empty array if tag generation fails
);
/**
 * Storage utilities for the video resizer worker
 * 
 * This module provides functions for retrieving videos from different storage sources
 * including R2 buckets, remote URLs, and fallback URLs.
 */

import { debug, error } from '../utils/loggerUtils';
import { CacheConfigurationManager } from '../config';
import { EnvVariables } from '../config/environmentConfig';

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
 * Apply path transformations for any origin type
 * This helper function is used to transform paths based on origin type
 */
function applyPathTransformation(
  path: string,
  config: any,
  originType: 'r2' | 'remote' | 'fallback'
): string {
  // Skip if no pathTransforms in config
  if (!config.pathTransforms) {
    return path;
  }
  
  // Normalize path by removing leading slash
  let normalizedPath = path.startsWith('/') ? path.substring(1) : path;
  
  // Get the original path segments to check for transforms
  const segments = path.split('/').filter(Boolean);
  
  // Check if any segment has a transform configuration
  for (const segment of segments) {
    if (config.pathTransforms[segment]) {
      const transform = config.pathTransforms[segment];
      
      // Check for origin-specific transforms first, fall back to generic transform
      const originTransform = transform[originType] || transform;
      
      // If this segment should be removed and replaced with a prefix
      if (originTransform.removePrefix && originTransform.prefix !== undefined) {
        // Create a new path with the proper prefix and without the matched segment
        const pathWithoutSegment = segments
          .filter(s => s !== segment) // Remove the segment
          .join('/');
          
        // Apply the new prefix
        normalizedPath = originTransform.prefix + pathWithoutSegment;
        
        debug('VideoStorageService', 'Applied path transformation', {
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
 * Fetch a video from R2 storage
 */
async function fetchFromR2(
  path: string, 
  bucket: R2Bucket,
  request?: Request,
  config?: any
): Promise<StorageResult | null> {
  try {
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
        } catch (e) {
          // Invalid range header, ignore
          debug('VideoStorageService', 'Invalid range header', { rangeHeader });
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
      const r2CacheTtl = config?.cache.ttl.ok || 86400;
      headers.set('Cache-Control', `public, max-age=${r2CacheTtl}`);
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
      
      // Add additional headers
      const r2CacheTtl = config?.cache.ttl.ok || 86400;
      headers.set('Cache-Control', `public, max-age=${r2CacheTtl}`);
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
  } catch (error) {
    debug('VideoStorageService', 'Error fetching from R2', { 
      error: error instanceof Error ? error.message : String(error),
      path
    });
    throw new Error('Error accessing R2 storage: ' + 
      (error instanceof Error ? error.message : String(error)));
  }
}

/**
 * Fetch a video from a remote URL
 */
async function fetchFromRemote(
  path: string, 
  baseUrl: string,
  config: any,
  env: EnvVariables
): Promise<StorageResult | null> {
  try {
    // Build fetch options from config
    const fetchOptions: RequestInit = {
      cf: {
        cacheTtl: config.cache.ttl.ok || 3600,
        cacheEverything: true,
      },
      headers: {
        'User-Agent': config.storage?.fetchOptions?.userAgent || 'Cloudflare-Video-Resizer/1.0',
      },
    };
    
    // Add any additional headers from config
    if (config.storage?.fetchOptions?.headers) {
      Object.entries(config.storage.fetchOptions.headers).forEach(([key, value]) => {
        if (fetchOptions.headers && typeof fetchOptions.headers === 'object') {
          // Add the headers from config
          (fetchOptions.headers as Record<string, string>)[key] = String(value);
        }
      });
    }
    
    // Apply path transformations for remote URLs
    const transformedPath = applyPathTransformation(path, config, 'remote');
    debug('VideoStorageService', 'Remote path after transformation', { 
      originalPath: path, 
      transformedPath 
    });
    
    // Check if authentication is required for this origin
    // Set the base URL
    const finalUrl = new URL(transformedPath, baseUrl).toString();
    
    // Check if remote auth is enabled specifically for this remote URL
    if (config.storage?.remoteAuth?.enabled) {
      debug('VideoStorageService', 'Remote auth enabled', {
        type: config.storage.remoteAuth.type,
        url: finalUrl
      });
      
      const remoteAuth = config.storage.remoteAuth as AuthConfig || {};
      
      // Handle different auth types
      if (remoteAuth.type === 'aws-s3') {
        // Check if we're using origin-auth
        if (config.storage.auth?.useOriginAuth) {
          // With origin-auth, we sign the headers and let Cloudflare pass them through
          // Create an AWS-compatible signer
          const accessKeyVar = remoteAuth.accessKeyVar || 'AWS_ACCESS_KEY_ID';
          const secretKeyVar = remoteAuth.secretKeyVar || 'AWS_SECRET_ACCESS_KEY';
          
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
                service: remoteAuth.service || 's3',
                region: remoteAuth.region || 'us-east-1'
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
              
              debug('VideoStorageService', 'Added AWS signed headers', {
                url: finalUrl,
                headerCount: Object.keys(fetchOptions.headers || {}).length
              });
            } catch (err) {
              error('VideoStorageService', 'Error signing AWS request', {
                error: err instanceof Error ? err.message : String(err),
                url: finalUrl
              });
              
              // Continue without authentication if in permissive mode
              if (config.storage.auth?.securityLevel !== 'permissive') {
                return null;
              }
            }
          } else {
            error('VideoStorageService', 'AWS credentials not found', {
              accessKeyVar,
              secretKeyVar
            });
            
            // Continue without authentication if in permissive mode
            if (config.storage.auth?.securityLevel !== 'permissive') {
              return null;
            }
          }
        } else {
          debug('VideoStorageService', 'AWS S3 auth requires origin-auth to be enabled', {
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
      if (config.storage.auth?.cacheTtl) {
        if (fetchOptions.cf && typeof fetchOptions.cf === 'object') {
          (fetchOptions.cf as Record<string, unknown>).cacheTtl = config.storage.auth.cacheTtl;
        }
      }
    } else {
      debug('VideoStorageService', 'Remote auth not enabled for this URL', {
        url: finalUrl
      });
    }
    
    // Fetch the video from the remote URL
    debug('VideoStorageService', 'Fetching from remote URL', { url: finalUrl });
    const response = await fetch(finalUrl, fetchOptions);
    
    if (!response.ok) {
      debug('VideoStorageService', 'Remote fetch failed', { 
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
  } catch (err) {
    error('VideoStorageService', 'Error fetching from remote', { 
      error: err instanceof Error ? err.message : String(err),
      url: baseUrl,
      path
    });
    return null;
  }
}

/**
 * Fetch a video from a fallback URL
 */
async function fetchFromFallback(
  path: string, 
  fallbackUrl: string,
  config: any,
  env: EnvVariables
): Promise<StorageResult | null> {
  try {
    // Build fetch options from config
    const fetchOptions: RequestInit = {
      cf: {
        cacheTtl: config.cache.ttl.ok || 3600,
        cacheEverything: true,
      },
      headers: {
        'User-Agent': config.storage?.fetchOptions?.userAgent || 'Cloudflare-Video-Resizer/1.0',
      },
    };
    
    // Add any additional headers from config
    if (config.storage?.fetchOptions?.headers) {
      Object.entries(config.storage.fetchOptions.headers).forEach(([key, value]) => {
        if (fetchOptions.headers && typeof fetchOptions.headers === 'object') {
          // Add the headers from config
          (fetchOptions.headers as Record<string, string>)[key] = String(value);
        }
      });
    }
    
    // Apply path transformations for fallback URLs
    const transformedPath = applyPathTransformation(path, config, 'fallback');
    debug('VideoStorageService', 'Fallback path after transformation', { 
      originalPath: path, 
      transformedPath 
    });
    
    // Set the base URL
    const finalUrl = new URL(transformedPath, fallbackUrl).toString();
    
    // Check if fallback auth is enabled specifically for this URL
    if (config.storage?.fallbackAuth?.enabled) {
      debug('VideoStorageService', 'Fallback auth enabled', {
        type: config.storage.fallbackAuth.type,
        url: finalUrl
      });
      
      const fallbackAuth = config.storage.fallbackAuth as AuthConfig || {};
      
      // Handle different auth types
      if (fallbackAuth.type === 'aws-s3') {
        // Check if we're using origin-auth
        if (config.storage.auth?.useOriginAuth) {
          // With origin-auth, we sign the headers and let Cloudflare pass them through
          // Create an AWS-compatible signer
          const accessKeyVar = fallbackAuth.accessKeyVar || 'AWS_ACCESS_KEY_ID';
          const secretKeyVar = fallbackAuth.secretKeyVar || 'AWS_SECRET_ACCESS_KEY';
          
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
                service: fallbackAuth.service || 's3',
                region: fallbackAuth.region || 'us-east-1'
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
              
              debug('VideoStorageService', 'Added AWS signed headers for fallback', {
                url: finalUrl,
                headerCount: Object.keys(fetchOptions.headers || {}).length
              });
            } catch (err) {
              error('VideoStorageService', 'Error signing AWS request for fallback', {
                error: err instanceof Error ? err.message : String(err),
                url: finalUrl
              });
              
              // Continue without authentication if in permissive mode
              if (config.storage.auth?.securityLevel !== 'permissive') {
                return null;
              }
            }
          } else {
            error('VideoStorageService', 'AWS credentials not found for fallback', {
              accessKeyVar,
              secretKeyVar
            });
            
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
      if (config.storage.auth?.cacheTtl) {
        if (fetchOptions.cf && typeof fetchOptions.cf === 'object') {
          (fetchOptions.cf as Record<string, unknown>).cacheTtl = config.storage.auth.cacheTtl;
        }
      }
    } else {
      debug('VideoStorageService', 'Fallback auth not enabled for this URL', {
        url: finalUrl
      });
    }
    
    // Fetch the video from the fallback URL
    debug('VideoStorageService', 'Fetching from fallback URL', { url: finalUrl });
    const response = await fetch(finalUrl, fetchOptions);
    
    if (!response.ok) {
      debug('VideoStorageService', 'Fallback fetch failed', { 
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
  } catch (err) {
    error('VideoStorageService', 'Error fetching from fallback', { 
      error: err instanceof Error ? err.message : String(err),
      url: fallbackUrl,
      path
    });
    return null;
  }
}

/**
 * Fetch a video from any available storage source
 * 
 * @param path The path to the video
 * @param config The video resizer configuration
 * @param env The Cloudflare environment
 * @returns A StorageResult object or null if the video couldn't be found
 */
export async function fetchVideo(
  path: string,
  config: any,
  env: EnvVariables,
  request?: Request
): Promise<StorageResult> {
  debug('VideoStorageService', 'Starting video fetch', {
    path,
    hasRequest: !!request,
    storageOptions: config.storage?.priority || []
  });
  
  // First, check the request type to determine if this is a Cloudflare Media Transformation subrequest
  const via = request?.headers.get('via') || '';
  const isMediaTransformationSubrequest = via.includes('media-transformation');
  
  // Log the request type for debugging
  debug('VideoStorageService', 'Video fetch request analysis', { 
    path, 
    isMediaTransformationSubrequest,
    via
  });
  
  // Special handling for Media Transformation subrequests
  if (isMediaTransformationSubrequest) {
    debug('VideoStorageService', 'Detected media-transformation subrequest', { path });
    
    // First, determine if R2 should be used based on storage priority
    const shouldUseR2 = config.storage?.priority?.includes('r2') && 
                       config.storage?.r2?.enabled && 
                       env.VIDEOS_BUCKET;
                       
    debug('VideoStorageService', 'Subrequest storage evaluation', {
      path: path,
      storageOrder: config.storage?.priority?.join(','),
      r2Available: config.storage?.r2?.enabled && !!env.VIDEOS_BUCKET ? true : false,
      shouldUseR2: shouldUseR2 ? true : false
    });
    
    // Check if R2 is available, enabled, and in the priority list
    if (shouldUseR2) {
      debug('VideoStorageService', 'Using R2 for media-transformation subrequest', { path });
      const bucket = env.VIDEOS_BUCKET;
      const fetchStart = Date.now();
      
      // Apply path transformations for R2 storage
      const r2Key = applyPathTransformation(path, config, 'r2');
      
      debug('VideoStorageService', 'Video key for subrequest', { 
        originalPath: path,
        transformedKey: r2Key,
        url: request?.url
      });
      
      // Try to get the object from R2
      try {
        // Make sure bucket is defined before using it
        if (!bucket) {
          error('VideoStorageService', 'R2 bucket is undefined', { path: r2Key });
          throw new Error('R2 bucket is undefined');
        }
        
        const result = await fetchFromR2(r2Key, bucket, request, config);
        const fetchEnd = Date.now();
        
        if (result) {
          debug('VideoStorageService', 'Found video in R2 bucket for subrequest', { r2Key });
          debug('VideoStorageService', 'R2 fetch successful for media-transformation subrequest', {
            contentType: result.contentType,
            size: result.size,
            key: r2Key,
            timeMs: fetchEnd - fetchStart
          });
          return result;
        }
        
        // If the video is not found with transformed path, try the simple normalized path as fallback
        const normalizedPath = path.startsWith('/') ? path.substring(1) : path;
        if (r2Key !== normalizedPath) {
          debug('VideoStorageService', 'Video not found with transformed key, trying normalized path', { 
            r2Key, 
            normalizedPath 
          });
          
          // Make sure bucket is defined before using it
          if (!bucket) {
            error('VideoStorageService', 'R2 bucket is undefined', { path: normalizedPath });
            throw new Error('R2 bucket is undefined');
          }
          
          const fallbackResult = await fetchFromR2(normalizedPath, bucket, request, config);
          if (fallbackResult) {
            debug('VideoStorageService', 'Found video in R2 bucket using normalized path', { normalizedPath });
            debug('VideoStorageService', 'R2 fallback fetch successful', {
              contentType: fallbackResult.contentType,
              size: fallbackResult.size,
              key: normalizedPath,
              timeMs: Date.now() - fetchStart
            });
            return fallbackResult;
          }
        }
        
        debug('VideoStorageService', 'Video not found in R2 for subrequest', {
          paths: r2Key !== normalizedPath ? `${r2Key}, ${normalizedPath}` : r2Key,
          timeMs: fetchEnd - fetchStart
        });
      } catch (err) {
        error('VideoStorageService', 'Error in R2 fetch for subrequest', {
          error: err instanceof Error ? err.message : String(err),
          path: r2Key
        });
      }
    } else {
      debug('VideoStorageService', 'R2 not available for media-transformation subrequest', { 
        r2Enabled: config.storage?.r2?.enabled,
        hasBucket: !!env.VIDEOS_BUCKET
      });
    }
  }

  // Determine available storage options
  const availableStorage = config.storage?.priority || ['remote', 'fallback'];
  debug('VideoStorageService', 'Trying storage options in priority order', { 
    storageOrder: availableStorage,
    r2Enabled: config.storage?.r2?.enabled && !!env.VIDEOS_BUCKET,
    remoteUrlSet: !!config.storage?.remoteUrl,
    fallbackUrlSet: !!config.storage?.fallbackUrl
  });
  
  // Try each storage option in order of priority
  for (const storageType of availableStorage) {
    let result: StorageResult | null = null;
    
    // Try to fetch from R2
    if (storageType === 'r2' && config.storage?.r2?.enabled && env.VIDEOS_BUCKET) {
      debug('VideoStorageService', 'Trying R2 storage', { path });
      
      // Apply path transformations for R2
      const transformedPath = applyPathTransformation(path, config, 'r2');
      debug('VideoStorageService', 'R2 path after transformation', { originalPath: path, transformedPath });
      
      const bucket = env.VIDEOS_BUCKET;
      const fetchStart = Date.now();
      
      // Make sure bucket is defined before using it
      if (!bucket) {
        error('VideoStorageService', 'R2 bucket is undefined', { path: transformedPath });
        throw new Error('R2 bucket is undefined');
      }
      
      result = await fetchFromR2(transformedPath, bucket, request, config);
      const fetchEnd = Date.now();
      
      if (result) {
        debug('VideoStorageService', 'R2 fetch successful', {
          size: result.size,
          contentType: result.contentType,
          timeMs: fetchEnd - fetchStart
        });
      } else {
        debug('VideoStorageService', 'R2 fetch failed', {
          timeMs: fetchEnd - fetchStart
        });
      }
    }
    
    // Try to fetch from remote URL
    if (storageType === 'remote' && config.storage?.remoteUrl) {
      debug('VideoStorageService', 'Trying remote URL', { path, remoteUrl: config.storage.remoteUrl });
      
      // Apply path transformations for remote
      const transformedPath = applyPathTransformation(path, config, 'remote');
      debug('VideoStorageService', 'Remote path after transformation', { originalPath: path, transformedPath });
      
      const fetchStart = Date.now();
      result = await fetchFromRemote(transformedPath, config.storage.remoteUrl, config, env);
      const fetchEnd = Date.now();
      
      if (result) {
        debug('VideoStorageService', 'Remote fetch successful', {
          size: result.size,
          contentType: result.contentType,
          timeMs: fetchEnd - fetchStart
        });
      } else {
        debug('VideoStorageService', 'Remote fetch failed', {
          timeMs: fetchEnd - fetchStart
        });
      }
    }
    
    // Try to fetch from fallback URL
    if (storageType === 'fallback' && config.storage?.fallbackUrl) {
      debug('VideoStorageService', 'Trying fallback URL', { path, fallbackUrl: config.storage.fallbackUrl });
      
      // Apply path transformations for fallback
      const transformedPath = applyPathTransformation(path, config, 'fallback');
      debug('VideoStorageService', 'Fallback path after transformation', { originalPath: path, transformedPath });
      
      const fetchStart = Date.now();
      result = await fetchFromFallback(transformedPath, config.storage.fallbackUrl, config, env);
      const fetchEnd = Date.now();
      
      if (result) {
        debug('VideoStorageService', 'Fallback fetch successful', {
          size: result.size,
          contentType: result.contentType,
          timeMs: fetchEnd - fetchStart
        });
      } else {
        debug('VideoStorageService', 'Fallback fetch failed', {
          timeMs: fetchEnd - fetchStart
        });
      }
    }
    
    // If we found the video, return it
    if (result) {
      debug('VideoStorageService', 'Found video in storage', { 
        sourceType: result.sourceType, 
        contentType: result.contentType, 
        size: result.size 
      });
      return result;
    }
  }
  
  // If we couldn't find the video anywhere, return an error
  debug('VideoStorageService', 'Video not found in any storage location', { path });
  
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
 * Determine if a response should bypass cache based on configuration and request
 * @param request - The incoming request
 * @returns Boolean indicating whether the cache should be bypassed
 */
export function shouldBypassCache(request: Request): boolean {
  // Check for cache-control header
  const cacheControl = request.headers.get('Cache-Control');
  if (cacheControl && (cacheControl.includes('no-cache') || cacheControl.includes('no-store'))) {
    return true;
  }
  
  // Check for cache bypass in query params
  const url = new URL(request.url);
  
  // Get cache configuration to check bypass parameters
  const cacheConfig = CacheConfigurationManager.getInstance();
  const bypassParams = cacheConfig.getConfig().bypassQueryParameters || ['nocache', 'bypass'];
  
  // Check if any of the bypass parameters exist in the URL
  return bypassParams.some(param => url.searchParams.has(param));
}

/**
 * Generate cache tags for a video resource
 * @param videoPath - The path to the video
 * @param options - Video options (quality, format, etc.)
 * @param cacheConfig - Cache configuration
 * @param headers - Response headers for additional metadata
 * @returns Array of cache tags
 */
export function generateCacheTags(
  videoPath: string,
  options: any,
  headers?: Headers
): string[] {
  // Get the cache configuration manager
  const cacheConfig = CacheConfigurationManager.getInstance();
  
  // If cache tags are disabled, return empty array
  if (!cacheConfig.getConfig().enableCacheTags) {
    debug('VideoStorageService', 'Cache tags are disabled');
    return [];
  }
  
  const startTime = Date.now();
  const tags: string[] = [];
  const prefix = 'video-';
  
  // Add base tag for the video path (normalized to avoid special chars)
  const leadingSlashPattern = '^\/+';
  const invalidCharsPattern = '[^a-zA-Z0-9-_/.]';
  const replacementChar = '-';
  
  debug('VideoStorageService', 'Generating cache tags', {
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
  debug('VideoStorageService', 'Generated cache tags', {
    tagCount: tags.length,
    generationTime: endTime - startTime
  });
  
  return tags;
}
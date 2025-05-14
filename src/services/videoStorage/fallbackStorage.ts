/**
 * Fallback storage functionality for the Video Storage Service
 */

import { withErrorHandling, logErrorWithContext } from '../../utils/errorHandlingUtils';
import { VideoResizerConfig, StorageResult } from './interfaces';
import { EnvVariables } from '../../config/environmentConfig';
import { getCurrentContext } from '../../utils/legacyLoggerAdapter';
import { addBreadcrumb } from '../../utils/requestContext';
import { getPresignedUrl, storePresignedUrl, isUrlExpiring, refreshPresignedUrl, UrlGeneratorFunction } from '../presignedUrlCacheService';
import { applyPathTransformation } from './pathTransform';
import { logDebug } from './logging';

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
  let finalUrl = new URL(transformedPath, fallbackUrl).toString();
  const originalFinalUrl = finalUrl; // Store original URL for header signing
  
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
            const signRequest = new Request(originalFinalUrl, {
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
    } else if (fallbackAuth.type === 'aws-s3-presigned-url') {
      // Check for cached presigned URL first if we have a KV namespace
      if (env.PRESIGNED_URLS) {
        try {
          const cachedEntry = await getPresignedUrl(
            env.PRESIGNED_URLS,
            transformedPath,
            {
              storageType: 'fallback',
              authType: 'aws-s3-presigned-url',
              region: fallbackAuth.region ?? 'us-east-1',
              service: fallbackAuth.service ?? 's3',
              env
            }
          );
          
          if (cachedEntry) {
            // Use the cached URL
            finalUrl = cachedEntry.url;
            
            // Log cache hit
            logDebug('VideoStorageService', 'Using cached AWS S3 Presigned URL for fallback', {
              path: transformedPath,
              expiresIn: Math.floor((cachedEntry.expiresAt - Date.now()) / 1000) + 's',
              urlLength: cachedEntry.url.length
            });
            
            // Add breadcrumb for the cache hit
            const requestContext = getCurrentContext();
            if (requestContext) {
              addBreadcrumb(requestContext, 'Cache', 'Presigned URL cache hit for fallback', {
                path: transformedPath,
                storageType: 'fallback',
                expiresIn: Math.floor((cachedEntry.expiresAt - Date.now()) / 1000) + 's'
              });
            }
            
            // Check if URL is close to expiration and refresh in background
            if ('executionCtx' in env && env.executionCtx?.waitUntil && isUrlExpiring(cachedEntry, 600) && env.PRESIGNED_URLS) {
              // Create URL generator function for refreshing
              const generateAwsUrl: UrlGeneratorFunction = async (path: string): Promise<string> => {
                const accessKeyVar = fallbackAuth.accessKeyVar ?? 'AWS_ACCESS_KEY_ID';
                const secretKeyVar = fallbackAuth.secretKeyVar ?? 'AWS_SECRET_ACCESS_KEY';
                const sessionTokenVar = fallbackAuth.sessionTokenVar;
                const envRecord = env as unknown as Record<string, string | undefined>;
                const accessKey = envRecord[accessKeyVar] as string;
                const secretKey = envRecord[secretKeyVar] as string;
                const sessionToken = sessionTokenVar ? envRecord[sessionTokenVar] as string : undefined;
                const expiresIn = fallbackAuth.expiresInSeconds ?? 3600;
                
                // Generate new URL
                const { AwsClient } = await import('aws4fetch');
                const aws = new AwsClient({
                  accessKeyId: accessKey,
                  secretAccessKey: secretKey,
                  sessionToken,
                  service: fallbackAuth.service ?? 's3',
                  region: fallbackAuth.region ?? 'us-east-1'
                });
                
                const pathUrl = new URL(path, fallbackUrl).toString();
                const signRequest = new Request(pathUrl, { method: 'GET' });
                const signedRequest = await aws.sign(signRequest, {
                  aws: { signQuery: true },
                  expiresIn
                });
                
                return signedRequest.url;
              };
              
              // Use waitUntil for non-blocking refresh
              env.executionCtx.waitUntil(
                (async () => {
                  if (env.PRESIGNED_URLS) {
                    await refreshPresignedUrl(
                      env.PRESIGNED_URLS,
                      cachedEntry,
                      {
                        thresholdSeconds: 600, // 10 minutes threshold
                        env,
                        generateUrlFn: generateAwsUrl
                      }
                    );
                  }
                })()
              );
            }
            
            // Skip normal URL generation since we have a cached URL
          } else {
            // No cached URL found, generate a new one
            logDebug('VideoStorageService', 'No cached presigned URL found for fallback, generating new one', {
              path: transformedPath
            });
          }
        } catch (err) {
          // Log error but continue with normal URL generation
          logDebug('VideoStorageService', 'Error retrieving cached presigned URL for fallback', {
            path: transformedPath,
            error: err instanceof Error ? err.message : String(err)
          });
        }
      }
      
      // If no cached URL was found, or cache lookup failed, generate a new one
      if (finalUrl === originalFinalUrl) {
        // Handle presigned URL generation
        const accessKeyVar = fallbackAuth.accessKeyVar ?? 'AWS_ACCESS_KEY_ID';
        const secretKeyVar = fallbackAuth.secretKeyVar ?? 'AWS_SECRET_ACCESS_KEY';
        const sessionTokenVar = fallbackAuth.sessionTokenVar;
        
        // Access environment variables
        const envRecord = env as unknown as Record<string, string | undefined>;
        
        const accessKey = envRecord[accessKeyVar] as string;
        const secretKey = envRecord[secretKeyVar] as string;
        const sessionToken = sessionTokenVar ? envRecord[sessionTokenVar] as string : undefined;
        
        // Get expiration time for presigned URL
        const expiresIn = fallbackAuth.expiresInSeconds ?? 3600;
        
        if (accessKey && secretKey) {
          try {
            // Import AwsClient
            const { AwsClient } = await import('aws4fetch');
            
            // Setup AWS client
            const aws = new AwsClient({
              accessKeyId: accessKey,
              secretAccessKey: secretKey,
              sessionToken,
              service: fallbackAuth.service ?? 's3',
              region: fallbackAuth.region ?? 'us-east-1'
            });
            
            // Create a request to sign
            const signRequest = new Request(originalFinalUrl, {
              method: 'GET'
            });
            
            // Sign the request with query parameters instead of headers
            const signedRequest = await aws.sign(signRequest, {
              aws: {
                signQuery: true
              },
              expiresIn
            });
            
            // Use the signed URL with query parameters
            finalUrl = signedRequest.url;
            
            // Use our helper function for consistent logging
            logDebug('VideoStorageService', 'Generated AWS S3 Presigned URL for fallback', {
              // Avoid logging the full URL which contains credentials
              urlLength: finalUrl.length,
              expiresIn,
              success: true
            });
            
            // Cache the generated URL if KV binding exists
            if (env.PRESIGNED_URLS) {
              try {
                await storePresignedUrl(
                  env.PRESIGNED_URLS,
                  transformedPath,
                  finalUrl,
                  originalFinalUrl,
                  {
                    storageType: 'fallback',
                    expiresInSeconds: expiresIn,
                    authType: 'aws-s3-presigned-url',
                    region: fallbackAuth.region ?? 'us-east-1',
                    service: fallbackAuth.service ?? 's3',
                    env
                  }
                );
                
                logDebug('VideoStorageService', 'Cached new presigned URL for fallback', {
                  path: transformedPath,
                  expiresIn
                });
              } catch (cacheErr) {
                // Log but continue - caching failure shouldn't stop the request
                logDebug('VideoStorageService', 'Error caching presigned URL for fallback', {
                  path: transformedPath,
                  error: cacheErr instanceof Error ? cacheErr.message : String(cacheErr)
                });
              }
            }
          } catch (err) {
            // Log error with standardized error handling
            logErrorWithContext(
              'Error generating AWS S3 Presigned URL for fallback',
              err,
              {
                url: originalFinalUrl,
                accessKeyVar,
                secretKeyVar
              },
              'VideoStorageService'
            );
            
            // Fail if we can't generate the presigned URL
            return null;
          }
        } else {
          // Log error with standardized error handling
          logErrorWithContext(
            'AWS credentials not found for presigned URL generation (fallback)',
            new Error('Missing credentials'),
            {
              accessKeyVar,
              secretKeyVar
            },
            'VideoStorageService'
          );
          
          // Fail if credentials are missing
          return null;
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
  
  // Check if we should store this in KV (in the background)
  if (response.ok && env.executionCtx?.waitUntil && env.VIDEO_TRANSFORMATIONS_CACHE) {
    // Get content length to check file size
    const contentLengthHeader = response.headers.get('Content-Length');
    const contentLength = contentLengthHeader ? parseInt(contentLengthHeader, 10) : 0;
    
    // For extremely large files, we'll still process them but log the size
    if (contentLength > 100 * 1024 * 1024) { // 100MB threshold
      logDebug('VideoStorageService', `Processing large fallback content (${Math.round(contentLength/1024/1024)}MB) with streams API`, {
        path: transformedPath,
        size: contentLength
      });
    }
    
    // We need to clone the response before passing it to waitUntil and returning it
    const responseClone = response.clone();
    
    // Use waitUntil to process in the background without blocking the response
    env.executionCtx.waitUntil(
      streamFallbackToKV(env, transformedPath, responseClone, config)
    );
    
    logDebug('VideoStorageService', 'Initiating background storage of fallback content', {
      path: transformedPath,
      size: contentLength || 'unknown'
    });
  }
  
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
 * Streams fallback content to KV storage in the background
 * Uses tee() with concurrent reading to avoid memory limitations for large files
 * @export - This is exported for use in transformationErrorHandler.ts
 */
export async function streamFallbackToKV(
  env: EnvVariables,
  sourcePath: string,
  fallbackResponse: Response,
  config: VideoResizerConfig
): Promise<void> {
  // Use the correct KV namespace from env
  if (!env.VIDEO_TRANSFORMATIONS_CACHE || !fallbackResponse.body || !fallbackResponse.ok) {
    return;
  }

  try {
    const transformedPath = applyPathTransformation(sourcePath, config, 'fallback');
    const contentType = fallbackResponse.headers.get('Content-Type') || 'video/mp4';
    const contentLength = parseInt(fallbackResponse.headers.get('Content-Length') || '0', 10);
    
    logDebug('VideoStorageService', 'Starting background streaming of fallback to KV', { 
      path: transformedPath,
      contentType,
      contentLength 
    });

    // Import the storeTransformedVideo function from the correct relative path
    const { storeTransformedVideo } = await import('../../services/kvStorage/storeVideo');
    
    // Create a new response with the body for KV storage
    // Since fallbackResponse was already cloned before being passed to this function,
    // we can just use it directly without another clone
    const storageResponse = new Response(fallbackResponse.body, {
      headers: new Headers({
        'Content-Type': contentType,
        'Content-Length': contentLength ? contentLength.toString() : ''
      })
    });

    // Store in KV with chunking support using existing implementation
    await storeTransformedVideo(
      env.VIDEO_TRANSFORMATIONS_CACHE,
      transformedPath,
      storageResponse,
      {
        // Transfer any transformation options that might be in the config
        // Note: These are optional and might not exist on the config object
        width: (config as any).width || null,
        height: (config as any).height || null,
        format: (config as any).format || null,
        env: env
      },
      config?.cache?.ttl?.ok ?? 3600
    );
    
    logDebug('VideoStorageService', 'Successfully stored fallback content in KV', {
      path: transformedPath,
      kvNamespace: 'VIDEO_TRANSFORMATIONS_CACHE'
    });
  } catch (err) {
    logErrorWithContext(
      'Error streaming fallback content to KV',
      err,
      { sourcePath, kvNamespace: 'VIDEO_TRANSFORMATIONS_CACHE' },
      'VideoStorageService'
    );
  }
}

/**
 * Fetch a video from a fallback URL
 * Uses standardized error handling for consistent logging and error propagation
 */
export const fetchFromFallback = withErrorHandling<
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
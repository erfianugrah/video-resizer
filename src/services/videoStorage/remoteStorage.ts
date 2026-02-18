/**
 * Remote storage functionality for the Video Storage Service
 */

import { withErrorHandling, logErrorWithContext } from '../../utils/errorHandlingUtils';
import { VideoResizerConfig, StorageResult } from './interfaces';
import { EnvVariables } from '../../config/environmentConfig';
import { getCurrentContext, addBreadcrumb } from '../../utils/requestContext';
import {
  getPresignedUrl,
  storePresignedUrl,
  isUrlExpiring,
  refreshPresignedUrl,
  UrlGeneratorFunction,
} from '../presignedUrlCacheService';
import { applyPathTransformation } from './pathTransform';
import { createCategoryLogger } from '../../utils/logger';
const logger = createCategoryLogger('VideoStorage');
import { getPresignedUrlKV } from '../../utils/flexibleBindings';

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
  logger.debug('Remote path after transformation', {
    originalPath: path,
    transformedPath,
  });

  // Check if authentication is required for this origin
  // Set the base URL
  let finalUrl = new URL(transformedPath, baseUrl).toString();
  const originalFinalUrl = finalUrl; // Store original URL for header signing

  // Check if remote auth is enabled specifically for this remote URL
  if (config?.storage?.remoteAuth?.enabled) {
    // Use our helper function for consistent logging
    logger.debug('Remote auth enabled', {
      type: config.storage.remoteAuth.type,
      url: finalUrl,
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
              region: remoteAuth.region ?? 'us-east-1',
            });

            // Create a request to sign
            const signRequest = new Request(originalFinalUrl, {
              method: 'GET',
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
            logger.debug('Added AWS signed headers', {
              url: finalUrl,
              headerCount: Object.keys(fetchOptions.headers || {}).length,
            });
          } catch (err) {
            // Log error with standardized error handling
            logErrorWithContext(
              'Error signing AWS request',
              err,
              {
                url: finalUrl,
                accessKeyVar,
                secretKeyVar,
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
              secretKeyVar,
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
        logger.debug('AWS S3 auth requires origin-auth to be enabled', {
          url: finalUrl,
        });
      }
    } else if (remoteAuth.type === 'aws-s3-presigned-url') {
      // Check for cached presigned URL first if we have a KV namespace
      const presignedKV = getPresignedUrlKV(env);
      if (presignedKV) {
        try {
          const cachedEntry = await getPresignedUrl(presignedKV, transformedPath, {
            storageType: 'remote',
            authType: 'aws-s3-presigned-url',
            region: remoteAuth.region ?? 'us-east-1',
            service: remoteAuth.service ?? 's3',
            env,
          });

          if (cachedEntry) {
            // Use the cached URL
            finalUrl = cachedEntry.url;

            // Log cache hit
            logger.debug('Using cached AWS S3 Presigned URL', {
              path: transformedPath,
              expiresIn: Math.floor((cachedEntry.expiresAt - Date.now()) / 1000) + 's',
              urlLength: cachedEntry.url.length,
            });

            // Add breadcrumb for the cache hit
            const requestContext = getCurrentContext();
            if (requestContext) {
              addBreadcrumb(requestContext, 'Cache', 'Presigned URL cache hit', {
                path: transformedPath,
                storageType: 'remote',
                expiresIn: Math.floor((cachedEntry.expiresAt - Date.now()) / 1000) + 's',
              });
            }

            // Check if URL is close to expiration and refresh in background
            if (
              'executionCtx' in env &&
              env.executionCtx?.waitUntil &&
              isUrlExpiring(cachedEntry, 600) &&
              presignedKV
            ) {
              // Create URL generator function for refreshing
              const generateAwsUrl: UrlGeneratorFunction = async (
                path: string
              ): Promise<string> => {
                const accessKeyVar = remoteAuth.accessKeyVar ?? 'AWS_ACCESS_KEY_ID';
                const secretKeyVar = remoteAuth.secretKeyVar ?? 'AWS_SECRET_ACCESS_KEY';
                const sessionTokenVar = remoteAuth.sessionTokenVar;
                const envRecord = env as unknown as Record<string, string | undefined>;
                const accessKey = envRecord[accessKeyVar] as string;
                const secretKey = envRecord[secretKeyVar] as string;
                const sessionToken = sessionTokenVar
                  ? (envRecord[sessionTokenVar] as string)
                  : undefined;
                const expiresIn = remoteAuth.expiresInSeconds ?? 3600;

                // Generate new URL
                const { AwsClient } = await import('aws4fetch');
                const aws = new AwsClient({
                  accessKeyId: accessKey,
                  secretAccessKey: secretKey,
                  sessionToken,
                  service: remoteAuth.service ?? 's3',
                  region: remoteAuth.region ?? 'us-east-1',
                });

                const pathUrl = new URL(path, baseUrl).toString();
                const signRequest = new Request(pathUrl, { method: 'GET' });
                const signedRequest = await aws.sign(signRequest, {
                  aws: { signQuery: true },
                  expiresIn,
                });

                return signedRequest.url;
              };

              // Use waitUntil for non-blocking refresh
              env.executionCtx.waitUntil(
                (async () => {
                  if (presignedKV) {
                    await refreshPresignedUrl(presignedKV, cachedEntry, {
                      thresholdSeconds: 600, // 10 minutes threshold
                      env,
                      generateUrlFn: generateAwsUrl,
                    });
                  }
                })()
              );
            }

            // Skip normal URL generation since we have a cached URL
          } else {
            // No cached URL found, generate a new one
            logger.debug('No cached presigned URL found, generating new one', {
              path: transformedPath,
            });
          }
        } catch (err) {
          // Log error but continue with normal URL generation
          logger.debug('Error retrieving cached presigned URL', {
            path: transformedPath,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      // If no cached URL was found, or cache lookup failed, generate a new one
      if (finalUrl === originalFinalUrl) {
        // Handle presigned URL generation
        const accessKeyVar = remoteAuth.accessKeyVar ?? 'AWS_ACCESS_KEY_ID';
        const secretKeyVar = remoteAuth.secretKeyVar ?? 'AWS_SECRET_ACCESS_KEY';
        const sessionTokenVar = remoteAuth.sessionTokenVar;

        // Access environment variables
        const envRecord = env as unknown as Record<string, string | undefined>;

        const accessKey = envRecord[accessKeyVar] as string;
        const secretKey = envRecord[secretKeyVar] as string;
        const sessionToken = sessionTokenVar ? (envRecord[sessionTokenVar] as string) : undefined;

        // Get expiration time for presigned URL
        const expiresIn = remoteAuth.expiresInSeconds ?? 3600;

        if (accessKey && secretKey) {
          try {
            // Import AwsClient
            const { AwsClient } = await import('aws4fetch');

            // Setup AWS client
            const aws = new AwsClient({
              accessKeyId: accessKey,
              secretAccessKey: secretKey,
              sessionToken,
              service: remoteAuth.service ?? 's3',
              region: remoteAuth.region ?? 'us-east-1',
            });

            // Create a request to sign
            const signRequest = new Request(originalFinalUrl, {
              method: 'GET',
            });

            // Sign the request with query parameters instead of headers
            const signedRequest = await aws.sign(signRequest, {
              aws: {
                signQuery: true,
              },
              expiresIn,
            });

            // Use the signed URL with query parameters
            finalUrl = signedRequest.url;

            // Use our helper function for consistent logging
            logger.debug('Generated AWS S3 Presigned URL', {
              // Avoid logging the full URL which contains credentials
              urlLength: finalUrl.length,
              expiresIn,
              success: true,
            });

            // Cache the generated URL if KV binding exists
            if (presignedKV) {
              try {
                await storePresignedUrl(presignedKV, transformedPath, finalUrl, originalFinalUrl, {
                  storageType: 'remote',
                  expiresInSeconds: expiresIn,
                  authType: 'aws-s3-presigned-url',
                  region: remoteAuth.region ?? 'us-east-1',
                  service: remoteAuth.service ?? 's3',
                  env,
                });

                logger.debug('Cached new presigned URL', {
                  path: transformedPath,
                  expiresIn,
                });
              } catch (cacheErr) {
                // Log but continue - caching failure shouldn't stop the request
                logger.debug('Error caching presigned URL', {
                  path: transformedPath,
                  error: cacheErr instanceof Error ? cacheErr.message : String(cacheErr),
                });
              }
            }
          } catch (err) {
            // Log error with standardized error handling
            logErrorWithContext(
              'Error generating AWS S3 Presigned URL',
              err,
              {
                url: originalFinalUrl,
                accessKeyVar,
                secretKeyVar,
              },
              'VideoStorageService'
            );

            // Fail if we can't generate the presigned URL
            return null;
          }
        } else {
          // Log error with standardized error handling
          logErrorWithContext(
            'AWS credentials not found for presigned URL generation',
            new Error('Missing credentials'),
            {
              accessKeyVar,
              secretKeyVar,
            },
            'VideoStorageService'
          );

          // Fail if credentials are missing
          return null;
        }
      }
    } else if (remoteAuth.type === 'bearer') {
      // Implement bearer token auth
      // Check if authorization is in headers directly
      if (remoteAuth.headers && 'Authorization' in remoteAuth.headers) {
        if (fetchOptions.headers && typeof fetchOptions.headers === 'object') {
          (fetchOptions.headers as Record<string, string>)['Authorization'] =
            remoteAuth.headers['Authorization'];
        }
      }
      // Check for environment variable based token
      else if (remoteAuth.accessKeyVar) {
        // Access environment variables
        const envRecord = env as unknown as Record<string, string | undefined>;
        const accessToken = envRecord[remoteAuth.accessKeyVar];

        if (accessToken) {
          // Add bearer token to headers
          if (fetchOptions.headers && typeof fetchOptions.headers === 'object') {
            (fetchOptions.headers as Record<string, string>)['Authorization'] =
              `Bearer ${accessToken}`;
          }

          // Log that we added the bearer token
          logger.debug('Added bearer token from environment variable', {
            accessKeyVar: remoteAuth.accessKeyVar,
          });
        } else {
          // Log error with standardized error handling
          logErrorWithContext(
            'Bearer token not found in environment variable',
            new Error('Missing token'),
            {
              accessKeyVar: remoteAuth.accessKeyVar,
            },
            'VideoStorageService'
          );

          // Continue without authentication if in permissive mode
          if (config.storage.auth?.securityLevel !== 'permissive') {
            return null;
          }
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
    logger.debug('Remote auth not enabled for this URL', {
      url: finalUrl,
    });
  }

  // Fetch the video from the remote URL
  logger.debug('Fetching from remote URL', { url: finalUrl });

  const response = await fetch(finalUrl, fetchOptions);

  if (!response.ok) {
    logger.debug('Remote fetch failed', {
      url: finalUrl,
      status: response.status,
      statusText: response.statusText,
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
    path: transformedPath,
  };
}

/**
 * Fetch a video from a remote URL
 * Uses standardized error handling for consistent logging and error propagation
 */
export const fetchFromRemote = withErrorHandling<
  [string, string, VideoResizerConfig, EnvVariables],
  Promise<StorageResult | null>
>(
  fetchFromRemoteImpl,
  {
    functionName: 'fetchFromRemote',
    component: 'VideoStorageService',
    logErrors: true,
  },
  {
    storageType: 'remote',
  }
);

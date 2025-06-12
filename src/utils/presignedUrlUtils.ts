/**
 * Utility functions for generating presigned URLs for AWS S3 assets
 * This file provides functions for use in the URL transformation process
 * to ensure presigned URLs are created before constructing Media Transformation URLs
 */

import { EnvVariables } from '../config/environmentConfig';
import { tryOrNull, logErrorWithContext } from './errorHandlingUtils';
import { getCurrentContext } from '../utils/legacyLoggerAdapter';
import { addBreadcrumb } from '../utils/requestContext';
import {
  getPresignedUrl,
  storePresignedUrl,
  refreshPresignedUrl,
  isUrlExpiring,
  verifyPresignedUrl,
  PresignedUrlCacheEntry
} from '../services/presignedUrlCacheService';
import { getPresignedUrlKV } from './flexibleBindings';
import { createCategoryLogger } from './logger';

// Create a category-specific logger for PresignedUrlUtils
const logger = createCategoryLogger('PresignedUrlUtils');
const { debug: logDebug } = logger;

/**
 * Interface for AWS authentication configuration
 */
interface AwsAuthConfig {
  type: string;
  accessKeyVar?: string;
  secretKeyVar?: string;
  region?: string;
  service?: string;
  expiresInSeconds?: number;
  sessionTokenVar?: string;
  verifyBeforeUse?: boolean; // Whether to verify URLs with HEAD requests before using
}

/**
 * Interface for the necessary pattern details for presigning
 */
export interface PresigningPatternContext {
  originUrl: string | null; // The specific origin URL for this pattern
  auth: AwsAuthConfig | null; // Auth config from the pattern
  name: string; // Pattern name for logging/context
}

/**
 * Interface for storage configuration
 * This needs to be flexible to support pattern-specific auth configurations
 */
interface StorageConfig {
  remoteUrl?: string;
  fallbackUrl?: string;
  remoteAuth?: AwsAuthConfig;
  fallbackAuth?: AwsAuthConfig;
  [key: string]: any; // Allow for pattern-specific auth keys like standardAuth, videosAuth, etc.
}

/**
 * Check if a URL needs to be presigned based on auth configuration
 * 
 * @param url The URL to check
 * @param storageConfig Storage configuration
 * @param patternContext Optional pattern context with auth information
 * @returns Boolean indicating whether the URL needs presigning
 */
export function needsPresigning(
  url: string, 
  storageConfig?: StorageConfig,
  patternContext?: PresigningPatternContext | null
): boolean {
  if (!storageConfig) return false;

  // First check if we have pattern context provided directly
  if (patternContext) {
    // If we have pattern context with auth and originUrl
    if (patternContext.auth && patternContext.originUrl && url.includes(patternContext.originUrl)) {
      const needsPresigning = patternContext.auth.type === 'aws-s3-presigned-url';
      logDebug('Checking presigning from provided pattern context', {
        patternName: patternContext.name,
        url,
        needsPresigning,
        authType: patternContext.auth.type
      });
      
      if (needsPresigning) {
        return true;
      }
    }
  }

  // Fall back to checking path patterns from configuration
  try {
    // Use our logDebug function which is defined at the top of this file
    logDebug('Checking path patterns for presigned URL detection (fallback)', { url });
    
    // Try to dynamically get VideoConfigurationManager
    // This is not a circular dependency because it's used conditionally
    const { VideoConfigurationManager } = require('../config/VideoConfigurationManager');
    const configManager = VideoConfigurationManager.getInstance();
    const pathPatterns = configManager.getConfig().pathPatterns || [];

    // Check if any path pattern applies to this URL and has auth of type aws-s3-presigned-url
    for (const pattern of pathPatterns) {
      logDebug('Checking pattern for presigned URL auth', { 
        patternName: pattern.name, 
        patternOriginUrl: pattern.originUrl,
        url,
        hasAuth: !!pattern.auth,
        authType: pattern.auth?.type
      });
      
      if (pattern.originUrl && url.includes(pattern.originUrl) && pattern.auth?.type === 'aws-s3-presigned-url') {
        logDebug('URL matches pattern with presigned auth', {
          url,
          patternName: pattern.name,
          patternOriginUrl: pattern.originUrl,
          authType: pattern.auth.type
        });
        return true;
      }
      
      // Also check for pattern-specific auth in the storage config
      // This allows for authKey formats like 'standardAuth', 'videosAuth', etc.
      const patternAuthKey = `${pattern.name}Auth`;
      if (pattern.originUrl && 
          url.includes(pattern.originUrl) && 
          storageConfig[patternAuthKey]?.type === 'aws-s3-presigned-url') {
        logDebug('URL matches pattern with pattern-specific presigned auth in storage config', {
          url,
          patternName: pattern.name,
          patternOriginUrl: pattern.originUrl,
          authType: storageConfig[patternAuthKey].type,
          authKey: patternAuthKey
        });
        return true;
      }
    }
  } catch (err) {
    logDebug('Error checking path patterns for presigning', {
      url,
      error: err instanceof Error ? err.message : String(err)
    });
  }

  // Check if this URL matches the remote URL
  if (storageConfig.remoteUrl && url.startsWith(storageConfig.remoteUrl)) {
    return storageConfig.remoteAuth?.type === 'aws-s3-presigned-url';
  }

  // Check if this URL matches the fallback URL
  if (storageConfig.fallbackUrl && url.startsWith(storageConfig.fallbackUrl)) {
    return storageConfig.fallbackAuth?.type === 'aws-s3-presigned-url';
  }
  
  // Check for any pattern-specific auth configurations
  // Iterate through all properties that end with 'Auth'
  for (const key in storageConfig) {
    if (key.endsWith('Auth') && 
        key !== 'remoteAuth' && 
        key !== 'fallbackAuth' &&
        storageConfig[key]?.type === 'aws-s3-presigned-url') {
      
      // Extract pattern name from auth key (e.g., 'standardAuth' -> 'standard')
      const patternName = key.slice(0, -4);
      
      // Check if we have a matching URL for this pattern
      const patternUrl = storageConfig[`${patternName}Url`] || storageConfig.remoteUrl;
      if (patternUrl && url.startsWith(patternUrl)) {
        logDebug('URL matches pattern-specific auth in storage config', {
          url,
          patternName,
          authKey: key,
          authType: storageConfig[key].type
        });
        return true;
      }
    }
  }

  return false;
}

/**
 * Get authentication configuration for a URL
 * 
 * @param url The URL to get auth config for
 * @param storageConfig Storage configuration
 * @param patternContext Optional pattern context with auth information
 * @returns Authentication configuration or null if not found
 */
export function getAuthConfig(
  url: string, 
  storageConfig?: StorageConfig,
  patternContext?: PresigningPatternContext | null
): AwsAuthConfig | null {
  if (!storageConfig) return null;
  
  // First check if pattern context is provided directly
  if (patternContext && patternContext.auth) {
    // If we have pattern context with auth
    if (patternContext.originUrl && url.includes(patternContext.originUrl)) {
      logDebug('Using auth config from provided pattern context', {
        patternName: patternContext.name,
        url,
        authType: patternContext.auth.type
      });
      return patternContext.auth;
    }
  }
  
  // Fall back to checking path patterns for auth configuration
  try {
    logDebug('Checking path patterns for auth config (fallback)', { url });
    
    // Try to dynamically get VideoConfigurationManager
    const { VideoConfigurationManager } = require('../config/VideoConfigurationManager');
    const configManager = VideoConfigurationManager.getInstance();
    const pathPatterns = configManager.getConfig().pathPatterns || [];

    // Check if any path pattern applies to this URL and has auth configuration
    for (const pattern of pathPatterns) {
      if (pattern.originUrl && url.includes(pattern.originUrl) && pattern.auth) {
        logDebug('Found auth config in path pattern', {
          url,
          patternName: pattern.name,
          authType: pattern.auth.type
        });
        return pattern.auth;
      }
      
      // Check for pattern-specific auth in storage config
      const patternAuthKey = `${pattern.name}Auth`;
      if (pattern.originUrl && 
          url.includes(pattern.originUrl) && 
          storageConfig[patternAuthKey]) {
        logDebug('Found pattern-specific auth config in storage config', {
          url,
          patternName: pattern.name,
          authKey: patternAuthKey,
          authType: storageConfig[patternAuthKey].type
        });
        return storageConfig[patternAuthKey];
      }
    }
  } catch (err) {
    logDebug('Error checking path patterns for auth config', {
      url,
      error: err instanceof Error ? err.message : String(err)
    });
  }

  // Check if this URL matches the remote URL
  if (storageConfig.remoteUrl && url.startsWith(storageConfig.remoteUrl)) {
    return storageConfig.remoteAuth || null;
  }

  // Check if this URL matches the fallback URL
  if (storageConfig.fallbackUrl && url.startsWith(storageConfig.fallbackUrl)) {
    return storageConfig.fallbackAuth || null;
  }
  
  // Check for any pattern-specific auth configurations directly in the storage config
  // Iterate through all properties that end with 'Auth'
  for (const key in storageConfig) {
    if (key.endsWith('Auth') && 
        key !== 'remoteAuth' && 
        key !== 'fallbackAuth') {
      
      // Extract pattern name from auth key (e.g., 'standardAuth' -> 'standard')
      const patternName = key.slice(0, -4);
      
      // Check if we have a matching URL for this pattern
      const patternUrl = storageConfig[`${patternName}Url`] || storageConfig.remoteUrl;
      if (patternUrl && url.startsWith(patternUrl)) {
        logDebug('Found pattern-specific auth config by URL matching', {
          url,
          patternName,
          authKey: key,
          authType: storageConfig[key].type
        });
        return storageConfig[key];
      }
    }
  }

  return null;
}

/**
 * Get storage type for a URL
 * 
 * @param url The URL to get storage type for
 * @param storageConfig Storage configuration
 * @returns 'remote', 'fallback', or null if not determined
 */
export function getStorageType(url: string, storageConfig?: StorageConfig): 'remote' | 'fallback' | null {
  if (!storageConfig) return null;

  // Check if URL matches the remote URL
  if (storageConfig.remoteUrl && url.includes(storageConfig.remoteUrl)) {
    return 'remote';
  }

  // Check if URL matches the fallback URL
  if (storageConfig.fallbackUrl && url.includes(storageConfig.fallbackUrl)) {
    return 'fallback';
  }

  // Simple heuristic - if URL contains S3 or Azure Storage patterns, assume remote
  if (url.includes('amazonaws.com') || url.includes('s3.') || url.includes('blob.core.windows.net')) {
    return 'remote';
  }

  return null;
}

/**
 * Extract path from URL relative to a base URL
 * 
 * @param url Full URL
 * @param baseUrl Base URL to extract path from
 * @returns Path relative to base URL
 */
export function extractPath(url: string, baseUrl: string): string {
  try {
    // Try parsing URLs
    const urlObj = new URL(url);
    const baseUrlObj = new URL(baseUrl);
    
    // Get the path that comes after the base URL's path
    let path = urlObj.pathname;
    if (baseUrlObj.pathname !== '/' && baseUrlObj.pathname !== '') {
      path = path.replace(baseUrlObj.pathname, '');
      // Ensure path starts with /
      if (!path.startsWith('/')) {
        path = '/' + path;
      }
    }
    
    return path;
  } catch (err) {
    // If URL parsing fails, try simple string manipulation
    let path = url.replace(baseUrl, '');
    // Remove protocol, hostname, etc. if still present
    path = path.replace(/^https?:\/\/[^\/]+\//, '/');
    // Ensure path starts with /
    if (!path.startsWith('/')) {
      path = '/' + path;
    }
    return path;
  }
}

// Import the token utility functions from the separate file
import { extractAuthToken, reconstructPresignedUrl } from './urlTokenUtils';

// Re-export the functions for backward compatibility
export { extractAuthToken, reconstructPresignedUrl };

/**
 * Get or generate a presigned URL for an asset
 * 
 * @param env Environment variables
 * @param url URL to be presigned
 * @param storageConfig Storage configuration 
 * @returns Original URL or presigned URL if applicable
 */
// The implementation function - MODIFIED SIGNATURE
async function getOrGeneratePresignedUrlImpl(
  env: EnvVariables,
  url: string,
  storageConfig: StorageConfig,
  patternContext: PresigningPatternContext | null // <-- ADDED: Context from the matched pattern
): Promise<string> {
  // Check if presigning is needed
  if (!needsPresigning(url, storageConfig)) {
    logDebug('URL does not need presigning', { url });
    return url;
  }

  // Determine the correct base URL for path extraction
  let baseUrlForPathExtraction: string | null = null;
  let authConfigForPresigning: AwsAuthConfig | null = null;
  // Using a type that allows both enum values and pattern names
let storageTypeForCache: string = 'remote'; // Default or derive more specifically

  if (patternContext && patternContext.originUrl) {
    baseUrlForPathExtraction = patternContext.originUrl;
    authConfigForPresigning = patternContext.auth;
    // You might want a more specific storageType based on the pattern name
    storageTypeForCache = patternContext.name;
    logDebug('Using pattern context for presigning', {
      patternName: patternContext.name,
      baseUrl: baseUrlForPathExtraction,
      hasAuth: !!authConfigForPresigning
    });
  } else {
    // Fallback logic (less ideal, try to always provide patternContext)
    authConfigForPresigning = getAuthConfig(url, storageConfig); // Existing logic
    const storageType = getStorageType(url, storageConfig);
    if (storageType) {
      // Get the appropriate base URL based on storage type
      if (storageType === 'remote') {
        baseUrlForPathExtraction = storageConfig.remoteUrl || null;
      } else if (storageType === 'fallback') {
        baseUrlForPathExtraction = storageConfig.fallbackUrl || null;
      } else {
        // If it's a pattern name, try to get a pattern-specific URL
        const patternUrl = storageConfig[`${storageType}Url`];
        baseUrlForPathExtraction = (patternUrl || storageConfig.remoteUrl || null);
      }
      storageTypeForCache = storageType;
      logDebug('Falling back to storage config for presigning', { 
        storageType, 
        baseUrl: baseUrlForPathExtraction 
      });
    }
  }

  // Ensure we have a base URL
  if (!baseUrlForPathExtraction) {
    logDebug('Missing base URL for path extraction', { url });
    return url; // Cannot proceed without a base URL
  }

  // Ensure we have auth config
  if (!authConfigForPresigning) {
    logDebug('Missing auth config for presigning', { 
      url, 
      patternName: patternContext?.name 
    });
    // Decide if returning the original URL is correct here, or if it should be an error
    // If an auth pattern matched, lack of config IS an error.
    // If no auth pattern matched, returning original URL might be okay.
    return url;
  }

  // Extract path using the *correct* base URL
  const path = extractPath(url, baseUrlForPathExtraction);

  logDebug('Extracted path for presigning using determined base URL', {
    url,
    baseUrl: baseUrlForPathExtraction,
    path,
    storageType: storageTypeForCache // Use the potentially more specific type
  });
  
  // Check cache for presigned URL if KV namespace exists
  const presignedKV = getPresignedUrlKV(env);
  if (presignedKV) {
    try {
      const cachedEntry = await getPresignedUrl(
        presignedKV,
        path,
        {
          storageType: storageTypeForCache, // Use potentially specific type
          authType: authConfigForPresigning.type, // Use determined auth config
          region: authConfigForPresigning.region ?? 'us-east-1',
          service: authConfigForPresigning.service ?? 's3',
          env
        }
      );
      
      if (cachedEntry) {
        // verifyPresignedUrl is already imported at the top
        
        // Add breadcrumb for the cache hit
        const requestContext = getCurrentContext();
        if (requestContext) {
          addBreadcrumb(requestContext, 'Cache', 'Presigned URL cache hit', {
            path,
            storageType: storageTypeForCache,
            expiresIn: Math.floor((cachedEntry.expiresAt - Date.now()) / 1000) + 's'
          });
        }
        
        // Check if we should verify the URL validity with a HEAD request
        const shouldVerifyUrl = authConfigForPresigning.verifyBeforeUse === true;
        let isValid = true;
        
        if (shouldVerifyUrl) {
          logDebug('Verifying cached presigned URL validity', { path });
          isValid = await verifyPresignedUrl(cachedEntry.url);
          
          if (!isValid) {
            logDebug('Cached presigned URL is invalid, regenerating', { path });
            
            // Regenerate URL in the background (using waitUntil if available)
            if (env.executionCtx?.waitUntil && presignedKV) {
              const refreshOperation = refreshPresignedUrl(
                presignedKV,
                cachedEntry,
                {
                  env,
                  generateUrlFn: async () => {
                    // This will trigger a new URL generation below
                    return 'pending-regeneration';
                  },
                  verifyUrl: true
                }
              );
              
              env.executionCtx.waitUntil(refreshOperation);
            }
            
            // Continue to generate a new URL below
          } else {
            logDebug('Cached presigned URL verification successful', { path });
            
            // Check if it's close to expiration and refresh in the background if needed
            if (isUrlExpiring(cachedEntry)) {
              logDebug('Cached presigned URL is valid but expiring soon, refreshing in background', { path });
              
              // Refresh in the background if execution context is available
              if (env.executionCtx?.waitUntil && presignedKV) {
                const refreshOperation = refreshPresignedUrl(
                  presignedKV,
                  cachedEntry,
                  {
                    env,
                    generateUrlFn: async (refreshPath) => {
                      // Generate a new URL for refreshing - this is a recursive call but safe
                      // because it will only happen in the background
                      return await getOrGeneratePresignedUrlImpl(env, cachedEntry.originalUrl, storageConfig, patternContext);
                    },
                    verifyUrl: true
                  }
                );
                
                env.executionCtx.waitUntil(refreshOperation);
              }
              
              // Continue to use the current valid URL
              return cachedEntry.url;
            }
            
            // Use the cached and verified URL
            logDebug('Using cached verified AWS S3 Presigned URL', {
              path,
              expiresIn: Math.floor((cachedEntry.expiresAt - Date.now()) / 1000) + 's',
              urlLength: cachedEntry.url.length
            });
            
            return cachedEntry.url;
          }
        } else {
          // Not verifying, just use the cached URL
          logDebug('Using cached AWS S3 Presigned URL', {
            path,
            expiresIn: Math.floor((cachedEntry.expiresAt - Date.now()) / 1000) + 's',
            urlLength: cachedEntry.url.length
          });
          
          return cachedEntry.url;
        }
      }
      
      // No cached URL found, generate a new one
      logDebug('No cached presigned URL found, generating new one', { path });
    } catch (err) {
      // Log error but continue with normal URL generation
      logDebug('Error retrieving cached presigned URL', {
        path,
        error: err instanceof Error ? err.message : String(err)
      });
    }
  }
  
  // Generate new presigned URL
  // Handle presigned URL generation
  const accessKeyVar = authConfigForPresigning.accessKeyVar ?? 'AWS_ACCESS_KEY_ID';
  const secretKeyVar = authConfigForPresigning.secretKeyVar ?? 'AWS_SECRET_ACCESS_KEY';
  const sessionTokenVar = authConfigForPresigning.sessionTokenVar;
  
  // Access environment variables
  const envRecord = env as unknown as Record<string, string | undefined>;
  
  const accessKey = envRecord[accessKeyVar] as string;
  const secretKey = envRecord[secretKeyVar] as string;
  const sessionToken = sessionTokenVar ? envRecord[sessionTokenVar] as string : undefined;
  
  // Get expiration time for presigned URL
  const expiresIn = authConfigForPresigning.expiresInSeconds ?? 3600;
  
  if (accessKey && secretKey) {
    try {
      // Import AwsClient
      const { AwsClient } = await import('aws4fetch');
      
      // Setup AWS client
      const aws = new AwsClient({
        accessKeyId: accessKey,
        secretAccessKey: secretKey,
        sessionToken,
        service: authConfigForPresigning.service ?? 's3',
        region: authConfigForPresigning.region ?? 'us-east-1'
      });
      
      // Create a request to sign
      const signRequest = new Request(url, {
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
      const presignedUrl = signedRequest.url;
      
      logDebug('Generated AWS S3 Presigned URL', {
        // Avoid logging the full URL which contains credentials
        urlLength: presignedUrl.length,
        expiresIn,
        success: true
      });
      
      // Cache the generated URL if KV binding exists
      if (presignedKV) {
        try {
          await storePresignedUrl(
            presignedKV,
            path,
            presignedUrl,
            url,
            {
              storageType: storageTypeForCache, // Use potentially specific type
              expiresInSeconds: expiresIn,
              authType: authConfigForPresigning.type, // Use determined auth config
              region: authConfigForPresigning.region ?? 'us-east-1',
              service: authConfigForPresigning.service ?? 's3',
              env
            }
          );
          
          logDebug('Cached new presigned URL', {
            path,
            expiresIn
          });
        } catch (cacheErr) {
          // Log but continue - caching failure shouldn't stop the request
          logDebug('Error caching presigned URL', {
            path,
            error: cacheErr instanceof Error ? cacheErr.message : String(cacheErr)
          });
        }
      }
      
      return presignedUrl;
    } catch (err) {
      // Log error with standardized error handling
      logErrorWithContext(
        'Error generating AWS S3 Presigned URL',
        err,
        {
          url,
          accessKeyVar,
          secretKeyVar
        },
        'PresignedUrlUtils'
      );
      
      // Return the original URL as fallback
      return url;
    }
  } else {
    // Log error with standardized error handling
    logErrorWithContext(
      'AWS credentials not found for presigned URL generation',
      new Error('Missing credentials'),
      {
        accessKeyVar,
        secretKeyVar
      },
      'PresignedUrlUtils'
    );
    
    // Return the original URL as fallback
    return url;
  }
}

/**
 * Properly encode a presigned URL for inclusion in another URL
 * This handles the double-encoding challenge when a URL contains a URL
 * 
 * @param url The presigned URL to encode
 * @returns Properly encoded URL for use in a CDN-CGI transformation URL
 */
export function encodePresignedUrl(url: string): string {
  // Leave AWS presigned URLs completely unmodified to preserve the signature
  if (url.includes('X-Amz-Credential') && url.includes('X-Amz-Signature')) {
    return url;
  }
  
  // For non-AWS URLs, apply standard encoding
  const [baseUrl, query] = url.split('?');
  
  if (!query) {
    return url;
  }
  
  const encodedParams = query.split('&').map(param => {
    const [key, value] = param.split('=');
    if (!value) return key;
    return `${key}=${encodeURIComponent(value)}`;
  });
  
  return `${baseUrl}?${encodedParams.join('&')}`;
}

// Export the wrapped function using tryOrNull - MODIFIED SIGNATURE
export const getOrGeneratePresignedUrl = tryOrNull<
  [EnvVariables, string, StorageConfig, PresigningPatternContext | null], // <-- ADDED patternContext
  Promise<string>
>(
  getOrGeneratePresignedUrlImpl,
  {
    functionName: 'getOrGeneratePresignedUrl',
    component: 'PresignedUrlUtils',
    logErrors: true
  }
);
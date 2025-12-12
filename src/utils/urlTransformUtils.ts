/**
 * Transforms a request URL based on deployment mode and configuration
 */
import { VideoConfigurationManager } from '../config/VideoConfigurationManager';
import { EnvironmentConfig } from '../config/environmentConfig';
import { tryOrDefault, tryOrNull, logErrorWithContext } from './errorHandlingUtils';

// No need for CDN URL - we use the request origin directly

/**
 * Interface for the response from URL transformation
 */
interface TransformedRequest {
  originRequest: Request;
  bucketName: string;
  originUrl: string;
  derivative: string | null;
  isRemoteFetch: boolean;
}

/**
 * Interface for path transformation configuration
 */
interface PathTransform {
  removePrefix?: boolean;
  prefix?: string;
}

/**
 * Interface for deployment configuration
 */
interface DeploymentConfig {
  deploymentMode?: 'direct' | 'remote';
  remoteBuckets?: Record<string, string>;
  pathTransforms?: Record<string, PathTransform>;
  derivativeTemplates?: Record<string, string>;
}

/**
 * Implementation of transformRequestUrl that might throw errors
 * @param request Original request
 * @param config Combined environment and deployment configuration
 * @param env Optional environment variables
 * @returns Transformed request information
 */
function transformRequestUrlImpl(
  request: Request, 
  config: EnvironmentConfig & DeploymentConfig, 
  env?: Record<string, unknown>
): TransformedRequest {
  const url = new URL(request.url);
  const path = url.pathname;
  const segments = path.split('/').filter((segment) => segment);

  // Default result assuming direct deployment
  const result: TransformedRequest = {
    originRequest: request,
    bucketName: 'default',
    originUrl: url.toString(),
    derivative: null,
    isRemoteFetch: false,
  };

  // Handle direct deployment
  if (config.deploymentMode === 'direct') {
    result.derivative = getDerivativeForPath(segments, path, config);
    return result;
  }

  // Handle remote mode (separate worker fetching from remote buckets)
  result.isRemoteFetch = true;

  // Find matching bucket
  if (segments.length > 0 && config.remoteBuckets) {
    const bucketMatch = Object.keys(config.remoteBuckets).find(
      (bucket) => segments[0] === bucket || path.includes(`/${bucket}/`)
    );

    if (bucketMatch) {
      result.bucketName = bucketMatch;
    }
  }

  // Determine derivative
  result.derivative = getDerivativeForPath(segments, path, config);

  // Transform the URL based on bucket and path transformation rules
  const transformedPath = transformPathForRemote(path, segments, result.bucketName, config);
  const remoteOrigin = getRemoteOrigin(result.bucketName, config, env);

  // Build the new origin URL
  const originUrl = buildOriginUrl(url, transformedPath, remoteOrigin);

  // Only update these properties if we got a valid URL back
  if (originUrl && originUrl.toString() !== 'https://placeholder.example.com/') {
    result.originUrl = originUrl.toString();
    result.originRequest = createOriginRequest(result.originUrl, request);
  } else {
    // Log an error about using the fallback URL
    try {
      logErrorWithContext(
        'Failed to build valid origin URL, using original request',
        new Error('Invalid origin URL'),
        { 
          path, 
          segments,
          bucketName: result.bucketName,
          transformedPath,
          remoteOrigin
        },
        'URLTransformUtils'
      );
    } catch (logErr) {
      // Last resort fallback if logging fails
      console.error({
        context: 'URLTransformUtils',
        operation: 'buildTargetUrl',
        message: 'URL transformation error and logging error',
        error: logErr instanceof Error ? { name: logErr.name, message: logErr.message, stack: logErr.stack } : String(logErr)
      });
    }
  }

  return result;
}

/**
 * Transform a video request URL based on configuration
 * Using tryOrDefault for safe URL transformation with proper error handling
 * 
 * @param request Original request
 * @param config Environment configuration
 * @param env Environment variables
 * @returns Transformed request information
 */
export const transformRequestUrl = tryOrDefault<
  [Request, EnvironmentConfig & DeploymentConfig, Record<string, unknown>?],
  TransformedRequest
>(
  transformRequestUrlImpl,
  {
    functionName: 'transformRequestUrl',
    component: 'URLTransformUtils',
    logErrors: true
  },
  {
    // Safe default if transformation fails completely, returns original request
    originRequest: undefined as unknown as Request, // Will be set in the wrapper
    bucketName: 'default',
    originUrl: '',  // Will be set in the wrapper
    derivative: null,
    isRemoteFetch: false
  }
);

/**
 * Implementation of getDerivativeForPath that might throw errors
 * @param segments Path segments
 * @param path Full path
 * @param config Configuration
 * @returns Derivative name or null
 */
function getDerivativeForPathImpl(
  segments: string[], 
  path: string, 
  config: DeploymentConfig
): string | null {
  // Get configuration manager instance
  const configManager = VideoConfigurationManager.getInstance();
  
  // Get known derivatives from configuration manager instead of hardcoding
  const knownDerivatives = Object.keys(configManager.getConfig().derivatives);

  // Check first segment if it's a known derivative
  if (segments.length > 0 && knownDerivatives.includes(segments[0])) {
    return segments[0];
  }

  // Check derivative templates from config
  if (config.derivativeTemplates) {
    // Look for the longest matching route to handle nested paths correctly
    const matchedRoutes = Object.keys(config.derivativeTemplates)
      .filter((route) => path.includes(`/${route}/`))
      .sort((a, b) => b.length - a.length); // Sort by length, longest first

    if (matchedRoutes.length > 0) {
      return config.derivativeTemplates[matchedRoutes[0]];
    }
  }

  return null;
}

/**
 * Get derivative type based on path and configuration
 * Using tryOrNull for safe derivative detection with proper error handling
 * 
 * @param segments Path segments
 * @param path Full path
 * @param config Configuration
 * @returns Derivative name or null
 */
export const getDerivativeForPath = tryOrNull<
  [string[], string, DeploymentConfig],
  string | null
>(
  getDerivativeForPathImpl,
  {
    functionName: 'getDerivativeForPath',
    component: 'URLTransformUtils',
    logErrors: true
  },
  null // Safe default is null if no derivative can be determined
);

/**
 * Implementation of transformPathForRemote that might throw errors
 * @param path Original path
 * @param segments Path segments
 * @param bucketName Bucket name
 * @param config Configuration
 * @returns Transformed path
 */
function transformPathForRemoteImpl(
  path: string,
  segments: string[],
  bucketName: string,
  config: DeploymentConfig
): string {
  let transformedPath = path;

  // Get configuration manager instance
  const configManager = VideoConfigurationManager.getInstance();
  
  // Get known derivatives from configuration manager instead of hardcoding
  const knownDerivatives = Object.keys(configManager.getConfig().derivatives);

  // Remove derivative prefix if present
  if (segments.length > 0 && knownDerivatives.includes(segments[0])) {
    transformedPath = `/${segments.slice(1).join('/')}`;
  }

  // Apply path transformations if configured
  const pathTransform = config.pathTransforms?.[bucketName];

  if (pathTransform) {
    // Remove bucket prefix if configured
    if (pathTransform.removePrefix) {
      transformedPath = transformedPath.replace(`/${bucketName}`, '');
    }

    // Add prefix if configured
    if (pathTransform.prefix) {
      const pathWithoutLeadingSlash = transformedPath.startsWith('/')
        ? transformedPath.substring(1)
        : transformedPath;
      transformedPath = `/${pathTransform.prefix}${pathWithoutLeadingSlash}`;
    }
  }

  return transformedPath;
}

/**
 * Transform path for remote buckets based on configuration
 * Using tryOrDefault for safe path transformation with proper error handling
 * 
 * @param path Original path
 * @param segments Path segments
 * @param bucketName Bucket name
 * @param config Configuration
 * @returns Transformed path
 */
export const transformPathForRemote = tryOrDefault<
  [string, string[], string, DeploymentConfig],
  string
>(
  transformPathForRemoteImpl,
  {
    functionName: 'transformPathForRemote',
    component: 'URLTransformUtils',
    logErrors: true
  },
  '' // Safe default is an empty path if transformation fails, will be updated in the wrapper
);

/**
 * Implementation of getRemoteOrigin that might throw errors
 * @param bucketName Bucket name
 * @param config Configuration
 * @param env Environment variables
 * @returns Remote origin URL
 */
function getRemoteOriginImpl(
  bucketName: string, 
  config: DeploymentConfig, 
  env?: Record<string, unknown>
): string {
  return (
    (config.remoteBuckets?.[bucketName]) ||
    (config.remoteBuckets?.default) ||
    (env?.FALLBACK_BUCKET as string) ||
    'https://placeholder.example.com'
  );
}

/**
 * Get remote origin URL for bucket
 * Using tryOrDefault for safe origin resolution with proper error handling
 * 
 * @param bucketName Bucket name
 * @param config Configuration
 * @param env Environment variables
 * @returns Remote origin URL
 */
export const getRemoteOrigin = tryOrDefault<
  [string, DeploymentConfig, Record<string, unknown>?],
  string
>(
  getRemoteOriginImpl,
  {
    functionName: 'getRemoteOrigin',
    component: 'URLTransformUtils',
    logErrors: true
  },
  'https://placeholder.example.com' // Safe default is the placeholder URL if resolution fails
);

/**
 * Implementation of buildOriginUrl that might throw errors
 * @param originalUrl Original URL
 * @param transformedPath Transformed path
 * @param remoteOrigin Remote origin
 * @returns Built origin URL
 */
function buildOriginUrlImpl(originalUrl: URL, transformedPath: string, remoteOrigin: string): URL {
  const originUrl = new URL(transformedPath, remoteOrigin);

  // List of video-specific params to exclude
  const videoParams = [
    // Basic dimension and quality parameters
    'width',
    'height',
    'bitrate',
    'quality',
    'format',
    'segment',
    'time',
    'derivative',
    'duration',
    'compression',
    
    // Video transformation method parameters
    'mode',
    'fit',
    'crop',
    'rotate',
    'imref',
    
    // Playback control parameters
    'loop',
    'preload',
    'autoplay',
    'muted',
    
    // Additional Cloudflare parameters
    'speed',
    'audio',
    'fps',
    'keyframe',
    'codec',
    
    // IMQuery parameters
    'imwidth',
    'imheight',
    'im-viewwidth',
    'im-viewheight',
    'im-density',
  ];

  // Copy over search params, excluding video-specific ones
  originalUrl.searchParams.forEach((value, key) => {
    if (!videoParams.includes(key)) {
      originUrl.searchParams.set(key, value);
    }
  });

  return originUrl;
}

/**
 * Build origin URL by combining remote origin with path and non-video params
 * Using tryOrDefault for safe URL building with proper error handling
 * 
 * @param originalUrl Original URL
 * @param transformedPath Transformed path
 * @param remoteOrigin Remote origin
 * @returns Built origin URL
 */
export const buildOriginUrl = tryOrDefault<
  [URL, string, string],
  URL
>(
  buildOriginUrlImpl,
  {
    functionName: 'buildOriginUrl',
    component: 'URLTransformUtils',
    logErrors: true
  },
  new URL('https://placeholder.example.com') // Safe default is a placeholder URL if building fails
);

/**
 * Implementation of createOriginRequest that might throw errors
 * @param originUrl Origin URL
 * @param originalRequest Original request
 * @returns New request
 */
function createOriginRequestImpl(originUrl: string, originalRequest: Request): Request {
  return new Request(originUrl, {
    method: originalRequest.method,
    headers: originalRequest.headers,
    body: originalRequest.body,
    redirect: 'follow',
  });
}

/**
 * Create new request for the origin
 * Using tryOrDefault for safe request creation with proper error handling
 * 
 * @param originUrl Origin URL
 * @param originalRequest Original request
 * @returns New request
 */
export const createOriginRequest = tryOrDefault<
  [string, Request],
  Request
>(
  createOriginRequestImpl,
  {
    functionName: 'createOriginRequest',
    component: 'URLTransformUtils',
    logErrors: true
  },
  new Request('https://placeholder.example.com') // Safe default if request creation fails
);

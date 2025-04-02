/**
 * Transforms a request URL based on deployment mode and configuration
 */
import { VideoConfigurationManager } from '../config/VideoConfigurationManager';
import { EnvironmentConfig } from '../config/environmentConfig';

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
 * Transform a video request URL based on configuration
 * @param request Original request
 * @param config Environment configuration
 * @param env Environment variables
 * @returns Transformed request information
 */
export function transformRequestUrl(
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

  result.originUrl = originUrl.toString();
  result.originRequest = createOriginRequest(result.originUrl, request);

  return result;
}

/**
 * Get derivative type based on path and configuration
 * @param segments Path segments
 * @param path Full path
 * @param config Configuration
 * @returns Derivative name or null
 */
function getDerivativeForPath(
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
 * Transform path for remote buckets based on configuration
 * @param path Original path
 * @param segments Path segments
 * @param bucketName Bucket name
 * @param config Configuration
 * @returns Transformed path
 */
function transformPathForRemote(
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
 * Get remote origin URL for bucket
 * @param bucketName Bucket name
 * @param config Configuration
 * @param env Environment variables
 * @returns Remote origin URL
 */
function getRemoteOrigin(
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
 * Build origin URL by combining remote origin with path and non-video params
 * @param originalUrl Original URL
 * @param transformedPath Transformed path
 * @param remoteOrigin Remote origin
 * @returns Built origin URL
 */
function buildOriginUrl(originalUrl: URL, transformedPath: string, remoteOrigin: string): URL {
  const originUrl = new URL(transformedPath, remoteOrigin);

  // List of video-specific params to exclude
  const videoParams = [
    'width',
    'height',
    'bitrate',
    'quality',
    'format',
    'segment',
    'time',
    'derivative',
    // Additional Cloudflare parameters
    'speed',
    'audio',
    'fps',
    'keyframe',
    'codec',
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
 * Create new request for the origin
 * @param originUrl Origin URL
 * @param originalRequest Original request
 * @returns New request
 */
function createOriginRequest(originUrl: string, originalRequest: Request): Request {
  return new Request(originUrl, {
    method: originalRequest.method,
    headers: originalRequest.headers,
    body: originalRequest.body,
    redirect: 'follow',
  });
}

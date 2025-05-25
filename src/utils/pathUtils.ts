/**
 * Utility functions for working with URL paths
 * This is a compatibility layer that uses OriginResolver internally
 */
import { VideoConfigurationManager } from '../config/VideoConfigurationManager';
import {
  TransformParams,
  TransformParamValue,
} from '../domain/strategies/TransformationStrategy';
import {
  OriginMatchResult,
  OriginResolver,
} from '../services/origins/OriginResolver';
import { Origin, Source } from '../services/videoStorage/interfaces';

/**
 * Path pattern interface with extended configuration
 */
export interface PathPattern {
  name: string;
  matcher: string;
  processPath: boolean;
  baseUrl: string | null;
  originUrl: string | null;
  quality?: string; // Optional quality preset for this path pattern
  cacheTtl?: number; // Legacy custom cache TTL for this path pattern (for backward compatibility)
  ttl?: { // Modern TTL configuration structure
    ok: number;
    redirects: number;
    clientError: number;
    serverError: number;
  };
  priority?: number; // Optional priority for pattern matching (higher values checked first)
  transformationOverrides?: Record<string, unknown>; // Optional parameter overrides for this path
  captureGroups?: string[]; // Names for regex capture groups
  auth?: { // Auth configuration for this path pattern
    type: string;
    enabled?: boolean;
    accessKeyVar?: string;
    secretKeyVar?: string;
    region?: string;
    service?: string;
    expiresInSeconds?: number;
    sessionTokenVar?: string;
  };
}

/**
 * Result from path pattern matching including captured values
 */
export interface PathMatchResult {
  pattern: PathPattern;
  matched: boolean;
  captures: Record<string, string>;
  originalPath: string;
}

// Helper function to convert an Origin to a PathPattern
function originToPathPattern(origin: Origin): PathPattern {
  // Find the highest priority source for origin URL
  let originUrl: string | null = null;
  let source: Source | null = null;

  if (origin.sources && origin.sources.length > 0) {
    // Sort by priority (lower number is higher)
    const sortedSources = [...origin.sources].sort((a, b) =>
      a.priority - b.priority
    );
    source = sortedSources[0];

    // Set originUrl if available from source
    if (source && source.url) {
      originUrl = source.url;
    }
  }

  return {
    name: origin.name,
    matcher: origin.matcher,
    processPath: origin.processPath ?? true,
    baseUrl: null, // Not directly equivalent in Origins
    originUrl: originUrl,
    quality: origin.quality,
    ttl: origin.ttl,
    priority: origin.sources[0]?.priority, // Use source priority
    transformationOverrides: origin.transformOptions,
    captureGroups: origin.captureGroups,
    auth: source?.auth
      ? {
        type: source.auth.type,
        enabled: source.auth.enabled,
        accessKeyVar: source.auth.accessKeyVar,
        secretKeyVar: source.auth.secretKeyVar,
        region: source.auth.region,
        service: source.auth.service,
        expiresInSeconds: source.auth.expiresInSeconds,
        sessionTokenVar: source.auth.sessionTokenVar,
      }
      : undefined,
  };
}

// Helper function to convert OriginMatchResult to PathMatchResult
function originMatchToPathMatch(
  originMatch: OriginMatchResult,
): PathMatchResult {
  return {
    pattern: originToPathPattern(originMatch.origin),
    matched: originMatch.matched,
    captures: originMatch.captures,
    originalPath: originMatch.originalPath,
  };
}

/**
 * Check if a URL path is a CDN-CGI media path
 * @param path The URL path to check
 * @returns True if the path is a CDN-CGI media path
 */
export function isCdnCgiMediaPath(path: string): boolean {
  const configManager = VideoConfigurationManager.getInstance();
  return path.startsWith(configManager.getCdnCgiConfig().basePath);
}

/**
 * Find a matching path pattern for a given URL path
 * Uses OriginResolver internally for pattern matching
 * @param path The URL path to match
 * @param patterns Array of path patterns to check against (ignored, uses Origins from config)
 * @returns The matching pattern or null if none match
 */
export function findMatchingPathPattern(
  path: string,
  patterns: PathPattern[],
): PathPattern | null {
  // Import logger utilities in case they're available
  let logDebug: (message: string, data?: Record<string, unknown>) => void;
  const console_debug = console.debug;

  try {
    // Define a fallback debug function to capture debug info during execution
    // since we might not have access to the proper logging system
    logDebug = (message: string, data?: Record<string, unknown>) => {
      console_debug(`[PathUtils-Compat] ${message}`, data || {});
    };
  } catch (err) {
    logDebug = (message: string, data?: Record<string, unknown>) => {
      console_debug(`[PathUtils-Compat] ${message}`, data || {});
    };
  }

  // Log that we're using the new OriginResolver-based implementation
  logDebug('Using OriginResolver for path pattern matching', { path });

  // Get the config and initialize the resolver
  const configManager = VideoConfigurationManager.getInstance();
  const config = configManager.getConfig();
  const resolver = new OriginResolver(config);

  // Log that we're finding a matching origin
  logDebug('Finding matching origin', {
    path,
    usingLegacyFallback: patterns && patterns.length > 0,
  });

  // Try to find a matching origin using the resolver
  try {
    const matchingOrigin = resolver.findMatchingOrigin(path);
    if (matchingOrigin) {
      // Convert the origin to a path pattern
      const pathPattern = originToPathPattern(matchingOrigin);
      logDebug('Found matching origin, converted to path pattern', {
        originName: matchingOrigin.name,
        pathPatternName: pathPattern.name,
      });
      return pathPattern;
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    logDebug('Error finding matching origin', { error: errorMessage });
  }

  // If no match found through Origins, and we have legacy patterns, use those as fallback
  if (patterns && patterns.length > 0) {
    logDebug('No matching origin found, falling back to legacy path patterns', {
      patternCount: patterns.length,
      patternNames: patterns.map((p) => p.name),
    });

    // Sort patterns by priority if specified (higher values first)
    const sortedPatterns = [...patterns].sort((a, b) => {
      const priorityA = a.priority ?? 0;
      const priorityB = b.priority ?? 0;
      return priorityB - priorityA;
    });

    for (let i = 0; i < sortedPatterns.length; i++) {
      const pattern = sortedPatterns[i];

      try {
        // Log pattern details before testing
        logDebug(`Testing legacy pattern #${i}: ${pattern.name}`, {
          matcher: pattern.matcher,
          path: path,
        });

        const regex = new RegExp(pattern.matcher);
        const isMatch = regex.test(path);

        if (isMatch) {
          logDebug(`Found matching legacy pattern: ${pattern.name}`, {
            matcher: pattern.matcher,
            path: path,
            processPath: pattern.processPath,
          });
          return pattern;
        }
      } catch (err) {
        const errorMessage = err instanceof Error
          ? err.message
          : 'Unknown error';
        logDebug(`Error testing legacy pattern #${i}: ${pattern.name}`, {
          matcher: pattern.matcher,
          error: errorMessage,
        });
      }
    }
  }

  logDebug('No matching pattern found for path', { path });
  return null;
}

/**
 * Find a matching path pattern with captured groups
 * Uses OriginResolver internally for pattern matching with captures
 * @param path The URL path to match
 * @param patterns Array of path patterns to check against (ignored, uses Origins from config)
 * @returns A path match result with pattern and captures
 */
export function matchPathWithCaptures(
  path: string,
  patterns: PathPattern[],
): PathMatchResult | null {
  // Get the config and initialize the resolver
  const configManager = VideoConfigurationManager.getInstance();
  const config = configManager.getConfig();
  const resolver = new OriginResolver(config);

  // Try to find a matching origin with captures using the resolver
  try {
    const originMatch = resolver.matchOriginWithCaptures(path);
    if (originMatch) {
      // Convert the origin match to a path match result
      return originMatchToPathMatch(originMatch);
    }
  } catch (err) {
    console.debug(
      '[PathUtils-Compat] Error finding matching origin with captures',
      {
        error: err instanceof Error ? err.message : String(err),
        path,
      },
    );
  }

  // If no match found through Origins, and we have legacy patterns, use those as fallback
  if (patterns && patterns.length > 0) {
    // Sort patterns by priority if specified (higher values first)
    const sortedPatterns = [...patterns].sort((a, b) => {
      const priorityA = a.priority ?? 0;
      const priorityB = b.priority ?? 0;
      return priorityB - priorityA;
    });

    for (const pattern of sortedPatterns) {
      const regex = new RegExp(pattern.matcher);
      const match = path.match(regex);

      if (match) {
        const captures: Record<string, string> = {};

        // Add numbered captures
        for (let i = 1; i < match.length; i++) {
          captures[i.toString()] = match[i];

          // If there are named capture groups defined, use those names too
          if (pattern.captureGroups && i <= pattern.captureGroups.length) {
            const name = pattern.captureGroups[i - 1];
            if (name) {
              captures[name] = match[i];
            }
          }
        }

        return {
          pattern,
          matched: true,
          captures,
          originalPath: path,
        };
      }
    }
  }

  return null;
}

/**
 * Extract video ID from a path using a path pattern
 * @param path The URL path
 * @param pattern The path pattern to use
 * @returns The extracted video ID or null if no match
 */
export function extractVideoId(
  path: string,
  pattern: PathPattern,
): string | null {
  const result = matchPathWithCaptures(path, [pattern]);
  if (!result) return null;

  // Try named videoId capture first
  if (result.captures['videoId']) {
    return result.captures['videoId'];
  }

  // Then try to use the first capture group
  if (result.captures['1']) {
    return result.captures['1'];
  }

  return null;
}

/**
 * Normalize a video path to a canonical form
 * @param path The path to normalize
 * @returns The normalized path
 */
export function normalizeVideoPath(path: string): string {
  // Remove double slashes (except after protocol)
  const normalizedPath = path.replace(/([^:])\/\//g, '$1/');

  // Remove trailing slash if present
  return normalizedPath.endsWith('/')
    ? normalizedPath.slice(0, -1)
    : normalizedPath;
}

/**
 * Create a path for a specific video quality
 * @param originalPath The original video path
 * @param quality The quality to use (e.g., 720p, 1080p)
 * @returns The path with quality indicator
 */
export function createQualityPath(
  originalPath: string,
  quality: string,
): string {
  // Don't modify paths that already contain quality indicators
  if (originalPath.includes('/quality/')) {
    return originalPath;
  }

  // Handle both full URLs and path-only strings
  let url: URL;
  let isFullUrl = false;

  try {
    // Try to parse as a full URL
    url = new URL(originalPath);
    isFullUrl = true;
  } catch {
    // If it fails, treat as a path
    url = new URL(originalPath, 'https://example.com');
  }

  const pathParts = url.pathname.split('/');

  // Insert quality before the filename
  const filename = pathParts.pop() || '';
  pathParts.push('quality', quality, filename);

  // Create new path
  const newPath = pathParts.join('/');

  // Return full URL or just the path
  if (isFullUrl) {
    url.pathname = newPath;
    return url.toString();
  } else {
    return newPath;
  }
}

/**
 * Builds a CDN-CGI media transformation URL synchronously (without presigning)
 * @param options Transformation options
 * @param originUrl Full URL to the origin video (content source URL)
 * @param requestUrl The original request URL (host will be used for the CDN-CGI path)
 * @returns A CDN-CGI media transformation URL
 */
export function buildCdnCgiMediaUrl(
  options: TransformParams,
  originUrl: string,
  requestUrl?: string,
): string {
  const result = buildCdnCgiMediaUrlImpl(options, originUrl, requestUrl, false);
  // Ensure we're returning a string, not a Promise
  if (typeof result === 'string') {
    return result;
  }
  throw new Error(
    'Unexpected Promise returned from synchronous buildCdnCgiMediaUrl',
  );
}

/**
 * Builds a CDN-CGI media transformation URL with async support for presigning
 * @param options Transformation options
 * @param originUrl Full URL to the origin video (content source URL)
 * @param requestUrl The original request URL (host will be used for the CDN-CGI path)
 * @param env The environment variables needed for presigning
 * @param matchedPattern Optional matched path pattern for context
 * @returns Promise resolving to a CDN-CGI media transformation URL
 */
export async function buildCdnCgiMediaUrlAsync(
  options: TransformParams,
  originUrl: string,
  requestUrl?: string,
  env?: any,
  matchedPattern?: PathPattern | null,
): Promise<string> {
  return buildCdnCgiMediaUrlImpl(
    options,
    originUrl,
    requestUrl,
    true,
    env,
    matchedPattern,
  );
}

/**
 * Implementation of buildCdnCgiMediaUrl that can work synchronously or asynchronously
 * @param options Transformation options
 * @param originUrl Full URL to the origin video (content source URL)
 * @param requestUrl The original request URL (host will be used for the CDN-CGI path)
 * @param waitForPresigning Whether to wait for presigning to complete (async mode)
 * @param environment The environment variables needed for presigning
 * @param matchedPattern Optional matched path pattern for context
 * @returns A CDN-CGI media transformation URL or Promise resolving to one
 */
function buildCdnCgiMediaUrlImpl(
  options: TransformParams,
  originUrl: string,
  requestUrl?: string,
  waitForPresigning: boolean = false,
  environment?: any,
  matchedPattern?: PathPattern | null,
): string | Promise<string> {
  const configManager = VideoConfigurationManager.getInstance();
  const { basePath } = configManager.getCdnCgiConfig();

  // Initialize with a default fallback logger
  let logDebug: (message: string, data?: Record<string, unknown>) => void = (
    message,
    data,
  ) => {
    console.debug(`[PathUtils-Compat] ${message}`, data || {});
  };

  // Quick check for URLs that likely need presigning (without importing presignedUrlUtils)
  const likelyNeedsPresigning = originUrl.includes('s3.') ||
    originUrl.includes('amazonaws.com') ||
    originUrl.includes('prod-eu-west-1-mcdc-media') ||
    originUrl.includes('blob.core.windows.net') ||
    originUrl.includes('storage.googleapis.com');

  // Force the async path if the URL looks like it might need presigning
  const shouldUseAsyncPath = waitForPresigning || likelyNeedsPresigning;

  // Try to use the proper logger if possible
  try {
    // We'll directly use the debug utility from loggerUtils
    import('./loggerUtils').then(({ debug }) => {
      // Update the logDebug function with the proper logger
      logDebug = (message, data) => debug('PathUtils-Compat', message, data);
    }).catch(() => {
      // If import fails, we'll keep using the fallback logger
    });
  } catch (err) {
    // Already using fallback logger, so no action needed
  }

  // Filter out null/undefined options
  const validOptions = Object.entries(options)
    .filter(([_, value]) => value !== null && value !== undefined)
    .reduce(
      (obj, [key, value]) => {
        obj[key] = value;
        return obj;
      },
      {} as Record<string, TransformParamValue>,
    );

  // Format options as a comma-separated string
  const optionsString = Object.entries(validOptions)
    .map(([key, value]) => `${key}=${value}`)
    .join(',');

  // Get the base URL from the request URL (if provided) or fall back to origin URL
  // This ensures the CDN-CGI URL is constructed with the request's host
  const baseUrlSource = requestUrl || originUrl;
  const baseUrlObj = new URL(baseUrlSource);
  const baseUrl = `${baseUrlObj.protocol}//${baseUrlObj.host}`;

  // Helper function to build the final CDN-CGI URL
  const buildFinalUrl = (url: string): string => {
    // Don't URL encode the origin URL - use it directly for best compatibility with CDN-CGI
    // CDN-CGI doesn't require URL encoding on the source URL parameter
    const finalUrl = `${baseUrl}${basePath}/${optionsString}/${url}`;

    // Log the transformation details (critical for debugging)
    logDebug('Building CDN-CGI media URL', {
      cdnCgiBasePath: basePath,
      transformParams: validOptions,
      parameterString: optionsString,
      originalOriginUrl: originUrl,
      finalOriginUrl: url,
      requestUrl: requestUrl || 'not provided',
      baseUrl: baseUrl,
      transformedUrl: finalUrl,
      paramCount: Object.keys(validOptions).length,
      keyParams: {
        width: validOptions.width,
        height: validOptions.height,
        format: validOptions.format,
        quality: validOptions.quality,
        mode: validOptions.mode,
        fit: validOptions.fit,
        compression: validOptions.compression,
        duration: validOptions.duration,
        time: validOptions.time,
      },
      hasDuration: 'duration' in validOptions,
    });

    return finalUrl;
  };

  // Helper function to add breadcrumb
  const addBreadcrumbForUrl = (url: string, finalUrl: string) => {
    try {
      // Using dynamic import to avoid circular dependencies
      import('../utils/requestContext').then(
        ({ getCurrentContext, addBreadcrumb }) => {
          const context = getCurrentContext();
          if (context) {
            addBreadcrumb(
              context,
              'CDN-CGI',
              'Built media transformation URL',
              {
                // Include the full parameters for debugging
                params: validOptions,
                paramCount: Object.keys(validOptions).length,
                // Include key parameters individually for easier filtering
                width: validOptions.width,
                height: validOptions.height,
                format: validOptions.format,
                quality: validOptions.quality,
                mode: validOptions.mode,
                fit: validOptions.fit,
                compression: validOptions.compression,
                duration: validOptions.duration,
                time: validOptions.time,
                hasDuration: 'duration' in validOptions,
                // Include URL details
                basePath,
                baseUrl,
                // Include source and transformation URLs
                originalOriginUrl: originUrl,
                finalOriginUrl: url,
                requestUrl: requestUrl || 'not provided',
                baseUrlSource: baseUrlSource,
                // Include the complete URL for debugging
                completeUrl: finalUrl,
              },
            );
          }
        },
      ).catch(() => {
        // Silent fail if we can't add the breadcrumb
      });
    } catch (err) {
      // Silent fail if requestContext isn't available
    }
  };

  // For S3 URLs or any that likely need presigning, we need to handle the presigning FIRST
  if (shouldUseAsyncPath) {
    try {
      // Use the passed environment parameter instead of trying to access it from globalThis
      const env = environment;
      if (env) {
        // Handle the async path
        return Promise.resolve().then(async () => {
          try {
            // Log what we're doing
            logDebug('URL likely needs presigning for CDN-CGI transformation', {
              originalUrl: originUrl,
              likelyNeedsPresigning,
            });

            // Dynamically import the presignedUrlUtils module
            const presignedUrlUtils = await import('./presignedUrlUtils');

            // Get video config containing storage configuration
            const videoConfig = configManager.getConfig().storage;

            // Log video config for debugging
            logDebug('Video storage config for presigning', {
              hasVideoConfig: !!videoConfig,
              storageInfo: videoConfig
                ? {
                  remoteUrl: videoConfig.remoteUrl,
                  fallbackUrl: videoConfig.fallbackUrl,
                  hasRemoteAuth: !!videoConfig.remoteAuth,
                  hasFallbackAuth: !!videoConfig.fallbackAuth,
                }
                : 'none',
            });

            // Import the PresigningPatternContext type
            type PresigningPatternContext = {
              originUrl: string | null;
              auth: {
                type: string;
                region?: string;
                service?: string;
                expiresInSeconds?: number;
                accessKeyVar?: string;
                secretKeyVar?: string;
                sessionTokenVar?: string;
              } | null;
              name: string;
            };

            // Prepare pattern context for presigning
            const patternContextForPresigning: PresigningPatternContext | null =
              matchedPattern
                ? {
                  originUrl: matchedPattern.originUrl,
                  auth: matchedPattern.auth || null, // Pass pattern's auth config
                  name: matchedPattern.name,
                }
                : null;

            // Check if presigning is needed using the specific pattern context if available
            const needsSigning = matchedPattern
              ? presignedUrlUtils.needsPresigning(
                originUrl,
                videoConfig,
                patternContextForPresigning,
              ) // Pass context here too
              : presignedUrlUtils.needsPresigning(originUrl, videoConfig); // Fallback if no pattern

            if (videoConfig && needsSigning) {
              try {
                // Generate the presigned URL first, passing the pattern context
                const presignedUrl = await presignedUrlUtils
                  .getOrGeneratePresignedUrl(
                    env,
                    originUrl, // Pass the constructed origin URL
                    videoConfig,
                    patternContextForPresigning, // <-- Pass the specific pattern context
                  );

                if (presignedUrl && presignedUrl !== originUrl) {
                  // We need to properly encode the presigned URL for use in the CDN-CGI URL
                  // The CDN-CGI service needs the proper encoding to correctly access the content

                  // Call the encodePresignedUrl utility to handle proper encoding
                  const encodedPresignedUrl = presignedUrlUtils
                    .encodePresignedUrl(presignedUrl);

                  logDebug(
                    'Using encoded presigned URL for CDN-CGI transformation',
                    {
                      hasPresignedUrl: true,
                      originalUrlLength: originUrl.length,
                      presignedUrlLength: presignedUrl.length,
                      encodedUrlLength: encodedPresignedUrl.length,
                      signaturePresent:
                        presignedUrl.includes('X-Amz-Signature') ||
                        presignedUrl.includes('Signature='),
                      useEncoding: presignedUrl !== encodedPresignedUrl
                    },
                  );

                  // Build the CDN-CGI URL with the encoded presigned URL
                  const finalUrl = buildFinalUrl(encodedPresignedUrl);
                  addBreadcrumbForUrl(presignedUrl, finalUrl);
                  return finalUrl;
                }
              } catch (err) {
                logDebug(
                  'Error generating presigned URL for Media Transformation',
                  {
                    error: err instanceof Error ? err.message : String(err),
                    url: originUrl,
                  },
                );
              }
            } else {
              logDebug('URL does not need presigning', {
                url: originUrl,
                needsPresigning: false,
              });
            }

            // For URLs that don't need presigning or if presigning failed, filter video-specific params
            // Create a new URL object for filtered origin URL
            const filteredOriginUrlObj = new URL(originUrl);

            // Clear search params to rebuild without transformation parameters
            filteredOriginUrlObj.search = '';

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
              'duration',
              'compression',
              'mode',
              'fit',
              'crop',
              'rotate',
              'imref',
              'loop',
              'preload',
              'autoplay',
              'muted',
              'speed',
              'audio',
              'fps',
              'keyframe',
              'codec',
              'imwidth',
              'imheight',
              'im-viewwidth',
              'im-viewheight',
              'im-density',
              'debug',
            ];

            // Copy over search params, excluding video-specific ones
            new URL(originUrl).searchParams.forEach((value, key) => {
              if (!videoParams.includes(key)) {
                filteredOriginUrlObj.searchParams.set(key, value);
              }
            });

            // Preserve debug=view parameter if present
            const hasDebugParam = new URL(originUrl).searchParams.has('debug');
            const debugParamValue = hasDebugParam
              ? new URL(originUrl).searchParams.get('debug')
              : null;
            if (hasDebugParam && debugParamValue === 'view') {
              filteredOriginUrlObj.searchParams.set('debug', debugParamValue);
              logDebug('Preserving debug=view parameter');
            }

            // Use the filtered URL
            const filteredOriginUrl = filteredOriginUrlObj.toString();

            // Build the final URL with the filtered non-presigned URL
            const finalUrl = buildFinalUrl(filteredOriginUrl);
            addBreadcrumbForUrl(filteredOriginUrl, finalUrl);
            return finalUrl;
          } catch (err) {
            // Error in the async path, log it and fall back to the sync path
            logDebug('Error in async path of buildCdnCgiMediaUrlImpl', {
              error: err instanceof Error ? err.message : String(err),
            });

            // Filter and build URL for fallback
            const filteredOriginUrlObj = new URL(originUrl);
            filteredOriginUrlObj.search = '';
            const filteredOriginUrl = filteredOriginUrlObj.toString();

            const finalUrl = buildFinalUrl(filteredOriginUrl);
            addBreadcrumbForUrl(filteredOriginUrl, finalUrl);
            return finalUrl;
          }
        });
      }
    } catch (err) {
      // Error accessing env or other setup, log it
      logDebug('Error setting up async path', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Sync path (for URLs that don't need presigning)
  // Filter out transformation parameters from the origin URL
  const filteredOriginUrlObj = new URL(originUrl);
  filteredOriginUrlObj.search = ''; // Remove all params by default for non-presigned URLs

  const filteredOriginUrl = filteredOriginUrlObj.toString();
  const finalUrl = buildFinalUrl(filteredOriginUrl);
  addBreadcrumbForUrl(filteredOriginUrl, finalUrl);
  return finalUrl;
}

/**
 * Utility functions for working with URL paths
 */
import { videoConfig } from '../config/videoConfig';
import { TransformParams, TransformParamValue } from '../domain/strategies/TransformationStrategy';

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
  cacheTtl?: number; // Optional custom cache TTL for this path pattern
  priority?: number; // Optional priority for pattern matching (higher values checked first)
  transformationOverrides?: Record<string, unknown>; // Optional parameter overrides for this path
  captureGroups?: string[]; // Names for regex capture groups
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

/**
 * Check if a URL path is a CDN-CGI media path
 * @param path The URL path to check
 * @returns True if the path is a CDN-CGI media path
 */
export function isCdnCgiMediaPath(path: string): boolean {
  return path.startsWith(videoConfig.cdnCgi.basePath);
}

/**
 * Find a matching path pattern for a given URL path
 * @param path The URL path to match
 * @param patterns Array of path patterns to check against
 * @returns The matching pattern or null if none match
 */
export function findMatchingPathPattern(path: string, patterns: PathPattern[]): PathPattern | null {
  // Import logger utilities in case they're available
  let logDebug: (message: string, data?: Record<string, unknown>) => void;
  let console_debug = console.debug;
  
  try {
    // Define a fallback debug function to capture debug info during execution
    // since we might not have access to the proper logging system
    logDebug = (message: string, data?: Record<string, unknown>) => {
      console_debug(`[PathUtils] ${message}`, data || {});
    };
  } catch (err) {
    logDebug = (message: string, data?: Record<string, unknown>) => {
      console_debug(`[PathUtils] ${message}`, data || {});
    };
  }

  if (!patterns || patterns.length === 0) {
    logDebug('No patterns provided to findMatchingPathPattern', { path });
    return null;
  }

  logDebug('Finding matching path pattern', { 
    path, 
    patternCount: patterns.length,
    patternNames: patterns.map(p => p.name),
  });

  // Sort patterns by priority if specified (higher values first)
  const sortedPatterns = [...patterns].sort((a, b) => {
    const priorityA = a.priority ?? 0;
    const priorityB = b.priority ?? 0;
    return priorityB - priorityA;
  });

  logDebug('Sorted patterns by priority', { 
    patternNames: sortedPatterns.map(p => p.name),
    patternPriorities: sortedPatterns.map(p => p.priority ?? 0),
  });

  for (let i = 0; i < sortedPatterns.length; i++) {
    const pattern = sortedPatterns[i];
    
    try {
      // Log pattern details before testing
      logDebug(`Testing pattern #${i}: ${pattern.name}`, {
        matcher: pattern.matcher,
        path: path
      });
      
      const regex = new RegExp(pattern.matcher);
      const isMatch = regex.test(path);
      
      // Log result of test
      logDebug(`Pattern #${i} test result: ${isMatch ? 'MATCH' : 'NO MATCH'}`, {
        pattern: pattern.name,
        matcher: pattern.matcher,
        regexObj: regex.toString(),
        path: path
      });
      
      if (isMatch) {
        logDebug(`Found matching pattern: ${pattern.name}`, {
          matcher: pattern.matcher,
          path: path,
          processPath: pattern.processPath
        });
        return pattern;
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      logDebug(`Error testing pattern #${i}: ${pattern.name}`, {
        matcher: pattern.matcher,
        error: errorMessage
      });
    }
  }

  logDebug('No matching pattern found for path', { path });
  return null;
}

/**
 * Find a matching path pattern with captured groups
 * @param path The URL path to match
 * @param patterns Array of path patterns to check against
 * @returns A path match result with pattern and captures
 */
export function matchPathWithCaptures(path: string, patterns: PathPattern[]): PathMatchResult | null {
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

  return null;
}

/**
 * Extract video ID from a path using a path pattern
 * @param path The URL path
 * @param pattern The path pattern to use
 * @returns The extracted video ID or null if no match
 */
export function extractVideoId(path: string, pattern: PathPattern): string | null {
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
export function createQualityPath(originalPath: string, quality: string): string {
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
 * Builds a CDN-CGI media transformation URL
 * @param options Transformation options
 * @param videoUrl Full URL to the video
 * @returns A CDN-CGI media transformation URL
 */
export function buildCdnCgiMediaUrl(
  options: TransformParams,
  videoUrl: string
): string {
  const { basePath } = videoConfig.cdnCgi;

  // Try to get the request context for logging
  let logDebug: (message: string, data?: Record<string, unknown>) => void;
  let console_debug = console.debug;
  
  try {
    // Define a fallback debug function to capture debug info during execution
    logDebug = (message: string, data?: Record<string, unknown>) => {
      console_debug(`[PathUtils] ${message}`, data || {});
    };
  } catch (err) {
    logDebug = (message: string, data?: Record<string, unknown>) => {
      console_debug(`[PathUtils] ${message}`, data || {});
    };
  }

  // Filter out null/undefined options
  const validOptions = Object.entries(options)
    .filter(([_, value]) => value !== null && value !== undefined)
    .reduce(
      (obj, [key, value]) => {
        obj[key] = value;
        return obj;
      },
      {} as Record<string, TransformParamValue>
    );

  // Format options as a comma-separated string
  const optionsString = Object.entries(validOptions)
    .map(([key, value]) => `${key}=${value}`)
    .join(',');

  // Get the current host from the request URL
  const currentUrl = new URL(videoUrl);
  const baseUrl = `${currentUrl.protocol}//${currentUrl.host}`;

  // Build the CDN-CGI media URL with the full video URL (including protocol)
  // Prepend the current host to the cdn-cgi path
  const cdnCgiUrl = `${baseUrl}${basePath}/${optionsString}/${videoUrl}`;
  
  // Log the transformation details (critical for debugging)
  logDebug('Building CDN-CGI media URL', {
    cdnCgiBasePath: basePath,
    transformParams: validOptions,
    parameterString: optionsString,
    originalUrl: videoUrl,
    transformedUrl: cdnCgiUrl,
    paramCount: Object.keys(validOptions).length,
    keyParams: {
      width: validOptions.width,
      height: validOptions.height,
      format: validOptions.format,
      quality: validOptions.quality,
      mode: validOptions.mode,
      fit: validOptions.fit,
      compression: validOptions.compression
    }
  });
  
  // Try to add a breadcrumb to the request context if it exists
  try {
    // Using dynamic import to avoid circular dependencies
    import('../utils/requestContext').then(({ getCurrentContext, addBreadcrumb }) => {
      const context = getCurrentContext();
      if (context) {
        addBreadcrumb(context, 'CDN-CGI', 'Built media transformation URL', {
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
          // Include URL details (safe version)
          basePath,
          baseUrl,
          // Include the complete URL for debugging (essential for troubleshooting)
          completeUrl: cdnCgiUrl
        });
      }
    }).catch(() => {
      // Silent fail if we can't add the breadcrumb
    });
  } catch (err) {
    // Silent fail if requestContext isn't available
  }

  return cdnCgiUrl;
}

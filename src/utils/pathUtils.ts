/**
 * Utility functions for working with URL paths
 */
import { VideoConfigurationManager } from '../config/VideoConfigurationManager';
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
  const configManager = VideoConfigurationManager.getInstance();
  return path.startsWith(configManager.getCdnCgiConfig().basePath);
}

/**
 * Find a matching path pattern for a given URL path
 * @param path The URL path to match
 * @param patterns Array of path patterns to check against
 * @param context Optional request context for caching
 * @returns The matching pattern or null if none match
 */
export function findMatchingPathPattern(
  path: string, 
  patterns: PathPattern[], 
  context?: any
): PathPattern | null {
  // Check cache if context is provided
  if (context && context.diagnostics && context.diagnostics.patternMatchCache) {
    const cacheKey = `findMatchingPathPattern:${path}:${patterns.length}`;
    if (context.diagnostics.patternMatchCache.has(cacheKey)) {
      return context.diagnostics.patternMatchCache.get(cacheKey);
    }
  }

  // Import logger utilities in case they're available
  let logDebug: (message: string, data?: Record<string, unknown>) => void;
  const console_debug = console.debug;
  
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
        
        // Cache result if context is provided
        if (context && context.diagnostics) {
          // Initialize cache if it doesn't exist
          if (!context.diagnostics.patternMatchCache) {
            context.diagnostics.patternMatchCache = new Map<string, any>();
          }
          
          const cacheKey = `findMatchingPathPattern:${path}:${patterns.length}`;
          context.diagnostics.patternMatchCache.set(cacheKey, pattern);
        }
        
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
  
  // Cache null result if context is provided
  if (context && context.diagnostics) {
    // Initialize cache if it doesn't exist
    if (!context.diagnostics.patternMatchCache) {
      context.diagnostics.patternMatchCache = new Map<string, any>();
    }
    
    const cacheKey = `findMatchingPathPattern:${path}:${patterns.length}`;
    context.diagnostics.patternMatchCache.set(cacheKey, null);
  }
  
  return null;
}

/**
 * Find a matching path pattern with captured groups
 * @param path The URL path to match
 * @param patterns Array of path patterns to check against
 * @param context Optional request context for caching the result
 * @returns A path match result with pattern and captures
 */
export function matchPathWithCaptures(
  path: string, 
  patterns: PathPattern[],
  context?: any
): PathMatchResult | null {
  // If context is provided and has a patternMatchCache, check for cached result
  if (context && context.diagnostics && context.diagnostics.patternMatchCache) {
    const cacheKey = `${path}:${patterns.length}`;
    if (context.diagnostics.patternMatchCache.has(cacheKey)) {
      return context.diagnostics.patternMatchCache.get(cacheKey);
    }
  }

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
      
      const result = {
        pattern,
        matched: true,
        captures,
        originalPath: path,
      };

      // Cache the result if context is provided
      if (context && context.diagnostics) {
        // Initialize cache if it doesn't exist
        if (!context.diagnostics.patternMatchCache) {
          context.diagnostics.patternMatchCache = new Map<string, PathMatchResult>();
        }
        
        // Cache the result with a key combining path and pattern count
        const cacheKey = `${path}:${patterns.length}`;
        context.diagnostics.patternMatchCache.set(cacheKey, result);
      }
      
      return result;
    }
  }

  // Cache null result if context is provided
  if (context && context.diagnostics) {
    // Initialize cache if it doesn't exist
    if (!context.diagnostics.patternMatchCache) {
      context.diagnostics.patternMatchCache = new Map<string, PathMatchResult | null>();
    }
    
    // Cache the null result
    const cacheKey = `${path}:${patterns.length}`;
    context.diagnostics.patternMatchCache.set(cacheKey, null);
  }

  return null;
}

/**
 * Extract video ID from a path using a path pattern
 * @param path The URL path
 * @param pattern The path pattern to use
 * @param context Optional request context for caching
 * @returns The extracted video ID or null if no match
 */
export function extractVideoId(
  path: string, 
  pattern: PathPattern, 
  context?: any
): string | null {
  const result = matchPathWithCaptures(path, [pattern], context);
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
 * @param originUrl Full URL to the origin video (content source URL)
 * @param requestUrl The original request URL (host will be used for the CDN-CGI path)
 * @returns A CDN-CGI media transformation URL
 */
export function buildCdnCgiMediaUrl(
  options: TransformParams,
  originUrl: string,
  requestUrl?: string
): string {
  const configManager = VideoConfigurationManager.getInstance();
  const { basePath } = configManager.getCdnCgiConfig();

  // Initialize with a default fallback logger
  let logDebug: (message: string, data?: Record<string, unknown>) => void = (message, data) => {
    console.debug(`[PathUtils] ${message}`, data || {});
  };
  
  // Try to use the proper logger if possible
  try {
    // We'll directly use the debug utility from loggerUtils
    import('./loggerUtils').then(({ debug }) => {
      // Update the logDebug function with the proper logger
      logDebug = (message, data) => debug('PathUtils', message, data);
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
      {} as Record<string, TransformParamValue>
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

  // Filter out transformation parameters from the origin URL
  const transformationUrlObj = new URL(originUrl);
  
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

  // Create a new URL object for filtered origin URL
  const filteredOriginUrlObj = new URL(transformationUrlObj.toString());
  
  // Clear search params to rebuild without transformation parameters
  filteredOriginUrlObj.search = '';
  
  // Copy over search params, excluding video-specific ones
  transformationUrlObj.searchParams.forEach((value, key) => {
    if (!videoParams.includes(key)) {
      filteredOriginUrlObj.searchParams.set(key, value);
    }
  });
  
  // Use the filtered origin URL
  const filteredOriginUrl = filteredOriginUrlObj.toString();
  
  // Build the CDN-CGI media URL with the correct URLs:
  // - Use request host for the base part
  // - Use filtered origin URL for the content source
  const cdnCgiUrl = `${baseUrl}${basePath}/${optionsString}/${filteredOriginUrl}`;
  
  // Log the transformation details (critical for debugging)
  logDebug('Building CDN-CGI media URL', {
    cdnCgiBasePath: basePath,
    transformParams: validOptions,
    parameterString: optionsString,
    originalOriginUrl: originUrl,
    filteredOriginUrl: filteredOriginUrl,
    requestUrl: requestUrl || 'not provided',
    baseUrl: baseUrl,
    transformedUrl: cdnCgiUrl,
    paramCount: Object.keys(validOptions).length,
    filteredParams: Array.from(transformationUrlObj.searchParams.keys())
      .filter(key => videoParams.includes(key)),
    retainedParams: Array.from(filteredOriginUrlObj.searchParams.keys()),
    keyParams: {
      width: validOptions.width,
      height: validOptions.height,
      format: validOptions.format,
      quality: validOptions.quality,
      mode: validOptions.mode,
      fit: validOptions.fit,
      compression: validOptions.compression,
      duration: validOptions.duration,
      time: validOptions.time
    },
    hasDuration: 'duration' in validOptions
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
          duration: validOptions.duration,
          time: validOptions.time,
          hasDuration: 'duration' in validOptions,
          // Include URL details (safe version)
          basePath,
          baseUrl,
          // Include source and transformation URLs
          originalOriginUrl: originUrl,
          filteredOriginUrl: filteredOriginUrl,
          requestUrl: requestUrl || 'not provided',
          baseUrlSource: baseUrlSource,
          // Include parameter filtering information
          filteredParams: Array.from(transformationUrlObj.searchParams.keys())
            .filter(key => videoParams.includes(key)),
          retainedParams: Array.from(filteredOriginUrlObj.searchParams.keys()),
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

/**
 * Utility functions for working with URL paths
 */
import { videoConfig } from '../config/videoConfig';
import { TransformParams, TransformParamValue } from '../domain/commands/TransformVideoCommand';

/**
 * Path pattern interface
 */
export interface PathPattern {
  name: string;
  matcher: string;
  processPath: boolean;
  baseUrl: string | null;
  originUrl: string | null;
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
  for (const pattern of patterns) {
    const regex = new RegExp(pattern.matcher);
    if (regex.test(path)) {
      return pattern;
    }
  }

  return null;
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

  // Build the CDN-CGI media URL
  return `${basePath}/${optionsString}/${videoUrl}`;
}

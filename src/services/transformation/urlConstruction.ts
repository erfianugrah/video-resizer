/**
 * URL construction utilities for video transformation
 *
 * Extracted from TransformationService.ts to reduce file size.
 * Contains functions for building video URLs from origins and path patterns.
 */
import { VideoTransformOptions } from '../../domain/commands/TransformVideoCommand';
import { PathPattern, matchPathWithCaptures } from '../../utils/pathUtils';
import { getCurrentContext, addBreadcrumb } from '../../utils/requestContext';
import { tryOrNull } from '../../utils/errorHandlingUtils';
import { OriginMatchResult, SourceResolutionResult } from '../origins/OriginResolver';
import { createCategoryLogger } from '../../utils/logger';
import { videoConfig } from '../../config/videoConfig';

// Create a category-specific logger
const logger = createCategoryLogger('TransformationService');
const { debug: logDebug } = logger;

/**
 * Named quality presets mapping quality names to dimensions.
 * Used by both Origin-based and legacy path-pattern-based quality resolution.
 */
export const QUALITY_PRESETS: Record<string, { width: number; height: number }> = {
  low: { width: 640, height: 360 },
  medium: { width: 854, height: 480 },
  high: { width: 1280, height: 720 },
  hd: { width: 1920, height: 1080 },
  '4k': { width: 3840, height: 2160 },
};

/**
 * Construct the video URL using origin and source resolution
 */
export const constructVideoUrlFromOrigin = tryOrNull<
  [string, URL, OriginMatchResult, SourceResolutionResult, VideoTransformOptions],
  string
>(
  function constructVideoUrlFromOriginImpl(
    path: string,
    url: URL,
    originMatch: OriginMatchResult,
    sourceResolution: SourceResolutionResult,
    options: VideoTransformOptions
  ): string {
    // Log start of URL construction
    logDebug('Constructing video URL from Origin', {
      path,
      url: url.toString(),
      originName: originMatch.origin.name,
      sourceType: sourceResolution.originType,
      resolvedPath: sourceResolution.resolvedPath,
    });

    // Check if we have a source URL from the resolution
    if (!sourceResolution.sourceUrl && sourceResolution.originType !== 'r2') {
      throw new Error('Source URL is required for path transformation');
    }

    // For remote and fallback sources, use the source URL directly
    if (sourceResolution.sourceUrl) {
      // Add breadcrumb for URL construction
      const requestContext = getCurrentContext();
      if (requestContext) {
        addBreadcrumb(requestContext, 'Transform', 'Using source URL from Origin', {
          originalUrl: url.toString(),
          sourceUrl: sourceResolution.sourceUrl,
          originName: originMatch.origin.name,
          sourceType: sourceResolution.originType,
        });
      }

      // For R2 sources, we use the resolved path
      if (sourceResolution.originType === 'r2') {
        return `r2:${sourceResolution.resolvedPath}`;
      }

      // Preserve query string and hash from original request
      const requestQuery = url.search; // includes the '?' if present
      const requestHash = url.hash; // includes the '#' if present

      return sourceResolution.sourceUrl + requestQuery + requestHash;
    }

    // For R2 sources without a source URL, construct r2: URL
    if (sourceResolution.originType === 'r2') {
      const r2Url = `r2:${sourceResolution.resolvedPath}`;

      // Add breadcrumb for URL construction
      const requestContext = getCurrentContext();
      if (requestContext) {
        addBreadcrumb(requestContext, 'Transform', 'Constructed R2 URL', {
          originalUrl: url.toString(),
          r2Url,
          originName: originMatch.origin.name,
          resolvedPath: sourceResolution.resolvedPath,
        });
      }

      return r2Url;
    }

    throw new Error('Could not construct URL from Origin');
  },
  {
    functionName: 'constructVideoUrlFromOrigin',
    component: 'TransformationService',
  },
  null // default return value when error occurs
);

/**
 * Construct the video URL using the path pattern
 */
export const constructVideoUrl = tryOrNull<
  [string, URL, PathPattern, VideoTransformOptions],
  string
>(
  function constructVideoUrlImpl(
    path: string,
    url: URL,
    pattern: PathPattern,
    options: VideoTransformOptions
  ): string {
    // Log start of URL construction
    logDebug('Constructing video URL using legacy path pattern', {
      path,
      url: url.toString(),
      patternName: pattern.name,
      hasOriginUrl: !!pattern.originUrl,
      hasCaptureGroups: !!pattern.captureGroups,
    });
    // Create a new URL using the originUrl from the pattern
    if (!pattern.originUrl) {
      throw new Error('Origin URL is required for path transformation');
    }

    // Use enhanced path matching with captures
    const pathMatch = matchPathWithCaptures(path, [pattern]);
    if (!pathMatch) {
      throw new Error('Failed to match path with pattern');
    }

    // Create a new URL with the pattern's origin
    const videoUrl = new URL(pattern.originUrl);

    // Preserve query string and hash from original request
    const requestQuery = url.search; // includes the '?' if present
    const requestHash = url.hash; // includes the '#' if present

    // Preserve the original path from the origin URL
    const originalPathname = videoUrl.pathname;

    // Use advanced path matching logic
    if (pattern.captureGroups && pathMatch.captures) {
      // Check if we have a videoId capture
      if (pathMatch.captures['videoId']) {
        // Append videoId to the origin URL's path, preserving the original path
        const separator = originalPathname.endsWith('/') ? '' : '/';
        videoUrl.pathname = `${originalPathname}${separator}${pathMatch.captures['videoId']}`;
      }
      // Check if we have a category capture
      else if (pathMatch.captures['category'] && pathMatch.captures['filename']) {
        // Append category/filename to the origin URL's path, preserving the original path
        const separator = originalPathname.endsWith('/') ? '' : '/';
        videoUrl.pathname = `${originalPathname}${separator}${pathMatch.captures['category']}/${pathMatch.captures['filename']}`;
      }
      // We have captures but no special handling, use first capture
      else if (pathMatch.captures['1']) {
        // Append the first capture to the origin URL's path, preserving the original path
        const separator = originalPathname.endsWith('/') ? '' : '/';
        videoUrl.pathname = `${originalPathname}${separator}${pathMatch.captures['1']}`;
      }
    }
    // Legacy behavior - use regex match directly
    else {
      const regex = new RegExp(pattern.matcher);
      const match = path.match(regex);

      if (match && match[0]) {
        const matchedPath = match[0];

        // If there's a captured group, use it as the path
        if (match.length > 1) {
          // Append the first capture group to the origin URL's path, preserving the original path
          const separator = originalPathname.endsWith('/') ? '' : '/';
          videoUrl.pathname = `${originalPathname}${separator}${match[1]}`;
        } else {
          // Otherwise append the full matched path
          const separator = originalPathname.endsWith('/') ? '' : '/';
          videoUrl.pathname = `${originalPathname}${separator}${matchedPath.replace(/^\//, '')}`;
        }
      } else {
        // Fallback to appending the original path
        const separator = originalPathname.endsWith('/') ? '' : '/';
        const cleanPath = path.replace(/^\//, ''); // Remove leading slash to avoid double slashes
        videoUrl.pathname = `${originalPathname}${separator}${cleanPath}`;
      }
    }

    // If pattern has transformation overrides, apply them to options
    if (pattern.transformationOverrides) {
      logDebug('Applying path-specific overrides', pattern.transformationOverrides);

      // Path-based quality presets get highest priority
      if (pattern.quality) {
        const preset = QUALITY_PRESETS[pattern.quality] || QUALITY_PRESETS.medium;

        // Apply quality preset to the options
        options.width = preset.width;
        options.height = preset.height;

        logDebug('Applied path-based quality preset', {
          quality: pattern.quality,
          width: preset.width,
          height: preset.height,
        });
      }
    }

    // Copy query parameters from the original URL
    url.searchParams.forEach((value, key) => {
      // Skip video parameter names
      const videoParamNames = Object.keys(videoConfig.paramMapping);
      if (!videoParamNames.includes(key) && key !== 'derivative') {
        videoUrl.searchParams.set(key, value);
      }
    });

    // Get final URL string
    const finalUrl = videoUrl.toString();

    // Log the constructed URL
    logDebug('Video URL constructed', {
      originalPath: path,
      constructedUrl: finalUrl,
      transformedParams: options !== undefined,
    });

    return finalUrl;
  },
  {
    functionName: 'constructVideoUrl',
    component: 'TransformationService',
  },
  null // default return value when error occurs
);

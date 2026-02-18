/**
 * Cache tag generation utilities for the Video Storage Service
 */

import { tryOrDefault } from '../../utils/errorHandlingUtils';
import { CacheConfigurationManager } from '../../config';
import { getDerivativeDimensions } from '../../utils/imqueryUtils';
import { VideoOptions } from './interfaces';
import { createCategoryLogger } from '../../utils/logger';
const logger = createCategoryLogger('VideoStorage');

/**
 * Implementation of generateCacheTags that might throw errors
 * @param videoPath - The path to the video
 * @param options - Video options (quality, format, etc.)
 * @param headers - Response headers for additional metadata
 * @returns Array of cache tags
 */
function generateCacheTagsImpl(
  videoPath: string,
  options: VideoOptions,
  headers?: Headers
): string[] {
  // Get the cache configuration manager
  const cacheConfig = CacheConfigurationManager.getInstance();

  // If cache tags are disabled, return empty array
  if (!cacheConfig.getConfig().enableCacheTags) {
    logger.debug('Cache tags are disabled');
    return [];
  }

  const startTime = Date.now();
  const tags: string[] = [];

  // Get prefix from the cache configuration
  // Use standardized short prefix format: vp- (video-processing)
  let prefix = 'vp-';

  try {
    // Use the configured cacheTagPrefix from CacheConfigurationManager
    const configuredPrefix = cacheConfig.getConfig().cacheTagPrefix;
    if (configuredPrefix) {
      prefix = configuredPrefix.endsWith('-') ? configuredPrefix : configuredPrefix + '-';
    }

    logger.debug('Using cache tag prefix from configuration', {
      configuredPrefix,
      shortPrefix: prefix,
      source: 'CacheConfigurationManager',
    });
  } catch (err) {
    // In case of any error with cache config, fall back to the default prefix
    logger.debug('Could not get prefix from config, using default prefix', {
      error: err instanceof Error ? err.message : String(err),
      defaultPrefix: prefix,
    });
  }

  logger.debug('Generating cache tags', {
    videoPath,
    hasOptions: !!options,
    hasHeaders: !!headers,
    prefix,
  });

  // Extract the last 2 segments of the path for the tag
  // e.g., /category/videos/test.mp4 -> videos-test.mp4
  const pathSegments = videoPath.split('/').filter((s) => s.length > 0);
  const last2Segments = pathSegments.slice(-2).join('-');

  // Normalize to create safe tags (replace special chars)
  const normalizedPathTag = last2Segments.replace(/[^a-zA-Z0-9-_.]/g, '-');

  // Add path-based tag for purging all derivatives of a specific video
  // Format: vp-p-{last-2-segments}
  if (normalizedPathTag) {
    tags.push(`${prefix}p-${normalizedPathTag}`);

    // Add derivative-specific tag if available - for purging one specific derivative
    // Format: vp-p-{last-2-segments}-{derivative}
    if (options.derivative) {
      tags.push(`${prefix}p-${normalizedPathTag}-${options.derivative}`);
    }
  }

  // Add derivative tag for purging all videos of a specific derivative type
  // Format: vp-d-{derivative}
  if (options.derivative) {
    tags.push(`${prefix}d-${options.derivative}`);
  }

  // Add format tag for format migration scenarios
  // Format: vp-f-{format}
  if (options.format) {
    tags.push(`${prefix}f-${options.format}`);
  }

  // Add mode-specific tags only for non-video modes (frame, spritesheet)
  // Format: vp-m-{mode}
  if (options.mode && options.mode !== 'video') {
    tags.push(`${prefix}m-${options.mode}`);

    // Add frame-specific tags
    // Format: vp-t-{time-value}
    if (options.mode === 'frame' && options.time) {
      const timeValue = String(options.time).replace('s', '');
      tags.push(`${prefix}t-${timeValue}`);
    }

    // Add spritesheet-specific tags
    if (options.mode === 'spritesheet') {
      // Format: vp-c-{columns}
      if (options.columns) tags.push(`${prefix}c-${options.columns}`);
      // Format: vp-r-{rows}
      if (options.rows) tags.push(`${prefix}r-${options.rows}`);
      // Format: vp-i-{interval-value}
      if (options.interval) {
        const intervalValue = String(options.interval).replace('s', '');
        tags.push(`${prefix}i-${intervalValue}`);
      }
    }
  }

  // Add IMQuery tag if this transformation came from IMQuery parameters
  if (options.customData && typeof options.customData === 'object') {
    const customData = options.customData as Record<string, unknown>;
    if (customData.imwidth || customData.imheight) {
      tags.push(`${prefix}imquery`);
    }
  }

  // Calculate processing time
  const endTime = Date.now();

  logger.debug('Generated cache tags', {
    tagCount: tags.length,
    generationTime: endTime - startTime,
  });

  return tags;
}

/**
 * Generate cache tags for a video resource
 * Uses standardized error handling to ensure consistent error logging and fallback behavior
 *
 * @param videoPath - The path to the video
 * @param options - Video options (quality, format, etc.)
 * @param headers - Response headers for additional metadata
 * @returns Array of cache tags, or empty array on error
 */
export const generateCacheTags = tryOrDefault<
  [string, VideoOptions, Headers | undefined],
  string[]
>(
  generateCacheTagsImpl,
  {
    functionName: 'generateCacheTags',
    component: 'VideoStorageService',
    logErrors: true,
  },
  [] // Default to empty array if tag generation fails
);

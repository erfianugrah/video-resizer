/**
 * Cache tag generation utilities for the Video Storage Service
 */

import { tryOrDefault } from '../../utils/errorHandlingUtils';
import { CacheConfigurationManager } from '../../config';
import { getDerivativeDimensions } from '../../utils/imqueryUtils';
import { VideoOptions } from './interfaces';
import { logDebug } from './logging';

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
    logDebug('VideoStorageService', 'Cache tags are disabled');
    return [];
  }
  
  const startTime = Date.now();
  const tags: string[] = [];
  
  // Get prefix from the cache configuration
  // Use a shorter prefix to save space in metadata
  let prefix = 'v-'; // Short default fallback
  
  try {
    // Properly use the configured cacheTagPrefix from CacheConfigurationManager
    const configuredPrefix = cacheConfig.getConfig().cacheTagPrefix || 'video-';
    // If the configured prefix is the default long one, use short version
    prefix = configuredPrefix === 'video-prod-' ? 'vp-' : 
             configuredPrefix === 'video-' ? 'v-' : 
             configuredPrefix.substring(0, 3); // Take first 3 chars of custom prefix
    
    logDebug('VideoStorageService', 'Using cache tag prefix from configuration', {
      configuredPrefix,
      shortPrefix: prefix,
      source: 'CacheConfigurationManager'
    });
  } catch (err) {
    // In case of any error with cache config, fall back to the default prefix
    logDebug('VideoStorageService', 'Could not get prefix from config, using default prefix', {
      error: err instanceof Error ? err.message : String(err),
      defaultPrefix: prefix
    });
  }
  
  // Add base tag for the video path (normalized to avoid special chars)
  const leadingSlashPattern = '^\/+';
  const invalidCharsPattern = '[^a-zA-Z0-9-_/.]';
  const replacementChar = '-';
  
  logDebug('VideoStorageService', 'Generating cache tags', {
    videoPath,
    hasOptions: !!options,
    hasHeaders: !!headers,
    prefix
  });
  
  // Normalize path to create safe tags
  const normalizedPath = videoPath
    .replace(new RegExp(leadingSlashPattern), '') // Remove leading slashes
    .replace(new RegExp(invalidCharsPattern, 'g'), replacementChar); // Replace special chars
  
  // Add path-based tag for purging all derivatives of a specific video
  // This uses the full normalized path as the identifier
  if (normalizedPath) {
    // Create a shortened path tag to save space
    // Take the last 2 segments of the path which typically identify the video
    const pathSegments = normalizedPath.split('/').filter(Boolean);
    const shortPath = pathSegments.slice(-2).join('-');
    
    if (shortPath) {
      // Add base path tag - for purging all derivatives of this video
      tags.push(`${prefix}p-${shortPath}`);
      
      // Add derivative-specific tag if available - for purging one specific derivative
      if (options.derivative) {
        tags.push(`${prefix}p-${shortPath}-${options.derivative}`);
      }
    }
  }
  
  // Add derivative tag for purging all videos of a specific derivative type
  if (options.derivative) {
    tags.push(`${prefix}d-${options.derivative}`);
  }
  
  // Add format tag for format migration scenarios
  if (options.format) {
    tags.push(`${prefix}f-${options.format}`);
  }

  // Add mode-specific tags only for non-video modes (frame, spritesheet)
  if (options.mode && options.mode !== 'video') {
    tags.push(`${prefix}m-${options.mode}`);
    
    // Add frame-specific tags
    if (options.mode === 'frame' && options.time) {
      tags.push(`${prefix}t-${options.time.replace('s', '')}`);
    }

    // Add spritesheet-specific tags
    if (options.mode === 'spritesheet') {
      if (options.columns) tags.push(`${prefix}c-${options.columns}`);
      if (options.rows) tags.push(`${prefix}r-${options.rows}`);
      if (options.interval) tags.push(`${prefix}i-${options.interval.replace('s', '')}`);
    }
  }
  
  // Add IMQuery tag if this transformation came from IMQuery parameters
  if (options.customData && typeof options.customData === 'object') {
    const customData = options.customData as Record<string, unknown>;
    if (customData.imwidth || customData.imheight) {
      tags.push(`${prefix}imq`);
    }
  }
  
  // Calculate processing time
  const endTime = Date.now();
  
  logDebug('VideoStorageService', 'Generated cache tags', {
    tagCount: tags.length,
    generationTime: endTime - startTime
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
    logErrors: true
  },
  [] // Default to empty array if tag generation fails
);
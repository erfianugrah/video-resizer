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
  // The prefix is configured in worker-config.json directly
  let prefix = 'video-'; // Default fallback
  
  try {
    // Properly use the configured cacheTagPrefix from CacheConfigurationManager
    prefix = cacheConfig.getConfig().cacheTagPrefix || 'video-';
    
    logDebug('VideoStorageService', 'Using cache tag prefix from configuration', {
      prefix,
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
    .replace(new RegExp(invalidCharsPattern, 'g'), replacementChar) // Replace special chars
    .split('/')
    .filter(Boolean);
  
  // Add a tag for the full path
  tags.push(`${prefix}path-${normalizedPath.join('-').replace(/\./g, '-')}`);
  
  // Add tags for each path segment
  normalizedPath.forEach((segment, index) => {
    // Only add segment tags if there are multiple segments
    if (normalizedPath.length > 1) {
      tags.push(`${prefix}segment-${index}-${segment.replace(/\./g, '-')}`);
    }
  });
  
  // Add a tag for the derivative if available
  if (options.derivative) {
    tags.push(`${prefix}derivative-${options.derivative}`);
  }
  
  // Add a tag for video format if available
  if (options.format) {
    tags.push(`${prefix}format-${options.format}`);
  }
  
  // Add mode-specific tags
  if (options.mode) {
    tags.push(`${prefix}mode-${options.mode}`);
    
    // Add frame-specific tags
    if (options.mode === 'frame' && options.time) {
      tags.push(`${prefix}time-${options.time.replace('s', '')}`);
    }
    
    // Add spritesheet-specific tags
    if (options.mode === 'spritesheet') {
      if (options.columns) tags.push(`${prefix}columns-${options.columns}`);
      if (options.rows) tags.push(`${prefix}rows-${options.rows}`);
      if (options.interval) tags.push(`${prefix}interval-${options.interval.replace('s', '')}`);
    }
  }
  
  // Add tag for the derivative if present
  if (options.derivative) {
    tags.push(`${prefix}derivative-${options.derivative}`);
    
    // When we have a derivative, use the actual derivative dimensions for width/height tags
    // instead of the requested dimensions for better cache consistency
    const derivativeDimensions = getDerivativeDimensions(options.derivative);
    
    if (derivativeDimensions) {
      // Add tags for the derivative's actual dimensions
      if (derivativeDimensions.width) {
        tags.push(`${prefix}width-${derivativeDimensions.width}`);
      }
      
      if (derivativeDimensions.height) {
        tags.push(`${prefix}height-${derivativeDimensions.height}`);
      }
      
      // Add combined dimensions tag for the derivative's actual dimensions
      if (derivativeDimensions.width && derivativeDimensions.height) {
        tags.push(`${prefix}dimensions-${derivativeDimensions.width}x${derivativeDimensions.height}`);
      }
      
      // Also include the original requested dimensions with a different prefix
      // This helps with debugging but doesn't affect cache behavior
      if (options.width) {
        tags.push(`${prefix}requested-width-${options.width}`);
      }
      
      if (options.height) {
        tags.push(`${prefix}requested-height-${options.height}`);
      }
    } else {
      // Fallback to the requested dimensions if the derivative config is not found
      if (options.width) {
        tags.push(`${prefix}width-${options.width}`);
      }
      
      if (options.height) {
        tags.push(`${prefix}height-${options.height}`);
      }
      
      if (options.width && options.height) {
        tags.push(`${prefix}dimensions-${options.width}x${options.height}`);
      }
    }
  } else {
    // No derivative - use requested dimensions directly
    if (options.width) {
      tags.push(`${prefix}width-${options.width}`);
    }
    
    if (options.height) {
      tags.push(`${prefix}height-${options.height}`);
    }
    
    // Add combined dimensions tag if both width and height are specified
    if (options.width && options.height) {
      tags.push(`${prefix}dimensions-${options.width}x${options.height}`);
    }
  }
  
  // Add IMQuery-specific tags if present
  if (options.customData && typeof options.customData === 'object') {
    const customData = options.customData as Record<string, unknown>;
    
    if (customData.imwidth) {
      tags.push(`${prefix}imwidth-${customData.imwidth}`);
    }
    
    if (customData.imheight) {
      tags.push(`${prefix}imheight-${customData.imheight}`);
    }
    
    // Add a tag to identify IMQuery sourced transformations
    if (customData.imwidth || customData.imheight) {
      tags.push(`${prefix}source-imquery`);
    }
  }
  
  // Add a tag for quality if available
  if (options.quality) {
    tags.push(`${prefix}quality-${options.quality}`);
  }
  
  // Add a tag for compression if available
  if (options.compression) {
    tags.push(`${prefix}compression-${options.compression}`);
  }
  
  // Add tags for content type from headers if available
  if (headers && headers.get('Content-Type')) {
    const contentType = headers.get('Content-Type') || '';
    const [mainType, fullSubType] = contentType.split('/');
    const subType = fullSubType?.split(';')[0]; // Remove parameters
    
    if (mainType) {
      tags.push(`${prefix}type-${mainType}`);
    }
    
    if (subType) {
      tags.push(`${prefix}subtype-${subType}`);
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
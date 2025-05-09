/**
 * Path transformation utilities for the Video Storage Service
 */

import { logErrorWithContext } from '../../utils/errorHandlingUtils';
import { VideoResizerConfig } from './interfaces';
import { logDebug } from './logging';

/**
 * Implementation of path transformation that might throw errors
 */
function applyPathTransformationImpl(
  path: string,
  config: VideoResizerConfig,
  originType: 'r2' | 'remote' | 'fallback'
): string {
  // Skip if no pathTransforms in config
  if (!config.pathTransforms || typeof config.pathTransforms !== 'object') {
    return path;
  }
  
  // Normalize path by removing leading slash
  let normalizedPath = path.startsWith('/') ? path.substring(1) : path;
  
  // Get the original path segments to check for transforms
  const segments = path.split('/').filter(Boolean);
  
  // Check if any segment has a transform configuration
  for (const segment of segments) {
    const pathTransforms = config.pathTransforms;
    if (pathTransforms[segment] && typeof pathTransforms[segment] === 'object') {
      const transform = pathTransforms[segment];
      
      // Check for origin-specific transforms first, fall back to generic transform
      const originSpecificTransform = transform[originType];
      const originTransform = (
        originSpecificTransform && typeof originSpecificTransform === 'object' 
          ? originSpecificTransform 
          : transform
      );
      
      // If this segment should be removed and replaced with a prefix
      if (originTransform.removePrefix && originTransform.prefix !== undefined) {
        // Create a new path with the proper prefix and without the matched segment
        const pathWithoutSegment = segments
          .filter(s => s !== segment) // Remove the segment
          .join('/');
          
        // Apply the new prefix
        normalizedPath = String(originTransform.prefix) + pathWithoutSegment;
        
        // Use our helper to log with proper context handling
        logDebug('VideoStorageService', 'Applied path transformation', {
          segment,
          originalPath: path,
          transformed: normalizedPath
        });
        
        break; // Only apply one transformation
      }
    }
  }
  
  return normalizedPath;
}

/**
 * Apply path transformations for any origin type
 * This helper function is used to transform paths based on origin type
 * Uses standardized error handling to safely transform paths
 */
export function applyPathTransformation(
  path: string,
  config: VideoResizerConfig,
  originType: 'r2' | 'remote' | 'fallback'
): string {
  try {
    return applyPathTransformationImpl(path, config, originType);
  } catch (err) {
    // Log with standardized error handling
    logErrorWithContext(
      `Error transforming path for ${originType}`,
      err,
      {
        path,
        originType,
        hasPathTransforms: !!config?.pathTransforms
      },
      'VideoStorageService'
    );
    
    // Return original path as fallback
    return path;
  }
}
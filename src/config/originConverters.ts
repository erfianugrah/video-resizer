/**
 * Convert legacy configuration to Origins format
 * 
 * This module provides utilities for converting legacy path pattern and
 * storage configuration to the new Origins model.
 */

import { PathPattern } from '../utils/pathUtils';
import { Origin, Source, Auth, StorageConfig, PathTransformConfig } from '../services/videoStorage/interfaces';
import { validateOrigin, validateSource } from './originSchema';

interface PathTransform {
  removePrefix?: boolean;
  prefix?: string;
}

/**
 * Convert a legacy PathPattern to an Origin
 * @param pathPattern Legacy path pattern object
 * @param storageConfig Global storage configuration
 * @returns A new Origin object
 */
export function convertPathPatternToOrigin(
  pathPattern: PathPattern,
  storageConfig: StorageConfig
): Origin {
  // Create an origin with the same name and matcher
  const origin: Origin = {
    name: pathPattern.name,
    matcher: pathPattern.matcher,
    processPath: pathPattern.processPath,
    sources: []
  };

  // Add any capture groups if available
  if (pathPattern.captureGroups) {
    origin.captureGroups = [...pathPattern.captureGroups];
  }

  // Add TTL if available
  if (pathPattern.ttl) {
    origin.ttl = {
      ok: pathPattern.ttl.ok,
      redirects: pathPattern.ttl.redirects,
      clientError: pathPattern.ttl.clientError,
      serverError: pathPattern.ttl.serverError
    };
  }

  // Set default cacheability to true
  origin.cacheability = true;

  // Add quality and compression settings if available
  if (pathPattern.quality) {
    origin.quality = pathPattern.quality;
  }
  
  // Set default videoCompression if not specified
  origin.videoCompression = "auto";
  
  // Get path transforms for this pattern if available
  const pathTransforms = storageConfig?.pathTransforms?.[pathPattern.name] as Record<string, PathTransform> | undefined;
  
  // Prioritize sources based on storage configuration
  const sourcePriorities = storageConfig?.priority || ['r2', 'remote', 'fallback'];
  
  // Create sources based on priorities
  const sources: Source[] = [];
  
  sourcePriorities.forEach((sourceType, index) => {
    switch (sourceType) {
      case 'r2':
        if (storageConfig?.r2?.enabled) {
          const r2Transform = pathTransforms?.r2 as PathTransform | undefined;
          
          const r2Source: Source = {
            type: 'r2',
            priority: index,
            path: constructPathTemplate(pathPattern, r2Transform),
            bucketBinding: 'VIDEOS_BUCKET' // Default bucket binding
          };
          
          // Add r2 source to the list
          sources.push(r2Source);
        }
        break;
        
      case 'remote':
        if (storageConfig?.remoteUrl) {
          const remoteTransform = pathTransforms?.remote as PathTransform | undefined;
          
          const remoteSource: Source = {
            type: 'remote',
            priority: index,
            path: constructPathTemplate(pathPattern, remoteTransform),
            url: pathPattern.originUrl || pathPattern.baseUrl || storageConfig.remoteUrl
          };
          
          // Add auth if configured
          if (storageConfig.remoteAuth?.enabled) {
            const authType = (storageConfig.remoteAuth.type as string).toLowerCase();
            if (authType === 'aws-s3' || authType === 'token' || authType === 'basic') {
              remoteSource.auth = { 
                enabled: storageConfig.remoteAuth.enabled,
                type: authType as 'aws-s3' | 'token' | 'basic',
                accessKeyVar: storageConfig.remoteAuth.accessKeyVar,
                secretKeyVar: storageConfig.remoteAuth.secretKeyVar,
                region: storageConfig.remoteAuth.region,
                service: storageConfig.remoteAuth.service
              };
            }
          }
          
          // Add remote source to the list
          sources.push(remoteSource);
        }
        break;
        
      case 'fallback':
        if (storageConfig?.fallbackUrl) {
          const fallbackTransform = pathTransforms?.fallback as PathTransform | undefined;
          
          const fallbackSource: Source = {
            type: 'fallback',
            priority: index,
            path: constructPathTemplate(pathPattern, fallbackTransform),
            url: storageConfig.fallbackUrl
          };
          
          // Add auth if configured
          if (storageConfig.fallbackAuth?.enabled) {
            const authType = (storageConfig.fallbackAuth.type as string).toLowerCase();
            if (authType === 'aws-s3' || authType === 'token' || authType === 'basic') {
              fallbackSource.auth = { 
                enabled: storageConfig.fallbackAuth.enabled,
                type: authType as 'aws-s3' | 'token' | 'basic',
                accessKeyVar: storageConfig.fallbackAuth.accessKeyVar,
                secretKeyVar: storageConfig.fallbackAuth.secretKeyVar,
                region: storageConfig.fallbackAuth.region,
                service: storageConfig.fallbackAuth.service
              };
            }
          }
          
          // Add fallback source to the list
          sources.push(fallbackSource);
        }
        break;
    }
  });
  
  // Add sources to origin
  origin.sources = sources;
  
  // Validate the created origin
  try {
    return validateOrigin(origin);
  } catch (error) {
    console.warn(`Warning: Created origin from path pattern '${pathPattern.name}' failed validation:`, error);
    return origin;
  }
}

/**
 * Construct a path template from a path pattern and transform config
 * @param pathPattern The path pattern
 * @param transform Optional transform configuration
 * @returns A path template with capture group references
 */
function constructPathTemplate(
  pathPattern: PathPattern,
  transform?: PathTransform
): string {
  // Default path template preserves the full path
  let template = '${0}';  // ${0} represents the full matched path
  
  // If we have capture groups, use the first one by default
  if (pathPattern.captureGroups && pathPattern.captureGroups.length > 0) {
    template = '${1}';  // ${1} represents the first capture group
    
    // If we have named capture groups, use the names instead
    if (pathPattern.captureGroups[0]) {
      template = '${' + pathPattern.captureGroups[0] + '}';
    }
  }
  
  // Apply transforms if specified
  if (transform) {
    if (transform.removePrefix) {
      // Not needed for template approach - handled by capture groups
    }
    
    if (transform.prefix) {
      template = transform.prefix + template;
    }
  }
  
  return template;
}

/**
 * Convert all legacy path patterns to Origins
 * @param pathPatterns Array of legacy path patterns
 * @param storageConfig Global storage configuration
 * @returns Array of Origins
 */
export function convertPathPatternsToOrigins(
  pathPatterns: PathPattern[],
  storageConfig: StorageConfig
): Origin[] {
  return pathPatterns.map(pattern => convertPathPatternToOrigin(pattern, storageConfig));
}

/**
 * Legacy path transform to source mapping
 * This is used to determine which path transforms apply to which source types
 */
interface PathTransformTypeMapping {
  [key: string]: 'r2' | 'remote' | 'fallback';
}

/**
 * Convert a legacy configuration to Origins
 * @param config The legacy configuration object
 * @returns Array of Origins
 */
export function convertLegacyConfigToOrigins(config: any): Origin[] {
  // Skip if already has origins
  if (config.origins) {
    return config.origins;
  }
  
  // Skip if missing required components
  if (!config.video?.pathPatterns || !config.video?.storage) {
    console.warn('Cannot convert to Origins: missing pathPatterns or storage configuration');
    return [];
  }
  
  // Convert path patterns to origins
  return convertPathPatternsToOrigins(
    config.video.pathPatterns,
    config.video.storage
  );
}
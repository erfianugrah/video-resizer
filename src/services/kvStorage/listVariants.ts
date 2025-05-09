import { withErrorHandling, logErrorWithContext } from '../../utils/errorHandlingUtils';
import { logDebug } from './logging';
import { TransformationMetadata } from './interfaces';
import { EnvVariables } from '../../config/environmentConfig';
import { getCacheKeyVersion } from '../cacheVersionService';

/**
 * Implementation for listing all transformed variants of a source video
 * 
 * @param namespace - The KV namespace to use
 * @param sourcePath - Original video path
 * @param env - Optional environment variables for version lookup
 * @returns Array of keys and their metadata
 */
async function listVariantsImpl(
  namespace: KVNamespace,
  sourcePath: string,
  env?: EnvVariables
): Promise<{ key: string; metadata: TransformationMetadata }[]> {
  // Normalize the path
  const normalizedPath = sourcePath.replace(/^\/+/, '');
  
  // When listing by path in our pattern format, we need a better matching strategy
  // We need to find keys matching our pattern where path is part of key
  // First, get all keys that might match by listing all keys
  // We don't use a specific prefix to ensure we get all keys with our path
  const keys = await namespace.list();
  
  // Get metadata for each key
  const variants: { key: string; metadata: TransformationMetadata }[] = [];
  
  for (const key of keys.keys) {
    // Process any key that contains this normalized path
    // This will include all transformation modes (video, frame, spritesheet)
    // The key format will be [mode]:[path]:[params]
    if (key.name.includes(`:${normalizedPath}:`)) {
      const { metadata } = await namespace.getWithMetadata<TransformationMetadata>(key.name);
      
      if (metadata) {
        // If env is provided and the KV version binding exists,
        // try to get the latest version for this key
        if (env?.VIDEO_CACHE_KEY_VERSIONS && !metadata.cacheVersion) {
          try {
            // Get the current version - don't increment
            const currentVersion = await getCacheKeyVersion(env, key.name);
            
            // Add version to metadata if found
            if (currentVersion !== null) {
              metadata.cacheVersion = currentVersion;
              
              logDebug('Added version info to variant metadata', {
                key: key.name,
                version: currentVersion
              });
            }
          } catch (err) {
            // Log error but continue
            logDebug('Error retrieving version for variant', {
              key: key.name,
              error: err instanceof Error ? err.message : String(err)
            });
          }
        }
        
        variants.push({ key: key.name, metadata });
      }
    }
  }
  
  // Log success
  logDebug('Listed video variants', {
    sourcePath,
    variantCount: variants.length,
    hasVersions: variants.some(v => v.metadata.cacheVersion !== undefined)
  });
  
  return variants;
}

/**
 * List all transformed variants of a source video
 * Uses standardized error handling to ensure consistent logging and fallback behavior
 * 
 * @param namespace - The KV namespace to use
 * @param sourcePath - Original video path
 * @param env - Optional environment variables for version lookup
 * @returns Array of keys and their metadata, or empty array on error
 */
export const listVariants = withErrorHandling<
  [KVNamespace, string, EnvVariables?],
  Promise<{ key: string; metadata: TransformationMetadata }[]>
>(
  async function listVariantsWrapper(
    namespace,
    sourcePath,
    env
  ): Promise<{ key: string; metadata: TransformationMetadata }[]> {
    try {
      return await listVariantsImpl(namespace, sourcePath, env);
    } catch (err) {
      // Log via standardized error handling but return empty array
      logErrorWithContext(
        'Failed to list video variants',
        err,
        { 
          sourcePath,
          hasVersionKv: !!env?.VIDEO_CACHE_KEY_VERSIONS
        },
        'KVStorageService'
      );
      
      // Return empty array as fallback
      return [];
    }
  },
  {
    functionName: 'listVariants',
    component: 'KVStorageService',
    logErrors: true
  },
  { operationType: 'list' }
);
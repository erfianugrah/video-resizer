/**
 * Utilities for flexible KV namespace binding access
 * Allows users to use custom KV namespace names via configuration
 */

import { EnvVariables } from '../config/environmentConfig';

interface FlexibleEnv extends EnvVariables {
  // Already includes all the bindings and flexible names from EnvVariables
}

/**
 * Get KV namespace using flexible naming
 * 
 * @param env - Worker environment
 * @param varName - Variable name containing the binding name (e.g., 'CONFIG_KV_NAME')
 * @param defaultBinding - Default binding name for backward compatibility
 * @returns KV namespace or null if not found
 */
export function getKVNamespace(
  env: FlexibleEnv,
  varName: string,
  defaultBinding: string
): KVNamespace | null {
  // First try to get the custom binding name from vars
  const customBindingName = env[varName];
  
  if (customBindingName && typeof customBindingName === 'string') {
    // Use the custom binding name to get the actual KV namespace
    const kvNamespace = env[customBindingName];
    if (kvNamespace && isKVNamespace(kvNamespace)) {
      return kvNamespace;
    }
  }
  
  // Fall back to default binding name for backward compatibility
  const defaultNamespace = env[defaultBinding];
  if (defaultNamespace && isKVNamespace(defaultNamespace)) {
    return defaultNamespace;
  }
  
  return null;
}

/**
 * Check if object is a KV namespace
 */
function isKVNamespace(obj: any): obj is KVNamespace {
  return (
    obj &&
    typeof obj === 'object' &&
    typeof obj.get === 'function' &&
    typeof obj.put === 'function' &&
    typeof obj.delete === 'function'
  );
}

/**
 * Get all configured KV namespaces with flexible naming
 */
export function getFlexibleBindings(env: FlexibleEnv) {
  return {
    configStore: getKVNamespace(env, 'CONFIG_KV_NAME', 'VIDEO_CONFIGURATION_STORE'),
    cacheStore: getKVNamespace(env, 'CACHE_KV_NAME', 'VIDEO_TRANSFORMATIONS_CACHE'),
    versionStore: getKVNamespace(env, 'VERSION_KV_NAME', 'VIDEO_CACHE_KEY_VERSIONS'),
    presignedStore: getKVNamespace(env, 'PRESIGNED_KV_NAME', 'PRESIGNED_URLS'),
  };
}

/**
 * Get presigned URL KV namespace
 */
export function getPresignedUrlKV(env: FlexibleEnv): KVNamespace | null {
  return getKVNamespace(env, 'PRESIGNED_KV_NAME', 'PRESIGNED_URLS');
}

/**
 * Get cache KV namespace (handles both new and legacy names)
 */
export function getCacheKV(env: FlexibleEnv): KVNamespace | null {
  // Try the flexible binding first
  const flexibleKV = getKVNamespace(env, 'CACHE_KV_NAME', 'VIDEO_TRANSFORMATIONS_CACHE');
  if (flexibleKV) return flexibleKV;
  
  // Fall back to legacy name
  return env.VIDEO_TRANSFORMS_KV || null;
}

/**
 * Get version KV namespace
 */
export function getVersionKV(env: FlexibleEnv): KVNamespace | null {
  return getKVNamespace(env, 'VERSION_KV_NAME', 'VIDEO_CACHE_KEY_VERSIONS');
}

/**
 * Get config KV namespace
 */
export function getConfigKV(env: FlexibleEnv): KVNamespace | null {
  return getKVNamespace(env, 'CONFIG_KV_NAME', 'VIDEO_CONFIGURATION_STORE');
}

/**
 * Example usage in existing code:
 * 
 * Instead of:
 *   const configKV = env.VIDEO_CONFIGURATION_STORE;
 * 
 * Use:
 *   const configKV = getKVNamespace(env, 'CONFIG_KV_NAME', 'VIDEO_CONFIGURATION_STORE');
 * 
 * This allows users to:
 * 1. Name their KV namespace whatever they want in wrangler.jsonc
 * 2. Set CONFIG_KV_NAME var to point to their custom name
 * 3. Code still works with default names if vars not set
 */
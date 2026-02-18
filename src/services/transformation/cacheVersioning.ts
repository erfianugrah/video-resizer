/**
 * Cache versioning logic for video transformation
 *
 * Extracted from TransformationService.ts to reduce file size.
 * Manages cache key version retrieval and URL updates for cache busting.
 */
import { VideoTransformOptions } from '../../domain/commands/TransformVideoCommand';
import { DiagnosticsInfo } from '../../utils/debugHeadersUtils';
import { RequestContext, getCurrentContext, addBreadcrumb } from '../../utils/requestContext';
import { CacheConfig } from '../../utils/cacheUtils';
import { addVersionToUrl, normalizeUrlForCaching } from '../../utils/urlVersionUtils';
import { generateKVKey } from '../kvStorageService';
import { getNextCacheKeyVersion, storeCacheKeyVersion } from '../cacheVersionService';
import { EnvVariables } from '../../config/environmentConfig';
import { getCacheKV } from '../../utils/flexibleBindings';
import { createCategoryLogger } from '../../utils/logger';

// Create a category-specific logger
const logger = createCategoryLogger('TransformationService');
const { debug: logDebug } = logger;

/**
 * Apply cache versioning to the CDN-CGI URL.
 *
 * Checks KV for a cache entry, increments the version if the entry is missing,
 * stores the new version, and returns the (possibly versioned) CDN-CGI URL
 * along with the updated options and diagnostics.
 *
 * @param env Environment variables (must be non-null)
 * @param videoUrl The original video URL (before versioning)
 * @param cdnCgiUrl The current CDN-CGI URL
 * @param options Video transformation options (mutated: options.version may be set)
 * @param cacheConfig Cache configuration for TTL
 * @param diagnosticsInfo Diagnostics (mutated: cacheVersion may be set)
 * @param requestContext Current request context (may be null)
 * @param path The URL path for logging
 * @returns The (possibly versioned) CDN-CGI URL
 */
export async function applyCacheVersioning(
  env: EnvVariables,
  videoUrl: string,
  cdnCgiUrl: string,
  options: VideoTransformOptions,
  cacheConfig: CacheConfig,
  diagnosticsInfo: DiagnosticsInfo,
  requestContext: RequestContext | null,
  path: string
): Promise<string> {
  try {
    // Generate a consistent cache key for this transformation
    const cacheKey = generateKVKey(normalizeUrlForCaching(videoUrl), options);

    // Check if the content exists in the cache
    let shouldIncrement = false;

    const cacheKV = getCacheKV(env);
    if (cacheKV) {
      try {
        // Check if the entry exists by trying to get it
        // We'll use list with a prefix to be more efficient and avoid fetching the actual data
        const keys = await cacheKV.list({ prefix: cacheKey, limit: 1 });
        const exists = keys.keys.length > 0;

        // If the entry doesn't exist, we should increment the version
        shouldIncrement = !exists;

        logDebug('Checking if cache entry exists for version increment', {
          cacheKey,
          exists,
          shouldIncrement,
          checkMethod: 'head request',
        });
      } catch (err) {
        // If error occurs during check, assume cache miss to be safe
        shouldIncrement = true;
        logDebug('Error checking cache existence, assuming cache miss', {
          cacheKey,
          error: err instanceof Error ? err.message : String(err),
          shouldIncrement: true,
        });
      }
    }

    // Get next version number - if shouldIncrement is true, we'll force an increment
    const nextVersion = await getNextCacheKeyVersion(env, cacheKey, shouldIncrement);

    // Calculate TTL - double the video cache TTL for longer persistence
    const versionTtl = (cacheConfig?.ttl?.ok || 300) * 2;

    // ALWAYS store the updated version in KV when it changes
    if (shouldIncrement) {
      logDebug('Storing incremented version in KV', {
        cacheKey,
        previousVersion: nextVersion - 1,
        nextVersion,
        ttl: versionTtl,
      });

      // Store updated version in background if possible
      const requestContextForWaitUntil = getCurrentContext(); // Get the current request context
      const executionCtxForWaitUntil = requestContextForWaitUntil?.executionContext;

      if (executionCtxForWaitUntil?.waitUntil) {
        // Use the context obtained from getCurrentContext()
        executionCtxForWaitUntil.waitUntil(
          storeCacheKeyVersion(env, cacheKey, nextVersion, versionTtl)
        );
      } else {
        // Fall back to direct storage
        logDebug(
          'Falling back to await for storeCacheKeyVersion, waitUntil not available via requestContext',
          { cacheKey }
        );
        await storeCacheKeyVersion(env, cacheKey, nextVersion, versionTtl);
      }
    }

    // Only add version param for version > 1 to avoid unnecessary params
    if (nextVersion > 1) {
      // Create a modified URL with version parameter
      const versionedCdnCgiUrl = addVersionToUrl(cdnCgiUrl, nextVersion);

      // Log the version addition
      logDebug('Added version parameter for cache busting', {
        originalUrl: cdnCgiUrl,
        versionedUrl: versionedCdnCgiUrl,
        cacheKey,
        nextVersion,
        shouldIncrement,
      });

      // Add a breadcrumb for tracking
      if (requestContext) {
        addBreadcrumb(requestContext, 'Cache', 'Added version for cache busting', {
          cacheKey,
          nextVersion,
          path,
          originalUrl: cdnCgiUrl,
        });
      }

      // Add version info to diagnostics
      diagnosticsInfo.cacheVersion = nextVersion;

      // Store version in options for use in kvStorageService
      options.version = nextVersion;

      // Update the URL with version
      return versionedCdnCgiUrl;
    } else {
      // First version - add to diagnostics but don't modify URL
      // Store version in options
      options.version = nextVersion;

      // Add version info to diagnostics
      diagnosticsInfo.cacheVersion = nextVersion;

      logDebug('Using first version (no URL parameter needed)', {
        cacheKey,
        version: nextVersion,
        url: cdnCgiUrl,
      });

      return cdnCgiUrl;
    }
  } catch (err) {
    // Log error but continue with unversioned URL
    logDebug('Error adding version parameter', {
      error: err instanceof Error ? err.message : String(err),
      path,
    });
    return cdnCgiUrl;
  }
}

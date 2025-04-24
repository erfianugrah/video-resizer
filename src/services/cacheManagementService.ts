/**
 * Service for managing cache behavior for video responses
 * Supports both Cache API and Cloudflare cf object caching methods
 * Refactored for ESM syntax and static imports.
 */

// Import modularized cache utilities
import { applyCacheHeaders } from '../utils/cacheHeaderUtils';
import { prepareResponseForCaching, storeInCacheWithRangeSupport, isCacheableContentType } from '../utils/cacheStorageUtils';
import { createCfObjectParams } from '../utils/cacheCfUtils';
import { getCachedResponse } from '../utils/cacheRetrievalUtils';
import { cacheResponse } from '../utils/cacheResponseUtils';

// Re-export them as part of the service interface
export {
  applyCacheHeaders,
  prepareResponseForCaching,
  createCfObjectParams,
  getCachedResponse,
  cacheResponse
};

// Also export helper function that's used internally by other functions
export { storeInCacheWithRangeSupport, isCacheableContentType };
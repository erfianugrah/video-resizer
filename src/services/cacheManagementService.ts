/**
 * Service for managing cache behavior for video responses
 * Now exclusively uses KV for caching
 * Refactored for ESM syntax and static imports.
 */

// Import modularized cache utilities
import { applyCacheHeaders } from '../utils/cacheHeaderUtils';
import { prepareResponseForCaching, prepareResponseForRangeSupport, isCacheableContentType } from '../utils/cacheStorageUtils';
import { getCachedResponse } from '../utils/cacheRetrievalUtils';
import { cacheResponse } from '../utils/cacheResponseUtils';

// Re-export them as part of the service interface
export {
  applyCacheHeaders,
  prepareResponseForCaching,
  getCachedResponse,
  cacheResponse
};

// Also export helper function that's used internally by other functions
export { prepareResponseForRangeSupport, isCacheableContentType };
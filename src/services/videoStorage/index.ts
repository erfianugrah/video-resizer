/**
 * Storage utilities for the video resizer worker
 * 
 * This module provides functions for retrieving videos from different storage sources
 * including R2 buckets, remote URLs, and fallback URLs.
 */

// Export interfaces
export * from './interfaces';

// Export the main functions
export { fetchVideo } from './fetchVideo';
export { fetchFromR2 } from './r2Storage';
export { fetchFromRemote } from './remoteStorage';
export { fetchFromFallback } from './fallbackStorage';
export { shouldBypassCache } from './cacheBypass';
export { generateCacheTags } from './cacheTags';
export { applyPathTransformation } from './pathTransform';
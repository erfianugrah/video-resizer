/**
 * Exports for the Video Storage Service
 */

// Interfaces
export * from './interfaces';

// Core storage functionality
export { fetchVideo } from './fetchVideo';
export { fetchVideoWithOrigins } from './fetchVideoWithOrigins';
export { applyPathTransformation } from './pathTransform';

// Storage providers
export { fetchFromR2 } from './r2Storage';
export { fetchFromRemote } from './remoteStorage';
export { fetchFromFallback } from './fallbackStorage';

// Cache tag utilities
export { generateCacheTags } from './cacheTags';

// Configuration handlers
export const VIDEO_STORAGE_VERSION = '2.0.0';
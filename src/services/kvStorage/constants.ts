/**
 * Constants for chunking configuration
 */
// Maximum size for a single KV entry (20 MiB is conservative for 25MiB KV value limit)
export const MAX_VIDEO_SIZE_FOR_SINGLE_KV_ENTRY = 20 * 1024 * 1024; 
// Standard chunk size for large videos (5 MiB chunk size)
export const STANDARD_CHUNK_SIZE = 5 * 1024 * 1024; 
// KV read cache TTL (1 hour edge cache for KV reads)
export const DEFAULT_KV_READ_CACHE_TTL = 60 * 60;
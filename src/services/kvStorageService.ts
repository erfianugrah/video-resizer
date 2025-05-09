/**
 * KV Storage Service for video-resizer
 * 
 * This service provides functions for storing and retrieving transformed video variants in Cloudflare KV.
 * It supports storing both the video content and associated metadata, which can be used for cache invalidation.
 * 
 * Features:
 * - Standard KV storage for videos under size limit
 * - Chunked storage for larger videos with data integrity verification
 * - Range request support for streaming video content
 * - TTL refresh for frequently accessed content
 * - Cache versioning for cache invalidation
 */

// Re-export all functionality from the kvStorage directory
export * from './kvStorage';
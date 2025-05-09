import { tryOrDefault } from '../../utils/errorHandlingUtils';
import { getDerivativeDimensions } from '../../utils/imqueryUtils';

/**
 * Helper function to determine if chunking should be used based on content size
 */
export function shouldUseChunking(contentSize: number): boolean {
  // Import constants from local constants file
  const { MAX_VIDEO_SIZE_FOR_SINGLE_KV_ENTRY } = require('./constants');
  
  // Use chunking if the content size exceeds the maximum size for a single KV entry
  return contentSize > MAX_VIDEO_SIZE_FOR_SINGLE_KV_ENTRY;
}

/**
 * Helper function to calculate the estimated number of chunks needed
 */
export function calculateChunkCount(totalSize: number): number {
  // Import constants from local constants file
  const { MAX_VIDEO_SIZE_FOR_SINGLE_KV_ENTRY, STANDARD_CHUNK_SIZE } = require('./constants');
  
  if (totalSize <= MAX_VIDEO_SIZE_FOR_SINGLE_KV_ENTRY) {
    return 1; // Single entry, no chunking needed
  }
  
  // Calculate the number of chunks needed (rounding up)
  return Math.ceil(totalSize / STANDARD_CHUNK_SIZE);
}

/**
 * Internal implementation of generateKVKey that might throw exceptions
 * 
 * @param sourcePath - The original video source path
 * @param options - Transformation options
 * @returns A unique key for the KV store
 */
function generateKVKeyImpl(
  sourcePath: string,
  options: {
    mode?: string | null;
    width?: number | null;
    height?: number | null;
    format?: string | null;
    quality?: string | null;
    compression?: string | null;
    derivative?: string | null;
    time?: string | null;
    columns?: number | null;
    rows?: number | null;
    interval?: string | null;
    customData?: Record<string, unknown>;
  }
): string {
  // Remove leading slashes for consistency
  const normalizedPath = sourcePath.replace(/^\/+/, '');
  
  // Set default mode to 'video' if not specified
  const mode = options.mode || 'video';
  
  // Create a base key from the mode and path
  let key = `${mode}:${normalizedPath}`;
  
  // Always prefer derivative-based caching for better cache efficiency
  if (options.derivative) {
    // Derivative-based caching is the primary method for better cache utilization
    key += `:derivative=${options.derivative}`;
  } else {
    // Only use individual parameters if no derivative specified
    if (options.width) key += `:w=${options.width}`;
    if (options.height) key += `:h=${options.height}`;
    
    // Add mode-specific parameters
    if (mode === 'frame') {
      if (options.time) key += `:t=${options.time}`;
      if (options.format) key += `:f=${options.format}`;
    } else if (mode === 'spritesheet') {
      if (options.columns) key += `:cols=${options.columns}`;
      if (options.rows) key += `:rows=${options.rows}`;
      if (options.interval) key += `:interval=${options.interval}`;
    } else {
      // Video-specific parameters
      if (options.format) key += `:f=${options.format}`;
      if (options.quality) key += `:q=${options.quality}`;
      if (options.compression) key += `:c=${options.compression}`;
    }
  }
  
  // Store IMQuery information in metadata but not in the cache key
  // This allows requests with different imwidth values but same derivative to share cache
  
  // Only replace spaces and other truly invalid characters, preserving slashes and equals signs
  return key.replace(/[^\w:/=.*-]/g, '-');
}

/**
 * Generate a KV key for a transformed video variant
 * Handles errors by returning a fallback key
 * 
 * @param sourcePath - The original video source path
 * @param options - Transformation options
 * @returns A unique key for the KV store
 */
export const generateKVKey = tryOrDefault<
  [string, {
    mode?: string | null;
    width?: number | null;
    height?: number | null;
    format?: string | null;
    quality?: string | null;
    compression?: string | null;
    derivative?: string | null;
    time?: string | null;
    columns?: number | null;
    rows?: number | null;
    interval?: string | null;
    customData?: Record<string, unknown>;
  }],
  string
>(
  generateKVKeyImpl,
  {
    functionName: 'generateKVKey',
    component: 'KVStorageService',
    logErrors: true
  },
  'video:error:fallback-key' // Default fallback key if generation fails
);

/**
 * Generate a chunk key for a specific chunk index
 * 
 * @param baseKey - The base KV key for the video
 * @param chunkIndex - The index of the chunk 
 * @returns A unique key for this specific chunk
 */
export function generateChunkKey(baseKey: string, chunkIndex: number): string {
  return `${baseKey}_chunk_${chunkIndex}`;
}

/**
 * Extract the base key from a chunk key
 * 
 * @param chunkKey - The full chunk key
 * @returns The base key portion, or null if not a valid chunk key
 */
export function extractBaseKeyFromChunkKey(chunkKey: string): string | null {
  const chunkKeyPattern = /^(.+)_chunk_\d+$/;
  const match = chunkKey.match(chunkKeyPattern);
  
  if (match && match[1]) {
    return match[1];
  }
  
  return null;
}

/**
 * Extract the chunk index from a chunk key
 * 
 * @param chunkKey - The full chunk key
 * @returns The chunk index, or -1 if not a valid chunk key
 */
export function extractChunkIndex(chunkKey: string): number {
  const chunkKeyPattern = /^.+_chunk_(\d+)$/;
  const match = chunkKey.match(chunkKeyPattern);
  
  if (match && match[1]) {
    return parseInt(match[1], 10);
  }
  
  return -1;
}
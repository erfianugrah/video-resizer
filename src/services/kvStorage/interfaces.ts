/**
 * Interface for chunking manifest data
 * This structure defines how large videos are split into chunks
 * and contains the necessary information to reconstruct the original video
 */
export interface ChunkManifest {
  // Total size of the video in bytes (sum of all actualChunkSizes)
  totalSize: number;
  // Number of chunks the video is split into
  chunkCount: number;
  // Array of exact byte lengths for each chunk as measured during storage
  actualChunkSizes: number[];
  // The target size for most chunks (STANDARD_CHUNK_SIZE)
  standardChunkSize: number;
  // Original content type of the video
  originalContentType: string;
}

/**
 * Interface for transformation metadata
 */
export interface TransformationMetadata {
  // Original source path (optional - path is already in the key)
  sourcePath?: string;
  // Transformation mode
  mode?: string | null;
  // Transformation parameters
  width?: number | null;
  height?: number | null;
  format?: string | null;
  quality?: string | null;
  compression?: string | null;
  derivative?: string | null;
  // Cache information
  cacheTags: string[];
  // Cache versioning
  cacheVersion?: number;
  // Content information
  contentType: string;
  contentLength: number;
  // Timestamps
  createdAt: number;
  expiresAt?: number;
  // Additional metadata
  duration?: number | string | null;  // Support both number and string for duration
  fps?: number | null;
  // Frame-specific metadata
  time?: string | null;
  // Spritesheet-specific metadata
  columns?: number | null;
  rows?: number | null;
  interval?: string | null;
  customData?: Record<string, unknown>;
  
  // Chunking-specific fields
  // Flag indicating if the video is stored as chunks
  isChunked?: boolean;
  // Actual total size of the video content (for both chunked and non-chunked)
  actualTotalVideoSize?: number;
  // Flag indicating if the asset should be stored indefinitely (no expiration)
  storeIndefinitely?: boolean;
}
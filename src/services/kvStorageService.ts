/**
 * KV Storage Service for video-resizer
 * 
 * This service provides functions for storing and retrieving transformed video variants in Cloudflare KV.
 * It supports storing both the video content and associated metadata, which can be used for cache invalidation.
 */

import { CacheConfigurationManager } from '../config';
import { createLogger, debug as pinoDebug, error as pinoError } from '../utils/pinoLogger';
import { getCurrentContext } from '../utils/legacyLoggerAdapter';
import { addBreadcrumb } from '../utils/requestContext';
import { generateCacheTags } from './videoStorageService';

/**
 * Helper functions for consistent logging throughout this file
 */
function logDebug(message: string, data?: Record<string, unknown>): void {
  const requestContext = getCurrentContext();
  if (requestContext) {
    const logger = createLogger(requestContext);
    pinoDebug(requestContext, logger, 'KVStorageService', message, data);
  } else {
    console.debug(`KVStorageService: ${message}`, data || {});
  }
}

function logError(message: string, data?: Record<string, unknown>): void {
  const requestContext = getCurrentContext();
  if (requestContext) {
    const logger = createLogger(requestContext);
    pinoError(requestContext, logger, 'KVStorageService', message, data);
  } else {
    console.error(`KVStorageService: ${message}`, data || {});
  }
}

/**
 * Interface for transformation metadata
 */
export interface TransformationMetadata {
  // Original source path
  sourcePath: string;
  // Transformation mode
  mode?: string;
  // Transformation parameters
  width?: number | null;
  height?: number | null;
  format?: string | null;
  quality?: string | null;
  compression?: string | null;
  derivative?: string | null;
  // Cache information
  cacheTags: string[];
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
}

/**
 * Generate a KV key for a transformed video variant
 * 
 * @param sourcePath - The original video source path
 * @param options - Transformation options
 * @returns A unique key for the KV store
 */
export function generateKVKey(
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
 * Store a transformed video in KV storage
 * 
 * @param namespace - The KV namespace to use
 * @param sourcePath - Original video path
 * @param response - The transformed video response
 * @param options - Transformation options used
 * @param ttl - Optional TTL in seconds
 * @returns Boolean indicating if storage was successful
 */
export async function storeTransformedVideo(
  namespace: KVNamespace,
  sourcePath: string,
  response: Response,
  options: {
    mode?: string | null;
    width?: number | null;
    height?: number | null;
    format?: string | null;
    quality?: string | null;
    compression?: string | null;
    derivative?: string | null;
    duration?: number | string | null;
    fps?: number | null;
    time?: string | null;
    columns?: number | null;
    rows?: number | null;
    interval?: string | null;
    customData?: Record<string, unknown>;
  },
  ttl?: number
): Promise<boolean> {
  try {
    // Clone the response to avoid consuming it
    const responseClone = response.clone();
    
    // Generate a key for this transformed variant using consistent format with = delimiter
    const key = generateKVKey(sourcePath, options);
    
    // Log key information for debugging
    logDebug('Generated KV cache key', {
      key,
      sourcePath,
      derivative: options.derivative,
      width: options.width,
      height: options.height
    });
    
    // Create metadata object
    const metadata: TransformationMetadata = {
      sourcePath,
      mode: options.mode || 'video',
      width: options.width,
      height: options.height,
      format: options.format,
      quality: options.quality,
      compression: options.compression,
      derivative: options.derivative,
      cacheTags: generateCacheTags(sourcePath, options),
      contentType: response.headers.get('Content-Type') || 'video/mp4',
      contentLength: parseInt(response.headers.get('Content-Length') || '0', 10),
      createdAt: Date.now(),
      duration: options.duration,
      fps: options.fps,
      // Add mode-specific metadata
      time: options.time,
      columns: options.columns,
      rows: options.rows,
      interval: options.interval,
      customData: options.customData
    };
    
    // If TTL is provided, set expiresAt
    if (ttl) {
      metadata.expiresAt = Date.now() + (ttl * 1000);
    }
    
    // Get response body as ArrayBuffer for storage
    const videoData = await responseClone.arrayBuffer();
    
    // Store the video data with metadata
    if (ttl) {
      await namespace.put(key, videoData, { metadata, expirationTtl: ttl });
    } else {
      await namespace.put(key, videoData, { metadata });
    }
    
    // Log success
    logDebug('Stored transformed video in KV', {
      key,
      size: metadata.contentLength,
      ttl: ttl || 'indefinite'
    });
    
    // Add breadcrumb for successful KV storage
    const requestContext = getCurrentContext();
    if (requestContext) {
      addBreadcrumb(requestContext, 'KV', 'Stored transformed video in KV', {
        key,
        contentType: metadata.contentType,
        contentLength: metadata.contentLength,
        ttl: ttl || 'indefinite'
      });
    }
    
    return true;
  } catch (err) {
    // Log error but don't fail the request
    const errMessage = err instanceof Error ? err.message : 'Unknown error';
    
    logError('Failed to store transformed video in KV', {
      sourcePath,
      options,
      error: errMessage,
      stack: err instanceof Error ? err.stack : undefined
    });
    
    // Add breadcrumb for KV storage error
    const requestContext = getCurrentContext();
    if (requestContext) {
      addBreadcrumb(requestContext, 'Error', 'Failed to store in KV', {
        sourcePath,
        error: errMessage,
        severity: 'medium'
      });
    }
    
    return false;
  }
}

/**
 * Retrieve a transformed video from KV storage
 * 
 * @param namespace - The KV namespace to use
 * @param sourcePath - Original video path
 * @param options - Transformation options
 * @returns The stored video response or null if not found
 */
export async function getTransformedVideo(
  namespace: KVNamespace,
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
  }
): Promise<{ response: Response; metadata: TransformationMetadata } | null> {
  try {
    // Generate a key for this transformed variant using consistent format with = delimiter
    const key = generateKVKey(sourcePath, options);
    
    // Log lookup key for debugging
    logDebug('Looking up KV cache with key', {
      key,
      sourcePath,
      derivative: options.derivative,
      width: options.width,
      height: options.height
    });
    
    // Check if the key exists in KV
    const { value, metadata } = await namespace.getWithMetadata<TransformationMetadata>(key, 'arrayBuffer');
    
    if (!value || !metadata) {
      logDebug('Transformed video not found in KV', { key });
      return null;
    }
    
    // Create headers for the response
    const headers = new Headers();
    headers.set('Content-Type', metadata.contentType);
    headers.set('Content-Length', metadata.contentLength.toString());
    
    // Add Cache-Control header if expiresAt is set
    const now = Date.now();
    if (metadata.expiresAt) {
      const remainingTtl = Math.max(0, Math.floor((metadata.expiresAt - now) / 1000));
      headers.set('Cache-Control', `public, max-age=${remainingTtl}`);
    } else {
      // Get the cache configuration manager
      const cacheConfig = CacheConfigurationManager.getInstance();
      const ttl = cacheConfig.getConfig().defaultMaxAge;
      headers.set('Cache-Control', `public, max-age=${ttl}`);
    }
    
    // Add Cache-Tag header with the cache tags from metadata
    if (metadata.cacheTags && metadata.cacheTags.length > 0) {
      headers.set('Cache-Tag', metadata.cacheTags.join(','));
    }
    
    // Add detailed KV cache headers for debugging and monitoring
    const cacheAge = Math.floor((now - metadata.createdAt) / 1000);
    const cacheTtl = metadata.expiresAt ? Math.floor((metadata.expiresAt - now) / 1000) : 86400; // Default 24h
    
    headers.set('X-KV-Cache-Age', `${cacheAge}s`);
    headers.set('X-KV-Cache-TTL', `${cacheTtl}s`);
    headers.set('X-KV-Cache-Key', key);
    headers.set('X-Cache-Status', 'HIT');
    headers.set('X-Cache-Source', 'KV');
    
    // Add derivative and other option information for analytics
    if (options.derivative) {
      headers.set('X-Video-Derivative', options.derivative);
    }
    if (options.quality) {
      headers.set('X-Video-Quality', options.quality);
    }
    
    // Create a new response with the video data
    const response = new Response(value, { headers });
    
    // Log success
    logDebug('Retrieved transformed video from KV', {
      key,
      size: metadata.contentLength,
      age: Math.floor((Date.now() - metadata.createdAt) / 1000) + 's'
    });
    
    // Add breadcrumb for successful KV retrieval
    const requestContext = getCurrentContext();
    if (requestContext) {
      addBreadcrumb(requestContext, 'KV', 'Retrieved transformed video from KV', {
        key,
        contentType: metadata.contentType,
        contentLength: metadata.contentLength,
        age: Math.floor((Date.now() - metadata.createdAt) / 1000) + 's'
      });
    }
    
    return { response, metadata };
  } catch (err) {
    // Log error but don't fail the request
    const errMessage = err instanceof Error ? err.message : 'Unknown error';
    
    logError('Failed to retrieve transformed video from KV', {
      sourcePath,
      options,
      error: errMessage,
      stack: err instanceof Error ? err.stack : undefined
    });
    
    // Add breadcrumb for KV retrieval error
    const requestContext = getCurrentContext();
    if (requestContext) {
      addBreadcrumb(requestContext, 'Error', 'Failed to retrieve from KV', {
        sourcePath,
        error: errMessage,
        severity: 'medium'
      });
    }
    
    return null;
  }
}

/**
 * List all transformed variants of a source video
 * 
 * @param namespace - The KV namespace to use
 * @param sourcePath - Original video path
 * @returns Array of keys and their metadata
 */
export async function listVariants(
  namespace: KVNamespace,
  sourcePath: string
): Promise<{ key: string; metadata: TransformationMetadata }[]> {
  try {
    // Normalize the path
    const normalizedPath = sourcePath.replace(/^\/+/, '');
    
    // Create a prefix for the key
    // We'll only use the path part to match all transformation modes (video, frame, spritesheet)
    // This allows listing all variants regardless of transformation type
    const prefix = normalizedPath;
    
    // List all keys with this prefix
    const keys = await namespace.list({ prefix });
    
    // Get metadata for each key
    const variants: { key: string; metadata: TransformationMetadata }[] = [];
    
    for (const key of keys.keys) {
      // Process any key that contains this normalized path
      // This will include all transformation modes (video, frame, spritesheet)
      // The key format will be [mode]:[path]:[params]
      if (key.name.includes(`:${normalizedPath}:`)) {
        const { metadata } = await namespace.getWithMetadata<TransformationMetadata>(key.name);
        
        if (metadata) {
          variants.push({ key: key.name, metadata });
        }
      }
    }
    
    // Log success
    logDebug('Listed video variants', {
      sourcePath,
      variantCount: variants.length
    });
    
    return variants;
  } catch (err) {
    // Log error
    const errMessage = err instanceof Error ? err.message : 'Unknown error';
    
    logError('Failed to list video variants', {
      sourcePath,
      error: errMessage,
      stack: err instanceof Error ? err.stack : undefined
    });
    
    return [];
  }
}
/**
 * KV Storage Service for video-resizer
 * 
 * This service provides functions for storing and retrieving transformed video variants in Cloudflare KV.
 * It supports storing both the video content and associated metadata, which can be used for cache invalidation.
 */

import { CacheConfigurationManager, VideoConfigurationManager } from '../config';
import { createLogger, debug as pinoDebug, error as pinoError } from '../utils/pinoLogger';
import { getCurrentContext } from '../utils/legacyLoggerAdapter';
import { addBreadcrumb } from '../utils/requestContext';
import { generateCacheTags } from './videoStorageService';
import { 
  logErrorWithContext, 
  withErrorHandling, 
  tryOrNull, 
  tryOrDefault 
} from '../utils/errorHandlingUtils';
import { getDerivativeDimensions } from '../utils/imqueryUtils';

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
 * Implementation of storeTransformedVideo with proper error handling
 * 
 * @param namespace - The KV namespace to use
 * @param sourcePath - Original video path
 * @param response - The transformed video response
 * @param options - Transformation options used
 * @param ttl - Optional TTL in seconds
 * @returns Boolean indicating if storage was successful
 */
async function storeTransformedVideoImpl(
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
    format: options.format,
    quality: options.quality,
    compression: options.compression,
    derivative: options.derivative,
    cacheTags: generateCacheTags(sourcePath, options, response.headers),
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
    customData: {
      ...(options.customData || {})
    }
  };
  
  // When we have a derivative, use the actual derivative dimensions for width/height
  // but store the original requested dimensions in customData
  if (options.derivative) {
    // Use centralized helper to get derivative dimensions
    const derivativeDimensions = getDerivativeDimensions(options.derivative);
    
    if (derivativeDimensions) {
      metadata.width = derivativeDimensions.width;
      metadata.height = derivativeDimensions.height;
      
      // Store original requested dimensions in customData for reference
      metadata.customData = {
        ...metadata.customData,
        requestedWidth: options.width,
        requestedHeight: options.height
      };
    } else {
      // Fallback to the provided dimensions if derivative config not found
      metadata.width = options.width;
      metadata.height = options.height;
    }
  } else {
    // No derivative - use provided dimensions directly
    metadata.width = options.width;
    metadata.height = options.height;
  }
  
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
}

/**
 * Store a transformed video in KV storage
 * This function is wrapped with error handling to ensure consistent error logging
 * and fail gracefully when KV operations encounter issues
 * 
 * @param namespace - The KV namespace to use
 * @param sourcePath - Original video path
 * @param response - The transformed video response
 * @param options - Transformation options used
 * @param ttl - Optional TTL in seconds
 * @returns Boolean indicating if storage was successful
 */
export const storeTransformedVideo = withErrorHandling<
  [
    KVNamespace,
    string,
    Response,
    {
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
    number | undefined
  ],
  Promise<boolean>
>(
  async function storeTransformedVideoWrapper(
    namespace,
    sourcePath,
    response,
    options,
    ttl?
  ): Promise<boolean> {
    try {
      return await storeTransformedVideoImpl(namespace, sourcePath, response, options, ttl);
    } catch (err) {
      // Add breadcrumb for KV storage error
      const requestContext = getCurrentContext();
      if (requestContext) {
        addBreadcrumb(requestContext, 'Error', 'Failed to store in KV', {
          sourcePath,
          error: err instanceof Error ? err.message : 'Unknown error',
          severity: 'medium'
        });
      }
      return false;
    }
  },
  {
    functionName: 'storeTransformedVideo',
    component: 'KVStorageService',
    logErrors: true
  },
  { operationType: 'write' }
);

/**
 * Implementation for retrieving a transformed video from KV storage
 * 
 * @param namespace - The KV namespace to use
 * @param sourcePath - Original video path
 * @param options - Transformation options
 * @returns The stored video response or null if not found
 */
async function getTransformedVideoImpl(
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
}

/**
 * Retrieve a transformed video from KV storage
 * Uses standardized error handling for robust error handling and logging
 * 
 * @param namespace - The KV namespace to use
 * @param sourcePath - Original video path
 * @param options - Transformation options
 * @returns The stored video response or null if not found
 */
export const getTransformedVideo = withErrorHandling<
  [
    KVNamespace,
    string,
    {
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
  ],
  Promise<{ response: Response; metadata: TransformationMetadata } | null>
>(
  async function getTransformedVideoWrapper(
    namespace,
    sourcePath,
    options
  ): Promise<{ response: Response; metadata: TransformationMetadata } | null> {
    try {
      return await getTransformedVideoImpl(namespace, sourcePath, options);
    } catch (err) {
      // Add breadcrumb for KV retrieval error
      const requestContext = getCurrentContext();
      if (requestContext) {
        addBreadcrumb(requestContext, 'Error', 'Failed to retrieve from KV', {
          sourcePath,
          error: err instanceof Error ? err.message : 'Unknown error',
          severity: 'medium'
        });
      }
      
      // Log via standardized error handling but return null to allow fallback to origin
      logErrorWithContext(
        'Failed to retrieve transformed video from KV',
        err,
        {
          sourcePath,
          options,
          key: generateKVKey(sourcePath, options)
        },
        'KVStorageService'
      );
      
      return null;
    }
  },
  {
    functionName: 'getTransformedVideo',
    component: 'KVStorageService',
    logErrors: true
  },
  { operationType: 'read' }
);

/**
 * Implementation for listing all transformed variants of a source video
 * 
 * @param namespace - The KV namespace to use
 * @param sourcePath - Original video path
 * @returns Array of keys and their metadata
 */
async function listVariantsImpl(
  namespace: KVNamespace,
  sourcePath: string
): Promise<{ key: string; metadata: TransformationMetadata }[]> {
  // Normalize the path
  const normalizedPath = sourcePath.replace(/^\/+/, '');
  
  // When listing by path in our pattern format, we need a better matching strategy
  // We need to find keys matching our pattern where path is part of key
  // First, get all keys that might match by listing all keys
  // We don't use a specific prefix to ensure we get all keys with our path
  const keys = await namespace.list();
  
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
}

/**
 * List all transformed variants of a source video
 * Uses standardized error handling to ensure consistent logging and fallback behavior
 * 
 * @param namespace - The KV namespace to use
 * @param sourcePath - Original video path
 * @returns Array of keys and their metadata, or empty array on error
 */
export const listVariants = withErrorHandling<
  [KVNamespace, string],
  Promise<{ key: string; metadata: TransformationMetadata }[]>
>(
  async function listVariantsWrapper(
    namespace,
    sourcePath
  ): Promise<{ key: string; metadata: TransformationMetadata }[]> {
    try {
      return await listVariantsImpl(namespace, sourcePath);
    } catch (err) {
      // Log via standardized error handling but return empty array
      logErrorWithContext(
        'Failed to list video variants',
        err,
        { sourcePath },
        'KVStorageService'
      );
      
      // Return empty array as fallback
      return [];
    }
  },
  {
    functionName: 'listVariants',
    component: 'KVStorageService',
    logErrors: true
  },
  { operationType: 'list' }
);
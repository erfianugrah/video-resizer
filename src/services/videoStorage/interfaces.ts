/**
 * Type definitions for the Video Storage Service
 */

// Type definitions for configuration objects
export interface CacheTTLConfig {
  ok?: number;
  error?: number;
  redirect?: number;
  default?: number;
}

export interface CacheConfig {
  ttl?: CacheTTLConfig;
  enableCacheTags?: boolean;
  bypassQueryParameters?: string[];
}

// Type for auth configuration
export interface AuthConfig {
  enabled: boolean;
  type: string;
  accessKeyVar?: string;
  secretKeyVar?: string;
  region?: string;
  service?: string;
  expiresInSeconds?: number;
  sessionTokenVar?: string;
  headers?: Record<string, string>;
}

export interface FetchOptions {
  userAgent?: string;
  headers?: Record<string, unknown>;
}

export interface StorageAuthConfig {
  useOriginAuth?: boolean;
  securityLevel?: 'strict' | 'permissive';
  cacheTtl?: number;
}

export interface R2Config {
  enabled?: boolean;
}

export interface StorageConfig {
  priority?: string[];
  r2?: R2Config;
  remoteUrl?: string;
  fallbackUrl?: string;
  remoteAuth?: AuthConfig;
  fallbackAuth?: AuthConfig;
  auth?: StorageAuthConfig;
  fetchOptions?: FetchOptions;
  pathTransforms?: Record<string, unknown>; // Make it compatible with usage
}

export interface PathTransformOriginConfig {
  removePrefix?: boolean;
  prefix?: string;
}

export interface PathTransformSegmentConfig extends PathTransformOriginConfig {
  [originType: string]: PathTransformOriginConfig | boolean | string | undefined;
}

export interface PathTransformConfig {
  [key: string]: PathTransformSegmentConfig;
}

export interface VideoResizerConfig {
  storage?: StorageConfig;
  cache?: CacheConfig;
  pathTransforms?: PathTransformConfig;
}

/**
 * Result of a storage operation
 */
export interface StorageResult {
  response: Response;
  sourceType: 'r2' | 'remote' | 'fallback' | 'error';
  contentType: string | null;
  size: number | null;
  originalUrl?: string;
  error?: Error;
  path?: string;
  width?: number;
  height?: number;
  duration?: number;
}

/**
 * Interface for video options
 */
export interface VideoOptions {
  mode?: string | null;
  derivative?: string | null;
  format?: string | null;
  width?: number | null;
  height?: number | null;
  quality?: string | null;
  compression?: string | null;
  time?: string | null;
  columns?: number | null;
  rows?: number | null;
  interval?: string | null;
  [key: string]: unknown;
}
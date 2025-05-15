/**
 * Type definitions for the Video Storage Service
 */

// Origin-based configuration interfaces
export interface Origin {
  name: string;                      // Unique identifier for this origin
  matcher: string;                   // Regex pattern to match incoming requests
  captureGroups?: string[];          // Names of capture groups in the matcher (optional)
  
  // Sources in priority order
  sources: Source[];
  
  // General settings for this origin
  ttl?: {
    ok: number;                      // TTL for successful responses (200-299)
    redirects: number;               // TTL for redirects (300-399)
    clientError: number;             // TTL for client errors (400-499)
    serverError: number;             // TTL for server errors (500-599)
  };
  useTtlByStatus?: boolean;          // Whether to use status-specific TTLs
  cacheability?: boolean;            // Whether responses can be cached
  videoCompression?: string;         // Video compression setting
  quality?: string;                  // Quality setting
  processPath?: boolean;             // Whether to process the path or pass it through
  
  // Additional settings from comprehensive config
  transformOptions?: {               // Options for transformation
    cacheability?: boolean;
    videoCompression?: string;
    quality?: string;
    fit?: string;
    bypassTransformation?: boolean;
  };
  derivatives?: Record<string, {     // Derivative-specific configurations
    width: number;
    height: number;
    compression?: string;
  }>;
  responsiveSelection?: {            // Responsive selection settings
    enabled: boolean;
    defaultDerivative: string;
    queryParam: string;
  };
  multiResolution?: {                // Multi-resolution settings
    enabled: boolean;
    resolutions: Record<string, {
      width: number;
      height: number;
      bitrate: number;
    }>;
    defaultResolution: string;
    queryParam: string;
  };
  accessControl?: {                  // Access control settings
    enabled: boolean;
    allowedIps?: string[];
    requireAuth?: boolean;
    authHeader?: string;
    authScheme?: string;
  };
  contentModeration?: {              // Content moderation settings
    enabled: boolean;
    sensitiveContent: boolean;
    ageRestriction: number;
  };
  cacheTags?: string[];              // Cache tags for purging
  metadata?: Record<string, string>; // Additional metadata
  streaming?: {                      // Streaming settings
    type: string;
    segmentDuration: number;
    manifestType: string;
    encryption: {
      enabled: boolean;
    };
  };
  dimensionRatio?: string;           // Aspect ratio (e.g. "16:9")
  formatMapping?: Record<string, {   // Format-specific mappings
    contentType: string;
    acceptRanges: boolean;
  }>;
}

export interface Source {
  type: 'r2' | 'remote' | 'fallback'; // The type of storage source
  priority: number;                   // Priority order (lower is higher priority)
  
  // Type-specific fields
  bucketBinding?: string;             // For r2: binding name for the bucket
  url?: string;                       // For remote/fallback: base URL
  
  // Path mapping using template strings with capture groups
  // e.g., "videos/$1" where $1 is the first capture group from the matcher
  path: string;
  
  // Authentication settings (if needed)
  auth?: Auth;
  
  // Additional settings from comprehensive config
  headers?: Record<string, string>;   // Custom headers to send with requests
  cacheControl?: {                    // Cache-Control settings
    maxAge?: number;
    staleWhileRevalidate?: number;
    staleIfError?: number;
  };
  resolutionPathTemplate?: boolean;   // Whether path is a template that includes resolution variables
}

export interface Auth {
  enabled: boolean;
  type: 'aws-s3' | 'token' | 'basic' | 'bearer' | 'query' | 'header';
  // Auth type-specific fields
  accessKeyVar?: string;
  secretKeyVar?: string;
  region?: string;
  service?: string;
  tokenVar?: string;
  tokenHeaderName?: string;
  headerName?: string;
  expiresInSeconds?: number;
  sessionTokenVar?: string;
  headers?: Record<string, string>;
  params?: Record<string, string>;
  authHeader?: string;
  authScheme?: string;
  tokenSecret?: string;
}

// Type definitions for legacy configuration objects
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

// Extended Origins configuration with control flags
export interface OriginsConfig {
  enabled?: boolean;                   // Flag to enable/disable Origins system
  useLegacyPathPatterns?: boolean;     // Flag to use legacy path patterns as fallback
  items?: Origin[];                    // Actual Origin objects
}

export interface VideoResizerConfig {
  // Version indicator for schema type
  version?: string;
  
  // New origins-based configuration
  origins?: Origin[] | OriginsConfig;
  
  // Legacy configuration (for backward compatibility)
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
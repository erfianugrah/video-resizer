/**
 * Type definitions for video transformation commands
 *
 * Extracted from TransformVideoCommand.ts for better modularity.
 */
import { PathPattern } from '../../utils/pathUtils';
import { DebugInfo } from '../../utils/debugHeadersUtils';
import { RequestContext } from '../../utils/requestContext';
import type { Logger } from 'pino';
import { Origin } from '../../services/videoStorage/interfaces';
import { SourceResolutionResult } from '../../services/origins/OriginResolver';

export interface VideoTransformOptions {
  width?: number | null;
  height?: number | null;
  mode?: string | null;
  fit?: string | null;
  audio?: boolean | null;
  format?: string | null;
  time?: string | null;
  duration?: string | null;
  quality?: string | null;
  compression?: string | null;
  loop?: boolean | null;
  preload?: string | null;
  autoplay?: boolean | null;
  muted?: boolean | null;
  source?: string;
  derivative?: string | null;
  filename?: string | null;

  // Additional video parameters
  fps?: number | null;
  speed?: number | null;
  crop?: string | null;
  rotate?: number | null;

  // IMQuery reference parameter
  imref?: string | null;

  // Cache versioning
  version?: number;

  // Diagnostics information
  diagnosticsInfo?: Record<string, any>;

  // Custom data for additional metadata (like IMQuery parameters)
  customData?: Record<string, unknown>;
}

/**
 * Interface for R2 bucket operations
 */
export interface R2Bucket {
  get(key: string): Promise<R2Object | null>;
  put(key: string, value: ReadableStream | ArrayBuffer | string): Promise<R2Object>;
  delete(key: string): Promise<void>;
}

/**
 * Interface for R2 object metadata
 */
export interface R2Object {
  key: string;
  version: string;
  size: number;
  etag: string;
  httpEtag: string;
  uploaded: Date;
  httpMetadata?: {
    contentType?: string;
    contentEncoding?: string;
    contentLanguage?: string;
    contentDisposition?: string;
    cacheControl?: string;
    contentLength?: number;
  };
  customMetadata?: Record<string, string>;
  body: ReadableStream;
}

/**
 * Interface for CloudFlare worker environment
 */
export interface WorkerEnvironment {
  ASSETS?: {
    fetch: (request: Request) => Promise<Response>;
  };
  // Add R2 bucket bindings
  [bucketName: string]: R2Bucket | { fetch: Function } | string | undefined;
}

export interface VideoTransformContext {
  request: Request;
  options: VideoTransformOptions;
  pathPatterns?: PathPattern[];
  debugInfo?: DebugInfo;
  env?: WorkerEnvironment; // Environment variables including bindings
  // Add RequestContext and logger to the transform context
  requestContext?: RequestContext;
  logger?: Logger;

  // Origins-based context (when using new Origins system)
  origin?: Origin; // Origin definition
  sourceResolution?: SourceResolutionResult; // Resolved source for the path
  debugMode?: boolean; // Debug mode flag
}

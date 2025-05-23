/**
 * Diagnostic types for the video resizer
 */

export interface TransformParams {
  width?: number;
  height?: number;
  mode?: 'video' | 'frame' | 'spritesheet';
  fit?: 'contain' | 'cover' | 'scale-down';
  format?: string;
  time?: string;
  duration?: string;
  audio?: boolean;
  quality?: 'low' | 'medium' | 'high' | 'auto';
  compression?: 'low' | 'medium' | 'high' | 'auto';
  loop?: boolean;
  autoplay?: boolean;
  muted?: boolean;
  preload?: 'none' | 'metadata' | 'auto';
  [key: string]: any;
}

export interface BrowserCapabilities {
  webpSupport?: boolean;
  avifSupport?: boolean;
  h264Support?: boolean;
  vp9Support?: boolean;
  av1Support?: boolean;
  hlsSupport?: boolean;
  dashSupport?: boolean;
  [key: string]: boolean | undefined;
}

import { Breadcrumb } from '../utils/requestContext';

export interface DiagnosticsInfo {
  // Basic metadata
  originalUrl?: string;
  processingTimeMs?: number;
  transformSource?: string;
  videoId?: string;
  videoFormat?: string;
  
  // Transformation details
  pathMatch?: string;
  transformParams?: TransformParams;
  actualTransformParams?: Record<string, string>;
  cdnCgiUrl?: string;
  
  // Client detection
  clientHints?: boolean;
  deviceType?: 'mobile' | 'tablet' | 'desktop' | string;
  networkQuality?: 'low' | 'medium' | 'high' | string;
  browserCapabilities?: BrowserCapabilities;
  
  // Cache information
  cacheability?: boolean;
  cacheTtl?: number;
  cacheTags?: string[];
  cacheVersion?: number;
  
  // Errors and warnings
  errors?: string[];
  warnings?: string[];
  
  // Extended diagnostics info
  derivative?: string;
  source?: string;
  sourceUrl?: string;
  videoInfo?: {
    width?: number;
    height?: number;
    duration?: number;
    format?: string;
  };
  
  // Configuration information (for debug UI)
  videoConfig?: Record<string, unknown>;
  cacheConfig?: Record<string, unknown>;
  debugConfig?: Record<string, unknown>;
  loggingConfig?: Record<string, unknown>;
  environment?: Record<string, unknown>;
  
  // Request context information
  requestId?: string;
  breadcrumbs?: Breadcrumb[];
  performanceMetrics?: Record<string, unknown>;
  
  // Headers information for debugging
  requestHeaders?: Record<string, string>;
  originalHeaders?: Record<string, string>;
  finalHeaders?: Record<string, string>;
  originalRequestHeaders?: Record<string, string>;
  
  // Origin system information
  origin?: {
    name: string;
    matcher: string;
    processPath?: boolean;
    capturedParams?: Record<string, string>;
  };
  
  sourceResolution?: {
    type: string;
    resolvedPath: string;
    url?: string;
    source?: Record<string, unknown>;
  };
  
  originUrl?: string;
  fallbackUrl?: string;
  transformRequest?: {
    url: string;
    method: string;
    headers: Record<string, string>;
  };
  transformResponse?: {
    status: number;
    statusText: string;
    headers: Record<string, string>;
  };
  
  // Special flags
  isRangeRequest?: boolean;
  isMediaContent?: boolean;
  originalRequestHadRange?: boolean;
  cachingMethod?: string;
  
  // Fallback information
  fallbackApplied?: boolean;
  fallbackReason?: string;
  fallbackResponse?: Record<string, unknown>;
  
  // Akamai translation info
  originalAkamaiParams?: Record<string, string>;
  translatedCloudflareParams?: Record<string, string | boolean | number>;
  translationWarnings?: string[];
  usingIMQuery?: boolean;
  imqueryMatching?: {
    requestedWidth?: number | null;
    requestedHeight?: number | null;
    matchedDerivative?: string;
    derivativeWidth?: number | null;
    derivativeHeight?: number | null;
    percentDifference?: string;
    mappingMethod?: string;
  };
  
  // Component timing info
  componentTiming?: Record<string, number>;
  executionTiming?: {
    originResolution?: number;
    sourceResolution?: number;
    transformation?: number;
    caching?: number;
    responseBuilding?: number;
  };
  
  // Additional data
  [key: string]: unknown;
}
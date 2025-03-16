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
  
  // Errors and warnings
  errors?: string[];
  warnings?: string[];
  
  // Extended diagnostics info
  derivative?: string;
  source?: string;
  
  // Configuration information (for new debug UI)
  configuration?: {
    videoConfig?: Record<string, any>;
    cacheConfig?: Record<string, any>;
    debugConfig?: Record<string, any>;
    loggingConfig?: Record<string, any>;
    environment?: Record<string, any>;
  };
  
  // Additional data
  [key: string]: any;
}
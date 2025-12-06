/**
 * Default configuration for video resizing and transformation
 * 
 * This file provides minimal default values that will be overridden
 * by configuration from worker-config.json or KV store at runtime.
 */
export const videoConfig = {
  // Define minimal default derivatives - these will be populated from config
  derivatives: {
    // Default derivatives with minimal settings
    // These are placeholders that will be overridden by configuration
    high: {
      width: 1920,
      height: 1080,
      quality: 'high',
    },
    medium: {
      width: 1280,
      height: 720,
      quality: 'medium',
    },
    low: {
      width: 854,
      height: 480,
      quality: 'low',
    },
    mobile: {
      width: 640,
      height: 360,
      quality: 'low',
    },
    thumbnail: {
      width: 320,
      height: 180,
      mode: 'frame',
      format: 'jpg',
    },
    // Keep legacy names for backward compatibility
    desktop: {
      width: 1920,
      height: 1080,
      quality: 'high',
    },
    tablet: {
      width: 1280,
      height: 720,
      quality: 'medium',
    },
  },

  // Default video options when none are specified
  defaults: {
    width: null,
    height: null,
    mode: 'video',
    fit: 'contain',
    audio: true,
    format: null,
    time: null,
    duration: null,
    quality: null,
    compression: null,
    loop: null,
    preload: null,
    autoplay: null,
    muted: null,
  },

  // Default valid options
  validOptions: {
    mode: ['video', 'frame', 'spritesheet'],
    fit: ['contain', 'scale-down', 'cover'],
    format: ['jpg', 'png'],
    audio: [true, false],
    quality: ['low', 'medium', 'high', 'auto'],
    compression: ['low', 'medium', 'high', 'auto'],
    preload: ['none', 'metadata', 'auto'],
    loop: [true, false],
    autoplay: [true, false],
    muted: [true, false],
  },

  // Minimal responsive sizing defaults
  responsive: {
    breakpoints: {
      xs: 640,
      sm: 768,
      md: 1024,
      lg: 1280,
      xl: 1920,
    },
    availableQualities: [360, 480, 720, 1080],
    deviceWidths: {
      mobile: 480,
      tablet: 720,
      desktop: 1080,
    },
    networkQuality: {
      slow: {
        maxWidth: 480,
        maxHeight: 360,
        maxBitrate: 800,
      },
      medium: {
        maxWidth: 854,
        maxHeight: 480,
        maxBitrate: 1500,
      },
      fast: {
        maxWidth: 1280,
        maxHeight: 720,
        maxBitrate: 3000,
      },
    },
  },

  // Empty responsive breakpoints - will be populated from config
  responsiveBreakpoints: {},

  // Basic parameter mapping
  paramMapping: {
    width: 'width',
    height: 'height',
    mode: 'mode',
    fit: 'fit',
    audio: 'audio',
    format: 'format',
    time: 'time',
    duration: 'duration',
    quality: 'quality',
    compression: 'compression',
    loop: 'loop',
    preload: 'preload',
    autoplay: 'autoplay',
    muted: 'muted',
  },

  // CDN-CGI path configuration
  cdnCgi: {
    basePath: '/cdn-cgi/media',
  },

  // Default passthrough settings
  passthrough: {
    enabled: true,
    whitelistedFormats: [],
  },

  // Default empty path patterns - populated from config
  pathPatterns: [],

  // Default caching configuration - overridden at runtime
  caching: {
    method: 'kv',
    debug: false,
    fallback: {
      enabled: true,
      badRequestOnly: false, // Allow fallback for all errors, including 500s
      preserveHeaders: ['Content-Type', 'Cache-Control', 'Etag'],
      maxRetries: 2, // Maximum number of retries for 500 errors
      // File size error handling with direct source fallback
      // When file size limits are exceeded in CDN-CGI transformation:
      // 1. Uses originSourceUrl from TransformationService if available
      // 2. Falls back to pattern's originUrl otherwise
      // 3. Final fallback to videoStorageService if direct sources fail
      // Adds X-File-Size-Error and X-Direct-Source-Used headers for tracking
      fileSizeErrorHandling: true, // Feature flag for direct source fallback on file size errors
    },
  },

  // Default cache profiles - overridden at runtime
  cache: {
    default: {
      regex: '.*',
      cacheability: true,
      videoCompression: 'auto',
      useTtlByStatus: true,
      ttl: {
        ok: 86400,
        redirects: 3600,
        clientError: 60,
        serverError: 10,
      },
    },
  },
};

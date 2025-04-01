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
    desktop: {
      width: 1920,
      height: 1080,
      quality: "high",
    },
    tablet: {
      width: 1280, 
      height: 720,
      quality: "medium",
    },
    mobile: {
      width: 854,
      height: 640,
      quality: "low",
    },
  },

  // Default video options when none are specified
  defaults: {
    width: null,
    height: null,
    mode: "video",
    fit: "contain",
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
    mode: ["video", "frame", "spritesheet"],
    fit: ["contain", "scale-down", "cover"],
    format: ["jpg", "png"],
    audio: [true, false],
    quality: ["low", "medium", "high", "auto"],
    compression: ["low", "medium", "high", "auto"],
    preload: ["none", "metadata", "auto"],
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
    width: "width",
    height: "height",
    mode: "mode",
    fit: "fit",
    audio: "audio",
    format: "format",
    time: "time",
    duration: "duration",
    quality: "quality",
    compression: "compression",
    loop: "loop",
    preload: "preload",
    autoplay: "autoplay",
    muted: "muted",
  },

  // CDN-CGI path configuration
  cdnCgi: {
    basePath: "/cdn-cgi/media",
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
    method: "cacheApi",
    debug: false,
    fallback: {
      enabled: true,
      badRequestOnly: true,
      preserveHeaders: ["Content-Type", "Cache-Control", "Etag"],
    },
  },

  // Default cache profiles - overridden at runtime
  cache: {
    default: {
      regex: ".*",
      cacheability: true,
      videoCompression: "auto",
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

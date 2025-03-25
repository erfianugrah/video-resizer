/**
 * Configuration for video resizing and transformation
 */

export const videoConfig = {
  // Define video derivatives - preset configurations
  derivatives: {
    // High-quality derivative
    high: {
      width: 1920,
      height: 1080,
      mode: 'video',
      fit: 'contain',
      audio: true,
      quality: 'high',
      compression: 'low',
    },

    // Medium-quality derivative
    medium: {
      width: 1280,
      height: 720,
      mode: 'video',
      fit: 'contain',
      audio: true,
      quality: 'medium',
      compression: 'medium',
    },

    // Low-quality derivative
    low: {
      width: 854,
      height: 480,
      mode: 'video',
      fit: 'contain',
      audio: true,
      quality: 'low',
      compression: 'high',
    },

    // Mobile-optimized derivative
    mobile: {
      width: 640,
      height: 360,
      mode: 'video',
      fit: 'contain',
      audio: true,
      quality: 'low',
      compression: 'high',
      preload: 'metadata',
    },

    // Thumbnail derivative
    thumbnail: {
      width: 320,
      height: 180,
      mode: 'frame',
      fit: 'contain',
      format: 'jpg',
    },
    
    // Animation derivative - for GIF-like video clips
    animation: {
      width: 480,
      height: 270,
      mode: 'video',
      fit: 'contain',
      audio: false,
      loop: true,
      preload: 'auto',
    },
    
    // Preview derivative - short, low-res preview with no audio
    preview: {
      width: 480,
      height: 270,
      mode: 'video',
      fit: 'contain',
      audio: false,
      duration: '5s',
      quality: 'low',
      compression: 'high',
      preload: 'auto',
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
    duration: '5m', // Default to 5 minutes for video playback
    quality: null,
    compression: null,
    loop: null,
    preload: null,
    autoplay: null,
    muted: null,
  },

  // Valid options
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

  // Responsive sizing breakpoints
  responsive: {
    breakpoints: {
      xs: 640,
      sm: 768,
      md: 1024,
      lg: 1280,
      xl: 1920,
    },
    // Available video quality settings
    availableQualities: [360, 480, 720, 1080, 1440, 2160],
    // Device-specific width mapping
    deviceWidths: {
      mobile: 480,
      tablet: 720,
      desktop: 1080,
    },
    // Network condition-based quality adjustments
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
      ultrafast: {
        maxWidth: 1920,
        maxHeight: 1080,
        maxBitrate: 6000,
      },
    },
  },

  // Parameter mapping
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

  // Default empty path patterns
  // These will be populated from environment configuration
  pathPatterns: [],
  
  // Caching configuration
  // These values will be updated from environment configuration at runtime
  caching: {
    // Which caching method to use: 'cf' or 'cacheApi'
    method: 'cacheApi', 
    // Whether to enable debug logging for cache operations
    debug: false,
  },
  
  // Cache configuration for different video types
  cache: {
    // Default cache configuration for all videos
    default: {
      regex: '.*',
      cacheability: true,
      videoCompression: 'auto',
      ttl: {
        ok: 86400, // 24 hours for successful responses
        redirects: 3600, // 1 hour for redirects
        clientError: 60, // 1 minute for client errors
        serverError: 10, // 10 seconds for server errors
      },
    },
    // High-traffic videos with longer cache time
    highTraffic: {
      regex: '.*\/popular\/.*\\.mp4',
      cacheability: true,
      videoCompression: 'auto',
      ttl: {
        ok: 604800, // 7 days for successful responses
        redirects: 3600, // 1 hour for redirects
        clientError: 60, // 1 minute for client errors
        serverError: 10, // 10 seconds for server errors
      },
    },
    // Short-form videos with medium cache time
    shortForm: {
      regex: '.*\/shorts\/.*\\.mp4',
      cacheability: true,
      videoCompression: 'auto',
      ttl: {
        ok: 172800, // 2 days for successful responses
        redirects: 3600, // 1 hour for redirects
        clientError: 60, // 1 minute for client errors
        serverError: 10, // 10 seconds for server errors
      },
    },
    // Live content or frequently updated videos with shorter cache time
    dynamic: {
      regex: '.*\/live\/.*\\.mp4',
      cacheability: true,
      videoCompression: 'auto',
      ttl: {
        ok: 300, // 5 minutes for successful responses
        redirects: 60, // 1 minute for redirects
        clientError: 30, // 30 seconds for client errors
        serverError: 10, // 10 seconds for server errors
      },
    },
  },
};

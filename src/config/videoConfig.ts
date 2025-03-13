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
    },

    // Medium-quality derivative
    medium: {
      width: 1280,
      height: 720,
      mode: 'video',
      fit: 'contain',
      audio: true,
    },

    // Low-quality derivative
    low: {
      width: 854,
      height: 480,
      mode: 'video',
      fit: 'contain',
      audio: true,
    },

    // Mobile-optimized derivative
    mobile: {
      width: 640,
      height: 360,
      mode: 'video',
      fit: 'contain',
      audio: true,
    },

    // Thumbnail derivative
    thumbnail: {
      width: 320,
      height: 180,
      mode: 'frame',
      fit: 'contain',
      format: 'jpg',
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
  },

  // Valid options
  validOptions: {
    mode: ['video', 'frame', 'spritesheet'],
    fit: ['contain', 'scale-down', 'cover'],
    format: ['jpg', 'png'],
    audio: [true, false],
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
  },

  // CDN-CGI path configuration
  cdnCgi: {
    basePath: '/cdn-cgi/media',
  },

  // Default empty path patterns
  // These will be populated from environment configuration
  pathPatterns: [],
};

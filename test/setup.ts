/**
 * Global test setup file
 * 
 * Sets up global variables and configuration needed for tests
 */

// Define LOGGING_CONFIG global to match what exists in wrangler.jsonc
// This ensures tests don't show "No request context available" warnings
(globalThis as any).LOGGING_CONFIG = {
  pino: {
    level: 'debug',
    browser: {
      asObject: true
    },
    base: {
      service: 'video-resizer',
      env: 'test'
    }
  },
  sampling: {
    enabled: false,
    rate: 1.0
  },
  breadcrumbs: {
    enabled: true,
    maxItems: 100
  }
};

// Initialize other global variables if needed
/**
 * Vitest setup file for ensuring proper Wrangler environment configuration
 * This file runs before tests to set up environment variables that need to be
 * propagated to pooled workers.
 */

// Ensure Wrangler uses local directories for logs and config
process.env.WRANGLER_HOME = process.env.WRANGLER_HOME || './.wrangler-home';
process.env.WRANGLER_LOG_DIR = process.env.WRANGLER_LOG_DIR || './.wrangler-logs';

// Disable telemetry in tests
process.env.WRANGLER_SEND_METRICS = 'false';

// Configure Node.js to use local paths
process.env.HOME = process.env.HOME || process.cwd();
process.env.XDG_CONFIG_HOME = process.env.XDG_CONFIG_HOME || './.wrangler-home';

// Log configuration for debugging
console.log('[Vitest Setup] Wrangler environment configured:', {
  WRANGLER_HOME: process.env.WRANGLER_HOME,
  WRANGLER_LOG_DIR: process.env.WRANGLER_LOG_DIR,
  WRANGLER_SEND_METRICS: process.env.WRANGLER_SEND_METRICS,
  XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
});

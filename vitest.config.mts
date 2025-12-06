import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    setupFiles: ['./vitest.setup.ts'],
    env: {
      WRANGLER_HOME: './.wrangler-home',
      WRANGLER_LOG_DIR: './.wrangler-logs',
      WRANGLER_SEND_METRICS: 'false',
      XDG_CONFIG_HOME: './.wrangler-home'
    },
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: {
          // Pass environment variables to workers
          bindings: {},
          envPath: true,
        }
      },
    },
    testTimeout: 30000, // Increase timeout to 30 seconds
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', 'test/', '**/*.spec.ts', '**/*.test.ts'],
    },
    includeSource: ['src/**/*.ts'],
  },
});

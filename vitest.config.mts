import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.jsonc' },
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

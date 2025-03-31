import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Use node environment for basic unit tests
    environment: 'node',
    // Skip the worker pool for these tests
    pool: 'forks',
    // Other configuration
    globals: true,
    include: ['test/kv-cache/**/*.{spec,test}.ts'],
  },
});
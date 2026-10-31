import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: ['./test/global-setup.ts'],
    setupFiles: ['./test/env.ts'],
    fileParallelism: false,   // tests share one database
    testTimeout: 20000,
    hookTimeout: 30000
  }
});

import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/e2e/**/*.test.ts'],
    testTimeout: 120000, // 2 minutes for e2e tests
    hookTimeout: 30000,
    teardownTimeout: 10000,
    setupFiles: [],
    globals: true,
  },
})
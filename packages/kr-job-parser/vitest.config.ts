import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src'],
      thresholds: { lines: 95, branches: 90, functions: 100, statements: 95 },
    },
  },
});

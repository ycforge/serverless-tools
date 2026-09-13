import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['src/**/*.spec.ts', 'test/**/*.spec.ts'],
    typecheck: {
      enabled: true,
      include: ['test/builder/**/*.test-d.ts'],
    },
  },
});
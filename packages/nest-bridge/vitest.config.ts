import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    setupFiles: ['reflect-metadata'],
    include: ['src/**/*.spec.ts', 'test/**/*.spec.ts'],
  },
});

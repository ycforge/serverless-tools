import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'nestjs-function/index': 'src/nestjs-function/index.ts',
    'docker/index': 'src/docker/index.ts',
    'vite/index': 'src/vite/index.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  minify: false,
});
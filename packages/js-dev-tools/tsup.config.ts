import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    'server/index': 'src/server/index.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  minify: false,
});
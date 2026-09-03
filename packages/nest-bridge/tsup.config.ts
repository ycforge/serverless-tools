import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'auth/index': 'src/auth/index.ts',
    'queue/index': 'src/queue/index.ts',
    'context/index': 'src/context/index.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  minify: false,
});

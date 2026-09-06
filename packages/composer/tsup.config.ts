import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: { index: 'src/index.ts' },
    format: ['esm'],
    dts: true,
    clean: true,
    sourcemap: true,
    minify: false,
    external: ['yaml', 'commander', '@ycforge/pilot'],
  },
  {
    entry: { index: 'src/cli/index.ts' },
    outDir: 'dist/cli',
    format: ['esm'],
    dts: true,
    clean: false,
    sourcemap: true,
    minify: false,
    external: ['yaml', 'commander', '@ycforge/pilot'],
    banner: { js: '#!/usr/bin/env node' },
  },
]);
import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: {
      index: 'src/index.ts',
      'contracts/index': 'src/contracts/index.ts',
      'build/index': 'src/build/index.ts',
    },
    format: ['esm', 'cjs'],
    dts: true,
    clean: true,
    sourcemap: true,
    minify: false,
    external: ['yaml', 'commander'],
  },
  {
    entry: { index: 'src/cli/index.ts' },
    outDir: 'dist/cli',
    format: ['esm'],
    clean: false,
    sourcemap: true,
    minify: false,
    external: ['yaml', 'commander'],
    banner: { js: '#!/usr/bin/env node' },
  },
]);

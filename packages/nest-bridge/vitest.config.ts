import { defineConfig, type Plugin } from 'vitest/config';
import { transformSync } from '@swc/core';

// NestJS DI resolves constructor dependencies via the `design:paramtypes`
// reflection emitted with decorator metadata. Neither esbuild nor Vite 7 emit
// it (esbuild strips decorators without reflection), so bare class-token
// injection (spec 004 FR-012, `constructor(private readonly logger:
// YandexLogger)`) would resolve to `undefined` under vitest. This plugin
// transforms every `.ts` source/test file through swc with legacy decorators
// and decorator metadata enabled, matching the semantics of a tsc-compiled
// Nest application. scoped to the CLI test pipeline only — the published
// runtime (tsup/esbuild) needs no metadata because consumers inject the token
// from their own tsc-compiled code.
function emitDecoratorMetadataPlugin(): Plugin {
  return {
    name: 'emit-decorator-metadata',
    enforce: 'pre',
    transform(code, id) {
      if (!/\.[cm]?ts$/.test(id) || id.includes('node_modules')) {
        return null;
      }
      const result = transformSync(code, {
        jsc: {
          parser: { syntax: 'typescript', decorators: true },
          target: 'es2022',
          transform: { legacyDecorator: true, decoratorMetadata: true },
        },
        sourceMaps: true,
      });
      return { code: result.code, map: result.map };
    },
  };
}

export default defineConfig({
  plugins: [emitDecoratorMetadataPlugin()],
  test: {
    globals: true,
    setupFiles: ['reflect-metadata'],
    include: ['src/**/*.spec.ts', 'test/**/*.spec.ts'],
    // Every spec bootstraps one or more full NestJS applications, which is
    // memory-hungry. Cap the worker count so a full run no longer spans one
    // process per CPU (~15 × ~2GB) and exhausts RAM. Tests in this repo are
    // I/O-light but bootstrap-heavy, so a small worker pool is both stable
    // and still comfortably fast.
    pool: 'threads',
    maxWorkers: 2,
    minWorkers: 1,
    maxConcurrency: 1,
  },
});

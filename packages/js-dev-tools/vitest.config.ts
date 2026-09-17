import { defineConfig, type Plugin } from 'vitest/config';
import { transformSync } from '@swc/core';

// NestJS DI resolves constructor dependencies via the `design:paramtypes`
// reflection emitted with decorator metadata. Neither esbuild nor Vite 7 emit
// it (esbuild strips decorators without reflection), so bare class-token
// injection would resolve to `undefined` under vitest. This plugin transforms
// every `.ts` test/fixture file through swc with legacy decorators and
// decorator metadata enabled, matching the semantics of a tsc-compiled Nest
// application. Scoped to the CLI test pipeline only — the published runtime
// is bundled through tsup/esbuild and needs no metadata.
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
    include: ['src/**/*.spec.ts', 'test/**/*.spec.ts', 'test/**/*.test.ts'],
    passWithNoTests: true,
    // Every repeatable test bootstraps full NestJS applications, which is
    // memory-hungry. Cap the worker count and concurrency like nest-bridge.
    pool: 'threads',
    maxWorkers: 2,
    minWorkers: 1,
    maxConcurrency: 1,
  },
});
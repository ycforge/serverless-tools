import { readFile } from 'node:fs/promises';

import { transformSync } from '@swc/core';
import type { Plugin } from 'esbuild';

/**
 * esbuild plugin that transpiles TypeScript through SWC so NestJS constructor
 * dependency injection keeps working.
 *
 * NestJS resolves constructor dependencies from the `design:paramtypes`
 * reflection metadata emitted under `experimentalDecorators` +
 * `emitDecoratorMetadata`. esbuild implements the former but deliberately NOT
 * the latter — it "requires type information" — so a bundle built by esbuild
 * alone strips the metadata and DI fails at runtime with
 * `Cannot read properties of undefined (reading 'getPublic')` (or resolves
 * `undefined` tokens). SWC does emit it, so every `.ts`/`.tsx` file is
 * transformed here (legacy decorators + decorator metadata) before esbuild
 * bundles the resulting JavaScript.
 *
 * This mirrors the SWC settings already used by the packages' own vitest
 * configs, and matches the semantics of a `tsc`-compiled Nest application.
 */
export function createDecoratorMetadataPlugin(): Plugin {
  return {
    name: 'swc-decorator-metadata',
    setup(build) {
      build.onLoad({ filter: /\.tsx?$/ }, async (args) => {
        const source = await readFile(args.path, 'utf8');
        const tsx = args.path.endsWith('.tsx');
        const { code } = transformSync(source, {
          filename: args.path,
          sourceMaps: false,
          jsc: {
            parser: { syntax: 'typescript', decorators: true, tsx },
            transform: { legacyDecorator: true, decoratorMetadata: true },
            target: 'es2021',
          },
          module: { type: 'es6' },
        });
        return { contents: code, loader: 'js' };
      });
    },
  };
}

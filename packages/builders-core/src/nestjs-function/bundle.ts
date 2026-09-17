/**
 * Function bundling (US1, D-RE-8): esbuild bundles the entry + local imports
 * into one self-contained CJS file. Nest optional plugins (transport adapters,
 * validator bridges) are satisfied with empty stubs so the runtime `require`
 * guards in `@nestjs/core` never resolve against the live store; the staging
 * directory is zipped deterministically into `outputDir/<out_filename>`.
 */

import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { basename, extname, join } from 'node:path';

import { build, type Plugin } from 'esbuild';

import { BLC_ARCHIVE_FAILED, BLC_BUILD_FAILED, BLC_ENTRY_NOT_FOUND, builderError } from '../diagnostics.js';
import type { BuilderError } from '../diagnostics.js';
import { collectDir } from '../zip/collect.js';
import { zipEntries } from '../zip/writer.js';
import type { ParsedNestjsConfig } from './config.js';

export interface BundleFunctionOptions extends ParsedNestjsConfig {
  readonly sourcePath: string;
  readonly outputDir: string;
}

export interface FunctionBundleResult {
  readonly archivePath: string;
  readonly entryPoint: string;
}

/**
 * Nest loads optional integrations with runtime `require()` guards (loadPackage
 * in @nestjs/core). Bundling would force esbuild to resolve them (and their
 * own optional transports: mqtt/nats/redis/... already missing from the app),
 * so those bare imports are substituted with an empty module: the guard then
 * treats the integration as absent, which is correct for plain HTTP functions.
 */
const NEST_OPTIONAL_STUBS: ReadonlyArray<{ filter: RegExp }> = [
  { filter: /^@nestjs\/microservices(\/.*)?$/ },
  { filter: /^@nestjs\/platform-express(\/.*)?$/ },
  { filter: /^@nestjs\/websockets(\/.*)?$/ },
  { filter: /^class-transformer\/(cjs\/)?storage$/ },
  { filter: /^class-validator$/ },
];

const stubPlugin: Plugin = {
  name: 'nest-optional-stub',
  setup(build) {
    const stubPath = 'nest-optional-stub.js';
    build.onResolve({ filter: /./ }, ({ path, importer }) => {
      const hits = NEST_OPTIONAL_STUBS.filter((s) => s.filter.test(path));
      if (hits.length === 0) return undefined;
      if (importer.includes('node_modules') || importer.includes('packages/nest-bridge')) {
        return { path: stubPath, namespace: 'nest-stub' };
      }
      return undefined;
    });
    build.onLoad({ filter: /nest-optional-stub/, namespace: 'nest-stub' }, () => ({
      contents: 'module.exports = {};',
      loader: 'js',
    }));
  },
};

export async function bundleFunction(options: BundleFunctionOptions): Promise<FunctionBundleResult> {
  const { sourcePath, entry, runtime, external, out_filename, outputDir } = options;

  const entryAbs = join(sourcePath, entry);
  if (!existsSync(entryAbs)) {
    throw builderError(
      BLC_ENTRY_NOT_FOUND,
      `entry not found: ${entry} (${BLC_ENTRY_NOT_FOUND})`,
      { field: 'entry' },
    );
  }

  const target = runtime === 'nodejs22' ? 'node22' : 'node20';
  const staging = join(outputDir, '.staging');

  try {
    mkdirSync(staging, { recursive: true });
    try {
      await build({
        entryPoints: [entryAbs],
        bundle: true,
        platform: 'node',
        format: 'cjs',
        target,
        external: [...external],
        plugins: [stubPlugin],
        outfile: join(staging, 'main.js'),
        write: true,
        logLevel: 'silent',
        sourcemap: false,
        minify: false,
      });
    } catch (err: unknown) {
      const detail = err instanceof Error ? err.message : String(err);
      throw builderError(BLC_BUILD_FAILED, `esbuild failed: ${detail} (${BLC_BUILD_FAILED})`);
    }
    const archivePath = join(outputDir, out_filename);
    zipEntries(collectDir(staging), archivePath);
    return { archivePath, entryPoint: `${basename(entry, extname(entry))}.handler` };
  } catch (err: unknown) {
    if (err instanceof Error && (err as BuilderError).name === 'BuilderError') {
      throw err;
    }
    const detail = err instanceof Error && err.message ? err.message : String(err);
    throw builderError(BLC_ARCHIVE_FAILED, `archive failed: ${detail} (${BLC_ARCHIVE_FAILED})`);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}
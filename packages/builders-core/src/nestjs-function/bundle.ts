/**
 * Function bundling (US1, D-RE-8): esbuild bundles the entry + local imports
 * into one self-contained CJS file, declared `external` packages are copied
 * from `node_modules` as-is (native addons), and the staging directory is
 * zipped deterministically into `outputDir/<out_filename>`.
 */

import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { basename, extname, join } from 'node:path';

import { build } from 'esbuild';

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

function copyDir(src: string, dest: string): void {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const from = join(src, entry.name);
    const to = join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(from, to);
    } else if (entry.isFile() || entry.isSymbolicLink()) {
      copyFileSync(from, to);
    }
  }
}

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

    for (const pkg of external) {
      const pkgDir = join(sourcePath, 'node_modules', pkg);
      if (existsSync(pkgDir)) {
        copyDir(pkgDir, join(staging, 'node_modules', pkg));
      }
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
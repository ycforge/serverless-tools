// spec 021 ycsf-cli — ycsf build command action (US1, FR-007..010, D-RE-1) + spec 022 cache.
import type { Command } from 'commander';
import { buildApps } from '../build/index.js';
import { CLI_BUILD_FAILED, CLI_APP_NOT_FOUND, CLI_MISSING_PROJECT_DIR } from './errors.js';
import type { CLIResult, CLIDiagnostic } from './result.js';
import { formatCacheLine } from './cache-helpers.js';
import type { CacheCheckResult } from '../contracts/cache.js';

export async function buildAction(cmd: Command): Promise<void> {
  const opts = cmd.optsWithGlobals();
  const rootDir = String(opts.projectDir ?? process.cwd());
  const json = Boolean(opts.json);
  const target = opts.target as string | undefined;
  const noCache = Boolean(opts.noCache || opts.force || opts.cache === false);
  const cacheDir = opts.cacheDir as string | undefined;

  const diagnostics: CLIDiagnostic[] = [];
  let exitCode: 0 | 1 | 2 = 0;

  try {
    const cacheEntries: CacheCheckResult[] = [];
    const buildOpts: { target?: string; onAppProgress?: (appId: string) => void; noCache?: boolean; cacheDir?: string; onCacheProgress?: (r: CacheCheckResult) => void } = {};
    if (target !== undefined) buildOpts.target = target;
    if (noCache) buildOpts.noCache = true;
    if (cacheDir !== undefined && !noCache) buildOpts.cacheDir = cacheDir;
    if (!json) {
      buildOpts.onAppProgress = (appId: string) => {
        process.stderr.write(`Building app ${appId}...\n`);
      };
      buildOpts.onCacheProgress = (r: CacheCheckResult) => {
        cacheEntries.push(r);
        process.stderr.write(formatCacheLine(r) + '\n');
      };
    } else {
      buildOpts.onCacheProgress = (r: CacheCheckResult) => {
        cacheEntries.push(r);
      };
    }
    const result = await buildApps(rootDir, buildOpts);

    if (result.kind === 'ok') {
      const artifactCount = result.artifacts.length;
      const appCount = artifactCount;
      const cache = (result as unknown as { cache?: { hits: number; misses: number; entries: CacheCheckResult[] } }).cache;
      // fallback to collected entries if build didn't return cache (should not)
      const summaryCache = cache ?? {
        hits: cacheEntries.filter((e) => e.hit).length,
        misses: cacheEntries.filter((e) => !e.hit).length,
        entries: cacheEntries,
      };

      if (!json) {
        process.stderr.write(`✓ Build complete. ${artifactCount} app(s) built.\n`);
      }

      const cliResult: CLIResult = {
        command: 'build',
        exitCode: 0,
        diagnostics: [],
        summary: { apps: appCount, artifacts: artifactCount, cache: summaryCache },
      };
      if (json) {
        process.stdout.write(JSON.stringify(cliResult, null, 2) + '\n');
      }
      process.exitCode = 0;
      return;
    }

    // kind === 'invalid'
    for (const err of result.errors) {
      const rec = err as unknown as Record<string, unknown>;
      const code = (rec.code as string) ?? CLI_BUILD_FAILED;
      if (code === CLI_APP_NOT_FOUND || code === CLI_MISSING_PROJECT_DIR) {
        exitCode = 2;
      } else {
        exitCode = 1;
      }
      diagnostics.push({
        code,
        message: (rec.message as string) ?? 'build failed',
      });
    }

    if (!json) {
      for (const d of diagnostics) {
        process.stderr.write(`✗ ${d.code}: ${d.message}\n`);
      }
    }

    const cliResult: CLIResult = {
      command: 'build',
      exitCode,
      diagnostics,
      summary: { apps: 0, artifacts: 0, cache: { hits: 0, misses: 0, entries: [] } },
    };
    if (json) {
      process.stdout.write(JSON.stringify(cliResult, null, 2) + '\n');
    }
    process.exitCode = exitCode;
  } catch (err) {
    exitCode = 1;
    const message = err instanceof Error ? err.message : String(err);
    diagnostics.push({ code: CLI_BUILD_FAILED, message });

    if (!json) {
      process.stderr.write(`✗ CLI_BUILD_FAILED: ${message}\n`);
    }

    const cliResult: CLIResult = {
      command: 'build',
      exitCode,
      diagnostics,
      summary: { apps: 0, artifacts: 0, cache: { hits: 0, misses: 0, entries: [] } },
    };
    if (json) {
      process.stdout.write(JSON.stringify(cliResult, null, 2) + '\n');
    }
    process.exitCode = exitCode;
  }
}

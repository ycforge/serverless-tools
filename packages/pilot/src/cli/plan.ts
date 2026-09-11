// spec 021 ycsf-cli — ycsf plan command action (US4, FR-018..022) + spec 022 cache.
import type { Command } from 'commander';
import { runBuildAndMaterialize, runTerraformInit, runTerraformPlan } from './pipeline.js';
import { CLIError, CLI_UNEXPECTED_ERROR } from './errors.js';
import type { CLIResult, CLIDiagnostic } from './result.js';
import { formatCacheLine } from './cache-helpers.js';
import type { CacheCheckResult } from '../contracts/cache.js';

export async function planAction(cmd: Command): Promise<void> {
  const opts = cmd.optsWithGlobals();
  const rootDir = String(opts.projectDir ?? process.cwd());
  const json = Boolean(opts.json);
  const noCache = Boolean(opts.noCache || opts.force || opts.cache === false);
  const cacheDir = opts.cacheDir as string | undefined;

  const diagnostics: CLIDiagnostic[] = [];
  let exitCode: 0 | 1 | 2 = 0;

  // Cache entries collected during build phase for observability (T150: preserve in catch).
  const cacheEntries: CacheCheckResult[] = [];

  try {
    const onCacheProgress = (r: CacheCheckResult) => {
      cacheEntries.push(r);
      if (!json) process.stderr.write(formatCacheLine(r) + '\n');
    };
    const bmOpts: { json?: boolean; noCache?: boolean; cacheDir?: string; onCacheProgress?: (r: CacheCheckResult) => void } = { json };
    if (noCache) bmOpts.noCache = true;
    if (cacheDir !== undefined && !noCache) bmOpts.cacheDir = cacheDir;
    bmOpts.onCacheProgress = onCacheProgress;
    const bm = (await runBuildAndMaterialize(rootDir, bmOpts)) as { cache?: import('../contracts/cache.js').CacheSummary } | undefined;
    await runTerraformInit(rootDir, json);
    const tfPlanOutput = await runTerraformPlan(rootDir, json);

    const cache = (bm?.cache) ?? { hits: cacheEntries.filter((e) => e.hit).length, misses: cacheEntries.filter((e) => !e.hit).length, entries: cacheEntries };

    const result: CLIResult = {
      command: 'plan',
      exitCode: 0,
      diagnostics: [],
      summary: { tfPlanOutput, cache },
    };
    if (json) process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    else {
      process.stderr.write('✓ Terraform plan complete.\n');
    }
    process.exitCode = 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const code = err instanceof CLIError ? err.code : CLI_UNEXPECTED_ERROR;
    diagnostics.push({ code, message });
    exitCode = err instanceof CLIError ? err.exitCode : 1;

    // Preserve cache stats from build phase for FR-023 (T150).
    const cache = { hits: cacheEntries.filter((e) => e.hit).length, misses: cacheEntries.filter((e) => !e.hit).length, entries: cacheEntries };

    if (json) {
      const result: CLIResult = {
        command: 'plan',
        exitCode,
        diagnostics,
        summary: { tfPlanOutput: '', cache },
      };
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    } else {
      process.stderr.write(`✗ ${code}: ${message}\n`);
    }
    process.exitCode = exitCode;
  }
}

export const planCommand = 'plan';

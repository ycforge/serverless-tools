// spec 021 ycsf-cli — ycsf check command action (US3, FR-014..017).
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Command } from 'commander';
import { check } from '../check/index.js';
import { CLI_UNEXPECTED_ERROR, CLI_MISSING_PROJECT_DIR } from './errors.js';
import type { CLIResult, CLIDiagnostic } from './result.js';
import type { Diagnostic } from '../contracts/index.js';

function diagToCLI(d: Diagnostic): CLIDiagnostic {
  const extra: Record<string, unknown> = { ...d };
  delete extra.code;
  delete extra.message;
  const hasDetails = Object.keys(extra).length > 0;
  return hasDetails
    ? { code: d.code, message: d.message, details: extra as Record<string, unknown> }
    : { code: d.code, message: d.message };
}

export async function checkAction(cmd: Command): Promise<void> {
  const opts = cmd.optsWithGlobals();
  const rootDir = String(opts.projectDir ?? process.cwd());
  const json = Boolean(opts.json);
  const validateTf = Boolean(opts.validateTf);

  const diagnostics: CLIDiagnostic[] = [];
  let exitCode: 0 | 1 | 2 = 0;

  try {
    // Missing .ycsf/apps.yaml → input error (exit 2). The check() library
    // (spec 020) swallows the loader throw and returns empty diagnostics, so
    // the CLI guards the project-root precondition itself. T148.
    if (!existsSync(join(rootDir, '.ycsf', 'apps.yaml'))) {
      const message = `missing .ycsf/apps.yaml — '${rootDir}' is not a serverless-tools project root`;
      diagnostics.push({ code: CLI_MISSING_PROJECT_DIR, message });
      exitCode = 2;
      if (json) {
        const cliResult: CLIResult = {
          command: 'check',
          exitCode,
          diagnostics,
          summary: { total: diagnostics.length },
        };
        process.stdout.write(JSON.stringify(cliResult, null, 2) + '\n');
      } else {
        process.stderr.write(`✗ ${CLI_MISSING_PROJECT_DIR}: ${message}\n`);
      }
      process.exitCode = exitCode;
      return;
    }

    const result = await check(rootDir, { validateTf });
    diagnostics.push(...result.diagnostics.map(diagToCLI));
    exitCode = result.diagnostics.length > 0 ? 1 : 0;

    if (json) {
      const cliResult: CLIResult = {
        command: 'check',
        exitCode,
        diagnostics,
        summary: { total: diagnostics.length },
      };
      process.stdout.write(JSON.stringify(cliResult, null, 2) + '\n');
    } else if (result.diagnostics.length === 0) {
      process.stdout.write('All checks passed.\n');
    } else {
      for (const d of result.diagnostics) {
        const extra = { ...d };
        delete (extra as { code?: string }).code;
        delete (extra as { message?: string }).message;
        const detailStr = Object.values(extra).filter((v) => v !== undefined).length > 0
          ? ' ' + Object.values(extra).filter((v) => v !== undefined).map(String).join(', ')
          : '';
        process.stderr.write(`✗ ${d.code}: ${d.message}${detailStr}\n`);
      }
    }
    process.exitCode = exitCode;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    diagnostics.push({ code: CLI_UNEXPECTED_ERROR, message });
    exitCode = 1;
    if (json) {
      const cliResult: CLIResult = {
        command: 'check',
        exitCode,
        diagnostics,
        summary: { total: diagnostics.length },
      };
      process.stdout.write(JSON.stringify(cliResult, null, 2) + '\n');
    } else {
      process.stderr.write(`✗ CLI_UNEXPECTED_ERROR: ${message}\n`);
    }
    process.exitCode = exitCode;
  }
}

export const checkCommand = 'check';
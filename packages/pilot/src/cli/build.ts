// spec 021 ycsf-cli — ycsf build command action (US1, FR-007..010, D-RE-1).
import type { Command } from 'commander';
import { buildApps } from '../build/index.js';
import { CLI_BUILD_FAILED, CLI_APP_NOT_FOUND, CLI_MISSING_PROJECT_DIR } from './errors.js';
import type { CLIResult, CLIDiagnostic } from './result.js';

export async function buildAction(cmd: Command): Promise<void> {
  const opts = cmd.optsWithGlobals();
  const rootDir = String(opts.projectDir ?? process.cwd());
  const json = Boolean(opts.json);
  const target = opts.target as string | undefined;

  const diagnostics: CLIDiagnostic[] = [];
  let exitCode: 0 | 1 | 2 = 0;

  try {
    const buildOpts: { target?: string; onAppProgress?: (appId: string) => void } = {};
    if (target !== undefined) buildOpts.target = target;
    if (!json) {
      buildOpts.onAppProgress = (appId: string) => {
        process.stderr.write(`Building app ${appId}...\n`);
      };
    }
    const result = await buildApps(rootDir, buildOpts);

    if (result.kind === 'ok') {
      const artifactCount = result.artifacts.length;
      const appCount = result.projectModel.apps.size;

      if (!json) {
        process.stderr.write(`✓ Build complete. ${artifactCount} app(s) built.\n`);
      }

      const cliResult: CLIResult = {
        command: 'build',
        exitCode: 0,
        diagnostics: [],
        summary: { apps: appCount, artifacts: artifactCount },
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
      summary: { apps: 0, artifacts: 0 },
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
      summary: { apps: 0, artifacts: 0 },
    };
    if (json) {
      process.stdout.write(JSON.stringify(cliResult, null, 2) + '\n');
    }
    process.exitCode = exitCode;
  }
}

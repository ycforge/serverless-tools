// spec 021 ycsf-cli — ycsf destroy command action (US6, FR-026..029).
import { existsSync } from 'node:fs';
import { readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { Command } from 'commander';
import { confirmDestroy } from './prompt.js';
import { runTerraformInit, runTerraformDestroy } from './pipeline.js';
import {
  CLIError,
  CLI_UNEXPECTED_ERROR,
  InputError,
  CLI_MISSING_PROJECT_DIR,
} from './errors.js';
import type { CLIResult, CLIDiagnostic } from './result.js';

async function cleanGeneratedFiles(rootDir: string): Promise<number> {
  // Generated Terraform files live in <root>/infra/ (materialize target),
  // NOT .ycsf/ — per-app `*.ycsf.tf.json` plus the merged `99-ycsf-outputs.tf.json`
  // (T147/T152). Build artifacts under .ycsf/artifacts are left intact.
  const infraDir = join(rootDir, 'infra');
  let removed = 0;
  let entries: string[] = [];
  try {
    entries = await readdir(infraDir);
  } catch {
    return 0;
  }
  for (const name of entries) {
    if (name.endsWith('.ycsf.tf.json') || name === '99-ycsf-outputs.tf.json') {
      try {
        await unlink(join(infraDir, name));
        removed += 1;
      } catch {
        // File already gone — treat as removed.
        removed += 1;
      }
    }
  }
  return removed;
}

export async function destroyAction(cmd: Command): Promise<void> {
  const opts = cmd.optsWithGlobals();
  const rootDir = String(opts.projectDir ?? process.cwd());
  const json = Boolean(opts.json);
  const yes = Boolean(opts.yes);
  const cleanup = Boolean(opts.cleanup);

  const diagnostics: CLIDiagnostic[] = [];
  let exitCode: 0 | 1 | 2 = 0;

  try {
    // FR-004/data-model §7: --project-dir must resolve to an existing
    // directory → InputError (exit 2) BEFORE any terraform dispatch. Without
    // this guard a missing dir would surface as an ENOENT from the missing
    // infra/ cwd and be misreported as CLI_TERRAFORM_NOT_FOUND (T162).
    if (!existsSync(rootDir)) {
      throw new InputError(
        `project directory does not exist — '${rootDir}' is not a serverless-tools project root`,
        CLI_MISSING_PROJECT_DIR,
      );
    }

    if (!yes) {
      const confirmed = await confirmDestroy();
      if (!confirmed) {
        const result: CLIResult = {
          command: 'destroy',
          exitCode: 0,
          diagnostics: [],
          summary: { tfDestroyOutput: '', cleanedUp: false },
        };
        if (json) process.stdout.write(JSON.stringify(result, null, 2) + '\n');
        else process.stderr.write('✓ Destroy cancelled by user.\n');
        process.exitCode = 0;
        return;
      }
    }

    await runTerraformInit(rootDir, json);
    const tfDestroyOutput = await runTerraformDestroy(rootDir, yes, json);

    let cleanedUp = false;
    if (cleanup) {
      const removed = await cleanGeneratedFiles(rootDir);
      cleanedUp = removed > 0; // T155: true only when files were actually removed
    }

    const result: CLIResult = {
      command: 'destroy',
      exitCode: 0,
      diagnostics: [],
      summary: { tfDestroyOutput, cleanedUp },
    };
    if (json) process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    else {
      // Terraform pass-through already streams child output to stderr (D-RE-2);
      // do not echo tfDestroyOutput again (T154).
      process.stderr.write(`✓ Terraform destroy complete.${cleanup ? ' Generated files cleaned.' : ''}\n`);
    }
    process.exitCode = 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const code = err instanceof CLIError ? err.code : CLI_UNEXPECTED_ERROR;
    diagnostics.push({ code, message });
    exitCode = err instanceof CLIError ? err.exitCode : 1;

    if (json) {
      const result: CLIResult = {
        command: 'destroy',
        exitCode,
        diagnostics,
        summary: { tfDestroyOutput: '', cleanedUp: false },
      };
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    } else {
      process.stderr.write(`✗ ${code}: ${message}\n`);
    }
    process.exitCode = exitCode;
  }
}

export const destroyCommand = 'destroy';
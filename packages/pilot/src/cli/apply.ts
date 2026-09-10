// spec 021 ycsf-cli — ycsf apply command action (US5, FR-023..025).
import type { Command } from 'commander';
import {
  runBuildAndMaterialize,
  runTerraformInit,
  runTerraformPlan,
  runTerraformApply,
} from './pipeline.js';
import { CLIError, CLI_UNEXPECTED_ERROR } from './errors.js';
import type { CLIResult, CLIDiagnostic } from './result.js';

export async function applyAction(cmd: Command): Promise<void> {
  const opts = cmd.optsWithGlobals();
  const rootDir = String(opts.projectDir ?? process.cwd());
  const json = Boolean(opts.json);

  const diagnostics: CLIDiagnostic[] = [];

  try {
    await runBuildAndMaterialize(rootDir, { json });
    await runTerraformInit(rootDir, json);
    await runTerraformPlan(rootDir, json);
    const tfApplyOutput = await runTerraformApply(rootDir, json);

    const result: CLIResult = {
      command: 'apply',
      exitCode: 0,
      diagnostics: [],
      summary: { tfApplyOutput },
    };
    if (json) process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    else {
      if (tfApplyOutput) process.stderr.write(tfApplyOutput);
      process.stderr.write('✓ Terraform apply complete.\n');
    }
    process.exitCode = 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const code = err instanceof CLIError ? err.code : CLI_UNEXPECTED_ERROR;
    diagnostics.push({ code, message });

    if (json) {
      const result: CLIResult = {
        command: 'apply',
        exitCode: 1,
        diagnostics,
        summary: { tfApplyOutput: '' },
      };
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    } else {
      process.stderr.write(`✗ ${code}: ${message}\n`);
    }
    process.exitCode = 1;
  }
}

export const applyCommand = 'apply';
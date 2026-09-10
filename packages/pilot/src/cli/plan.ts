// spec 021 ycsf-cli — ycsf plan command action (US4, FR-018..022).
import type { Command } from 'commander';
import { runBuildAndMaterialize, runTerraformInit, runTerraformPlan } from './pipeline.js';
import { CLIError, CLI_UNEXPECTED_ERROR } from './errors.js';
import type { CLIResult, CLIDiagnostic } from './result.js';

export async function planAction(cmd: Command): Promise<void> {
  const opts = cmd.optsWithGlobals();
  const rootDir = String(opts.projectDir ?? process.cwd());
  const json = Boolean(opts.json);

  const diagnostics: CLIDiagnostic[] = [];
  let exitCode: 0 | 1 | 2 = 0;

  try {
    await runBuildAndMaterialize(rootDir, { json });
    await runTerraformInit(rootDir, json);
    const tfPlanOutput = await runTerraformPlan(rootDir, json);

    const result: CLIResult = {
      command: 'plan',
      exitCode: 0,
      diagnostics: [],
      summary: { tfPlanOutput },
    };
    if (json) process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    else {
      // Terraform pass-through already streams child output to stderr (D-RE-2);
      // do not echo tfPlanOutput again (T154).
      process.stderr.write('✓ Terraform plan complete.\n');
    }
    process.exitCode = 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const code = err instanceof CLIError ? err.code : CLI_UNEXPECTED_ERROR;
    diagnostics.push({ code, message });
    exitCode = err instanceof CLIError ? err.exitCode : 1;

    if (json) {
      const result: CLIResult = {
        command: 'plan',
        exitCode,
        diagnostics,
        summary: { tfPlanOutput: '' },
      };
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    } else {
      process.stderr.write(`✗ ${code}: ${message}\n`);
    }
    process.exitCode = exitCode;
  }
}

export const planCommand = 'plan';
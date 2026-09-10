// spec 021 ycsf-cli — ycsf materialize command action (US2, FR-011..013).
import type { Command } from 'commander';
import { loadProjectModel } from '../model/loader.js';
import { loadRegistry } from '../registry/index.js';
import { runMaterializeGeneration } from './pipeline.js';
import { CLIError, CLI_BUILD_FAILED, CLI_MISSING_PROJECT_DIR, CLI_APP_NOT_FOUND } from './errors.js';
import type { CLIResult, CLIDiagnostic } from './result.js';

export async function materializeAction(cmd: Command): Promise<void> {
  const opts = cmd.optsWithGlobals();
  const rootDir = String(opts.projectDir ?? process.cwd());
  const json = Boolean(opts.json);
  const target = opts.target as string | undefined;

  const diagnostics: CLIDiagnostic[] = [];
  let exitCode: 0 | 1 | 2 = 0;

  try {
    let model;
    try {
      const modelResult = loadProjectModel(rootDir);
      if (modelResult.kind === 'invalid') {
        diagnostics.push(
          ...modelResult.errors.flatMap((e) =>
            e.diagnostics.map((d) => ({
              code: d.code,
              message: d.message,
              ...(d.file !== undefined ? { details: { file: d.file } } : {}),
            })),
          ),
        );
        exitCode = 1;
      } else {
        model = modelResult.model;
      }
    } catch {
      diagnostics.push({
        code: CLI_MISSING_PROJECT_DIR,
        message: `missing .ycsf/apps.yaml — '${rootDir}' is not a serverless-tools project root`,
      });
      exitCode = 2;
    }

    if (!model) {
      const result: CLIResult = {
        command: 'materialize',
        exitCode,
        diagnostics,
        summary: { files: 0, extensions: 0 },
      };
      if (json) process.stdout.write(JSON.stringify(result, null, 2) + '\n');
      else for (const d of diagnostics) process.stderr.write(`✗ ${d.code}: ${d.message}\n`);
      process.exitCode = exitCode;
      return;
    }

    // Filter apps by target before materialization so an unknown app fails
    // fast (exit code 2) regardless of registry state.
    if (target) {
      if (!model.apps.has(target)) {
        const available = [...model.apps.keys()].join(', ');
        const result: CLIResult = {
          command: 'materialize',
          exitCode: 2,
          diagnostics: [
            {
              code: CLI_APP_NOT_FOUND,
              message: `app '${target}' not found in apps.yaml; available: ${available}`,
            },
          ],
          summary: { files: 0, extensions: 0 },
        };
        if (json) process.stdout.write(JSON.stringify(result, null, 2) + '\n');
        else process.stderr.write(`✗ ${CLI_APP_NOT_FOUND}: ${result.diagnostics[0]?.message}\n`);
        process.exitCode = 2;
        return;
      }
    }

    let registry;
    try {
      const registryResult = await loadRegistry(rootDir);
      if (registryResult.kind === 'invalid') {
        diagnostics.push(...registryResult.errors.map((e) => ({ code: e.code, message: e.message })));
        exitCode = exitCode === 0 ? 1 : exitCode;
      } else {
        registry = registryResult.registry;
      }
    } catch {
      diagnostics.push({ code: CLI_BUILD_FAILED, message: 'builders registry could not be loaded' });
      exitCode = exitCode === 0 ? 1 : exitCode;
    }

    if (!registry) {
      const result: CLIResult = {
        command: 'materialize',
        exitCode,
        diagnostics,
        summary: { files: 0, extensions: 0 },
      };
      if (json) process.stdout.write(JSON.stringify(result, null, 2) + '\n');
      else for (const d of diagnostics) process.stderr.write(`✗ ${d.code}: ${d.message}\n`);
      process.exitCode = exitCode;
      return;
    }

    // Materialize generation — dispatch + extensions + moves + outputs + write
    // (pipeline order, spec line 50; FR-011/FR-012, shared with plan/apply).
    const genOpts: { json?: boolean; target?: string } = { json };
    if (target !== undefined) genOpts.target = target;
    const { files, extensionsApplied } = await runMaterializeGeneration(rootDir, model, registry, genOpts);

    const infraDir = `${rootDir}/infra`;
    for (const file of files) {
      if (!json) process.stderr.write(`✓ Generated: ${infraDir}/${file.filename}\n`);
    }

    const result: CLIResult = {
      command: 'materialize',
      exitCode,
      diagnostics,
      summary: { files: files.length, extensions: extensionsApplied },
    };
    if (json) process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    else for (const d of diagnostics) process.stderr.write(`✗ ${d.code}: ${d.message}\n`);
    process.exitCode = exitCode;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const code = err instanceof CLIError ? err.code : CLI_BUILD_FAILED;
    diagnostics.push({ code, message });
    exitCode = err instanceof CLIError ? err.exitCode : 1;
    const result: CLIResult = {
      command: 'materialize',
      exitCode,
      diagnostics,
      summary: { files: 0, extensions: 0 },
    };
    if (json) process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    else process.stderr.write(`✗ ${code}: ${message}\n`);
    process.exitCode = exitCode;
  }
}

export const materializeCommand = 'materialize';
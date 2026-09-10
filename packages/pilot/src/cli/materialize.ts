// spec 021 ycsf-cli — ycsf materialize command action (US2, FR-011..013).
import type { Command } from 'commander';
import { loadProjectModel } from '../model/loader.js';
import { loadRegistry } from '../registry/index.js';
import { dispatch } from '../materialize/dispatch.js';
import { loadExtensions, applyExtensions } from '../extensions/index.js';
import { writeGeneratedTerraform } from '../materialize/write.js';
import {
  CLI_MISSING_PROJECT_DIR,
  CLI_BUILD_FAILED,
  CLI_APP_NOT_FOUND,
} from './errors.js';
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

    // Filter apps by target before loading the registry so an unknown app
    // fails fast (exit code 2) regardless of builders.yaml state.
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

    const dispatchResult = await dispatch(model, registry);
    if (dispatchResult.kind === 'invalid') {
      diagnostics.push(...dispatchResult.errors.map((e) => ({ code: e.code, message: e.message })));
      exitCode = exitCode === 0 ? 1 : exitCode;
    } else {
      const resources = dispatchResult.resources;
      const generatedFiles = dispatchResult.generatedFiles.filter((f) => {
        if (!target) return true;
        const appId = target;
        return f.filename === `${appId}.ycsf.tf.json`;
      });

      let extensionsApplied = 0;
      try {
        const extensions = loadExtensions(rootDir);
        if (extensions.kind === 'ok') {
          const applied = applyExtensions(resources, extensions.data);
          if (applied.kind === 'invalid') {
            diagnostics.push(...applied.errors.map((e) => ({ code: e.code, message: e.message })));
            exitCode = exitCode === 0 ? 1 : exitCode;
          } else {
            extensionsApplied = extensions.data.extensions.length;
          }
        }
      } catch {
        // extensions.yaml missing — skip extension step.
      }

      const infraDir = `${rootDir}/infra`;
      await writeGeneratedTerraform(infraDir, generatedFiles);

      const filePaths = generatedFiles.map((f) => `${infraDir}/${f.filename}`);
      for (const path of filePaths) {
        if (!json) process.stderr.write(`✓ Generated: ${path}\n`);
      }

      const result: CLIResult = {
        command: 'materialize',
        exitCode,
        diagnostics,
        summary: { files: generatedFiles.length, extensions: extensionsApplied },
      };
      if (json) process.stdout.write(JSON.stringify(result, null, 2) + '\n');
      else for (const d of diagnostics) process.stderr.write(`✗ ${d.code}: ${d.message}\n`);
      process.exitCode = exitCode;
      return;
    }

    const result: CLIResult = {
      command: 'materialize',
      exitCode,
      diagnostics,
      summary: { files: 0, extensions: 0 },
    };
    if (json) process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    else for (const d of diagnostics) process.stderr.write(`✗ ${d.code}: ${d.message}\n`);
    process.exitCode = exitCode;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    diagnostics.push({ code: CLI_BUILD_FAILED, message });
    exitCode = 1;
    const result: CLIResult = {
      command: 'materialize',
      exitCode,
      diagnostics,
      summary: { files: 0, extensions: 0 },
    };
    if (json) process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    else process.stderr.write(`✗ CLI_BUILD_FAILED: ${message}\n`);
    process.exitCode = exitCode;
  }
}

export const materializeCommand = 'materialize';
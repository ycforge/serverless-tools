// spec 021 ycsf-cli — shared pipeline functions (D-RE-6).
import { buildApps } from '../build/index.js';
import { loadExtensions, applyExtensions } from '../extensions/index.js';
import { loadMoves, buildMoves, buildMovedFile } from '../moves/index.js';
import { loadOutputs, buildOutputs } from '../outputs/index.js';
import { dispatch } from '../materialize/dispatch.js';
import { writeGeneratedTerraform } from '../materialize/write.js';
import { moveEndpointsFromResources } from './resource-endpoints.js';
import type { GeneratedTfFile, PluginRegistry, ProjectModel } from '../contracts/index.js';
import { spawnTerraform } from './terraform.js';
import {
  RuntimeError,
  InputError,
  CLI_BUILD_FAILED,
  CLI_MISSING_PROJECT_DIR,
  CLI_APP_NOT_FOUND,
} from './errors.js';

function stderr(msg: string, json?: boolean): void {
  if (!json) process.stderr.write(`${msg}\n`);
}

/** Result of materialize generation (files + how many extensions applied). */
export interface MaterializeGenerationResult {
  readonly files: readonly GeneratedTfFile[];
  readonly extensionsApplied: number;
}

/**
 * Materialize generation: dispatch → extensions → moves → outputs → write
 * (spec pipeline order). Shared by both `runBuildAndMaterialize` (plan/apply)
 * and standalone `ycsf materialize` (T147) so generated files are equivalent.
 * Fail-fast: any step error aborts before the next step runs.
 */
export async function runMaterializeGeneration(
  rootDir: string,
  projectModel: ProjectModel,
  registry: PluginRegistry,
  opts?: { target?: string; json?: boolean },
): Promise<MaterializeGenerationResult> {
  const json = opts?.json;
  const target = opts?.target;

  stderr('Materializing artifacts...', json);
  const dispatchResult = await dispatch(projectModel, registry);
  if (dispatchResult.kind === 'invalid') {
    const first = dispatchResult.errors[0];
    throw new RuntimeError(
      first?.message ?? 'materialize failed',
      String(first?.code ?? 'MTL_ERROR'),
    );
  }
  const resources = dispatchResult.resources;

  // Extensions (validation + deep-merge; fail-fast on error).
  stderr('Applying extensions...', json);
  let extensionsApplied = 0;
  try {
    const extensions = loadExtensions(rootDir);
    if (extensions.kind === 'ok') {
      const applied = applyExtensions(resources, extensions.data);
      if (applied.kind === 'invalid') {
        const first = applied.errors[0];
        throw new RuntimeError(
          first?.message ?? 'extensions failed',
          String(first?.code ?? 'EXT_ERROR'),
        );
      }
      extensionsApplied = extensions.data.extensions.length;
    }
  } catch (err) {
    // extensions.yaml missing (EXT_MISSING_FILE, plain Error) — optional step, skip.
    // Real apply failures are RuntimeError → fail-fast.
    if (err instanceof RuntimeError) throw err;
  }

  // Moves (optional .ycsf/moved.yaml).
  const currentResources = moveEndpointsFromResources(resources);
  let movedFiles: GeneratedTfFile[] = [];
  const movesResult = loadMoves(rootDir);
  if (movesResult.kind === 'ok') {
    const moved = buildMoves(currentResources, movesResult.data);
    if (moved.kind === 'ok') {
      const file = buildMovedFile(moved.moved);
      if (file) movedFiles = [file];
    } else {
      const first = moved.errors[0];
      throw new RuntimeError(
        first?.message ?? 'moves failed',
        String(first?.code ?? 'MOV_ERROR'),
      );
    }
  }

  // Outputs (optional .ycsf/outputs.yaml).
  let outputFiles: GeneratedTfFile[] = [];
  try {
    const outputsResult = loadOutputs(rootDir);
    if (outputsResult.kind === 'ok') {
      const outputs = buildOutputs({
        outputsYaml: outputsResult.data,
        materializerOutputs: new Map(),
        resources,
      });
      if (outputs.kind === 'ok') {
        outputFiles = [outputs.file];
      } else {
        const first = outputs.errors[0];
        throw new RuntimeError(first?.message ?? 'outputs failed', String(first?.code ?? 'OUT_ERROR'));
      }
    }
  } catch (err) {
    // outputs.yaml missing (OUT_MISSING_FILE, plain Error) — optional step, skip.
    // Real outputs failures are RuntimeError → fail-fast.
    if (err instanceof RuntimeError) throw err;
  }

  const allFiles = [...dispatchResult.generatedFiles, ...movedFiles, ...outputFiles];
  // --target filters per-app files by filename (FR-012); moves/outputs are
  // project-level and dropped under a target (T141 AC3, T147).
  const files =
    target !== undefined
      ? allFiles.filter((f) => f.filename === `${target}.ycsf.tf.json`)
      : allFiles;
  const infraDir = `${rootDir}/infra`;
  await writeGeneratedTerraform(infraDir, files);

  return { files, extensionsApplied };
}

/**
 * Build → materialize (dispatch + extensions + moves + outputs + writes).
 * Fail-fast: any step error aborts before the next step runs.
 */
export async function runBuildAndMaterialize(
  rootDir: string,
  opts?: { target?: string; json?: boolean; noCache?: boolean; cacheDir?: string; onCacheProgress?: (r: import('../contracts/cache.js').CacheCheckResult) => void },
): Promise<{ cache?: import('../contracts/cache.js').CacheSummary } | void> {
  const json = opts?.json;

  stderr('Building apps...', json);
  const buildOpts: import('../contracts/build.js').BuildAppsOptions = {
    ...(opts?.target !== undefined ? { target: opts.target } : {}),
    ...(opts?.noCache !== undefined ? { noCache: opts.noCache } : {}),
    ...(opts?.cacheDir !== undefined ? { cacheDir: opts.cacheDir } : {}),
    ...(opts?.onCacheProgress !== undefined ? { onCacheProgress: opts.onCacheProgress } : {}),
  };
  const buildResult = await buildApps(rootDir, buildOpts);
  if (buildResult.kind === 'invalid') {
    const first = buildResult.errors[0];
    const code = String(first?.code ?? CLI_BUILD_FAILED);
    // Input/config errors (D-3, spec edge case: no .ycsf/apps.yaml, unknown
    // --target) must surface as exit code 2, not 1. T149.
    if (code === CLI_MISSING_PROJECT_DIR || code === CLI_APP_NOT_FOUND) {
      throw new InputError(first?.message ?? 'build input error', code);
    }
    throw new RuntimeError(first?.message ?? 'build failed', code);
  }
  const { projectModel, registry } = buildResult;

  const genOpts: { json?: boolean; target?: string } = {};
  if (json !== undefined) genOpts.json = json;
  if (opts?.target !== undefined) genOpts.target = opts.target;
  const { files } = await runMaterializeGeneration(rootDir, projectModel, registry, genOpts);

  stderr(`Build + materialize complete. ${buildResult.artifacts.length} app(s) built, ${files.length} file(s) written.`, json);
  const c = (buildResult as unknown as { cache?: import('../contracts/cache.js').CacheSummary }).cache;
  return c !== undefined ? { cache: c } : {};
}

export async function runTerraformInit(rootDir: string, json?: boolean): Promise<void> {
  stderr('Running terraform init...', json);
  await spawnTerraform('init', rootDir);
}

export async function runTerraformPlan(rootDir: string, json?: boolean): Promise<string> {
  stderr('Running terraform plan...', json);
  const result = await spawnTerraform('plan', rootDir);
  return result.stdout;
}

export async function runTerraformApply(rootDir: string, json?: boolean): Promise<string> {
  stderr('Running terraform apply...', json);
  const result = await spawnTerraform('apply', rootDir);
  return result.stdout;
}

export async function runTerraformDestroy(
  rootDir: string,
  autoApprove: boolean,
  json?: boolean,
): Promise<string> {
  stderr('Running terraform destroy...', json);
  const result = await spawnTerraform('destroy', rootDir, { autoApprove });
  return result.stdout;
}
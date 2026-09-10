// spec 020 ycsf-check — orchestration: load + all categories + aggregate.
import type { Diagnostic, TerraformResource } from '../contracts/index.js';
import type { ExtensionsDiagnostic } from '../contracts/index.js';
import type { CheckOptions, CheckResult } from '../contracts/check.js';
import { loadProjectModel } from '../model/loader.js';
import { checkEnvRequirements } from '../model/env-requirements.js';
import { loadExtensions, applyExtensions } from '../extensions/index.js';
import { loadRegistry, validateBuilders } from '../registry/index.js';
import { loadOutputs, buildOutputs } from '../outputs/index.js';
import { loadMoves, validateMoves } from '../moves/index.js';
import { loadGeneratedModel } from './generated-loader.js';
import { checkOverrideTargets } from './categories/override-targets.js';
import { scanPatchForEnvRefs } from './categories/env-in-patch.js';
import { checkResourceConsistency } from './categories/resource-consistency.js';
import { runTerraformValidate } from './categories/terraform-validate.js';

export async function check(rootDir: string, options?: CheckOptions): Promise<CheckResult> {
  const diagnostics: Diagnostic[] = [];

  // 1. Load project model (C12)
  let modelResult: ReturnType<typeof loadProjectModel>;
  try {
    modelResult = loadProjectModel(rootDir);
  } catch {
    return { diagnostics: [] };
  }
  if (modelResult.kind === 'invalid') {
    for (const err of modelResult.errors) {
      diagnostics.push(...err.diagnostics);
    }
    return { diagnostics };
  }
  const model = modelResult.model;

  // 2. Load generated model
  const generatedResources = loadGeneratedModel(rootDir, options?.generatedDir);

  // 3. C2–C3: build ENV validation
  for (const [appId, buildConfig] of model.build_configs) {
    const file = `${appId}/build_config.yaml`;
    const { errors } = checkEnvRequirements(appId, buildConfig, file);
    diagnostics.push(...errors);
  }

  // 4. C11: builder registry validation
  try {
    const registryResult = await loadRegistry(rootDir);
    if (registryResult.kind === 'ok') {
      const builderResult = validateBuilders(model, registryResult.registry);
      if (builderResult.kind === 'invalid') {
        diagnostics.push(...builderResult.errors);
      }
    }
  } catch {
    // builders.yaml missing or unloadable — skip C11
  }

  // 5. Extensions (C1, C5–C8)
  let extensions: ReturnType<typeof loadExtensions> | undefined;
  try {
    extensions = loadExtensions(rootDir);
  } catch {
    // extensions.yaml missing — skip C1, C5–C8
  }

  if (extensions?.kind === 'ok') {
    // C1: override targets
    diagnostics.push(...checkOverrideTargets(extensions.data, generatedResources as unknown as TerraformResource[]));

    // C5–C8: extensions validation (reuse)
    const applyResult = applyExtensions(generatedResources, extensions.data);
    if (applyResult.kind === 'invalid') {
      diagnostics.push(...(applyResult.errors as ExtensionsDiagnostic[]));
    }

    // C7: ENV in patch
    diagnostics.push(...scanPatchForEnvRefs(extensions.data));
  }

  // 6. C4: resource consistency
  diagnostics.push(...checkResourceConsistency(model, generatedResources as unknown as TerraformResource[]));

  // 7. C9: outputs validation (reuse)
  try {
    const outputsResult = loadOutputs(rootDir);
    if (outputsResult.kind === 'ok') {
      const buildResult = buildOutputs({
        outputsYaml: outputsResult.data,
        materializerOutputs: new Map(),
        resources: generatedResources,
      });
      if (buildResult.kind === 'invalid') {
        diagnostics.push(...(buildResult.errors as Diagnostic[]));
      }
    }
  } catch {
    // outputs.yaml missing — skip C9
  }

  // 8. C10: moves validation (reuse)
  const movesResult = loadMoves(rootDir);
  if (movesResult.kind === 'ok') {
    const validated = validateMoves(movesResult.data);
    if (validated.errors.length > 0) {
      diagnostics.push(...(validated.errors as Diagnostic[]));
    }
  }

  // 10. C13: optional terraform validate (fail-fast: only if 0 base errors)
  if (options?.validateTf === true && diagnostics.length === 0) {
    diagnostics.push(...runTerraformValidate(rootDir));
  }

  return { diagnostics };
}

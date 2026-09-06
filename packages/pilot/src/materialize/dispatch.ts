import type {
  DispatchOptions,
  DispatchResult,
  GeneratedTfFile,
  PluginRegistry,
  ProjectModel,
  TerraformResource,
} from '../contracts/index.js';
import { createOutputBuilder } from './context.js';
import { materializeAll } from './materialize.js';
import { outputCollisionDiagnostics, serializeOutputs, serializeResourceFile, detectFilenameCollision } from './serialize.js';
import { selectArtifacts } from './select.js';

/**
 * Dispatch orchestration (data-model "Dispatch Flow"). Pure + async — no I/O
 * (FR-015); the resulting files are persisted by `writeGeneratedTerraform`.
 *
 *  Phase 1 — SELECT: deterministic order → supports iteration → collect-ALL
 *  selection errors (FR-017). Any error → invalid, materialize never called.
 *  Phase 2 — MATERIALIZE: one shared OutputBuilder context; abort-on-first
 *  MTL_MATERIALIZE_FAILED (FR-006).
 *  SERIALIZE: address guard + filename per app → files; outputs file LAST.
 */
export async function dispatch(
  projectModel: ProjectModel,
  registry: PluginRegistry,
  _options?: DispatchOptions,
): Promise<DispatchResult> {
  // Phase 1 — selection, all-or-nothing (FR-017).
  const selection = selectArtifacts(projectModel, registry);
  if (selection.kind === 'invalid') {
    return { kind: 'invalid', errors: selection.errors };
  }

  // Phase 2 — materialize, abort-on-first (FR-006).
  const outputBuilder = createOutputBuilder();
  const materialization = await materializeAll(projectModel, registry, selection.matches, outputBuilder);
  if (materialization.kind === 'failed') {
    return { kind: 'invalid', errors: [materialization.error] };
  }

  // Filename collision guard first (defensive, FR-010).
  const collisions = detectFilenameCollision(
    materialization.resources.map(({ appId }) => ({
      appId,
      filename: `${appId}.ycsf.tf.json`,
    })),
  );
  if (collisions.length > 0) {
    return { kind: 'invalid', errors: collisions };
  }

  // Serialize each resource (address guard, FR-011; sorted keys, FR-009).
  const resources: TerraformResource[] = [];
  const generatedFiles: GeneratedTfFile[] = [];
  for (const { resource, appId } of materialization.resources) {
    const serialized = serializeResourceFile(appId, resource);
    if (serialized.kind === 'invalid') {
      return { kind: 'invalid', errors: serialized.errors };
    }
    generatedFiles.push(serialized.file);
    resources.push(resource);
  }

  // Outputs: collision is an error (FR-013); file appended LAST (FR-012).
  const outputCollisions = outputCollisionDiagnostics(outputBuilder.duplicateNames);
  if (outputCollisions.length > 0) {
    return { kind: 'invalid', errors: outputCollisions };
  }
  if (outputBuilder.declared.size > 0) {
    generatedFiles.push({
      filename: '00-ycsf-outputs.tf.json',
      content: serializeOutputs(outputBuilder.declared),
    });
  }

  return { kind: 'ok', resources, generatedFiles };
}
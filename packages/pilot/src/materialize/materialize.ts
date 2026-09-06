import type {
  ArtifactDescriptor,
  DispatchDiagnostic,
  PluginRegistry,
  ProjectModel,
  TerraformResource,
} from '../contracts/index.js';
import { MTL_MATERIALIZE_FAILED } from '../contracts/index.js';
import { createContext, createOutputBuilder } from './context.js';
import type { OutputBuilderWithCollection } from './context.js';
import { mtl } from './errors.js';
import { getMaterializer } from './shape.js';
import { deterministicOrder } from './select.js';

/**
 * Phase 2 materialization (FR-005/006, research 7).
 * Abort-on-first: the throwing materializer wins, later artifacts are NOT
 * materialized, and no partial resources are returned. A throw/reject inside
 * `materialize` surfaces as a single `MTL_MATERIALIZE_FAILED`.
 */

export interface DispatchedResource {
  readonly resource: TerraformResource;
  readonly appId: string;
  readonly materializerId: string;
}

export type MaterializeAllResult =
  | { readonly kind: 'ok'; readonly resources: readonly DispatchedResource[] }
  | { readonly kind: 'failed'; readonly error: DispatchDiagnostic };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function materializeAll(
  model: ProjectModel,
  registry: PluginRegistry,
  matches: ReadonlyMap<string, string>,
  outputBuilder: OutputBuilderWithCollection = createOutputBuilder(),
): Promise<MaterializeAllResult> {
  const resources: DispatchedResource[] = [];

  for (const appId of deterministicOrder(model)) {
    const materializerId = matches.get(appId);
    if (materializerId === undefined) continue;

    const entry = registry.records.get(materializerId);
    const materializer = entry === undefined ? null : getMaterializer(entry.module);
    if (materializer === null) continue;

    const type = model.apps.get(appId)?.builder ?? 'unknown';
    const artifact: ArtifactDescriptor = { id: appId, name: appId, type };
    const context = createContext(outputBuilder);

    try {
      const resource = await materializer.materialize(artifact, context);
      resources.push({ resource, appId, materializerId });
    } catch (error) {
      return {
        kind: 'failed',
        error: mtl({
          code: MTL_MATERIALIZE_FAILED,
          message: `materializer '${materializerId}' failed for artifact '${appId}': ${errorMessage(error)} (MTL_MATERIALIZE_FAILED)`,
          artifactId: appId,
          materializerId,
        }),
      };
    }
  }

  return { kind: 'ok', resources };
}
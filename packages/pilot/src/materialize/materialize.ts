import type {
  AppIdArtifactMap,
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
import { buildArtifactDescriptors, deterministicOrder } from './select.js';

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
  if (error instanceof Error) {
    // Materializers-core errors carry a `code` (e.g. YMT_INVALID_ARTIFACT_VALUE);
    // surface it in the diagnostic message so the root cause is machine-readable.
    const code = (error as { readonly code?: unknown }).code;
    const base = error.message;
    return typeof code === 'string' && code !== '' ? `${base} (${code})` : base;
  }
  return String(error);
}

export async function materializeAll(
  model: ProjectModel,
  registry: PluginRegistry,
  matches: ReadonlyMap<string, string>,
  outputBuilder: OutputBuilderWithCollection = createOutputBuilder(),
  artifacts?: AppIdArtifactMap,
): Promise<MaterializeAllResult> {
  const resources: DispatchedResource[] = [];
  const descriptors = new Map(
    buildArtifactDescriptors(model, artifacts).map((descriptor) => [descriptor.id, descriptor]),
  );

  for (const appId of deterministicOrder(model)) {
    const materializerId = matches.get(appId);
    if (materializerId === undefined) continue;

    const entry = registry.records.get(materializerId);
    const materializer = entry === undefined ? null : getMaterializer(entry.module);
    if (materializer === null) continue;

    const type = model.apps.get(appId)?.builder ?? 'unknown';
    const descriptor = descriptors.get(appId);
    const artifact: ArtifactDescriptor = descriptor ?? { id: appId, name: appId, type };
    const context = createContext(outputBuilder);

    try {
      // Per the C-layer contract `materialize` returns a single resource;
      // some real B-layer materializers (yandex-storage-bucket) return an
      // array (bucket + its objects) at runtime. Flatten the array so every
      // resource is serialized into the app's single file. Single-resource
      // results are untouched (FR-005 contract pinned by test/types).
      const produced = await materializer.materialize(artifact, context);
      const producedList: readonly TerraformResource[] = Array.isArray(produced) ? produced : [produced];
      for (const resource of producedList) {
        resources.push({ resource, appId, materializerId });
      }
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
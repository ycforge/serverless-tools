import type {
  ArtifactDescriptor,
  DispatchDiagnostic,
  PluginRegistry,
  ProjectModel,
} from '../contracts/index.js';
import { MTL_COLLISION, MTL_UNHANDLED_ARTIFACT } from '../contracts/index.js';
import { createContext, createOutputBuilder } from './context.js';
import { mtl } from './errors.js';
import { getMaterializer } from './shape.js';

/**
 * Phase 1 selection (FR-002/003/004/017; data-model).
 * All-or-nothing: EVERY selection error (MTL_COLLISION / MTL_UNHANDLED_ARTIFACT)
 * is collected; on any error `materialize` is never called for any artifact.
 * `supports` runs sequentially in registry insertion order (research 2/3).
 * A throwing `supports` propagates — selection never swallows (A2).
 */

/**
 * Deterministic artifact order (A5, research 2): alphabetical pre-sort of
 * `app_id`, then topological consumption via `depends_on_graph.adjacency`
 * with alphabetic tie-break among ready apps. Matches US-4.
 */
export function deterministicOrder(model: ProjectModel): readonly string[] {
  const appIds = [...model.apps.keys()].sort();
  const adjacency = model.depends_on_graph.adjacency;

  const remaining = new Map<string, number>();
  for (const id of appIds) {
    const deps = (adjacency.get(id) ?? []).filter((d) => model.apps.has(d));
    remaining.set(id, deps.length);
  }

  const dependents = new Map<string, string[]>();
  for (const id of appIds) {
    for (const dep of adjacency.get(id) ?? []) {
      if (!model.apps.has(dep)) continue;
      const list = dependents.get(dep) ?? [];
      list.push(id);
      dependents.set(dep, list);
    }
  }

  const order: string[] = [];
  const ready = appIds.filter((id) => (remaining.get(id) ?? 0) === 0);

  while (ready.length > 0) {
    ready.sort();
    const next = ready.shift();
    if (next === undefined) break;
    order.push(next);

    for (const dependent of dependents.get(next) ?? []) {
      const count = (remaining.get(dependent) ?? 0) - 1;
      remaining.set(dependent, count);
      if (count === 0) ready.push(dependent);
    }
  }

  return order;
}

/** One app → one flat descriptor, in deterministic order (FR-001). */
export function buildArtifactDescriptors(model: ProjectModel): readonly ArtifactDescriptor[] {
  return deterministicOrder(model).map((id) => {
    const app = model.apps.get(id);
    return { id, name: id, type: app?.builder ?? 'unknown' };
  });
}

export type SelectionResult =
  | {
      readonly kind: 'ok';
      readonly orderedAppIds: readonly string[];
      readonly matches: ReadonlyMap<string, string>;
    }
  | { readonly kind: 'invalid'; readonly orderedAppIds: readonly string[]; readonly errors: readonly DispatchDiagnostic[] };

export function selectArtifacts(model: ProjectModel, registry: PluginRegistry): SelectionResult {
  const orderedAppIds = deterministicOrder(model);
  const descriptors = buildArtifactDescriptors(model);
  const entries = [...registry.records.values()].filter((entry) => entry.kind === 'materializer');

  const matches = new Map<string, string>();
  const errors: DispatchDiagnostic[] = [];

  for (const descriptor of descriptors) {
    const supporters: string[] = [];
    const context = createContext(createOutputBuilder());
    for (const entry of entries) {
      const materializer = getMaterializer(entry.module);
      if (materializer === null) continue;
      if (materializer.supports(descriptor, context)) supporters.push(entry.id);
    }

    if (supporters.length === 0) {
      errors.push(
        mtl({
          code: MTL_UNHANDLED_ARTIFACT,
          message: `no materializer supports artifact '${descriptor.id}' of type '${descriptor.type}' (registered: ${entries.length}) (MTL_UNHANDLED_ARTIFACT)`,
          artifactId: descriptor.id,
          type: descriptor.type,
          materializerIds: entries.map((e) => e.id),
        }),
      );
    } else if (supporters.length > 1) {
      errors.push(
        mtl({
          code: MTL_COLLISION,
          message: `artifact '${descriptor.id}' type '${descriptor.type}' claimed by ${supporters.length} materializers: '${supporters.join("', '")}' (MTL_COLLISION)`,
          artifactId: descriptor.id,
          type: descriptor.type,
          materializerIds: supporters,
        }),
      );
    } else {
      matches.set(descriptor.id, supporters[0] as string);
    }
  }

  return errors.length > 0
    ? { kind: 'invalid', orderedAppIds, errors }
    : { kind: 'ok', orderedAppIds, matches };
}
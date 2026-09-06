import type { ArtifactDescriptor, Materializer } from '../contracts/index.js';

/**
 * Shape guard narrowing `PluginEntry.module: unknown` to the Materializer
 * contract (research 4 / data-model). Resolves `ns.default` (if it is a
 * non-null object) first, falls back to `ns` itself — symmetric with
 * 013 `detectPluginKind` so both `export default` and named-export plugins
 * load. Returns `null` when the module is not a materializer.
 */
export function isMaterializerShape(obj: unknown): boolean {
  if (obj === null || typeof obj !== 'object') return false;
  const rec = obj as Record<string, unknown>;
  return typeof rec.supports === 'function' && typeof rec.materialize === 'function';
}

export function getMaterializer(module: unknown): Materializer<ArtifactDescriptor> | null {
  if (module === null || typeof module !== 'object') return null;
  const rec = module as Record<string, unknown>;
  const target: unknown =
    rec.default !== null && typeof rec.default === 'object' ? rec.default : rec;
  return isMaterializerShape(target)
    ? (target as unknown as Materializer<ArtifactDescriptor>)
    : null;
}
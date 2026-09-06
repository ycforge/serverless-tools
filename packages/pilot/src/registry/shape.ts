/**
 * Shape detection for builder/materializer plugins (FR-007/008, research 2).
 *
 * Pure functions — no I/O, no dynamic import.
 */

export function isBuilderShape(obj: unknown): boolean {
  if (obj === null || typeof obj !== 'object') return false;
  return typeof (obj as Record<string, unknown>).build === 'function';
}

export function isMaterializerShape(obj: unknown): boolean {
  if (obj === null || typeof obj !== 'object') return false;
  const rec = obj as Record<string, unknown>;
  return typeof rec.supports === 'function' && typeof rec.materialize === 'function';
}

/**
 * Detect the plugin kind from a loaded module namespace.
 * Resolves `ns.default` (if non-null object) first, falls back to `ns` itself.
 * Builder-priority: if both shapes present → `'builder'` (research 2).
 * Neither shape → `null` (caller emits `BRG_NOT_A_PLUGIN`).
 */
export function detectPluginKind(ns: Record<string, unknown>): 'builder' | 'materializer' | null {
  const target: unknown = (ns.default !== null && typeof ns.default === 'object')
    ? ns.default
    : ns;

  if (isBuilderShape(target)) return 'builder';
  if (isMaterializerShape(target)) return 'materializer';
  return null;
}

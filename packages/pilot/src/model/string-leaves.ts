import { isRecord } from './types.js';

/**
 * Shared string-leaf walk over an arbitrary JSON value (research decision 1).
 *
 * Walks objects and arrays deeply; every string leaf is handed to `visit` with
 * a `setLeaf` writeback. Returns a FRESH tree: original input is never mutated.
 * When a visitor never calls `setLeaf`, the returned tree is a deep copy.
 *
 * Two spec-011/012 consumers share this single traversal so the definition of
 * "string leaf" cannot drift:
 * - 011 env-requirements.ts collects leaves (read-only visitor);
 * - 012 build-env/interpolate.ts substitutes `{{$NAME}}` (calls `setLeaf`).
 */
export function forEachStringLeaf(
  value: unknown,
  visit: (leaf: string, setLeaf: (next: string) => void) => void,
): unknown {
  if (typeof value === 'string') {
    let next = value;
    visit(value, (replacement) => {
      next = replacement;
    });
    return next;
  }
  if (Array.isArray(value)) {
    return value.map((item) => forEachStringLeaf(item, visit));
  }
  if (isRecord(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = forEachStringLeaf(item, visit);
    }
    return out;
  }
  return value;
}
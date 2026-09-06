// spec 015 extensions — deep merge (§25.2). Non-mutating, deterministic.

/**
 * True only for "plain" objects (prototype `Object.prototype` or `null`).
 * Arrays, scalars and class instances never merge — a patch value of that
 * shape replaces the base value wholesale (FR-008/§25.2).
 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Deep-merge `patch` over `base` (returns a NEW object; `base`/`patch` are
 * never mutated):
 * - both plain objects → recursive merge per key (patch keys override; base
 *   keys not present in the patch are carried over BY REFERENCE);
 * - anything else → the patch value replaces the base value.
 */
export function deepMerge(base: unknown, patch: unknown): unknown {
  if (!isPlainObject(patch)) return patch;
  if (!isPlainObject(base)) return patch;

  const result: Record<string, unknown> = {};
  const resultKeys = new Set([...Object.keys(base), ...Object.keys(patch)]);
  for (const key of resultKeys) {
    result[key] = Object.prototype.hasOwnProperty.call(patch, key)
      ? deepMerge(base[key], patch[key])
      : base[key];
  }
  return result;
}
/**
 * Shared known-field validation for builder build_config schemas (FR-004).
 *
 * Unknown top-level keys are ignored by construction (coexistence with
 * B-shared fields such as `openapi_entry`); a known field with an invalid
 * type / a value outside `allowed` → `BLC_INVALID_CONFIG`.
 */

export interface KnownFieldSchema {
  readonly field: string;
  readonly type: 'string' | 'string[]';
  readonly allowed?: readonly string[];
}

export type ValidateKnownFieldsResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; field: string };

export function validateKnownFields(
  raw: unknown,
  schema: readonly KnownFieldSchema[],
): ValidateKnownFieldsResult {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, field: 'build_config' };
  }
  const record = raw as Record<string, unknown>;
  for (const known of schema) {
    if (!(known.field in record)) continue;
    const value = record[known.field];
    const valid = known.type === 'string' ? requireString(value) : requireStringArray(value);
    if (!valid) {
      return { ok: false, field: known.field };
    }
    if (
      known.allowed !== undefined &&
      typeof value === 'string' &&
      !known.allowed.includes(value)
    ) {
      return { ok: false, field: known.field };
    }
  }
  return { ok: true, value: record };
}

export function requireString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

export function requireStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}
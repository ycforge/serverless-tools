import { ContractError, parseResourceReference } from '@ycforge/pilot/contracts';
import type { ParsedResourceReference } from '@ycforge/pilot/contracts';

import { ResourceRefError } from './errors.js';
import { TEMPLATE_PREFIX, TEMPLATE_RE, TEMPLATE_SUFFIX, makeTemplate, BARE_FUNCTION_ID_RE } from './refs/template.js';
import { DOMAIN_PROPERTIES } from './types.js';
import type { EnvMapping, ReferenceBearerField, ResourceDomain, ResourceIndex } from './types.js';

export type ResourceReferenceValidation =
  | { valid: true; parsed: ParsedResourceReference }
  | { valid: false; notAReference: true }
  | { valid: false; error: ResourceRefError };

/** Strips the `${resources.` prefix / `}` suffix; undefined when not in the resources namespace. */
function resourcesInnerOf(ref: string): string | undefined {
  if (!ref.startsWith(TEMPLATE_PREFIX) || !ref.endsWith(TEMPLATE_SUFFIX)) {
    return undefined;
  }
  return ref.slice(TEMPLATE_PREFIX.length, ref.length - TEMPLATE_SUFFIX.length);
}

/**
 * Validates a logical template reference `${resources.<domain>.<name>.<property>}`
 * against the {@link ResourceIndex} (FR-006). Non-`resources` interpolation
 * strings (APIGW `${var.foo}`, Terraform `${...}`, `{{$ENV}}`) are NOT 009
 * references and return the typed `notAReference` result (FR-014) — callers
 * skip them. Strings in the `${resources.` namespace but malformed fail-fast
 * with `RESOURCE_REF_SYNTAX_INVALID` (FR-005).
 */
export function validateResourceReference(
  ref: string,
  index: ResourceIndex,
): ResourceReferenceValidation {
  const match = TEMPLATE_RE.exec(ref);
  if (match === null) {
    const inner = resourcesInnerOf(ref);
    if (inner === undefined) {
      return { valid: false, notAReference: true };
    }
    try {
      parseResourceReference(inner);
    } catch (err) {
      const reason = err instanceof ContractError ? err.message : 'invalid syntax';
      return {
        valid: false,
        error: new ResourceRefError('RESOURCE_REF_SYNTAX_INVALID', {
          input: inner,
          reason,
        }),
      };
    }
    return {
      valid: false,
      error: new ResourceRefError('RESOURCE_REF_SYNTAX_INVALID', {
        input: inner,
        reason: 'malformed ${resources...} template',
      }),
    };
  }

  const [, domain = '', name = '', property = ''] = match;

  if (!DOMAIN_PROPERTIES.has(domain as ResourceDomain)) {
    return {
      valid: false,
      error: new ResourceRefError('RESOURCE_REF_DOMAIN_UNKNOWN', { domain, reference: ref }),
    };
  }
  if (!index.has(domain, name)) {
    return {
      valid: false,
      error: new ResourceRefError('RESOURCE_REF_NOT_DECLARED', {
        domain,
        name,
        reference: ref,
      }),
    };
  }
  if (!index.validateProperty(domain, name, property)) {
    const allowed = DOMAIN_PROPERTIES.get(domain as ResourceDomain);
    return {
      valid: false,
      error: new ResourceRefError('RESOURCE_REF_PROPERTY_INVALID', {
        domain,
        name,
        property,
        allowedProperties: allowed !== undefined ? [...allowed].sort() : undefined,
        reference: ref,
      }),
    };
  }

  const parsed: ParsedResourceReference = { domain, name, property };
  return { valid: true, parsed };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Resolves a single reference-bearing field value against the `ResourceIndex` and
 * `EnvMapping`. Returns the resolved string (real value, or the preserved canonical
 * template form). Throws `ResourceRefError` on undeclared/malformed references or an
 * unset `env:` variable (FR-006/008/010/011).
 */
function resolveScalar(
  value: unknown,
  index: ResourceIndex,
  envMapping: EnvMapping,
): string {
  if (typeof value !== 'string') {
    return String(value);
  }

  const bare = BARE_FUNCTION_ID_RE.exec(value);
  const canonicalTemplate =
    bare !== null
      ? makeTemplate({ domain: 'functions', name: bare[1]!, property: 'id' })
      : value;

  // Foreign interpolations (APIGW `${var.foo}`, Terraform, build ENV) are never `${resources...}`
  // references (FR-014) — leave the original string untouched.
  if (!TEMPLATE_RE.test(canonicalTemplate)) {
    return value;
  }

  // Every `${resources...}` reaching here MUST be valid against the index (FR-006/FR-008).
  const checked = validateResourceReference(canonicalTemplate, index);
  if (!checked.valid) {
    // `checked` is either { notAReference: true } or { error: ResourceRefError }.
    // The `notAReference` case should have been filtered by the TEMPLATE_RE test above,
    // but type-narrow defensively.
    if ('error' in checked) {
      throw checked.error;
    }
    // Should not reach here for a string that passed TEMPLATE_RE, but preserve to be safe.
    return value;
  }

  const { domain, name, property } = checked.parsed;
  if (envMapping.hasEntry(domain, name, property)) {
    const envVar = envMapping.getEnvVar(domain, name, property)!;
    const actual = process.env[envVar];
    if (actual === undefined || actual === '') {
      throw new ResourceRefError('RESOURCE_REF_ENV_NOT_SET', {
        envVar,
        reference: canonicalTemplate,
      });
    }
    return actual;
  }

  // No `env:` declaration → preserve the canonical template form (FR-010).
  return canonicalTemplate;
}

interface LeafPosition {
  parent: Record<string, unknown>;
  key: string;
}

/** Collects every leaf position matching `path`, where `'*'` matches any object key. */
function collectLeafPositions(target: unknown, path: readonly (string | number)[]): LeafPosition[] {
  if (path.length === 0) {
    return [];
  }
  const seg = path[0];
  const rest = path.slice(1);
  if (seg === undefined) {
    return [];
  }

  if (seg === '*') {
    if (!isRecord(target)) {
      return [];
    }
    const out: LeafPosition[] = [];
    for (const key of Object.keys(target)) {
      if (rest.length === 0) {
        // A trailing '*' is not a real targeting spec; skip defensively.
        continue;
      }
      out.push(...collectLeafPositions(target[key], rest));
    }
    return out;
  }

  if (!isRecord(target) || !(seg in target)) {
    return [];
  }
  if (rest.length === 0) {
    return [{ parent: target, key: seg as string }];
  }
  return collectLeafPositions(target[seg as string], rest);
}

/**
 * ENV-only resolution pass over the gateway artifact (FR-009/010). Applies ONLY to the
 * contracted `ReferenceBearerField`s (FR-019; clarify Q3 → Variant B): a `${resources...}`
 * (or legacy `functions.<name>`, transition) reference with an `env:` declaration is replaced
 * by `process.env[VAR]` read at compile time (snapshot; US4/AC1); references without a
 * declaration keep their canonical template form (FR-010); undeclared/malformed references
 * fail-fast (FR-008); foreign interpolations are never matched (FR-014).
 * Pure + deterministic (contract §Determinism; FR-009/010/011/018).
 */

export function resolveReferences(
  document: Record<string, unknown>,
  envMapping: EnvMapping,
  fields: readonly ReferenceBearerField[],
  index: ResourceIndex,
): Record<string, unknown> {
  const clone: Record<string, unknown> = structuredClone(document) as Record<string, unknown>;
  for (const field of fields) {
    const positions = collectLeafPositions(clone, field.path);
    for (const { parent, key } of positions) {
      parent[key] = resolveScalar(parent[key], index, envMapping);
    }
  }
  return clone;
}

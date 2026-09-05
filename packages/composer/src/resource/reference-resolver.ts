import { ContractError, parseResourceReference } from '@ycforge/pilot/contracts';
import type { ParsedResourceReference } from '@ycforge/pilot/contracts';

import { ResourceRefError } from './errors.js';
import { TEMPLATE_PREFIX, TEMPLATE_RE, TEMPLATE_SUFFIX } from './refs/template.js';
import { DOMAIN_PROPERTIES } from './types.js';
import type { ResourceDomain, ResourceIndex } from './types.js';

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
  const parsed: ParsedResourceReference = { domain, name, property };

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

  return { valid: true, parsed };
}
// spec 016 outputs — IDL side-table + reference resolver (research 1).
import { parseResourceReference } from '../contracts/resource-reference.js';
import { ContractError } from '../contracts/diagnostic.js';
import { OUT_INVALID_VALUE, OUT_UNRESOLVED_IDL } from '../contracts/index.js';
import type { OutputsDiagnostic } from '../contracts/index.js';
import { IDL_DOMAIN_BY_TF_TYPE } from '../extensions/idl.js';
import type { IdlIndex } from '../extensions/idl.js';
import { out } from './errors.js';

/**
 * Reverse of `IDL_DOMAIN_BY_TF_TYPE` (spec 015): `functions → yandex_function`,
 * `gateways → yandex_api_gateway`. Derived once at module load and frozen.
 * Non-listed Terraform types are never addressable.
 */
export const DOMAIN_TO_TF_TYPE: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(Object.entries(IDL_DOMAIN_BY_TF_TYPE).map(([tfType, domain]) => [domain, tfType])),
);

export type ResolveIdlReferenceResult =
  | { kind: 'ok'; id: string }
  | { kind: 'error'; error: OutputsDiagnostic };

/**
 * Resolve a user `value` — a 3-segment IDL reference
 * `domain.name.property` — against an IDL index (contract 002 grammar).
 *
 * Returns the RAW Terraform address `tfType.name.property` WITHOUT `${...}`:
 * wrapping is the single responsibility of build assembly (FR-011).
 *
 * @param ref The `value` string from `.ycsf/outputs.yaml`.
 * @param index IDL index built via `createIdlIndex` (spec 015).
 * @param name Optional failing output name, so build diagnostics identify the entry.
 */
export function resolveIdlReference(ref: string, index: IdlIndex, name?: string): ResolveIdlReferenceResult {
  let parsed;
  try {
    parsed = parseResourceReference(ref);
  } catch (err) {
    if (err instanceof ContractError) {
      return {
        kind: 'error',
        error: out({ code: OUT_INVALID_VALUE, message: err.message, ...(name !== undefined ? { name } : {}) }),
      };
    }
    throw err;
  }

  const tfType = DOMAIN_TO_TF_TYPE[parsed.domain];
  const target = `${parsed.domain}.${parsed.name}`;
  if (tfType === undefined || index.byIdl.get(target) === undefined) {
    return {
      kind: 'error',
      error: out({
        code: OUT_UNRESOLVED_IDL,
        message: `unresolved IDL reference '${ref}' (OUT_UNRESOLVED_IDL); available IDLs: ${index.availableIdls.join(', ')}`,
        availableIdls: index.availableIdls,
        ...(name !== undefined ? { name } : {}),
      }),
    };
  }

  return { kind: 'ok', id: `${tfType}.${parsed.name}.${parsed.property}` };
}
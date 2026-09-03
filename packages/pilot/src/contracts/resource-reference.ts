import { ContractError, Diagnostics } from './diagnostic.js';

/**
 * Canonical logical resource reference (FR-010..FR-013; IDEA §15).
 *
 * `ResourceReference` is the single canonical representation of a logical
 * reference; it stays ONE string. The parser is a helper utility for
 * consumers that need the parts — it does not replace the representation.
 *
 * Grammar (clarified 2026-09-03): exactly three segments
 * `domain.name.property`, where a segment is `[a-z][a-z0-9_]*` (lowercase;
 * underscore allowed, hyphen not). The two-segment IDL form `domain.name`
 * is a logical resource identity, NOT a ResourceReference, and is rejected.
 *
 * The parser does not distinguish managed (app) resources from external
 * (`resources.yaml`) ones — ownership semantics live in Project C
 * (Constitution VI). IDL→IDT translation is the materializer's job; IDR
 * never appears in contracts (FR-013).
 */

/** Single canonical representation of a logical reference. */
export interface ResourceReference {
  readonly ref: string;
}

/** Parsed view of a canonical reference. A helper type, not the contract. */
export interface ParsedResourceReference {
  readonly domain: string;
  readonly name: string;
  readonly property: string;
}

const SEGMENT_PATTERN = /^[a-z][a-z0-9_]*$/;
const SEGMENT_COUNT = 3;

function reject(ref: string, reason: string): never {
  throw new ContractError(
    Diagnostics.InvalidResourceReference,
    `invalid resource reference ${JSON.stringify(ref)}: ${reason}`,
  );
}

/**
 * Parses a canonical reference into its three parts. Pure and deterministic.
 *
 * @throws {@link ContractError} with code `INVALID_RESOURCE_REFERENCE` on any
 * malformed input — never returns `undefined` (Constitution V).
 */
export function parseResourceReference(ref: string): ParsedResourceReference {
  if (ref.length === 0) {
    reject(ref, 'empty string');
  }
  const segments = ref.split('.');
  if (segments.length !== SEGMENT_COUNT) {
    reject(
      ref,
      `expected ${SEGMENT_COUNT} segments (domain.name.property), got ${segments.length}`,
    );
  }
  const [domain = '', name = '', property = ''] = segments;
  for (const [label, segment] of [
    ['domain', domain],
    ['name', name],
    ['property', property],
  ] as const) {
    if (!SEGMENT_PATTERN.test(segment)) {
      reject(ref, `invalid ${label} segment ${JSON.stringify(segment)} (expected [a-z][a-z0-9_]*)`);
    }
  }
  return { domain, name, property };
}

/**
 * Serializes parsed parts back into the canonical string. Inverse of
 * {@link parseResourceReference}: `format(parse(r)) === r` for valid `r`.
 */
export function formatResourceReference(parsed: ParsedResourceReference): string {
  return `${parsed.domain}.${parsed.name}.${parsed.property}`;
}

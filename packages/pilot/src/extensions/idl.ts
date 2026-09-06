// spec 015 extensions — IDL side-table + resolution helpers.
import type { TerraformResource } from '../contracts/index.js';

/**
 * The only two domain types that are IDL-addressable by extensions
 * (data-model.md, research.md; quickstart uses `functions.*` and `gateways.*`).
 * Frozen so the table cannot be mutated at runtime. Non-listed types are
 * never addressable and never produce errors.
 */
export const IDL_DOMAIN_BY_TF_TYPE: Readonly<Record<string, string>> = Object.freeze({
  yandex_function: 'functions',
  yandex_api_gateway: 'gateways',
});

/** IDL grammar: `<domain>.<name>` — both segments `[a-z][a-z0-9_]*` (FR-004). */
export const IDL_SEGMENT_RE = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;

/** Full IDL of a resource, or `null` when its Terraform type is not in the addressable table. */
export function idlFor(resource: TerraformResource): string | null {
  const domain = IDL_DOMAIN_BY_TF_TYPE[resource.type];
  if (domain === undefined) return null;
  return `${domain}.${resource.name}`;
}

export interface IdlIndex {
  /** First resource per IDL (later ones are recorded as duplicates). */
  readonly byIdl: ReadonlyMap<string, TerraformResource>;
  /** All distinct IDLs, alphabetical (for EXT_UNRESOLVED_TARGET hints). */
  readonly availableIdls: readonly string[];
  /** Duplicate IDLs in order of first duplicate occurrence. */
  readonly duplicateIdls: readonly string[];
}

export function createIdlIndex(resources: readonly TerraformResource[]): IdlIndex {
  const byIdl = new Map<string, TerraformResource>();
  const duplicateIdls: string[] = [];

  for (const resource of resources) {
    const idl = idlFor(resource);
    if (idl === null) continue;
    if (byIdl.has(idl)) {
      if (!duplicateIdls.includes(idl)) duplicateIdls.push(idl);
    } else {
      byIdl.set(idl, resource);
    }
  }

  const availableIdls = [...byIdl.keys()].sort();

  return { byIdl, availableIdls, duplicateIdls };
}
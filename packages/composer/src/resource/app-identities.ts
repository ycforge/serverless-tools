import type { AppIdentity } from '@ycforge/pilot/contracts';
import { artifactTypeToResourceDomain } from '@ycforge/pilot/contracts';

import { ResourceRefError } from './errors.js';
import { buildIndex } from './resource-index.js';
import { DOMAIN_PROPERTIES, RESOURCE_DOMAINS } from './types.js';
import type { ResourceDomain, ResourceIndex } from './types.js';

/**
 * Extends an external resource index with Project C-derived app identities
 * (spec 028, plan D-1). The reference-envelope (Constitution VI) is NOT
 * extended here: identities are appended after the external entries, in the
 * exact order Project C handed them (determinism, FR-003), exposing the full
 * property set of their domain (empty-declaration semantics, FR-004).
 *
 * Fail-fast (never silent, never merged): an identity whose app id collides
 * with an external resource id in the same domain throws
 * `RESOURCE_REF_IDENTITY_COLLISION`; an artifact type that maps to no resource
 * domain throws `RESOURCE_REF_DOMAIN_UNKNOWN` (no guessing, FR-004).
 */
export function mergeResourceIndex(
  index: ResourceIndex,
  appIdentities: readonly AppIdentity[] | undefined,
): ResourceIndex {
  if (appIdentities === undefined || appIdentities.length === 0) {
    return index;
  }
  const entries = new Map<ResourceDomain, Map<string, Set<string>>>();
  for (const [domain, names] of index.entries) {
    const copy = new Map<string, Set<string>>();
    for (const [name, props] of names) {
      copy.set(name, new Set(props));
    }
    entries.set(domain, copy);
  }
  for (const identity of appIdentities) {
    const domain = artifactTypeToResourceDomain(identity.artifactType) as
      | ResourceDomain
      | undefined;
    if (domain === undefined || !RESOURCE_DOMAINS.includes(domain)) {
      throw new ResourceRefError('RESOURCE_REF_DOMAIN_UNKNOWN', {
        domain: identity.artifactType,
      });
    }
    const names = entries.get(domain) ?? new Map<string, Set<string>>();
    if (names.has(identity.appId)) {
      throw new ResourceRefError('RESOURCE_REF_IDENTITY_COLLISION', {
        domain,
        name: identity.appId,
      });
    }
    names.set(identity.appId, new Set(DOMAIN_PROPERTIES.get(domain) ?? []));
    entries.set(domain, names);
  }
  return buildIndex(entries);
}
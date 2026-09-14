import { describe, expect, it } from 'vitest';

import { ARTIFACT_TYPE_DOMAIN_MAP } from '@ycforge/pilot/contracts';
import { RESOURCE_DOMAINS } from '../../../src/resource/types.js';

// spec 028, T001(c): the contract-side artifact-type → domain mapping must
// stay aligned with the composer `RESOURCE_DOMAINS` vocabulary (SC-006, no
// dictionary drift). Written BEFORE the contract module exists (RED).

describe('resource errors module vocabulary (spec 028, T001)', () => {
  it('ARTIFACT_TYPE_DOMAIN_MAP values ⊆ composer RESOURCE_DOMAINS (SC-006)', () => {
    expect(Object.values(ARTIFACT_TYPE_DOMAIN_MAP).every((d) => RESOURCE_DOMAINS.includes(d))).toBe(true);
  });

  it('all four FR-002 domains are represented in the mapping', () => {
    const values = new Set(Object.values(ARTIFACT_TYPE_DOMAIN_MAP));
    expect(values.has('functions')).toBe(true);
    expect(values.has('containers')).toBe(true);
    expect(values.has('buckets')).toBe(true);
    expect(values.has('gateways')).toBe(true);
  });
});
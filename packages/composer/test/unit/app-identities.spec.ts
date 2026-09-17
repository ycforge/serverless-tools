import { describe, expect, it } from 'vitest';

import type { AppIdentity } from '@ycforge/pilot/contracts';

import {
  ResourceRefError,
  parseResourceIndex,
} from '../../src/resource/index.js';
import { mergeResourceIndex } from '../../src/resource/app-identities.js';

// spec 028 / plan D-1, T009: Project B compiles an app whose references point
// at OTHER map-form apps (sibling identities). Project C derives them from
// `apps.yaml` (ycforge:* artifact-type builder keys) and passes them in the
// BuildContext; Project B appends them to the external resource index — with
// the reference-envelope and one-side (identity) machinery preserved.

const EXTERNAL = parseResourceIndex(
  `version: 1
functions:
  legacy_authorizer:
    id: d4e-legacy
buckets:
  ext_bucket: {}
`,
  '<memory>',
);

const IDENTITIES: readonly AppIdentity[] = [
  { appId: 'user_service', artifactType: 'ycforge:function' },
  { appId: 'analytics', artifactType: 'ycforge:docker-image' },
  { appId: 'frontend', artifactType: 'ycforge:frontend' },
];

function thrown<T>(fn: () => T): ResourceRefError | undefined {
  try {
    fn();
  } catch (error) {
    if (error instanceof ResourceRefError) {
      return error;
    }
    throw error;
  }
  return undefined;
}

describe('mergeResourceIndex (spec 028, T009)', () => {
  it('T009-a: keeps the external index untouched when no app identities are provided', () => {
    expect(mergeResourceIndex(EXTERNAL, undefined)).toBe(EXTERNAL);
    expect(EXTERNAL.entries.get('functions')).toBeDefined();
  });

  it('T009-a: external entries stay FIRST, app identities are appended in input order (FR-003)', () => {
    const merged = mergeResourceIndex(EXTERNAL, IDENTITIES);
    expect([...merged.entries.get('functions')!.keys()]).toEqual(['legacy_authorizer', 'user_service']);
    expect([...merged.entries.get('containers')!.keys()]).toEqual(['analytics']);
    expect([...merged.entries.get('buckets')!.keys()]).toEqual(['ext_bucket', 'frontend']);
    expect([...merged.domains]).toEqual(['functions', 'buckets', 'containers']);
  });

  it('T009-a: merging is deterministic — same input, same order', () => {
    const first = mergeResourceIndex(EXTERNAL, IDENTITIES);
    const second = mergeResourceIndex(EXTERNAL, IDENTITIES);
    expect([...first.entries.get('functions')!.keys()]).toEqual([
      ...second.entries.get('functions')!.keys(),
    ]);
    expect([...first.entries.get('buckets')!.keys()]).toEqual([
      ...second.entries.get('buckets')!.keys(),
    ]);
  });

  it('T009-b: app identities expose all properties of their domain (empty-declaration semantics, FR-004)', () => {
    const merged = mergeResourceIndex(EXTERNAL, IDENTITIES);
    expect([...merged.getProperties('functions', 'user_service')!]).toEqual(['id']);
    expect([...merged.getProperties('containers', 'analytics')!]).toEqual(['id']);
    expect([...merged.getProperties('buckets', 'frontend')!]).toEqual(['name']);
    expect(merged.validateProperty('functions', 'user_service', 'id')).toBe(true);
    expect(merged.validateProperty('functions', 'user_service', 'name')).toBe(false);
    expect(merged.has('containers', 'analytics')).toBe(true);
    expect(merged.has('gateways', 'openapi')).toBe(false);
  });

  it('T009-c: an app identity colliding with an external resource id FAILS FAST (never merged)', () => {
    const external = parseResourceIndex(
      `version: 1
functions:
  collider:
    id: d4e-ext
`,
      '<memory>',
    );
    const error = thrown(() =>
      mergeResourceIndex(external, [{ appId: 'collider', artifactType: 'ycforge:function' }]),
    );
    expect(error?.code).toBe('RESOURCE_REF_IDENTITY_COLLISION');
    expect(error?.domain).toBe('functions');
    expect(error?.context?.name).toBe('collider');
  });

  it('T009-c: an artifact type that maps to NO resource domain FAILS FAST (no guessing, FR-004)', () => {
    const error = thrown(() =>
      mergeResourceIndex(EXTERNAL, [{ appId: 'mystery', artifactType: 'ycforge:mystery' }]),
    );
    expect(error?.code).toBe('RESOURCE_REF_DOMAIN_UNKNOWN');
    expect(error?.domain).toBe('ycforge:mystery');
  });
});
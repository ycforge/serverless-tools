import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  ARTIFACT_TYPE_DOMAIN_MAP,
  artifactTypeToResourceDomain,
  type AppIdentity,
  type ResourceDomain,
} from '../../src/contracts/index.js';

// spec 028, FR-001/FR-002, plan D-1 (T001). The artifact-type → resource-domain
// mapping is the canonical contract home for the C→B identity transport.
// RED (this file is written BEFORE the module exists): type/assert failures.

describe('contracts/resource-domain (spec 028, T001)', () => {
  it('ResourceDomain is exactly the composer-domain vocabulary (FR-001)', () => {
    expectTypeOf<ResourceDomain>().toEqualTypeOf<
      'functions' | 'queues' | 'buckets' | 'containers' | 'gateways'
    >();
  });

  it('AppIdentity is a readonly { appId, artifactType } pair (D-1)', () => {
    expectTypeOf<AppIdentity>().toEqualTypeOf<{
      readonly appId: string;
      readonly artifactType: string;
    }>();
  });

  it('ARTIFACT_TYPE_DOMAIN_MAP is frozen with exactly the four FR-002 pairs', () => {
    expect(Object.isFrozen(ARTIFACT_TYPE_DOMAIN_MAP)).toBe(true);
    expect(ARTIFACT_TYPE_DOMAIN_MAP).toEqual({
      'ycforge:function': 'functions',
      'ycforge:docker-image': 'containers',
      'ycforge:frontend': 'buckets',
      'ycforge:api-gateway': 'gateways',
    });
  });

  it('every mapping VALUE is a composer ResourceDomain value (vocabulary, SC-006)', () => {
    const allowed = new Set<ResourceDomain>(['functions', 'queues', 'buckets', 'containers', 'gateways']);
    expect(Object.values(ARTIFACT_TYPE_DOMAIN_MAP).every((d) => allowed.has(d))).toBe(true);
  });

  it('artifactTypeToResourceDomain maps known types and returns undefined otherwise (FR-002)', () => {
    expect(artifactTypeToResourceDomain('ycforge:function')).toBe('functions');
    expect(artifactTypeToResourceDomain('ycforge:docker-image')).toBe('containers');
    expect(artifactTypeToResourceDomain('ycforge:frontend')).toBe('buckets');
    expect(artifactTypeToResourceDomain('ycforge:api-gateway')).toBe('gateways');
    expect(artifactTypeToResourceDomain('ycforge:queue')).toBeUndefined();
    expect(artifactTypeToResourceDomain('nestjs-function')).toBeUndefined();
  });

  it('artifactTypeToResourceDomain is a typed unary mapping (D-1)', () => {
    const domain: ResourceDomain | undefined = artifactTypeToResourceDomain('ycforge:function');
    expect(domain).toBe('functions');
  });
});
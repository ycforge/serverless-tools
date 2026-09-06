import { describe, expect, it } from 'vitest';

import { EXT_INVALID } from '../../src/contracts/index.js';
import { applyExtensions } from '../../src/extensions/apply.js';
import {
  IDL_DOMAIN_BY_TF_TYPE,
  IDL_SEGMENT_RE,
  createIdlIndex,
  idlFor,
} from '../../src/extensions/idl.js';
import {
  canonicalResources,
  functionResource,
  gatewayResource,
  makeExtensions,
  rule,
} from '../helpers/extensions-fixtures.js';

describe('idl (T015–T017)', () => {
  it('T015 IDL side-table + index from canonical resources (FR-006, Sc3/Sc10.3)', () => {
    expect(IDL_DOMAIN_BY_TF_TYPE).toEqual({
      yandex_function: 'functions',
      yandex_api_gateway: 'gateways',
    });
    expect(Object.isFrozen(IDL_DOMAIN_BY_TF_TYPE)).toBe(true);

    const resources = canonicalResources();
    const index = createIdlIndex(resources);

    expect(Array.from(index.byIdl.keys()).sort()).toEqual([
      'functions.analytics',
      'functions.user_service',
      'gateways.openapi',
    ]);
    expect(index.byIdl.get('functions.user_service')?.name).toBe('user_service');
    expect(index.byIdl.get('functions.analytics')?.name).toBe('analytics');
    expect(index.byIdl.get('gateways.openapi')?.name).toBe('openapi');
    expect(index.availableIdls).toEqual([
      'functions.analytics',
      'functions.user_service',
      'gateways.openapi',
    ]);
    // yandex_container.frontend is NOT addressable — not in the index, not an error
    expect(index.availableIdls.some((idl) => idl.includes('frontend'))).toBe(false);
    expect(index.duplicateIdls).toEqual([]);

    expect(idlFor(resources[0]!)).toBe('functions.user_service');
    expect(idlFor(resources[3]!)).toBeNull();
  });

  it('T016 IDL segment grammar (FR-004 grammar, Sc3)', () => {
    for (const ok of ['functions.user_service', 'gateways.openapi', 'a_1.b_2']) {
      expect(IDL_SEGMENT_RE.test(ok)).toBe(true);
    }
    for (const bad of [
      'functions',
      'functions.user_service.extra',
      'Functions.user_service',
      'functions.user-service',
      'functions/user_service',
      'functions..x',
      '.x',
      'x.',
      '',
    ]) {
      expect(IDL_SEGMENT_RE.test(bad)).toBe(false);
    }
    // grammatically valid but non-existent domain passes grammar (resolution-level, not structural)
    expect(IDL_SEGMENT_RE.test('containers.user_service')).toBe(true);
  });

  it('T017 duplicate IDL defensive + alphabetical availableIdls (FR-007, Sc10.1)', () => {
    const dupResources = [
      functionResource('user_service', { name: 'a' }),
      functionResource('user_service', { name: 'b' }),
    ];
    const result = applyExtensions(
      dupResources,
      makeExtensions([rule('functions.user_service', { tags: {} })]),
    );
    expect(result.kind).toBe('invalid');
    if (result.kind !== 'invalid') return;
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ code: EXT_INVALID });
    expect(result.errors[0]?.message).toMatch(/duplicate IDL functions\.user_service in generated model/);

    // availableIdls sorted regardless of input resource order
    const shuffled = [
      gatewayResource('openapi', {}),
      functionResource('user_service', {}),
      functionResource('analytics', {}),
    ];
    expect(createIdlIndex(shuffled).availableIdls).toEqual([
      'functions.analytics',
      'functions.user_service',
      'gateways.openapi',
    ]);
  });
});
import { describe, expect, it } from 'vitest';

import { OUT_INVALID_VALUE, OUT_UNRESOLVED_IDL } from '../../src/contracts/index.js';
import { createIdlIndex } from '../../src/extensions/idl.js';
import { DOMAIN_TO_TF_TYPE, resolveIdlReference } from '../../src/outputs/resolver.js';
import { canonicalResources } from '../helpers/outputs-fixtures.js';

// T014–T016: resolveIdlReference + DOMAIN_TO_TF_TYPE — IDL resolution of
// user output values (US-1/US-3/US-5, FR-006/007/017, quickstart Sc1/Sc8/Sc9/Sc12).

describe('resolveIdlReference + DOMAIN_TO_TF_TYPE (T014–T016)', () => {
  const index = createIdlIndex(canonicalResources());

  it('T014 reverse table derived from IDL_DOMAIN_BY_TF_TYPE (frozen); happy path → RAW tf address (FR-006, US-1, Sc1)', () => {
    expect(DOMAIN_TO_TF_TYPE['functions']).toBe('yandex_function');
    expect(DOMAIN_TO_TF_TYPE['gateways']).toBe('yandex_api_gateway');
    expect(Object.isFrozen(DOMAIN_TO_TF_TYPE)).toBe(true);

    const gateway = resolveIdlReference('gateways.openapi.domain', index);
    expect('id' in gateway).toBe(true);
    if ('id' in gateway) {
      expect(gateway.id).toBe('yandex_api_gateway.openapi.domain');
    }

    const func = resolveIdlReference('functions.user_service.id', index);
    expect('id' in func).toBe(true);
    if ('id' in func) {
      expect(func.id).toBe('yandex_function.user_service.id');
    }
  });

  it('T015 unresolved IDL → OUT_UNRESOLVED_IDL with ref + alphabetical availableIdls (FR-006/017, Sc8/Sc12)', () => {
    const badDomain = resolveIdlReference('databases.postgres.id', index);
    expect('error' in badDomain).toBe(true);
    if ('error' in badDomain) {
      expect(badDomain.error.code).toBe(OUT_UNRESOLVED_IDL);
      expect(badDomain.error.message).toContain('databases.postgres.id');
      expect(badDomain.error.message).toContain('functions.analytics');
      expect(badDomain.error.availableIdls).toEqual([
        'functions.analytics',
        'functions.user_service',
        'gateways.openapi',
      ]);
    }

    const container = resolveIdlReference('containers.user_service.id', index);
    expect('error' in container).toBe(true);
    if ('error' in container) {
      expect(container.error.code).toBe(OUT_UNRESOLVED_IDL);
    }

    const missingName = resolveIdlReference('functions.user_servivce.id', index);
    expect('error' in missingName).toBe(true);
    if ('error' in missingName) {
      expect(missingName.error.code).toBe(OUT_UNRESOLVED_IDL);
      expect(missingName.error.availableIdls).toEqual([
        'functions.analytics',
        'functions.user_service',
        'gateways.openapi',
      ]);
    }

    const external = resolveIdlReference('queues.events.qurl', index);
    expect('error' in external).toBe(true);
    if ('error' in external) {
      expect(external.error.code).toBe(OUT_UNRESOLVED_IDL);
      expect(external.error.message).toContain('queues.events.qurl');
    }
  });

  it('T016 grammar violations → OUT_INVALID_VALUE (ContractError via parseResourceReference; FR-007/016, Sc9)', () => {
    for (const bad of [
      'Functions.User_Service.Id',
      'functions.user_service',
      'a.b.c.d',
      'func-ions.user_service.id',
      'functions/user_service/id',
      '',
      '${yandex_function.foo.id}',
    ]) {
      const result = resolveIdlReference(bad, index);
      expect('error' in result, `expected OUT_INVALID_VALUE for ${JSON.stringify(bad)}`).toBe(true);
      if ('error' in result) {
        expect(result.error.code).toBe(OUT_INVALID_VALUE);
        if (bad !== '') expect(result.error.message).toContain(bad);
      }
    }
  });
});
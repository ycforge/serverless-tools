import { describe, expect, it } from 'vitest';

import { EXT_DUPLICATE_TARGET, EXT_UNRESOLVED_TARGET } from '../../src/contracts/index.js';
import { applyExtensions } from '../../src/extensions/apply.js';
import {
  canonicalResources,
  makeExtensions,
  rule,
} from '../helpers/extensions-fixtures.js';

describe('applyExtensions (T021–T025)', () => {
  it('T021 single-target patch happy path (US-1 AC1, FR-008/010/012, Sc1)', () => {
    const resources = canonicalResources();
    const result = applyExtensions(
      resources,
      makeExtensions([
        rule('functions.user_service', {
          environment: { CUSTOM_VAR: 'value' },
          execution_timeout: '30s',
          service_account_id: '${yandex_iam_service_account.custom.id}',
        }),
      ]),
    );

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.resources).toHaveLength(4);

    const patched = result.resources[0]!;
    expect(patched).not.toBe(resources[0]);
    expect(patched).toMatchObject({ kind: 'resource', type: 'yandex_function', name: 'user_service' });
    expect(patched.configuration).toMatchObject({
      environment: { NODE_ENV: 'production', CUSTOM_VAR: 'value' },
      execution_timeout: '30s',
      service_account_id: '${yandex_iam_service_account.custom.id}',
    });

    // input untouched
    expect(resources[0]?.configuration).toEqual({
      name: 'user-service',
      runtime: 'nodejs18',
      entrypoint: 'main.handler',
      environment: { NODE_ENV: 'production' },
      execution_timeout: '5s',
    });
  });

  it('T022 multiple targets in file order + untouched by reference + {{$ENV}} passthrough (US-1/US-2, FR-009/011, Sc2/Sc5.2)', () => {
    const resources = canonicalResources();
    const result = applyExtensions(
      resources,
      makeExtensions([
        rule('functions.user_service', {
          environment: { EXTRA: '{{$ENV}}' },
        }),
        rule('gateways.openapi', {
          custom_domains: [{ domain_id: '${yandex_api_gateway_domain.main.id}' }],
        }),
      ]),
    );

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;

    const userService = result.resources.find((r) => r.name === 'user_service')!;
    expect(userService.configuration).toMatchObject({
      environment: { NODE_ENV: 'production', EXTRA: '{{$ENV}}' },
    });

    const openapi = result.resources.find((r) => r.name === 'openapi')!;
    expect(openapi.configuration).toEqual({
      name: 'openapi',
      custom_domains: [{ domain_id: '${yandex_api_gateway_domain.main.id}' }],
    });

    // untouched resources (analytics, frontend) reused by reference
    expect(result.resources).toContain(resources[1]);
    expect(result.resources).toContain(resources[3]);
    expect(result.resources).toHaveLength(4);
  });

  it('T023 duplicate target → EXT_DUPLICATE_TARGET + all-or-nothing (US-4 AC1/AC2, FR-005, Sc4)', () => {
    const resources = canonicalResources();
    const snapshot = JSON.stringify(resources);
    const result = applyExtensions(
      resources,
      makeExtensions([
        rule('functions.user_service', { execution_timeout: '30s' }),
        rule('functions.user_service', { environment: { A: '1' } }),
        rule('gateways.openapi', { custom_domains: [] }),
      ]),
    );

    expect(result.kind).toBe('invalid');
    if (result.kind !== 'invalid') return;
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({
      code: EXT_DUPLICATE_TARGET,
      target: 'functions.user_service',
    });
    // no EXT_UNRESOLVED_TARGET duplication for the duplicate target
    expect(result.errors.some((e) => e.code === EXT_UNRESOLVED_TARGET)).toBe(false);

    // all-or-nothing: gateways.openapi NOT patched, inputs untouched
    expect(JSON.stringify(resources)).toBe(snapshot);
  });

  it('T024 unresolved target → EXT_UNRESOLVED_TARGET + alphabetical availableIdls + collect-all (US-3, FR-007, Sc3)', () => {
    const resources = canonicalResources();
    const snapshot = JSON.stringify(resources);
    const result = applyExtensions(
      resources,
      makeExtensions([
        rule('functions.user_servivce', { execution_timeout: '30s' }),
        rule('functions.user_service', { tags: { main: 'http' } }),
      ]),
    );

    expect(result.kind).toBe('invalid');
    if (result.kind !== 'invalid') return;
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({
      code: EXT_UNRESOLVED_TARGET,
      target: 'functions.user_servivce',
      availableIdls: ['functions.analytics', 'functions.user_service', 'gateways.openapi'],
    });
    const message = result.errors[0]?.message ?? '';
    expect(message).toContain('functions.user_servivce');
    expect(message.indexOf('functions.analytics')).toBeGreaterThan(-1);
    expect(message.indexOf('functions.analytics')).toBeLessThan(message.indexOf('functions.user_service'));
    expect(message.indexOf('functions.user_service')).toBeLessThan(message.indexOf('gateways.openapi'));

    // all-or-nothing: valid second target NOT applied
    expect(JSON.stringify(resources)).toBe(snapshot);

    // collect-all: multiple unresolved collected in file order
    const multi = applyExtensions(
      resources,
      makeExtensions([rule('functions.missing1', {}), rule('gateways.missing2', {})]),
    );
    expect(multi.kind).toBe('invalid');
    if (multi.kind !== 'invalid') return;
    expect(multi.errors).toHaveLength(2);
    expect(multi.errors.map((e) => e.target)).toEqual(['functions.missing1', 'gateways.missing2']);

    // grammatically valid but non-existent domain → resolution-level error
    const containerDomain = applyExtensions(
      resources,
      makeExtensions([rule('containers.user_service', {})]),
    );
    expect(containerDomain.kind).toBe('invalid');
    if (containerDomain.kind !== 'invalid') return;
    expect(containerDomain.errors[0]?.code).toBe(EXT_UNRESOLVED_TARGET);
    expect(containerDomain.errors[0]?.target).toBe('containers.user_service');
  });

  it('T025 determinism + empty rules + empty patch + out-of-table resource (SC-001, US-6/US-8, FR-009/013, Sc6/Sc8)', () => {
    const resources = canonicalResources();
    const yaml = makeExtensions([rule('functions.user_service', { execution_timeout: '30s' })]);
    const before = JSON.stringify(resources);

    const a = applyExtensions(resources, yaml);
    const b = applyExtensions(resources, yaml);
    expect(a).toEqual(b);
    if (a.kind === 'ok' && b.kind === 'ok') {
      expect(a.resources).toEqual(b.resources);
    }

    // extensions: [] → identity transform (US-8 AC2, FR-013)
    const identity = applyExtensions(resources, makeExtensions([]));
    expect(identity.kind).toBe('ok');
    if (identity.kind !== 'ok') return;
    expect(identity.resources).toHaveLength(resources.length);
    resources.forEach((r, i) => expect(identity.resources[i]).toBe(r));

    // rule with patch: {} → no-op, configuration structurally equal (US-8 AC1)
    const noOp = applyExtensions(resources, makeExtensions([rule('functions.user_service', {})]));
    expect(noOp.kind).toBe('ok');
    if (noOp.kind !== 'ok') return;
    const noOpUser = noOp.resources.find((r) => r.name === 'user_service')!;
    expect(noOpUser.configuration).toEqual(resources[0]!.configuration);

    // yandex_container.frontend (outside table) present unchanged in ok result
    expect(noOp.resources.find((r) => r.name === 'frontend')).toBe(resources[3]);

    // inputs never mutated across calls
    expect(JSON.stringify(resources)).toBe(before);
  });
});
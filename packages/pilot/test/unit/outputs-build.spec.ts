import { describe, expect, it } from 'vitest';

import {
  OUT_DUPLICATE_NAME,
  OUT_INVALID,
  OUT_INVALID_AUTO_PREFIX,
  OUT_INVALID_VALUE,
  OUT_RESERVED_PREFIX,
  OUT_UNRESOLVED_IDL,
} from '../../src/contracts/index.js';
import { buildOutputs } from '../../src/outputs/build.js';
import { parseOutputsYaml } from '../../src/outputs/outputs-yaml.js';
import {
  canonicalOutputsYaml,
  canonicalResources,
  makeOutputsYaml,
  outputsYamlText,
} from '../helpers/outputs-fixtures.js';

const FILENAME = '99-ycsf-outputs.tf.json';

function parsed(result: ReturnType<typeof buildOutputs>): Record<string, { value: string; description?: string }> {
  if (result.kind !== 'ok') throw new Error(`expected ok, got invalid (${result.errors.length} errors)`);
  return (JSON.parse(result.file.content) as { output: Record<string, { value: string; description?: string }> })
    .output;
}

// T017–T028: buildOutputs — two-phase validate-first collect-all + deterministic
// assembly (US-1..US-5, FR-005/008/009/010/011/012/013/014/015/016, quickstart Sc1–Sc14).

describe('buildOutputs (T017–T028)', () => {
  it('T017 happy path (US-1): two user outputs → ok, 99- filename, ${...} values, sorted keys (FR-006/010/011/012, Sc1)', () => {
    const result = buildOutputs({
      outputsYaml: canonicalOutputsYaml(),
      materializerOutputs: new Map(),
      resources: canonicalResources(),
    });
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.file.filename).toBe(FILENAME);

    const output = parsed(result);
    expect(Object.keys(output)).toEqual(['frontend_api_url', 'user_service_function_id']);
    expect(output['frontend_api_url']).toEqual({
      value: '${yandex_api_gateway.openapi.domain}',
      description: 'Public API endpoint',
    });
    expect(output['user_service_function_id']).toEqual({
      value: '${yandex_function.user_service.id}',
      description: 'Cloud function ID',
    });
  });

  it('T018 description omit + empty-string preserve (FR-013, US-1 AC3, Sc2)', () => {
    const omit = buildOutputs({
      outputsYaml: makeOutputsYaml({ only_value: { value: 'functions.user_service.id' } }),
      materializerOutputs: new Map(),
      resources: canonicalResources(),
    });
    expect(omit.kind).toBe('ok');
    if (omit.kind !== 'ok') return;
    expect(Object.keys(parsed(omit)['only_value'] ?? {})).toEqual(['value']);

    const empty = buildOutputs({
      outputsYaml: makeOutputsYaml({ empty_desc: { value: 'functions.user_service.id', description: '' } }),
      materializerOutputs: new Map(),
      resources: canonicalResources(),
    });
    expect(empty.kind).toBe('ok');
    if (empty.kind !== 'ok') return;
    expect(parsed(empty)['empty_desc']).toEqual({
      description: '',
      value: '${yandex_function.user_service.id}',
    });
  });

  it('T019 merge user + auto outputs (US-2): both present, both wrapped, keys sorted (FR-008/010/011/012, Sc3)', () => {
    const result = buildOutputs({
      outputsYaml: makeOutputsYaml({
        frontend_api_url: { value: 'gateways.openapi.domain', description: 'Public API endpoint' },
      }),
      materializerOutputs: new Map([
        [
          'ycsf_function_user_service_id',
          { value: 'yandex_function.user_service.id', description: 'serverless-tools generated: functions.user_service.id' },
        ],
      ]),
      resources: canonicalResources(),
    });
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;

    const output = parsed(result);
    expect(Object.keys(output)).toEqual(['frontend_api_url', 'ycsf_function_user_service_id']);
    expect(output['frontend_api_url']?.value).toBe('${yandex_api_gateway.openapi.domain}');
    expect(output['ycsf_function_user_service_id']?.value).toBe('${yandex_function.user_service.id}');
    expect(output['ycsf_function_user_service_id']?.description).toBe(
      'serverless-tools generated: functions.user_service.id',
    );
  });

  it('T020 auto output without ycsf_ prefix is VALID under D-3, key lands in merged file (US-2 AC2, FR-008, Sc4)', () => {
    const result = buildOutputs({
      outputsYaml: makeOutputsYaml({}),
      materializerOutputs: new Map([
        ['function_user_service_id', { value: 'yandex_function.user_service.id' }],
      ]),
      resources: canonicalResources(),
    });
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    const output = parsed(result);
    expect(Object.keys(output)).toEqual(['function_user_service_id']);
    expect(output['function_user_service_id']?.value).toBe('${yandex_function.user_service.id}');
  });

  it('T021 empty outputs → stable { "output": {} }, filename 99- (US-2 AC3, US-5 AC1, FR-014, Sc5)', () => {
    const result = buildOutputs({
      outputsYaml: makeOutputsYaml({}),
      materializerOutputs: new Map(),
      resources: canonicalResources(),
    });
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.file.content).toBe('{"output":{}}');
    expect(result.file.filename).toBe(FILENAME);
  });

  it('T022 duplicate output names are rejected at the parse gate, never silently merged (US-3 AC1, FR-009, Sc6)', () => {
    const dupYsml = parseOutputsYaml(
      outputsYamlText(
        '  api_url:\n    value: "functions.user_service.id"\n  api_url:\n    value: "functions.analytics.id"\n',
      ),
      '.ycsf/outputs.yaml',
    );
    expect(dupYsml.kind).toBe('invalid');
    if (dupYsml.kind !== 'invalid') return;
    expect(dupYsml.errors.some((e) => e.code === OUT_INVALID)).toBe(true);

    const single = buildOutputs({
      outputsYaml: makeOutputsYaml({ api_url: { value: 'functions.user_service.id' } }),
      materializerOutputs: new Map(),
      resources: canonicalResources(),
    });
    expect(single.kind).toBe('ok');
    if (single.kind !== 'ok') return;
    expect(Object.keys(parsed(single))).toEqual(['api_url']);
  });

  it('T023 reserved prefix → OUT_RESERVED_PREFIX with name (US-3 AC2, FR-005, Constitution V, Sc7)', () => {
    const result = buildOutputs({
      outputsYaml: makeOutputsYaml({ ycsf_function_id: { value: 'functions.user_service.id' } }),
      materializerOutputs: new Map(),
      resources: canonicalResources(),
    });
    expect(result.kind).toBe('invalid');
    if (result.kind !== 'invalid') return;
    const err = result.errors.find((e) => e.code === OUT_RESERVED_PREFIX);
    expect(err).toBeDefined();
    expect(err?.name).toBe('ycsf_function_id');
  });

  it('T024 unresolved IDL → OUT_UNRESOLVED_IDL; message + alphabetical availableIdls; all-or-nothing (US-3 AC3, FR-006/015, Sc8)', () => {
    const result = buildOutputs({
      outputsYaml: makeOutputsYaml({
        bad: { value: 'databases.postgres.id' },
        good: { value: 'functions.user_service.id' },
      }),
      materializerOutputs: new Map(),
      resources: canonicalResources(),
    });
    expect(result.kind).toBe('invalid');
    if (result.kind !== 'invalid') return;
    const unresolved = result.errors.filter((e) => e.code === OUT_UNRESOLVED_IDL);
    expect(unresolved).toHaveLength(1);
    expect(unresolved[0]?.name).toBe('bad');
    expect(unresolved[0]?.message).toContain('databases.postgres.id');
    expect(unresolved[0]?.message).toContain('functions.analytics');
    expect(unresolved[0]?.availableIdls).toEqual([
      'functions.analytics',
      'functions.user_service',
      'gateways.openapi',
    ]);
  });

  it('T025 invalid grammar value → OUT_INVALID_VALUE; auto outputs ignored (all-or-nothing) (US-5 AC4, FR-007/016, Sc9)', () => {
    const result = buildOutputs({
      outputsYaml: makeOutputsYaml({ bad: { value: 'Functions.User_Service.Id' } }),
      materializerOutputs: new Map([
        ['ycsf_ok', { value: 'yandex_function.user_service.id' }],
      ]),
      resources: canonicalResources(),
    });
    expect(result.kind).toBe('invalid');
    if (result.kind !== 'invalid') return;
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]?.code).toBe(OUT_INVALID_VALUE);
  });

  it('T026 determinism: identical inputs → byte-identical content (US-4 AC1, FR-012/019, SC-001, Sc13)', () => {
    const input = {
      outputsYaml: canonicalOutputsYaml(),
      materializerOutputs: new Map([
        ['ycsf_function_user_service_id', { value: 'yandex_function.user_service.id' }],
      ]),
      resources: canonicalResources(),
    };
    const first = buildOutputs(input);
    const second = buildOutputs(input);
    expect(first.kind).toBe('ok');
    expect(second.kind).toBe('ok');
    if (first.kind !== 'ok' || second.kind !== 'ok') return;
    expect(first.file.content).toBe(second.file.content);
  });

  it('T027 mixed errors collect-all all-or-nothing; fix → ok (US-3, FR-015/009, Sc14)', () => {
    const bad = buildOutputs({
      outputsYaml: makeOutputsYaml({
        ycsf_reserved: { value: 'functions.user_service.id' },
        unresolved: { value: 'databases.postgres.id' },
        bad_grammar: { value: 'Functions.User_Service.Id' },
      }),
      materializerOutputs: new Map(),
      resources: canonicalResources(),
    });
    expect(bad.kind).toBe('invalid');
    if (bad.kind !== 'invalid') return;
    const codes = new Set(bad.errors.map((e) => e.code));
    expect(codes.has(OUT_RESERVED_PREFIX)).toBe(true);
    expect(codes.has(OUT_UNRESOLVED_IDL)).toBe(true);
    expect(codes.has(OUT_INVALID_VALUE)).toBe(true);
    expect(bad.errors.length).toBeGreaterThanOrEqual(3);

    const fixed = buildOutputs({
      outputsYaml: makeOutputsYaml({ api_url: { value: 'functions.user_service.id' } }),
      materializerOutputs: new Map(),
      resources: canonicalResources(),
    });
    expect(fixed.kind).toBe('ok');
  });

  it('T028 priority/determinism + immutable inputs (FR-008/015, research 2, Sc4/Sc14)', () => {
    const outputsYaml = makeOutputsYaml({ bad_grammar: { value: 'Functions.User_Service.Id' } });
    const materializerOutputs = new Map([
      ['function_user_service_id', { value: 'yandex_function.user_service.id', description: 'd' }],
    ]);
    const resources = canonicalResources();

    const snapshot = JSON.stringify({
      outputsYaml,
      materializerOutputs: [...materializerOutputs.entries()],
      resources,
    });

    const result = buildOutputs({ outputsYaml, materializerOutputs, resources });
    expect(result.kind).toBe('invalid');
    if (result.kind !== 'invalid') return;
    expect(result.errors.map((e) => e.code)).toEqual([OUT_INVALID_VALUE]);

    const after = JSON.stringify({
      outputsYaml,
      materializerOutputs: [...materializerOutputs.entries()],
      resources,
    });
    expect(after).toBe(snapshot);
  });

  it('T021 auto output with invalid grammar (UpperCase) → OUT_INVALID, not prefix error (FR-008, D-3)', () => {
    const result = buildOutputs({
      outputsYaml: makeOutputsYaml({}),
      materializerOutputs: new Map([
        ['User_Service_Function_Id', { value: 'yandex_function.user_service.id' }],
      ]),
      resources: canonicalResources(),
    });
    expect(result.kind).toBe('invalid');
    if (result.kind !== 'invalid') return;
    expect(result.errors.map((e) => e.code)).toEqual([OUT_INVALID]);
    expect(result.errors[0]?.name).toBe('User_Service_Function_Id');
  });

  it('T021 auto name colliding with a user output → OUT_DUPLICATE_NAME, not a silent user-wins merge (edge §8, FR-013)', () => {
    const result = buildOutputs({
      outputsYaml: makeOutputsYaml({ api_url: { value: 'functions.user_service.id' } }),
      materializerOutputs: new Map([
        ['api_url', { value: 'yandex_api_gateway.openapi.domain' }],
      ]),
      resources: canonicalResources(),
    });
    expect(result.kind).toBe('invalid');
    if (result.kind !== 'invalid') return;
    expect(result.errors.map((e) => e.code)).toEqual([OUT_DUPLICATE_NAME]);
    expect(result.errors[0]?.name).toBe('api_url');
  });

  it('T021 frozen-guard: OUT_INVALID_AUTO_PREFIX still exported and typed as literal (SC-007, FR-016)', () => {
    const code: typeof OUT_INVALID_AUTO_PREFIX = 'OUT_INVALID_AUTO_PREFIX';
    expect(code.length).toBeGreaterThan(0);
  });
});
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  OUT_INVALID,
  OUT_INVALID_AUTO_PREFIX,
  OUT_INVALID_VALUE,
  OUT_RESERVED_PREFIX,
  OUT_UNRESOLVED_IDL,
  OUT_VERSION,
} from '../../src/contracts/index.js';
import { buildOutputs, dispatch, loadOutputs, writeGeneratedTerraform } from '../../src/index.js';
import { createOutputBuilder, type OutputBuilderWithCollection } from '../../src/materialize/context.js';
import { appsModel, makeMaterializer, makeRegistry, materializerEntry } from '../helpers/materialize-fixtures.js';
import {
  canonicalResources,
  functionResource,
  makeOutputsYaml,
  outputsYamlText,
  writeOutputsYaml,
} from '../helpers/outputs-fixtures.js';
import { createTempProject, removeTempProject, type TempProject } from '../helpers/temp-project.js';

const FILENAME = '99-ycsf-outputs.tf.json';
const CANONICAL = canonicalResources();

function parsed(result: ReturnType<typeof buildOutputs>): Record<string, { value: string; description?: string }> {
  if (result.kind !== 'ok') throw new Error('expected ok');
  return (JSON.parse(result.file.content) as { output: Record<string, { value: string; description?: string }> })
    .output;
}

/** Scope-016 fixture materializer: declares one `ycsf_` output (pattern 014). */
function outputDeclaringMaterializer(): ReturnType<typeof makeMaterializer> {
  return makeMaterializer('outputs-mat', {
    supportedTypes: ['nestjs-function'],
    materialize: (a, ctx) => {
      ctx.output.declare('ycsf_function_user_service_id', {
        value: 'yandex_function.user_service.id',
        description: 'serverless-tools generated: functions.user_service.id',
      });
      return { kind: 'resource', type: 'yandex_function', name: a.id, configuration: { name: a.id } };
    },
  });
}

// Phase 4: quickstart.md Sc1–Sc15 (T080–T094) + perf smoke (T104) against the
// real loadOutputs/buildOutputs/dispatch/writeGeneratedTerraform.

describe('outputs quickstart (Sc1–Sc15)', () => {
  const projects: TempProject[] = [];

  afterEach(() => {
    for (const project of projects.splice(0)) removeTempProject(project);
  });

  function tempProject(files: Record<string, string> = {}): TempProject {
    const project = createTempProject(files);
    projects.push(project);
    return project;
  }

  it('Sc1: happy path — user outputs → ${...} terraform expressions, sorted keys, inputs untouched (US-1, FR-006/010/011/012)', () => {
    const outputsYaml = makeOutputsYaml({
      frontend_api_url: { value: 'gateways.openapi.domain', description: 'Public API endpoint' },
      user_service_function_id: { value: 'functions.user_service.id', description: 'Cloud function ID' },
    });
    const snapshot = JSON.stringify({ outputsYaml, resources: CANONICAL });

    const result = buildOutputs({ outputsYaml, materializerOutputs: new Map(), resources: CANONICAL });
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.file.filename).toBe(FILENAME);
    expect(() => JSON.parse(result.file.content)).not.toThrow();

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
    expect(JSON.stringify({ outputsYaml, resources: CANONICAL })).toBe(snapshot);
  });

  it('Sc2: description omit + empty-string preserve (US-1 AC3, FR-013)', () => {
    const omit = buildOutputs({
      outputsYaml: makeOutputsYaml({ only_value: { value: 'functions.user_service.id' } }),
      materializerOutputs: new Map(),
      resources: CANONICAL,
    });
    expect(omit.kind).toBe('ok');
    if (omit.kind !== 'ok') return;
    expect(Object.keys(parsed(omit)['only_value'] ?? {})).toEqual(['value']);

    const empty = buildOutputs({
      outputsYaml: makeOutputsYaml({
        empty_desc: { value: 'functions.user_service.id', description: '' },
      }),
      materializerOutputs: new Map(),
      resources: CANONICAL,
    });
    expect(empty.kind).toBe('ok');
    if (empty.kind !== 'ok') return;
    expect(parsed(empty)['empty_desc']).toEqual({
      description: '',
      value: '${yandex_function.user_service.id}',
    });
  });

  it('Sc3: auto-generated ycsf_ outputs merge with user outputs (US-2, FR-008/010/011/012)', () => {
    const builder = createOutputBuilder();
    builder.declare('ycsf_function_user_service_id', {
      value: 'yandex_function.user_service.id',
      description: 'serverless-tools generated: functions.user_service.id',
    });

    const result = buildOutputs({
      outputsYaml: makeOutputsYaml({
        frontend_api_url: { value: 'gateways.openapi.domain', description: 'Public API endpoint' },
      }),
      materializerOutputs: builder.declared,
      resources: CANONICAL,
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

  it('Sc4: auto output without ycsf_ prefix → OUT_INVALID_AUTO_PREFIX (US-2 AC2, FR-008)', () => {
    const builder = createOutputBuilder();
    builder.declare('function_user_service_id', { value: 'yandex_function.user_service.id' });

    const result = buildOutputs({
      outputsYaml: makeOutputsYaml({}),
      materializerOutputs: builder.declared,
      resources: CANONICAL,
    });
    expect(result.kind).toBe('invalid');
    if (result.kind !== 'invalid') return;
    expect(result.errors.some((e) => e.code === OUT_INVALID_AUTO_PREFIX)).toBe(true);
  });

  it('Sc5: empty outputs → stable {"output":{}} (US-2 AC3, US-5 AC1, FR-014)', () => {
    const result = buildOutputs({
      outputsYaml: makeOutputsYaml({}),
      materializerOutputs: new Map(),
      resources: CANONICAL,
    });
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.file.content).toBe('{"output":{}}');
    expect(result.file.filename).toBe(FILENAME);
  });

  it('Sc6: duplicate output names rejected at the parse gate — never silently merged (US-3 AC1, FR-009)', () => {
    const dupFile = tempProject();
    writeOutputsYaml(
      dupFile,
      outputsYamlText(
        '  api_url:\n    value: "functions.user_service.id"\n  api_url:\n    value: "functions.analytics.id"\n',
      ),
    );
    const loaded = loadOutputs(dupFile.root);
    expect(loaded.kind).toBe('invalid');
    if (loaded.kind !== 'invalid') return;
    expect(loaded.errors.some((e) => e.code === OUT_INVALID)).toBe(true);
  });

  it('Sc7: user output with ycsf_ prefix → OUT_RESERVED_PREFIX (US-3 AC2, FR-005)', () => {
    const result = buildOutputs({
      outputsYaml: makeOutputsYaml({ ycsf_function_id: { value: 'functions.user_service.id' } }),
      materializerOutputs: new Map(),
      resources: CANONICAL,
    });
    expect(result.kind).toBe('invalid');
    if (result.kind !== 'invalid') return;
    const err = result.errors.find((e) => e.code === OUT_RESERVED_PREFIX);
    expect(err?.name).toBe('ycsf_function_id');
  });

  it('Sc8: unresolved IDL → OUT_UNRESOLVED_IDL with alphabetical availableIdls (US-3, FR-006/017)', () => {
    const missingDomain = buildOutputs({
      outputsYaml: makeOutputsYaml({ bad: { value: 'databases.postgres.id' } }),
      materializerOutputs: new Map(),
      resources: CANONICAL,
    });
    expect(missingDomain.kind).toBe('invalid');
    if (missingDomain.kind !== 'invalid') return;
    const err = missingDomain.errors.find((e) => e.code === OUT_UNRESOLVED_IDL);
    expect(err?.message).toContain('databases.postgres.id');
    expect(err?.message).toContain('functions.analytics');
    expect(err?.availableIdls).toEqual([
      'functions.analytics',
      'functions.user_service',
      'gateways.openapi',
    ]);

    const missingName = buildOutputs({
      outputsYaml: makeOutputsYaml({ bad: { value: 'functions.user_servivce.id' } }),
      materializerOutputs: new Map(),
      resources: CANONICAL,
    });
    expect(missingName.kind).toBe('invalid');
    if (missingName.kind === 'invalid') {
      expect(missingName.errors.some((e) => e.code === OUT_UNRESOLVED_IDL)).toBe(true);
    }
  });

  it('Sc9: invalid value grammar + ${...} not passed through → OUT_INVALID_VALUE (US-5 AC4, FR-007/016)', () => {
    for (const value of ['Functions.User_Service.Id', '${yandex_function.foo.id}']) {
      const result = buildOutputs({
        outputsYaml: makeOutputsYaml({ bad: { value } }),
        materializerOutputs: new Map(),
        resources: CANONICAL,
      });
      expect(result.kind, `expected invalid for ${value}`).toBe('invalid');
      if (result.kind === 'invalid') {
        expect(result.errors.some((e) => e.code === OUT_INVALID_VALUE)).toBe(true);
      }
    }
  });

  it('Sc10: loadOutputs version/structure errors per quickstart table (US-3 AC4, FR-003/004)', () => {
    const cases: readonly [string, string, string][] = [
      ['version-2', 'version: 2\noutputs: {}\n', OUT_VERSION],
      ['missing-outputs', 'version: 1\n', OUT_INVALID],
      ['outputs-scalar', 'version: 1\noutputs: "not-a-mapping"\n', OUT_INVALID],
      ['value-not-string', outputsYamlText('  a:\n    value: 123\n'), OUT_INVALID],
      ['unknown-top-key', 'version: 1\nfoobar: 1\noutputs: {}\n', OUT_INVALID],
      ['dup-key', 'version: 1\noutputs:\n  a:\n    value: "x"\n  a:\n    value: "y"\n', OUT_INVALID],
    ];
    for (const [name, yaml, code] of cases) {
      const project = tempProject();
      writeOutputsYaml(project, yaml);
      const result = loadOutputs(project.root);
      expect(result.kind, name).toBe('invalid');
      if (result.kind === 'invalid') {
        const codes = result.errors.map((e) => e.code);
        expect(codes, name).toContain(code);
      }
    }

    const multi = tempProject();
    writeOutputsYaml(multi, 'version: 1\nfoobar: 1\noutputs:\n  a:\n    value: 123\n');
    const multiResult = loadOutputs(multi.root);
    expect(multiResult.kind).toBe('invalid');
    if (multiResult.kind === 'invalid') {
      expect(multiResult.errors.filter((e) => e.code === OUT_INVALID).length).toBeGreaterThanOrEqual(2);
    }
  });

  it('Sc11: missing .ycsf/outputs.yaml → loadOutputs throws OUT_MISSING_FILE (US-5 AC2, FR-002)', () => {
    const project = tempProject();
    let thrown: unknown;
    try {
      loadOutputs(project.root);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(Error);
    if (thrown instanceof Error) {
      expect(thrown.message).toMatch(/OUT_MISSING_FILE/);
      expect(thrown.message).toMatch(/missing \.ycsf\/outputs\.yaml/);
    }
  });

  it('Sc12: external resource reference → OUT_UNRESOLVED_IDL (US-5 AC3, FR-017)', () => {
    const result = buildOutputs({
      outputsYaml: makeOutputsYaml({ queue_url: { value: 'queues.events.qurl' } }),
      materializerOutputs: new Map(),
      resources: CANONICAL,
    });
    expect(result.kind).toBe('invalid');
    if (result.kind !== 'invalid') return;
    expect(result.errors.some((e) => e.code === OUT_UNRESOLVED_IDL)).toBe(true);
  });

  it('Sc13: two identical runs → byte-identical determinism; inputs immutable (US-4, SC-001)', () => {
    const outputsYaml = makeOutputsYaml({
      frontend_api_url: { value: 'gateways.openapi.domain', description: 'Public API endpoint' },
      user_service_function_id: { value: 'functions.user_service.id' },
    });
    const materializerOutputs = new Map<string, { value: string; description?: string }>([
      ['ycsf_function_user_service_id', { value: 'yandex_function.user_service.id', description: 'gen' }],
    ]);
    const snapshot = JSON.stringify({ outputsYaml, materializerOutputs: [...materializerOutputs], resources: CANONICAL });

    const first = buildOutputs({ outputsYaml, materializerOutputs, resources: CANONICAL });
    const second = buildOutputs({ outputsYaml, materializerOutputs, resources: CANONICAL });
    expect(first.kind).toBe('ok');
    expect(second.kind).toBe('ok');
    if (first.kind !== 'ok' || second.kind !== 'ok') return;
    expect(first.file.content).toBe(second.file.content);
    expect(JSON.stringify({ outputsYaml, materializerOutputs: [...materializerOutputs], resources: CANONICAL })).toBe(snapshot);
  });

  it('Sc14: mixed errors collect-all all-or-nothing (US-3, FR-009/015)', () => {
    const result = buildOutputs({
      outputsYaml: makeOutputsYaml({
        ycsf_reserved: { value: 'functions.user_service.id' },
        unresolved: { value: 'databases.postgres.id' },
        bad_grammar: { value: 'Functions.User_Service.Id' },
      }),
      materializerOutputs: new Map(),
      resources: CANONICAL,
    });
    expect(result.kind).toBe('invalid');
    if (result.kind !== 'invalid') return;
    const codes = new Set(result.errors.map((e) => e.code));
    expect(codes.has(OUT_RESERVED_PREFIX)).toBe(true);
    expect(codes.has(OUT_UNRESOLVED_IDL)).toBe(true);
    expect(codes.has(OUT_INVALID_VALUE)).toBe(true);
  });

  it('Sc15: dispatch no longer emits outputs file; buildOutputs generates 99-; orphan removes stale 00- (SC-007, FR-020)', async () => {
    const project = tempProject({
      '.ycsf/apps.yaml': `version: 1
apps:
  user_service: { source_path: user_service, builder: nestjs-function }
`,
      'infra/custom.tf': '# user\nresource "yandex_vpc_network" "net" {}\n',
      'infra/00-ycsf-outputs.tf.json': '{"stale":true}',
      'infra/user_service.ycsf.tf.json': '{"stale":true}',
    });

    const model = appsModel(`version: 1
apps:
  user_service: { source_path: user_service, builder: nestjs-function }
`);
    const result = await dispatch(model, makeRegistry([materializerEntry(outputDeclaringMaterializer())]));
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.generatedFiles.map((f) => f.filename)).toEqual(['user_service.ycsf.tf.json']);

    const infraDir = join(project.root, 'infra');
    await writeGeneratedTerraform(infraDir, result.generatedFiles);
    expect(existsSync(join(infraDir, '00-ycsf-outputs.tf.json'))).toBe(false);
    expect(existsSync(join(infraDir, 'user_service.ycsf.tf.json'))).toBe(true);
    expect(readFileSync(join(infraDir, 'custom.tf'), 'utf8')).toBe(
      '# user\nresource "yandex_vpc_network" "net" {}\n',
    );

    const builder: OutputBuilderWithCollection = createOutputBuilder();
    builder.declare('ycsf_function_user_service_id', {
      value: 'yandex_function.user_service.id',
      description: 'serverless-tools generated: functions.user_service.id',
    });
    const built = buildOutputs({
      outputsYaml: makeOutputsYaml({}),
      materializerOutputs: builder.declared,
      resources: result.resources,
    });
    expect(built.kind).toBe('ok');
    if (built.kind !== 'ok') return;
    expect(built.file.filename).toBe(FILENAME);
    const output = parsed(built);
    expect(output['ycsf_function_user_service_id']?.value).toBe('${yandex_function.user_service.id}');
  });

  it('perf smoke: 20 resources × 10 user outputs build in ms-scale (SC-001)', () => {
    const resources = Array.from({ length: 20 }, (_, i) => functionResource(`fn${String(i).padStart(2, '0')}`));
    const outputs: Record<string, { value: string }> = {};
    for (let i = 0; i < 10; i += 1) {
      outputs[`out_${String(i).padStart(2, '0')}`] = { value: `functions.fn${String(i).padStart(2, '0')}.id` };
    }

    const start = Date.now();
    const result = buildOutputs({
      outputsYaml: makeOutputsYaml(outputs),
      materializerOutputs: new Map(),
      resources,
    });
    const elapsed = Date.now() - start;

    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(Object.keys(parsed(result))).toHaveLength(10);
    }
    expect(elapsed).toBeLessThan(5000);
  });
});
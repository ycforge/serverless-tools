import { describe, expect, it } from 'vitest';

import { OUT_INVALID, OUT_VERSION } from '../../src/contracts/index.js';
import { parseOutputsYaml } from '../../src/outputs/outputs-yaml.js';
import { canonicalOutputsYamlText, outputsYamlText } from '../helpers/outputs-fixtures.js';

const FILE = '.ycsf/outputs.yaml';

function expectInvalid(result: ReturnType<typeof parseOutputsYaml>): void {
  expect(result.kind).toBe('invalid');
}

// T010–T013: parseOutputsYaml — `.ycsf/outputs.yaml` parse gate + structure
// (US-1/US-3/US-5, FR-001/003/004, quickstart Sc1/Sc10).

describe('parseOutputsYaml (T010–T013)', () => {
  it('T010 valid canonical file → ok, version 1, outputs Record with value strings + optional description (FR-001, US-1, Sc1)', () => {
    const result = parseOutputsYaml(canonicalOutputsYamlText(), FILE);
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;

    expect(result.data.version).toBe(1);
    expect(Object.keys(result.data.outputs).sort()).toEqual([
      'frontend_api_url',
      'user_service_function_id',
    ]);
    expect(result.data.outputs['frontend_api_url']).toEqual({
      value: 'gateways.openapi.domain',
      description: 'Public API endpoint',
    });
    expect(result.data.outputs['user_service_function_id']).toEqual({
      value: 'functions.user_service.id',
      description: 'Cloud function ID',
    });

    const noDesc = parseOutputsYaml(
      outputsYamlText('  only_value:\n    value: "functions.user_service.id"\n'),
      FILE,
    );
    expect(noDesc.kind).toBe('ok');
    if (noDesc.kind !== 'ok') return;
    expect(noDesc.data.outputs['only_value']).toEqual({ value: 'functions.user_service.id' });
  });

  it('T011 version gate: missing → OUT_VERSION, unsupported → OUT_VERSION (FR-003, US-3 AC4, Sc10)', () => {
    const missing = parseOutputsYaml('outputs: {}\n', FILE);
    expectInvalid(missing);
    if (missing.kind === 'invalid') {
      expect(missing.errors).toHaveLength(1);
      expect(missing.errors[0]).toMatchObject({ code: OUT_VERSION, file: FILE });
      expect(missing.errors[0]?.message).toMatch(/missing version/);
    }

    const unsupported = parseOutputsYaml('version: 2\noutputs: {}\n', FILE);
    expectInvalid(unsupported);
    if (unsupported.kind === 'invalid') {
      expect(unsupported.errors[0]).toMatchObject({ code: OUT_VERSION });
      expect(unsupported.errors[0]?.message).toMatch(/unsupported version '2'.*supported: 1/);
    }
  });

  it('T012 structural invalid (collect-all): unknown top key, no/malformed outputs, bad names (FR-004, Sc10)', () => {
    const foobar = parseOutputsYaml('version: 1\nfoobar: 1\noutputs: {}\n', FILE);
    expectInvalid(foobar);
    if (foobar.kind === 'invalid') {
      expect(foobar.errors.some((e) => e.code === OUT_INVALID)).toBe(true);
    }

    const noOutputs = parseOutputsYaml('version: 1\n', FILE);
    expectInvalid(noOutputs);
    if (noOutputs.kind === 'invalid') {
      expect(noOutputs.errors.length).toBeGreaterThanOrEqual(1);
      expect(noOutputs.errors[0]).toMatchObject({ code: OUT_INVALID, file: FILE });
      expect(noOutputs.errors[0]?.message).toMatch(/outputs/);
    }

    for (const badOutputs of ['version: 1\noutputs: 5\n', 'version: 1\noutputs:\n  - a\n']) {
      const result = parseOutputsYaml(badOutputs, FILE);
      expectInvalid(result);
      if (result.kind === 'invalid') {
        expect(result.errors.some((e) => e.code === OUT_INVALID)).toBe(true);
      }
    }

    for (const badName of ['MyOutput', 'my-output', 'my.output', '']) {
      const block = `  ${badName === '' ? '""' : badName}:\n    value: "functions.user_service.id"\n`;
      const result = parseOutputsYaml(outputsYamlText(block), FILE);
      expectInvalid(result);
      if (result.kind === 'invalid') {
        expect(result.errors.some((e) => e.code === OUT_INVALID)).toBe(true);
      }
    }

    const multi = parseOutputsYaml('version: 1\nfoobar: 1\noutputs:\n  a:\n    value: 123\n', FILE);
    expectInvalid(multi);
    if (multi.kind === 'invalid') {
      expect(multi.errors.length).toBeGreaterThanOrEqual(2);
      expect(multi.errors.filter((e) => e.code === OUT_INVALID).length).toBeGreaterThanOrEqual(2);
    }
  });

  it('T013 value/description types + duplicate YAML keys with line/column (FR-004, US-5, Sc10)', () => {
    const badValue = parseOutputsYaml(outputsYamlText('  a:\n    value: 123\n'), FILE);
    expectInvalid(badValue);
    if (badValue.kind === 'invalid') {
      expect(badValue.errors.some((e) => e.code === OUT_INVALID)).toBe(true);
    }

    const badDescription = parseOutputsYaml(
      outputsYamlText('  a:\n    value: "functions.user_service.id"\n    description: 123\n'),
      FILE,
    );
    expectInvalid(badDescription);
    if (badDescription.kind === 'invalid') {
      expect(badDescription.errors.some((e) => e.code === OUT_INVALID)).toBe(true);
    }

    const dupKey = parseOutputsYaml(
      'version: 1\noutputs:\n  a:\n    value: "functions.user_service.id"\n  a:\n    value: "functions.analytics.id"\n',
      FILE,
    );
    expectInvalid(dupKey);
    if (dupKey.kind === 'invalid') {
      expect(dupKey.errors.some((e) => e.code === OUT_INVALID)).toBe(true);
      const withLocation = dupKey.errors.find((e) => e.line !== undefined && e.column !== undefined);
      expect(withLocation).toBeDefined();
    }
  });
});
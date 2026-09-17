import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { loadOutputs } from '../../src/outputs/loader.js';
import { canonicalOutputsYamlText, outputsYamlText } from '../helpers/outputs-fixtures.js';

const FILE = '.ycsf/outputs.yaml';
const TMP_ROOTS: string[] = [];

function tempProject(outputsYaml: string | null): string {
  const root = mkdtempSync(join(tmpdir(), 'pilot-outputs-'));
  TMP_ROOTS.push(root);
  mkdirSync(join(root, '.ycsf'), { recursive: true });
  if (outputsYaml !== null) writeFileSync(join(root, '.ycsf/outputs.yaml'), outputsYaml);
  return root;
}

// T009/T029: loadOutputs — `.ycsf/outputs.yaml` discovery + read (US-1, FR-002,
// Sc1/Sc11), errors OUT_MISSING_FILE/OUT_INVALID (US-3 AC5, FR-004).

describe('loadOutputs (T009/T029)', () => {
  afterEach(() => {
    for (const root of TMP_ROOTS.splice(0)) rmSync(root, { force: true, recursive: true });
  });

  it('T009 valid canonical file → ok with parsed data (Sc1)', () => {
    const root = tempProject(canonicalOutputsYamlText());
    const result = loadOutputs(root);
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
  });

  it('T029 (a/b/c/d): missing file throws OUT_MISSING_FILE; invalid load result; grammar NOT checked in loader', () => {
    const missing = tempProject(null);
    let thrown: unknown;
    try {
      loadOutputs(missing);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(Error);
    const message = thrown instanceof Error ? thrown.message : String(thrown);
    expect(message).toMatch(/missing \.ycsf\/outputs\.yaml/);
    expect(message).toMatch(/OUT_MISSING_FILE/);

    const invalid = tempProject(outputsYamlText('  bad:\n    value: 5\n'));
    const bad = loadOutputs(invalid);
    expect(bad.kind).toBe('invalid');
    if (bad.kind !== 'invalid') return;
    expect(bad.errors).toEqual([expect.objectContaining({ code: 'OUT_INVALID', file: FILE })]);
    expect(bad.errors[0]?.message).toMatch(/bad/);

    const unversioned = tempProject('outputs: {}\n');
    const noVersion = loadOutputs(unversioned);
    expect(noVersion.kind).toBe('invalid');
    if (noVersion.kind === 'invalid') {
      expect(noVersion.errors[0]?.code).toBe('OUT_VERSION');
    }

    const grammarUntouched = tempProject(
      outputsYamlText('  ok_name:\n    value: "Functions.User_Service.Id"\n'),
    );
    const loaded = loadOutputs(grammarUntouched);
    expect(loaded.kind).toBe('ok');
    if (loaded.kind !== 'ok') return;
    expect(loaded.data.outputs['ok_name']?.value).toBe('Functions.User_Service.Id');
  });
});
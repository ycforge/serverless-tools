import { describe, expect, it } from 'vitest';

import {
  PML_DUPLICATE_APP_ID,
  PML_DUPLICATE_KEY,
  PML_DUPLICATE_RESOURCE_ID,
  PML_PARSE,
  PML_VERSION,
} from '../../src/contracts/index.js';
import { parseYaml } from '../../src/model/parse.js';

// US-6 (version: 1) and US-3 (duplicate YAML keys) at the parse level.
// parseYaml = parse (uniqueKeys:true) + version gate: any doc without
// `version: 1` is rejected before any extractor sees it (FR-004/FR-014).

describe('parseYaml — version (US-6, FR-004/FR-014)', () => {
  it('accepts version: 1', () => {
    const result = parseYaml('version: 1\napps: {}\n', '.ycsf/apps.yaml');
    expect(result.kind).toBe('ok');
  });

  it('rejects a missing version with PML_VERSION (field: version)', () => {
    const result = parseYaml('apps: {}\n', '.ycsf/apps.yaml');
    if (result.kind !== 'invalid') throw new Error('expected invalid');
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({
      code: PML_VERSION,
      file: '.ycsf/apps.yaml',
      field: 'version',
    });
  });

  it('rejects version: 2 with PML_VERSION naming the unsupported value', () => {
    const result = parseYaml('version: 2\napps: {}\n', '.ycsf/apps.yaml');
    if (result.kind !== 'invalid') throw new Error('expected invalid');
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.code).toBe(PML_VERSION);
    expect(result.errors[0]?.message).toContain('2');
  });
});

describe('parseYaml — YAML syntax (FR-015 line/column)', () => {
  it('rejects a YAML syntax error with PML_PARSE carrying line + column', () => {
    const result = parseYaml(
      'version: 1\napps:\n  user_service: { source_path: [unclosed\n',
      '.ycsf/apps.yaml',
    );
    if (result.kind !== 'invalid') throw new Error('expected invalid');
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]?.code).toBe(PML_PARSE);
    expect(result.errors[0]?.line).toBeGreaterThanOrEqual(1);
    expect(result.errors[0]?.column).toBeGreaterThanOrEqual(1);
  });
});

describe('parseYaml — duplicate keys (US-3 AC2, FR-008)', () => {
  it('rejects a repeated app_id key with PML_DUPLICATE_KEY at the YAML level', () => {
    const text =
      'version: 1\n' +
      'apps:\n' +
      '  user_service: { source_path: a, builder: b }\n' +
      '  user_service: { source_path: c, builder: d }\n';
    const result = parseYaml(text, '.ycsf/apps.yaml');
    if (result.kind !== 'invalid') throw new Error('expected invalid');
    const codes = result.errors.map((e) => e.code);
    expect(codes).toContain(PML_DUPLICATE_KEY);
    expect(codes).not.toContain(PML_DUPLICATE_APP_ID);
    expect(codes).not.toContain(PML_DUPLICATE_RESOURCE_ID);
  });

  it('rejects a repeated resource_id key with PML_DUPLICATE_KEY (never silent last-wins)', () => {
    const text = 'version: 1\nqueues:\n  events: {}\n  events: {}\n';
    const result = parseYaml(text, '.ycsf/resources.yaml');
    if (result.kind !== 'invalid') throw new Error('expected invalid');
    const codes = result.errors.map((e) => e.code);
    expect(codes).toContain(PML_DUPLICATE_KEY);
    expect(codes).not.toContain(PML_DUPLICATE_RESOURCE_ID);
  });
});
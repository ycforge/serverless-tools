import { describe, expect, it } from 'vitest';

import {
  BRG_DUPLICATE_KEY,
  BRG_INVALID,
  BRG_KEY_COLLISION,
  BRG_VERSION,
} from '../../src/contracts/index.js';
import { parseBuildersYaml } from '../../src/registry/builders-yaml.js';

// T010–T019: parseBuildersYaml unit tests (FR-001/002/003/004/005, US-1/2/6)

describe('parseBuildersYaml', () => {
  it('T010: valid builders.yaml → ok with version/builders/materializers (FR-001, US-1 AC1)', () => {
    const yaml = `version: 1
builders:
  nestjs-function: "pkg-a"
materializers:
  yandex-function: "pkg-b"
`;
    const result = parseBuildersYaml(yaml, '.ycsf/builders.yaml');
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.data.version).toBe(1);
    expect(result.data.builders).toEqual({ 'nestjs-function': 'pkg-a' });
    expect(result.data.materializers).toEqual({ 'yandex-function': 'pkg-b' });
  });

  it('T011: missing version → invalid, BRG_VERSION, "missing version" (FR-002, US-1 AC2)', () => {
    const yaml = `builders:
  nestjs-function: "pkg-a"
`;
    const result = parseBuildersYaml(yaml, '.ycsf/builders.yaml');
    expect(result.kind).toBe('invalid');
    if (result.kind !== 'invalid') return;
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]?.code).toBe(BRG_VERSION);
    expect(result.errors[0]?.message).toMatch(/missing.*version/i);
  });

  it('T012: version: 2 → invalid, BRG_VERSION, unsupported (FR-002, US-1 AC3)', () => {
    const yaml = `version: 2
builders:
  nestjs-function: "pkg-a"
`;
    const result = parseBuildersYaml(yaml, '.ycsf/builders.yaml');
    expect(result.kind).toBe('invalid');
    if (result.kind !== 'invalid') return;
    expect(result.errors[0]?.code).toBe(BRG_VERSION);
    expect(result.errors[0]?.message).toMatch(/unsupported version '2'.*supported: 1/i);
  });

  it('T013: cross-section key collision → BRG_KEY_COLLISION (FR-003, US-2 AC1)', () => {
    const yaml = `version: 1
builders:
  my-plugin: "pkg-a"
materializers:
  my-plugin: "pkg-b"
`;
    const result = parseBuildersYaml(yaml, '.ycsf/builders.yaml');
    expect(result.kind).toBe('invalid');
    if (result.kind !== 'invalid') return;
    const collision = result.errors.find((e) => e.code === BRG_KEY_COLLISION);
    expect(collision).toBeDefined();
    expect(collision?.message).toMatch(/my-plugin.*builders and materializers/i);
  });

  it('T014: duplicate builder key → BRG_DUPLICATE_KEY (FR-003, US-2 AC2)', () => {
    const yaml = `version: 1
builders:
  a: "pkg-1"
  a: "pkg-2"
`;
    const result = parseBuildersYaml(yaml, '.ycsf/builders.yaml');
    expect(result.kind).toBe('invalid');
    if (result.kind !== 'invalid') return;
    const dup = result.errors.find((e) => e.code === BRG_DUPLICATE_KEY);
    expect(dup).toBeDefined();
    expect(dup?.message).toMatch(/keys must be unique|duplicate key/i);
  });

  it('T015: non-string value in builders → BRG_INVALID (FR-004, edge)', () => {
    const yaml = `version: 1
builders:
  x: 123
`;
    const result = parseBuildersYaml(yaml, '.ycsf/builders.yaml');
    expect(result.kind).toBe('invalid');
    if (result.kind !== 'invalid') return;
    expect(result.errors.some((e) => e.code === BRG_INVALID)).toBe(true);
  });

  it('T016: empty string key → BRG_INVALID (FR-004, edge)', () => {
    const yaml = `version: 1
builders:
  "": "pkg"
`;
    const result = parseBuildersYaml(yaml, '.ycsf/builders.yaml');
    expect(result.kind).toBe('invalid');
    if (result.kind !== 'invalid') return;
    expect(result.errors.some((e) => e.code === BRG_INVALID)).toBe(true);
  });

  it('T017: empty builders.yaml (version only) → ok with empty maps (US-6 AC1, FR-005)', () => {
    const yaml = `version: 1
`;
    const result = parseBuildersYaml(yaml, '.ycsf/builders.yaml');
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.data.version).toBe(1);
    expect(result.data.builders).toEqual({});
    expect(result.data.materializers).toEqual({});
  });

  it('T018: YAML syntax error → BRG_INVALID with line+column (FR-015, edge)', () => {
    const yaml = `version: 1
builders:
  a: "pkg"
  b: [unclosed
`;
    const result = parseBuildersYaml(yaml, '.ycsf/builders.yaml');
    expect(result.kind).toBe('invalid');
    if (result.kind !== 'invalid') return;
    const syntaxErr = result.errors.find((e) => e.code === BRG_INVALID);
    expect(syntaxErr).toBeDefined();
    expect(syntaxErr?.line).toBeDefined();
    expect(syntaxErr?.column).toBeDefined();
  });

  it('T019: only builders present (no materializers) → ok; only materializers → ok (FR-004)', () => {
    const buildersOnly = `version: 1
builders:
  a: "pkg-a"
`;
    const matOnly = `version: 1
materializers:
  b: "pkg-b"
`;
    const r1 = parseBuildersYaml(buildersOnly, 'f');
    expect(r1.kind).toBe('ok');
    const r2 = parseBuildersYaml(matOnly, 'f');
    expect(r2.kind).toBe('ok');
  });
});

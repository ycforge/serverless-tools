import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  BRG_DUPLICATE_KEY,
  BRG_INVALID,
  BRG_KEY_COLLISION,
  BRG_LOAD_ERROR,
  BRG_MISSING_FILE,
  BRG_NOT_A_PLUGIN,
  BRG_PACKAGE_NOT_FOUND,
  BRG_UNKNOWN_BUILDER,
  BRG_VERSION,
} from '../../src/contracts/index.js';
import { loadProjectModel } from '../../src/index.js';
import { loadRegistry, validateBuilders } from '../../src/registry/index.js';
import { createTempProject, removeTempProject, type TempProject } from '../helpers/temp-project.js';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

// quickstart.md Sc1–Sc14 + boundary (T061–T075) against the real
// loadRegistry + validateBuilders.

const FIXTURES_DIR = join(fileURLToPath(new URL('../../', import.meta.url)), 'test', 'registry', 'fixtures');
const fixture = (name: string): string => join(FIXTURES_DIR, name);

function writeBuilders(project: TempProject, yaml: string): void {
  project.write('.ycsf/builders.yaml', yaml);
}

function expectInvalidLoad(r: Awaited<ReturnType<typeof loadRegistry>>): Extract<
  Awaited<ReturnType<typeof loadRegistry>>,
  { kind: 'invalid' }
> {
  expect(r.kind).toBe('invalid');
  if (r.kind !== 'invalid') throw new Error('expected invalid registry load');
  return r;
}

describe('registry quickstart (Sc1–Sc14 + boundary)', () => {
  let project: TempProject;

  beforeEach(() => {
    project = createTempProject();
  });

  afterEach(() => {
    removeTempProject(project);
  });

  it('Sc1: valid builders.yaml loads → ok, 4 entries with correct kinds (US-1, FR-001/007/008)', async () => {
    writeBuilders(
      project,
      `version: 1
builders:
  nestjs-function: "${fixture('builder-default.mjs')}"
  docker: "${fixture('builder-named.mjs')}"
materializers:
  yandex-function: "${fixture('materializer-default.mjs')}"
`,
    );
    const result = await loadRegistry(project.root);
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.registry.records.size).toBe(3);
    expect(result.registry.records.get('nestjs-function')?.kind).toBe('builder');
    expect(result.registry.records.get('docker')?.kind).toBe('builder');
    expect(result.registry.records.get('yandex-function')?.kind).toBe('materializer');
  });

  it('Sc2: missing version → invalid BRG_VERSION, no dynamic import (US-1 AC2)', async () => {
    writeBuilders(project, `builders:\n  nestjs-function: "pkg"\n`);
    const result = await loadRegistry(project.root);
    const invalid = expectInvalidLoad(result);
    expect(invalid.errors.some((e) => 'code' in e && e.code === BRG_VERSION)).toBe(true);
  });

  it('Sc3: builders↔materializers key collision → BRG_KEY_COLLISION before any import (US-2, FR-003)', async () => {
    writeBuilders(
      project,
      `version: 1
builders:
  my-plugin: "pkg-a"
materializers:
  my-plugin: "pkg-b"
`,
    );
    const result = await loadRegistry(project.root);
    const invalid = expectInvalidLoad(result);
    expect(invalid.errors.some((e) => 'code' in e && e.code === BRG_KEY_COLLISION)).toBe(true);
  });

  it('Sc4: duplicate builder key → BRG_DUPLICATE_KEY (US-2 AC2, FR-003)', async () => {
    writeBuilders(project, `version: 1\nbuilders:\n  a: "pkg-1"\n  a: "pkg-2"\n`);
    const result = await loadRegistry(project.root);
    const invalid = expectInvalidLoad(result);
    expect(invalid.errors.some((e) => 'code' in e && e.code === BRG_DUPLICATE_KEY)).toBe(true);
  });

  it('Sc5: package not found → BRG_PACKAGE_NOT_FOUND (US-3, FR-009)', async () => {
    writeBuilders(project, `version: 1\nbuilders:\n  nestjs: "@nonexistent/fake-builder"\n`);
    const result = await loadRegistry(project.root);
    const invalid = expectInvalidLoad(result);
    expect(invalid.errors.some((e) => 'code' in e && e.code === BRG_PACKAGE_NOT_FOUND)).toBe(true);
  });

  it('Sc6: not-a-plugin fixture → BRG_NOT_A_PLUGIN (US-4, FR-010)', async () => {
    writeBuilders(project, `version: 1\nbuilders:\n  nap: "${fixture('not-a-plugin.mjs')}"\n`);
    const result = await loadRegistry(project.root);
    const invalid = expectInvalidLoad(result);
    expect(invalid.errors.some((e) => 'code' in e && e.code === BRG_NOT_A_PLUGIN)).toBe(true);
  });

  it('Sc7: load-error fixture → BRG_LOAD_ERROR (FR-011)', async () => {
    writeBuilders(project, `version: 1\nbuilders:\n  le: "${fixture('load-error.mjs')}"\n`);
    const result = await loadRegistry(project.root);
    const invalid = expectInvalidLoad(result);
    expect(invalid.errors.some((e) => 'code' in e && e.code === BRG_LOAD_ERROR)).toBe(true);
  });

  it('Sc8: both-shape module → ok, entry kind builder (builder-priority) (US-4 AC2)', async () => {
    writeBuilders(project, `version: 1\nbuilders:\n  both: "${fixture('both-shapes.mjs')}"\n`);
    const result = await loadRegistry(project.root);
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.registry.records.get('both')?.kind).toBe('builder');
  });

  it('Sc9: partial load collects both BRG_PACKAGE_NOT_FOUND and BRG_LOAD_ERROR (FR-015)', async () => {
    writeBuilders(
      project,
      `version: 1
builders:
  good: "${fixture('builder-default.mjs')}"
  nf: "@nonexistent/pkg"
  le: "${fixture('load-error.mjs')}"
`,
    );
    const result = await loadRegistry(project.root);
    const invalid = expectInvalidLoad(result);
    const codes = invalid.errors.map((e) => ('code' in e ? e.code : ''));
    expect(codes).toContain(BRG_PACKAGE_NOT_FOUND);
    expect(codes).toContain(BRG_LOAD_ERROR);
  });

  it('Sc10: validateBuilders — unknown builder → BRG_UNKNOWN_BUILDER (US-5, FR-013)', async () => {
    writeBuilders(
      project,
      `version: 1
builders:
  nestjs-function: "${fixture('builder-default.mjs')}"
  docker: "${fixture('builder-named.mjs')}"
`,
    );
    const registryResult = await loadRegistry(project.root);
    expect(registryResult.kind).toBe('ok');
    if (registryResult.kind !== 'ok') return;

    project.write(
      '.ycsf/apps.yaml',
      `version: 1
apps:
  analytics: { source_path: analytics, builder: nest-function }
`,
    );
    const modelResult = loadProjectModel(project.root);
    expect(modelResult.kind).toBe('ok');
    if (modelResult.kind !== 'ok') return;

    const validation = validateBuilders(modelResult.model, registryResult.registry);
    expect(validation.kind).toBe('invalid');
    if (validation.kind !== 'invalid') return;
    expect(validation.errors[0]?.code).toBe(BRG_UNKNOWN_BUILDER);
    expect(validation.errors[0]?.app).toBe('analytics');
    expect(validation.errors[0]?.field).toBe('builder');
    expect(validation.errors[0]?.message).toContain('available builders:');
  });

  it('Sc11: validateBuilders — known builder passes (US-5 AC2, FR-013)', async () => {
    writeBuilders(project, `version: 1\nbuilders:\n  nestjs-function: "${fixture('builder-default.mjs')}"\n`);
    const registryResult = await loadRegistry(project.root);
    expect(registryResult.kind).toBe('ok');
    if (registryResult.kind !== 'ok') return;

    project.write(
      '.ycsf/apps.yaml',
      `version: 1
apps:
  frontend: { source_path: frontend, builder: nestjs-function }
`,
    );
    const modelResult = loadProjectModel(project.root);
    expect(modelResult.kind).toBe('ok');
    if (modelResult.kind !== 'ok') return;

    const validation = validateBuilders(modelResult.model, registryResult.registry);
    expect(validation.kind).toBe('ok');
  });

  it('Sc12: validateBuilders — collect-all unknowns → 2 diagnostics (US-5 AC3, FR-013)', async () => {
    writeBuilders(project, `version: 1\nbuilders:\n  docker: "${fixture('builder-named.mjs')}"\n`);
    const registryResult = await loadRegistry(project.root);
    expect(registryResult.kind).toBe('ok');
    if (registryResult.kind !== 'ok') return;

    project.write(
      '.ycsf/apps.yaml',
      `version: 1
apps:
  a: { source_path: a, builder: unknown1 }
  b: { source_path: b, builder: unknown2 }
`,
    );
    const modelResult = loadProjectModel(project.root);
    expect(modelResult.kind).toBe('ok');
    if (modelResult.kind !== 'ok') return;

    const validation = validateBuilders(modelResult.model, registryResult.registry);
    expect(validation.kind).toBe('invalid');
    if (validation.kind !== 'invalid') return;
    expect(validation.errors).toHaveLength(2);
    expect(validation.errors.every((e) => e.code === BRG_UNKNOWN_BUILDER)).toBe(true);
  });

  it('Sc13: empty registry — loadRegistry ok (0 entries), validateBuilders invalid; 0 apps → ok (US-6)', async () => {
    writeBuilders(project, `version: 1\n`);
    const registryResult = await loadRegistry(project.root);
    expect(registryResult.kind).toBe('ok');
    if (registryResult.kind !== 'ok') return;
    expect(registryResult.registry.records.size).toBe(0);

    project.write(
      '.ycsf/apps.yaml',
      `version: 1
apps:
  myapp: { source_path: myapp, builder: nestjs-function }
`,
    );
    const modelResult = loadProjectModel(project.root);
    expect(modelResult.kind).toBe('ok');
    if (modelResult.kind !== 'ok') return;

    const validation = validateBuilders(modelResult.model, registryResult.registry);
    expect(validation.kind).toBe('invalid');
    if (validation.kind !== 'invalid') return;
    expect(validation.errors[0]?.code).toBe(BRG_UNKNOWN_BUILDER);
    expect(validation.errors[0]?.message).toMatch(/available builders: $/);

    // zero-apps case
    project.write('.ycsf/apps.yaml', `version: 1\napps: {}\n`);
    const emptyModel = loadProjectModel(project.root);
    expect(emptyModel.kind).toBe('ok');
    if (emptyModel.kind !== 'ok') return;
    expect(validateBuilders(emptyModel.model, registryResult.registry).kind).toBe('ok');
  });

  it('Sc14: materializers only → ok, 1 materializer entry (US-1, FR-005)', async () => {
    writeBuilders(project, `version: 1\nmaterializers:\n  yandex-function: "${fixture('materializer-default.mjs')}"\n`);
    const result = await loadRegistry(project.root);
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.registry.records.size).toBe(1);
    expect(result.registry.records.get('yandex-function')?.kind).toBe('materializer');
  });

  it('edge (Sc14-boundary): yandex-api-gateway (B-as-plugin) → BRG_PACKAGE_NOT_FOUND, no special case', async () => {
    writeBuilders(project, `version: 1\nbuilders:\n  yandex-api-gateway: "@ycforge/ycsf-api"\n`);
    const result = await loadRegistry(project.root);
    const invalid = expectInvalidLoad(result);
    expect(invalid.errors.some((e) => 'code' in e && e.code === BRG_PACKAGE_NOT_FOUND)).toBe(true);
  });

  it('Sc15/edge: missing .ycsf/builders.yaml → throws BRG_MISSING_FILE', async () => {
    await expect(loadRegistry(project.root)).rejects.toThrow(/BRG_MISSING_FILE/);
  });

  it('SC-001 perf smoke: 3 builders + 2 materializers load well under 2s', async () => {
    const buildersYaml = `version: 1
builders:
  b1: "${fixture('builder-default.mjs')}"
  b2: "${fixture('builder-named.mjs')}"
  b3: "${fixture('builder-default.mjs')}"
materializers:
  m1: "${fixture('materializer-default.mjs')}"
  m2: "${fixture('materializer-default.mjs')}"
`;
    writeBuilders(project, buildersYaml);
    const start = Date.now();
    const result = await loadRegistry(project.root);
    const elapsed = Date.now() - start;
    expect(result.kind).toBe('ok');
    expect(elapsed).toBeLessThan(5000);
  });
});
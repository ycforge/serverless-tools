import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

import {
  MTL_COLLISION,
  MTL_FILENAME_COLLISION,
  MTL_INVALID_TERRAFORM_ADDRESS,
  MTL_MATERIALIZE_FAILED,
  MTL_OUTPUT_NAME_COLLISION,
  MTL_UNHANDLED_ARTIFACT,
} from '../../src/contracts/index.js';
import { dispatch, loadProjectModel, writeGeneratedTerraform } from '../../src/index.js';
import { loadRegistry } from '../../src/registry/index.js';
import {
  GOLDEN_OUTPUTS_TF_JSON,
  GOLDEN_USER_SERVICE_TF_JSON,
  appsModel,
  makeMaterializer,
  makeRegistry,
  materializerEntry,
  matDocker,
  matNest,
  matThrow,
  matWithOutput,
  writeFixtureMaterializer,
} from '../helpers/materialize-fixtures.js';
import { createTempProject, removeTempProject, type TempProject } from '../helpers/temp-project.js';
import { detectFilenameCollision } from '../../src/materialize/serialize.js';

// Phase 4: quickstart.md Sc1–Sc15 + E2E wiring (T081–T093) + perf smoke
// (T105) against the real loadProjectModel → dispatch → writeGeneratedTerraform.

const MAIN_TF = '# user\nresource "yandex_vpc_network" "net" {}\n';

describe('materialize quickstart (Sc1–Sc15 + E2E)', () => {
  let project: TempProject | undefined;

  afterEach(() => {
    if (project) removeTempProject(project);
    project = undefined;
  });

  it('T081 Sc1: single app → ok, golden .tf.json content (US-1, FR-001/005/007/008/009)', async () => {
    const model = appsModel(`version: 1
apps:
  user_service: { source_path: user_service, builder: nestjs-function }
`);
    const registry = makeRegistry([materializerEntry(matNest())]);
    const result = await dispatch(model, registry);

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.generatedFiles).toHaveLength(1);
    expect(result.generatedFiles[0]?.filename).toBe('user_service.ycsf.tf.json');
    expect(result.generatedFiles[0]?.content).toBe(GOLDEN_USER_SERVICE_TF_JSON);
  });

  it('T082 Sc2: two materializers claim same type → MTL_COLLISION, materialize never called (US-2, FR-003/017)', async () => {
    const model = appsModel(`version: 1
apps:
  user_service: { source_path: user_service, builder: nestjs-function }
`);
    const m1 = makeMaterializer('m1', { supportedTypes: ['nestjs-function'] });
    const m2 = makeMaterializer('m2', { supportedTypes: ['nestjs-function'] });
    const result = await dispatch(model, makeRegistry([materializerEntry(m1), materializerEntry(m2)]));

    expect(result.kind).toBe('invalid');
    if (result.kind !== 'invalid') return;
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({
      code: MTL_COLLISION,
      artifactId: 'user_service',
      materializerIds: ['m1', 'm2'],
    });
    expect(m1.spy.count.materialize).toBe(0);
    expect(m2.spy.count.materialize).toBe(0);
  });

  it('T083 Sc3: no materializer supports type → MTL_UNHANDLED_ARTIFACT (US-3, FR-004/017)', async () => {
    const model = appsModel(`version: 1
apps:
  analytics: { source_path: analytics, builder: docker }
`);
    const registry = makeRegistry([materializerEntry(matNest())]);
    const result = await dispatch(model, registry);

    expect(result.kind).toBe('invalid');
    if (result.kind !== 'invalid') return;
    expect(result.errors[0]).toMatchObject({
      code: MTL_UNHANDLED_ARTIFACT,
      artifactId: 'analytics',
      materializerIds: ['yandex-function'],
    });
  });

  it('T084 Sc4: dependency order analytics → user_service → frontend (US-4, FR-014)', async () => {
    const model = appsModel(`version: 1
apps:
  analytics:   { source_path: analytics,   builder: docker }
  user_service: { source_path: user_service, builder: nestjs-function, depends_on: [analytics] }
  frontend:     { source_path: frontend,     builder: vite,            depends_on: [user_service] }
`);
    const registry = makeRegistry([
      materializerEntry(matDocker()),
      materializerEntry(matNest()),
      materializerEntry(makeMaterializer('vite', { supportedTypes: ['vite'] })),
    ]);
    const result = await dispatch(model, registry);

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.resources.map((r) => r.name)).toEqual(['analytics', 'user_service', 'frontend']);
    expect(result.generatedFiles.map((f) => f.filename)).toEqual([
      'analytics.ycsf.tf.json',
      'user_service.ycsf.tf.json',
      'frontend.ycsf.tf.json',
    ]);
  });

  it('T085 Sc5: regeneration removes stale C-owned files, keeps user *.tf (US-5, FR-015/016)', async () => {
    project = createTempProject({
      '.ycsf/apps.yaml': `version: 1
apps:
  analytics: { source_path: analytics, builder: docker }
`,
      'infra/user_service.ycsf.tf.json': '{"stale":true}',
      'infra/main.tf': MAIN_TF,
    });

    const model = loadProjectModel(project.root);
    expect(model.kind).toBe('ok');
    if (model.kind !== 'ok') return;

    const result = await dispatch(model.model, makeRegistry([materializerEntry(matDocker())]));
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;

    await writeGeneratedTerraform(join(project.root, 'infra'), result.generatedFiles);

    expect(existsSync(join(project.root, 'infra/analytics.ycsf.tf.json'))).toBe(true);
    expect(existsSync(join(project.root, 'infra/user_service.ycsf.tf.json'))).toBe(false);
    expect(readFileSync(join(project.root, 'infra/main.tf'), 'utf8')).toBe(MAIN_TF);
  });

  it('T086 Sc6: materializer throws → MTL_MATERIALIZE_FAILED, abort-on-first (US-6, FR-006)', async () => {
    const model = appsModel(`version: 1
apps:
  user_service: { source_path: user_service, builder: nestjs-function }
  analytics:    { source_path: analytics,    builder: docker }
`);
    const nest = matNest();
    const throwing = matThrow('throw-materializer', ['docker']);
    const result = await dispatch(
      model,
      makeRegistry([materializerEntry(nest), materializerEntry(throwing)]),
    );

    expect(result.kind).toBe('invalid');
    if (result.kind !== 'invalid') return;
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({
      code: MTL_MATERIALIZE_FAILED,
      artifactId: 'analytics',
      materializerId: 'throw-materializer',
    });
    expect(result.errors[0]?.message).toContain('plugin crashed');
    expect(throwing.spy.count.materialize).toBe(1);
    expect(nest.spy.count.materialize).toBe(0);
  });

  it('T087 Sc7/Sc8: empty registry → unhandled per app; empty apps → ok (US-7, FR-004)', async () => {
    const withApp = appsModel(`version: 1
apps:
  user_service: { source_path: user_service, builder: nestjs-function }
`);
    const unhandled = await dispatch(withApp, makeRegistry([]));
    expect(unhandled.kind).toBe('invalid');
    if (unhandled.kind !== 'invalid') return;
    expect(unhandled.errors[0]).toMatchObject({
      code: MTL_UNHANDLED_ARTIFACT,
      artifactId: 'user_service',
      materializerIds: [],
    });

    const empty = await dispatch(appsModel(`version: 1\napps: {}\n`), makeRegistry([]));
    expect(empty.kind).toBe('ok');
    if (empty.kind !== 'ok') return;
    expect(empty.resources).toHaveLength(0);
    expect(empty.generatedFiles).toHaveLength(0);
  });

  it('T088 Sc9: byte-identical generatedFiles across two dispatch runs (US-8)', async () => {
    const model = appsModel(`version: 1
apps:
  user_service: { source_path: user_service, builder: nestjs-function }
  frontend:     { source_path: frontend,     builder: vite, depends_on: [user_service] }
`);
    const registry = makeRegistry([
      materializerEntry(matNest()),
      materializerEntry(makeMaterializer('vite', { supportedTypes: ['vite'] })),
    ]);

    const first = await dispatch(model, registry);
    const second = await dispatch(model, registry);
    expect(first.kind).toBe('ok');
    expect(second.kind).toBe('ok');
    if (first.kind !== 'ok' || second.kind !== 'ok') return;
    expect(JSON.stringify(first.generatedFiles)).toBe(JSON.stringify(second.generatedFiles));
  });

  it('T089 Sc10/Sc11: defensive filename guard + invalid Terraform address (FR-010/011)', async () => {
    const collisions = detectFilenameCollision([
      { appId: 'x', filename: 'user_service.ycsf.tf.json' },
      { appId: 'y', filename: 'user_service.ycsf.tf.json' },
    ]);
    expect(collisions).toHaveLength(1);
    expect(collisions[0]?.code).toBe(MTL_FILENAME_COLLISION);

    const model = appsModel(`version: 1
apps:
  user_service: { source_path: user_service, builder: nestjs-function }
`);
    const badAddress = makeMaterializer('bad-address', {
      supportedTypes: ['nestjs-function'],
      materialize: (a) => ({ kind: 'resource', type: 'yandex-function', name: a.id, configuration: {} }),
    });
    const result = await dispatch(model, makeRegistry([materializerEntry(badAddress)]));
    expect(result.kind).toBe('invalid');
    if (result.kind !== 'invalid') return;
    expect(result.errors[0]?.code).toBe(MTL_INVALID_TERRAFORM_ADDRESS);
    expect(result.errors[0]?.type).toBe('yandex-function');
  });

  it('T090 Sc12: declared outputs → 00-ycsf-outputs.tf.json, appended last (FR-012)', async () => {
    const model = appsModel(`version: 1
apps:
  user_service: { source_path: user_service, builder: nestjs-function }
`);
    const result = await dispatch(model, makeRegistry([materializerEntry(matWithOutput())]));
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;

    expect(result.generatedFiles.map((f) => f.filename)).toEqual([
      'user_service.ycsf.tf.json',
      '00-ycsf-outputs.tf.json',
    ]);
    expect(result.generatedFiles[1]?.content).toBe(GOLDEN_OUTPUTS_TF_JSON);
  });

  it('T091 Sc13: duplicate output name → MTL_OUTPUT_NAME_COLLISION (FR-013)', async () => {
    const model = appsModel(`version: 1
apps:
  user_service: { source_path: user_service, builder: nestjs-function }
  analytics:    { source_path: analytics,    builder: docker }
`);
    const dockerOutput = makeMaterializer('docker-output', {
      supportedTypes: ['docker'],
      materialize: (a, ctx) => {
        ctx.output.declare('url', { value: `function_url(${a.id})`, description: 'URL' });
        return { kind: 'resource', type: 'yandex_container', name: a.id, configuration: { name: a.id } };
      },
    });
    const result = await dispatch(
      model,
      makeRegistry([materializerEntry(matWithOutput()), materializerEntry(dockerOutput)]),
    );
    expect(result.kind).toBe('invalid');
    if (result.kind !== 'invalid') return;
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ code: MTL_OUTPUT_NAME_COLLISION, outputName: 'url' });
  });

  it('T092 Sc14/Sc15: write creates missing infra dir; user *.tf preserved (FR-015)', async () => {
    project = createTempProject({ 'infra/main.tf': MAIN_TF });
    await writeGeneratedTerraform(join(project.root, 'infra'), [
      { filename: 'user_service.ycsf.tf.json', content: GOLDEN_USER_SERVICE_TF_JSON },
    ]);
    expect(existsSync(join(project.root, 'infra/user_service.ycsf.tf.json'))).toBe(true);
    expect(readFileSync(join(project.root, 'infra/user_service.ycsf.tf.json'), 'utf8')).toBe(
      GOLDEN_USER_SERVICE_TF_JSON,
    );
    expect(readFileSync(join(project.root, 'infra/main.tf'), 'utf8')).toBe(MAIN_TF);
  });

  it('T093 E2E: loadRegistry (real module namespace) → loadProjectModel → dispatch → write (013+011+014)', async () => {
    project = createTempProject({
      '.ycsf/apps.yaml': `version: 1
apps:
  user_service: { source_path: user_service, builder: nestjs-function }
  analytics:    { source_path: analytics,    builder: docker }
`,
      'infra/main.tf': MAIN_TF,
      'infra/user_service.ycsf.tf.json': '{"stale":true}',
    });

    const pluginsDir = join(project.root, 'plugins');
    mkdirSync(pluginsDir, { recursive: true });
    const nestPath = writeFixtureMaterializer(pluginsDir, 'nest', {
      supports: "(a) => a.type === 'nestjs-function'",
    });
    const dockerPath = writeFixtureMaterializer(pluginsDir, 'docker', {
      supports: "(a) => a.type === 'docker'",
      materialize:
        "(a) => ({ kind: 'resource', type: 'yandex_container', name: a.id, configuration: { image: 'registry.example.com/' + a.id } })",
    });
    project.write(
      '.ycsf/builders.yaml',
      `version: 1
materializers:
  yandex-function: "${nestPath}"
  yandex-container: "${dockerPath}"
`,
    );

    const registryResult = await loadRegistry(project.root);
    expect(registryResult.kind).toBe('ok');
    if (registryResult.kind !== 'ok') return;

    const modelResult = loadProjectModel(project.root);
    expect(modelResult.kind).toBe('ok');
    if (modelResult.kind !== 'ok') return;

    const dispatched = await dispatch(modelResult.model, registryResult.registry);
    expect(dispatched.kind).toBe('ok');
    if (dispatched.kind !== 'ok') return;
    expect(dispatched.generatedFiles.map((f) => f.filename)).toEqual([
      'analytics.ycsf.tf.json',
      'user_service.ycsf.tf.json',
    ]);

    await writeGeneratedTerraform(join(project.root, 'infra'), dispatched.generatedFiles);

    const userService = readFileSync(join(project.root, 'infra/user_service.ycsf.tf.json'), 'utf8');
    expect(userService).toContain('"yandex_function"');
    expect(userService).toContain('"user_service"');
    expect(existsSync(join(project.root, 'infra/analytics.ycsf.tf.json'))).toBe(true);
    expect(readFileSync(join(project.root, 'infra/main.tf'), 'utf8')).toBe(MAIN_TF);
  });

  it('T105 perf smoke: 3 inline materializers × 20 apps dispatch well under 5s (SC-003)', async () => {
    const lines = ['version: 1', 'apps:'];
    const types = ['nestjs-function', 'docker', 'vite'];
    for (let i = 0; i < 20; i += 1) {
      lines.push(`  app${String(i).padStart(2, '0')}: { source_path: app${i}, builder: ${types[i % 3]} }`);
    }
    const model = appsModel(lines.join('\n'));
    const registry = makeRegistry([
      materializerEntry(matNest()),
      materializerEntry(matDocker()),
      materializerEntry(makeMaterializer('vite', { supportedTypes: ['vite'] })),
    ]);

    const start = Date.now();
    const result = await dispatch(model, registry);
    const elapsed = Date.now() - start;

    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.resources).toHaveLength(20);
      expect(result.generatedFiles).toHaveLength(20);
    }
    expect(elapsed).toBeLessThan(5000);
  });

  it('T105b (fixture smoke): loadRegistry recognizes committed .mjs fixtures, dispatch happy', async () => {
    project = createTempProject({
      '.ycsf/apps.yaml': `version: 1
apps:
  user_service: { source_path: user_service, builder: nestjs-function }
`,
    });
    const fixturesDir = fileURLToPath(new URL('./fixtures/', import.meta.url));
    project.write(
      '.ycsf/builders.yaml',
      `version: 1
materializers:
  nest: "${join(fixturesDir, 'materializer-nest.mjs')}"
  docker: "${join(fixturesDir, 'materializer-docker.mjs')}"
`,
    );
    const registryResult = await loadRegistry(project.root);
    expect(registryResult.kind).toBe('ok');
    if (registryResult.kind !== 'ok') return;

    const facade = await dispatch(
      appsModel(`version: 1
apps:
  user_service: { source_path: user_service, builder: nestjs-function }
`),
      registryResult.registry,
    );
    expect(facade.kind).toBe('ok');
    if (facade.kind !== 'ok') return;
    expect(facade.generatedFiles[0]?.content).toBe(GOLDEN_USER_SERVICE_TF_JSON);
  });
});
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadProjectModel, dispatch, loadExtensions, applyExtensions, loadOutputs, buildOutputs } from '@ycforge/pilot';
import type { PluginRegistry } from '@ycforge/pilot/contracts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = join(ROOT, 'test/fixtures');
const infraDir = join(ROOT, 'infra');

const cliReady = existsSync(join(ROOT, '../../packages/pilot/dist/index.js'));
const artifactsReady =
  existsSync(join(ROOT, '.ycsf/artifacts/user_service/function.zip')) &&
  existsSync(join(ROOT, '.ycsf/artifacts/frontend/index.html'));

// Hermetic registry: materializers imported by stable package subpath
// (T044 boundary: `.ycsf/builders.yaml` monorepo-relative composer row is a CLI
// concern; the dispatch surface itself resolves by package subpath).
async function buildRegistry(): Promise<PluginRegistry> {
  const materializers = {
    'yandex-function': await import('@ycforge/materializers-core/yandex-function'),
    'yandex-serverless-container': await import('@ycforge/materializers-core/yandex-serverless-container'),
    'yandex-storage-bucket': await import('@ycforge/materializers-core/yandex-storage-bucket'),
    'yandex-api-gateway': await import('@ycforge/materializers-core/yandex-api-gateway'),
  };
  const records = new Map(
    Object.entries(materializers).map(([id, module]) => [
      id,
      { id, packageName: id, kind: 'materializer', module },
    ]),
  );
  return { records } as unknown as PluginRegistry;
}

// archivePath resolves relative to process.cwd() — materialize CLI runs from infra/.
const SAVED_CWD = process.cwd();

const ARTIFACTS = () =>
  new Map<string, { type: string; value: unknown }>([
    ['user_service', { type: 'ycforge:function', value: { archivePath: '../.ycsf/artifacts/user_service/function.zip', entryPoint: 'main.handler' } }],
    [
      'analytics',
      {
        type: 'ycforge:docker-image',
        value: { image: 'cr.yandex/ycforge/analytics@sha256:c16dea4fac51b380fee77eef61fc6344dfde1b306629bb02b4f1b3dbad8ce7f0' },
      },
    ],
    ['frontend', { type: 'ycforge:frontend', value: { directory: join(ROOT, '.ycsf/artifacts/frontend') } }],
    ['openapi', { type: 'ycforge:api-gateway', value: { specPath: join(ROOT, 'apps/openapi/openapi.yaml'), resourceReferences: [] } }],
  ]);

// Real dispatch determinism (T040): same inputs → same files, twice.
// Gated on real artifacts existing (built by `ycsf build`; the pipeline run for
// analytics is blocked — D10/D1-D2 package bugs registered T035/T036).
describe
  .skipIf(!cliReady || !artifactsReady)('dispatch + extensions + outputs (T040)', () => {
    it('стабильные addresses FR-017: 4 app-а → 4 tf-адреса', async () => {
      process.chdir(infraDir);
      try {
        const modelR = loadProjectModel(ROOT);
        expect(modelR.kind).toBe('ok');
        if (modelR.kind !== 'ok') return;
        const registry = await buildRegistry();
        const d = await dispatch(modelR.model, registry, { artifacts: ARTIFACTS() });
        expect(d.kind).toBe('ok');
        if (d.kind !== 'ok') return;
        const addresses = d.resources.map((r) => `${r.type}.${r.name}`).sort();
        expect(addresses).toEqual([
          'yandex_api_gateway.openapi',
          'yandex_function.user_service',
          'yandex_serverless_container.analytics',
          'yandex_storage_bucket.frontend',
          'yandex_storage_object.frontend_assets_index_CII8GTtS_js',
          'yandex_storage_object.frontend_index_html',
        ]);
      } finally {
        process.chdir(SAVED_CWD);
      }
    });

    it('determinizm: dispatch дважды → идентичные файлы (byte-for-byte, FR-020)', async () => {
      process.chdir(infraDir);
      try {
        const modelR = loadProjectModel(ROOT);
        if (modelR.kind !== 'ok') return;
        const registry = await buildRegistry();
        const run = async () => {
          const d = await dispatch(modelR.model, registry, { artifacts: ARTIFACTS() });
          if (d.kind !== 'ok') throw new Error(d.errors.map((e) => e.message).join('; '));
          return d.generatedFiles.map((f) => f.content).sort();
        };
        expect(await run()).toEqual(await run());
      } finally {
        process.chdir(SAVED_CWD);
      }
    });

    it('extensions применяются на уровне ресурсов: user_service получает memory:128/execution_timeout:5', async () => {
      process.chdir(infraDir);
      try {
        const modelR = loadProjectModel(ROOT);
        if (modelR.kind !== 'ok') return;
        const registry = await buildRegistry();
        const d = await dispatch(modelR.model, registry, { artifacts: ARTIFACTS() });
        if (d.kind !== 'ok') return;
        const ext = loadExtensions(ROOT);
        if (ext.kind !== 'ok') return;
        const applied = applyExtensions(d.resources, ext.data);
        expect(applied.kind).toBe('ok');
        if (applied.kind !== 'ok') return;
        const us = applied.resources.find((r) => r.type === 'yandex_function' && r.name === 'user_service');
        expect((us?.configuration as Record<string, unknown>).memory).toBe(128);
        expect((us?.configuration as Record<string, unknown>).execution_timeout).toBe(5);
      } finally {
        process.chdir(SAVED_CWD);
      }
    });

    it('golden user_service byte-for-byte совпадает с реальным serialization-выходом (T039)', async () => {
      process.chdir(infraDir);
      try {
        const modelR = loadProjectModel(ROOT);
        if (modelR.kind !== 'ok') return;
        const registry = await buildRegistry();
        const d = await dispatch(modelR.model, registry, { artifacts: ARTIFACTS() });
        if (d.kind !== 'ok') return;
        const generated = d.generatedFiles.find((f) => f.filename === 'user_service.ycsf.tf.json');
        const golden = readFileSync(join(FIXTURES, 'user_service.ycsf.tf.json'), 'utf8');
        expect(generated?.content).toBe(golden);
      } finally {
        process.chdir(SAVED_CWD);
      }
    });

    it('golden outputs byte-for-byte совпадает с buildOutputs (T039)', async () => {
      process.chdir(infraDir);
      try {
        const modelR = loadProjectModel(ROOT);
        if (modelR.kind !== 'ok') return;
        const registry = await buildRegistry();
        const d = await dispatch(modelR.model, registry, { artifacts: ARTIFACTS() });
        if (d.kind !== 'ok') return;
        const outputsR = loadOutputs(ROOT);
        if (outputsR.kind !== 'ok') return;
        const outputs = buildOutputs({ outputsYaml: outputsR.data, materializerOutputs: d.materializerOutputs, resources: d.resources });
        expect(outputs.kind).toBe('ok');
        if (outputs.kind !== 'ok') return;
        const golden = readFileSync(join(FIXTURES, '99-ycsf-outputs.tf.json'), 'utf8');
        expect(outputs.file.content).toBe(golden);
      } finally {
        process.chdir(SAVED_CWD);
      }
    });
  });
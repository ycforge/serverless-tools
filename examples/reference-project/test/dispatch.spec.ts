import { describe, it, expect, afterAll } from 'vitest';
import { existsSync, readFileSync, mkdtempSync, mkdirSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadProjectModel, dispatch, loadExtensions, applyExtensions, loadOutputs, buildOutputs } from '@ycforge/pilot';
import type { PluginRegistry } from '@ycforge/pilot/contracts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = join(ROOT, 'test/fixtures');

const cliReady = existsSync(join(ROOT, '../../packages/pilot/dist/index.js'));
const artifactsReady =
  existsSync(join(ROOT, '.ycsf/artifacts/user_service/function.zip')) &&
  existsSync(join(ROOT, '.ycsf/artifacts/frontend/index.html'));

// Hermetic registry: materializers imported by stable package subpath
// (T044 boundary: `.ycsf/builders.yaml` monorepo-relative composer row is a CLI
// concern; the dispatch surface itself resolves by package subpath).
// spec 028 (Fix-5): registry keys are `<kind>:<id>` namespaced.
async function buildRegistry(): Promise<PluginRegistry> {
  const materializers = {
    'yandex-function': await import('@ycforge/materializers-core/yandex-function'),
    'yandex-serverless-container': await import('@ycforge/materializers-core/yandex-serverless-container'),
    'yandex-storage-bucket': await import('@ycforge/materializers-core/yandex-storage-bucket'),
    'yandex-api-gateway': await import('@ycforge/materializers-core/yandex-api-gateway'),
  };
  const records = new Map(
    Object.entries(materializers).map(([id, module]) => [
      `materializer:${id}`,
      { id, packageName: id, kind: 'materializer' as const, module },
    ]),
  );
  return { records } as unknown as PluginRegistry;
}

// archivePath resolves relative to process.cwd() — materialize CLI runs from infra/.
// The api-gateway materializer writes the companion spec (generated/openapi-openapi.yaml)
// to disk as a side effect of dispatch; with `resourceReferences: []` below that file
// would clobber the real infra/ output. So dispatch tests run in a sandbox that
// mirrors the `infra/` + `../.ycsf` layout via a symlink.
const SAVED_CWD = process.cwd();
const SANDBOX = mkdtempSync(join(tmpdir(), 'ref-dispatch-'));
const infraDir = join(SANDBOX, 'infra');
mkdirSync(infraDir, { recursive: true });
symlinkSync(join(ROOT, '.ycsf'), join(SANDBOX, '.ycsf'), 'dir');
afterAll(() => rmSync(SANDBOX, { recursive: true, force: true }));

const ARTIFACTS = () =>
  new Map<string, { type: string; value: unknown }>([
    ['user_service', { type: 'ycforge:function', value: { archivePath: '../.ycsf/artifacts/user_service/function.zip', entryPoint: 'main.handler' } }],
    [
      'analytics',
      {
        type: 'ycforge:docker-image',
        value: { image: 'cr.yandex/crps9jj0ui2e954vaj8m/analytics@sha256:85b68206325f6af4fc29f72b87ebcdbc94cf5c8fc086ef48a02abf40372e80f4' },
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
          'yandex_storage_object.frontend_artifact_json',
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

    it('golden user_service: конфигурация после applyExtensions совпадает с фикстурой (T039)', async () => {
      process.chdir(infraDir);
      try {
        const modelR = loadProjectModel(ROOT);
        if (modelR.kind !== 'ok') return;
        const registry = await buildRegistry();
        const d = await dispatch(modelR.model, registry, { artifacts: ARTIFACTS() });
        if (d.kind !== 'ok') return;
        // materialize-пайплайн применяет extensions до сериализации — golden
        // отражает финальный выход, поэтому сравниваем после applyExtensions.
        const ext = loadExtensions(ROOT);
        if (ext.kind !== 'ok') return;
        const applied = applyExtensions(d.resources, ext.data);
        if (applied.kind !== 'ok') return;
        const us = applied.resources.find((r) => r.type === 'yandex_function' && r.name === 'user_service');
        const golden = JSON.parse(readFileSync(join(FIXTURES, 'user_service.ycsf.tf.json'), 'utf8')) as {
          resource: { yandex_function: { user_service: unknown } };
        };
        expect(us?.configuration).toEqual(golden.resource.yandex_function.user_service);
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
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(ROOT, '../..');
const CLI = join(REPO, 'packages/pilot/dist/cli/index.js');
const FIXTURES = join(ROOT, 'test/fixtures');

const FUNCTION_HASH = 'b3cb172aef08c3c4c9fc5c95427d4ee06c1fa0c57405496b2dba2fde58aafda8';
const ANALYTICS_IMAGE =
  'cr.yandex/crps9jj0ui2e954vaj8m/analytics@sha256:85b68206325f6af4fc29f72b87ebcdbc94cf5c8fc086ef48a02abf40372e80f4';
const FRONTEND_JS = 'index-CII8GTtS.js';

interface TfResourceDoc {
  resource: Record<string, Record<string, Record<string, unknown>>>;
}
interface FunctionResource {
  runtime: string;
  entrypoint: string;
  user_hash: string;
  name: string;
  memory: number;
  execution_timeout: number;
  service_account_id: string;
  content: { zip_filename: string };
}
interface ContainerResource {
  image: Array<{ url: string }>;
  name: string;
  memory: number;
  service_account_id: string;
}
interface BucketResource {
  bucket: string;
  acl: string;
}
interface StorageObjectResource {
  bucket: string;
  key: string;
  source: string;
}
interface SpecResource {
  spec: string;
}
interface PlainPath {
  get: {
    'x-yc-apigateway-integration': {
      type: string;
      function_id?: string;
      container_id?: string;
      service_account_id?: string;
    };
  };
}
interface OpenApiCompanion {
  openapi: string;
  info: { title: string };
  paths: Record<string, PlainPath>;
  components: Record<string, unknown>;
}
interface OutputResource {
  value: string;
  description?: string;
}

function read(name: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURES, name), 'utf8'));
}
function sha256(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}
const artifactsReady = existsSync(join(ROOT, '.ycsf/artifacts'));
const cliReady = existsSync(CLI);

describe('golden fixtures', () => {
  const inventory = readdirSync(FIXTURES).sort();

  it('комплект из 6 golden-файлов, все валидны', () => {
    const files = inventory.filter((f) => f.endsWith('.tf.json') || f.endsWith('.yaml'));
    expect(files).toEqual([
      '99-ycsf-outputs.tf.json',
      'analytics.ycsf.tf.json',
      'frontend.ycsf.tf.json',
      'openapi-openapi.yaml',
      'openapi.ycsf.tf.json',
      'user_service.ycsf.tf.json',
    ]);
    for (const f of inventory) {
      if (f.endsWith('.tf.json')) {
        expect(() => JSON.parse(readFileSync(join(FIXTURES, f), 'utf8'))).not.toThrow();
      }
    }
  });

  it('user_service: nodejs22, hash-константа, относительный zip_filename, extension-патчи', () => {
    const doc = read('user_service.ycsf.tf.json') as TfResourceDoc;
    const fn = doc.resource.yandex_function.user_service as unknown as FunctionResource;
    expect(fn.runtime).toBe('nodejs22');
    expect(fn.entrypoint).toBe('main.handler');
    expect(fn.name).toBe('user-service');
    expect(fn.user_hash).toBe(FUNCTION_HASH);
    expect(fn.content.zip_filename).toBe('../.ycsf/artifacts/user_service/function.zip');
    // extensions.yaml: memory/timeout/service_account патчи применены materializer-ом
    expect(fn.memory).toBe(128);
    expect(fn.execution_timeout).toBe(5);
    expect(fn.service_account_id).toBe('ajefi3b58tak71g3ecp1');
    expect(JSON.stringify(doc)).not.toContain('<ROOT>');
    expect(JSON.stringify(doc)).not.toContain(ROOT);
  });

  it('analytics: provider-форма image-блока, name/memory, SA (золотая форма materializer-а)', () => {
    const doc = read('analytics.ycsf.tf.json') as TfResourceDoc;
    const c = doc.resource.yandex_serverless_container.analytics as unknown as ContainerResource;
    expect(c.image).toEqual([{ url: ANALYTICS_IMAGE }]);
    expect(c.name).toBe('analytics');
    expect(c.memory).toBe(128);
    expect(c.service_account_id).toBe('ajefi3b58tak71g3ecp1');
  });

  it('frontend: bucket + ровно 2 объекта с корректными именами и key', () => {
    const doc = read('frontend.ycsf.tf.json') as TfResourceDoc;
    const b = doc.resource.yandex_storage_bucket.frontend as unknown as BucketResource;
    expect(b.bucket).toBe('frontend-a31c4d4c');
    expect(b.acl).toBe('public-read');
    const objects = doc.resource.yandex_storage_object as unknown as Record<
      string,
      StorageObjectResource
    >;
    expect(Object.keys(objects).sort()).toEqual([
      'frontend_artifact_json',
      'frontend_assets_index_CII8GTtS_js',
      'frontend_index_html',
    ]);
    for (const o of Object.values(objects)) {
      expect(o.bucket).toBe('${yandex_storage_bucket.frontend.id}');
      expect(o.source).toMatch(/^<ROOT>\/\.ycsf\/artifacts\/frontend\/.+\.(json|html|js)$/);
    }
    expect(objects.frontend_index_html.key).toBe('index.html');
    expect(objects.frontend_assets_index_CII8GTtS_js.key).toBe(`assets/${FRONTEND_JS}`);
  });

  it('openapi: templatefile-спека + companion (реальные интеграции, flat refs)', () => {
    const doc = read('openapi.ycsf.tf.json') as TfResourceDoc;
    const gateway = doc.resource.yandex_api_gateway.openapi as unknown as SpecResource;
    expect(gateway.spec).toBe(
      '${templatefile("${path.module}/generated/openapi-openapi.yaml", { yandex_function_user_service_id = yandex_function.user_service.id, yandex_serverless_container_analytics_id = yandex_serverless_container.analytics.id })}',
    );
    const companion = JSON.parse(
      readFileSync(join(FIXTURES, 'openapi-openapi.yaml'), 'utf8'),
    ) as OpenApiCompanion;
    expect(companion.openapi).toBe('3.0.0');
    expect(companion.info.title).toBe('Reference API Gateway');
    expect(Object.keys(companion.paths).sort()).toEqual(['/analytics', '/analytics/kms', '/users']);
    expect(companion.paths['/users'].get['x-yc-apigateway-integration']).toEqual({
      type: 'cloud_functions',
      function_id: '${yandex_function_user_service_id}',
      service_account_id: 'ajefi3b58tak71g3ecp1',
    });
    for (const p of ['/analytics', '/analytics/kms']) {
      expect(companion.paths[p].get['x-yc-apigateway-integration']).toEqual({
        type: 'serverless_containers',
        container_id: '${yandex_serverless_container_analytics_id}',
        service_account_id: 'ajefi3b58tak71g3ecp1',
      });
    }
    expect(companion.components.securitySchemes).toEqual({});
  });

  it('99-ycsf-outputs: 6 выходов, сортировка ключей, user-описания', () => {
    const doc = read('99-ycsf-outputs.tf.json') as TfResourceDoc & { output: Record<string, OutputResource> };
    const keys = Object.keys(doc.output);
    expect(keys).toEqual([
      'analytics_container_id',
      'frontend_bucket_id',
      'gateway_id',
      'openapi_gateway_id',
      'user_service_function_id',
      'user_service_id',
    ]);
    for (const k of keys) {
      expect(doc.output[k].value).toMatch(
        /^\$\{yandex_(?:function|serverless_container|api_gateway|storage_bucket)\.[a-z_]+\.[a-z0-9_]+\}$/,
      );
    }
    expect(doc.output.gateway_id.description).toBe('API Gateway id (front entry)');
    expect(doc.output.user_service_id.description).toBe('Yandex Function id (user service)');
    expect(keys.some((k) => k.startsWith('ycsf_'))).toBe(false);
  });
});

describe
  .skipIf(!cliReady || !artifactsReady)('golden reproducibility', () => {
    it('rebuild user_service --no-cache → тот же sha256', () => {
      const r = spawnSync(process.execPath, [CLI, 'build', '--target', 'user_service', '--no-cache'], {
        cwd: ROOT,
        encoding: 'utf8',
        timeout: 180_000,
      });
      expect(r.status).toBe(0);
      expect(sha256(join(ROOT, '.ycsf/artifacts/user_service/function.zip'))).toBe(FUNCTION_HASH);
    });

    it('frontend bias: собраный dist воспроизводит frozen-имена объектов', () => {
      const r = spawnSync(process.execPath, [CLI, 'build', '--target', 'frontend'], {
        cwd: ROOT,
        encoding: 'utf8',
        timeout: 120_000,
      });
      expect(r.status).toBe(0);
      const dist = join(ROOT, '.ycsf/artifacts/frontend');
      expect(existsSync(join(dist, 'index.html'))).toBe(true);
      const assets = readdirSync(join(dist, 'assets'));
      expect(assets).toContain(FRONTEND_JS);
    });
  });
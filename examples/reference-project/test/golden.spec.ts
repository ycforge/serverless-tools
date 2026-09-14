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

const FUNCTION_HASH = '5e2dbc98b7d6351b613ade1944fab5228d59709a1989674cbfd55ff9cb00b493';
const ANALYTICS_IMAGE =
  'cr.yandex/ycforge/analytics@sha256:c16dea4fac51b380fee77eef61fc6344dfde1b306629bb02b4f1b3dbad8ce7f0';
const FRONTEND_JS = 'index-CII8GTtS.js';

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

  it('user_service: nodejs22, hash-константа, относительный zip_filename', () => {
    const doc = read('user_service.ycsf.tf.json') as any;
    const fn = doc.resource.yandex_function.user_service;
    expect(fn.runtime).toBe('nodejs22');
    expect(fn.entrypoint).toBe('main.handler');
    expect(fn.user_hash).toBe(FUNCTION_HASH);
    expect(fn.content.zip_filename).toBe('../.ycsf/artifacts/user_service/function.zip');
    expect(JSON.stringify(doc)).not.toContain('<ROOT>');
    expect(JSON.stringify(doc)).not.toContain(ROOT);
  });

  it('analytics: image и name зафиксированы (золотая форма materializer-а)', () => {
    const doc = read('analytics.ycsf.tf.json') as any;
    const c = doc.resource.yandex_serverless_container.analytics;
    expect(c.image).toBe(ANALYTICS_IMAGE);
    expect(c.name).toBe('analytics');
  });

  it('frontend: bucket + ровно 2 объекта с корректными именами и key', () => {
    const doc = read('frontend.ycsf.tf.json') as any;
    const b = doc.resource.yandex_storage_bucket.frontend;
    expect(b.bucket).toBe('frontend');
    expect(b.acl).toBe('public-read');
    const objects = doc.resource.yandex_storage_object;
    expect(Object.keys(objects).sort()).toEqual([
      'frontend_assets_index_CII8GTtS_js',
      'frontend_index_html',
    ]);
    for (const o of Object.values(objects) as any[]) {
      expect(o.bucket).toBe('yandex_storage_bucket.frontend.id');
      expect(o.source).toMatch(/^<ROOT>\/\.ycsf\/artifacts\/frontend\/.+\.(html|js)$/);
    }
    expect(objects.frontend_index_html.key).toBe('index.html');
    expect(objects.frontend_assets_index_CII8GTtS_js.key).toBe(`assets/${FRONTEND_JS}`);
  });

  it('openapi: spec-шаблон + companion (mock, securitySchemes пустой, без рефов)', () => {
    const doc = read('openapi.ycsf.tf.json') as any;
    expect(doc.resource.yandex_api_gateway.openapi.spec).toBe(
      'file("${path.module}/generated/openapi-openapi.yaml")',
    );
    const companion = JSON.parse(readFileSync(join(FIXTURES, 'openapi-openapi.yaml'), 'utf8'));
    expect(companion.openapi).toBe('3.0.0');
    expect(companion.info.title).toBe('Reference API Gateway');
    expect(Object.keys(companion.paths).sort()).toEqual(['/analytics/report', '/users']);
    for (const p of Object.values(companion.paths) as any[]) {
      expect(p.get['x-yc-apigateway-integration'].type).toBe('mock');
    }
    expect(companion.components.securitySchemes).toEqual({});
    expect(JSON.stringify(companion)).not.toContain('function_id');
  });

  it('99-ycsf-outputs: 6 выходов, сортировка ключей, user-описания', () => {
    const doc = read('99-ycsf-outputs.tf.json') as any;
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
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDocument } from 'yaml';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function yaml(file: string): Record<string, unknown> {
  const doc = parseDocument(readFileSync(join(ROOT, file), 'utf8'));
  if (doc.errors.length) throw new Error(`${file}: ${doc.errors[0].message}`);
  return (doc.toJS() ?? {}) as Record<string, unknown>;
}
function buildCfg(app: string): Record<string, unknown> {
  return yaml(join('apps', app, 'build_config.yaml')).build_config as Record<string, unknown>;
}
interface AppEntry {
  builder?: string;
  depends_on?: string[];
  source_path?: string;
}
interface BuildConfig {
  version: number;
  build_config?: unknown;
}

describe('ycsf-модель эталона', () => {
  it('все .ycsf/*.yaml и build_config.yaml несут version: 1', () => {
    for (const f of readdirSync(join(ROOT, '.ycsf')).filter((f) => f.endsWith('.yaml'))) {
      expect(yaml(join('.ycsf', f)).version).toBe(1);
    }
    for (const app of ['user_service', 'analytics', 'frontend', 'openapi']) {
      const cfg = parseDocument(
        readFileSync(join(ROOT, 'apps', app, 'build_config.yaml'), 'utf8'),
      ).toJS() as unknown as BuildConfig;
      expect(cfg.version).toBe(1);
      expect(cfg.build_config).toBeTruthy();
    }
  });

  it('apps.yaml: ровно 4 канонических приложения, openapi зависит от трёх', () => {
    const apps = (yaml('.ycsf/apps.yaml').apps ?? {}) as Record<string, AppEntry>;
    expect(Object.keys(apps).sort()).toEqual(['analytics', 'frontend', 'openapi', 'user_service']);
    expect(apps.user_service.builder).toBe('ycforge:function');
    expect(apps.analytics.builder).toBe('ycforge:docker-image');
    expect(apps.frontend.builder).toBe('ycforge:frontend');
    expect(apps.openapi.builder).toBe('ycforge:api-gateway');
    for (const app of ['user_service', 'analytics', 'frontend']) {
      expect(apps[app].depends_on).toEqual([]);
    }
    expect(apps.openapi.depends_on).toEqual(['analytics', 'frontend', 'user_service']);
    expect(apps.openapi.source_path).toBe('apps/openapi');
  });

  it('builders.yaml разделяет builder-ключи (ycforge:*) и materializer-ключи (yandex-*)', () => {
    const builders = yaml('.ycsf/builders.yaml');
    const b = builders.builders as Record<string, string>;
    const m = builders.materializers as Record<string, string>;
    for (const key of Object.keys(b)) {
      expect(key).toMatch(/^ycforge:/);
      // api-gateway: относительный путь к модулю composer-сборщика (D3/BRG);
      // остальные builder-ы и все materializer-ы — реестровые импорты @ycforge/*.
      const value = b[key];
      if (key === 'ycforge:api-gateway') {
        expect(value).toMatch(/^\.\.\/\.\.\/\.\.\/composer\/dist\/builder\/index\.js$/);
      } else {
        expect(value).toMatch(/^@ycforge\//);
      }
    }
    for (const key of Object.keys(m)) {
      expect(key).toMatch(/^yandex-/);
      expect(m[key]).toMatch(/^@ycforge\//);
    }
    expect(Object.keys(b).sort()).toEqual([
      'ycforge:api-gateway',
      'ycforge:docker-image',
      'ycforge:frontend',
      'ycforge:function',
    ]);
  });

  it('nested build_config: self-contained function, docker registry-ref, vite command, openapi entry', () => {
    const us = buildCfg('user_service');
    expect(us.entry).toBe('src/main.ts');
    expect(us.runtime).toBe('nodejs22');
    // Self-contained-only since the spec-028 toolchain fix: no declared
    // externals (the bundle inlines everything); out_filename defaults to
    // function.zip inside the builder.
    expect(us.external ?? []).toEqual([]);
    expect(us.out_filename ?? 'function.zip').toBe('function.zip');

    const an = buildCfg('analytics');
    const image = an.image as Record<string, unknown>;
    // spec 028 dev-mode: the reference project pins the already-pushed amd64
    // image (cr.yandex host, immutable digest) instead of building locally —
    // a local `docker build` on Apple Silicon yields arm64, which the YC
    // x86_64 container runtime cannot run (revision deploy → Internal error).
    expect(image.mode).toBe('registry-ref');
    expect(image.ref).toMatch(/^cr\.yandex\/.+\/analytics@sha256:[0-9a-f]{64}$/);
    expect(an.dockerfile).toBeUndefined();

    const fe = yaml('apps/frontend/build_config.yaml');
    const feCfg = fe.build_config as Record<string, unknown>;
    expect(feCfg.out_dir).toBe('dist');
    expect(feCfg.command).toContain('vite build');
    expect(Object.keys(fe.build_env ?? {}).sort()).toEqual(['VITE_API_BASE', 'VITE_ENV']);

    const oa = buildCfg('openapi');
    expect(oa.openapi_entry).toBe('openapi.yaml');
    for (const app of ['user_service', 'analytics', 'frontend', 'openapi']) {
      expect(yaml(`apps/${app}/build_config.yaml`).build_env ?? {}).not.toContain('TOKEN');
    }
  });

  it('extensions/outputs используют 3-сегментный IDL-грамматику (D6)', () => {
    const ext = (yaml('.ycsf/extensions.yaml').extensions ?? []) as Array<{ target: string }>;
    for (const e of ext) {
      expect(String(e.target)).toMatch(/^(functions|containers|gateways|buckets)\.[a-z_]+$/);
    }
    const outs = (yaml('.ycsf/outputs.yaml').outputs ?? {}) as Record<string, { value: string }>;
    expect(Object.keys(outs).sort()).toEqual(['gateway_id', 'user_service_id']);
    for (const o of Object.values(outs)) {
      expect(o.value).toMatch(/^(functions|containers|gateways|buckets)\.[a-z_]+\.[a-z0-9_]+$/);
    }
  });

  it('нет секретных литералов и {{$ENV}} в конфигах', () => {
    const files = [
      '.ycsf/apps.yaml',
      '.ycsf/builders.yaml',
      '.ycsf/extensions.yaml',
      '.ycsf/outputs.yaml',
      'apps/user_service/build_config.yaml',
      'apps/analytics/build_config.yaml',
      'apps/frontend/build_config.yaml',
      'apps/openapi/build_config.yaml',
    ];
    for (const f of files) {
      const text = readFileSync(join(ROOT, f), 'utf8');
      expect(text).not.toMatch(/\{\{\$ENV\}\}/);
    }
    expect(readFileSync(join(ROOT, '.ycsf/extensions.yaml'), 'utf8')).toContain('containers.analytics');
    expect(readFileSync(join(ROOT, '.ycsf/extensions.yaml'), 'utf8')).toContain('service_account_id');
  });
});
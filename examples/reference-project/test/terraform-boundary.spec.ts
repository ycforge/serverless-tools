import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, rmSync, cpSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BOUNDARY = join(ROOT, 'test/fixtures/boundary');
const LOCK = join(ROOT, 'infra/.terraform.lock.hcl');

const EXPECTED_PLAN_FAIL = "one of 'token' or 'service_account_key_file' should be specified";

function copyBoundaryTree(dir: string): string {
  const infra = join(dir, 'infra');
  cpSync(BOUNDARY, infra, { recursive: true });
  cpSync(join(ROOT, 'infra/main.tf'), join(infra, 'main.tf'));
  return infra;
}

// T041: границы terraform CLI — validate на provider-совместимых boundary-фикстурах
// и plan без credentials (стоп ровно на provider-границе, без вызовов Yandex Cloud).
// Требуют установленного провайдера yandex (terraform init, сеть до registry.terraform.io).
// Здесь провайдер недоступен офлайн → describe gated на probeInit.
function probeInit(): boolean {
  const dir = mkdtempSync(join(tmpdir(), 'tf-probe-'));
  try {
    const infra = copyBoundaryTree(dir);
    const r = spawnSync('terraform', ['-chdir=' + infra, 'init', '-input=false'], {
      encoding: 'utf8',
      timeout: 300_000,
    });
    return r.status === 0;
  } catch {
    return false;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const tfReady = (() => {
  const probe = spawnSync('terraform', ['version'], { encoding: 'utf8' });
  if (probe.status !== 0) return false;
  return probeInit();
})();

describe.skipIf(!tfReady)('terraform CLI границы (T041)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tf-bd-'));
  let infra: string;

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('init: lock-файл закоммичен, провайдер yandex ~> 0.145 (повторимость)', () => {
    infra = copyBoundaryTree(dir);
    expect(() => readFileSync(join(ROOT, 'infra/main.tf'), 'utf8')).not.toThrow();
    const lock = readFileSync(LOCK, 'utf8');
    expect(lock).toContain('registry.terraform.io/yandex-cloud/yandex');
    expect(lock).toContain('0.145.0');
    const r = spawnSync('terraform', ['-chdir=' + infra, 'init', '-input=false'], {
      encoding: 'utf8',
      timeout: 300_000,
      env: { ...process.env, YC_TOKEN: '' },
    });
    expect(r.status).toBe(0);
  }, 320_000);

  it('validate: 0 диагностик на boundary-фикстурах (provider-совместимые формы)', () => {
    const r = spawnSync('terraform', ['-chdir=' + infra, 'validate', '-no-color'], {
      encoding: 'utf8',
      timeout: 300_000,
      env: { ...process.env, YC_TOKEN: '' },
    });
    expect(r.status).toBe(0);
    expect(`${r.stdout ?? ''}\n${r.stderr ?? ''}`).toContain(
      'Success! The configuration is valid.',
    );
  }, 320_000);

  it('plan без credentials: не-zero exit, диагностика провайдера до вызовов Yandex Cloud', () => {
    const r = spawnSync('terraform', [
      '-chdir=' + infra,
      'plan',
      '-no-color',
      '-input=false',
      '-detailed-exitcode',
    ], {
      encoding: 'utf8',
      timeout: 300_000,
      env: { ...process.env, YC_TOKEN: '', SERVICE_ACCOUNT_KEY_FILE: '' },
    });
    expect(r.status).not.toBe(0);
    const out = `${r.stdout ?? ''}\n${r.stderr ?? ''}`;
    expect(out).toContain(EXPECTED_PLAN_FAIL);
    expect(out.toLowerCase()).not.toContain('getusercontent');
    expect(out.toLowerCase()).not.toContain('serverless.cloud.yandex');
  }, 320_000);
});
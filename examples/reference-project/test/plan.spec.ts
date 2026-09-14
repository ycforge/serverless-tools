import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PKG = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

describe('plan-скрипты и границы стадий', () => {
  it('plan = check → build → materialize (cwd=infra, -p ..) → terraform init/validate/plan', () => {
    const plan = PKG.scripts.plan as string;
    const idx = {
      check: plan.indexOf('check'),
      build: plan.indexOf('build'),
      materialize: plan.indexOf('materialize'),
      init: plan.indexOf('terraform init'),
      validate: plan.indexOf('terraform validate'),
      tfplan: plan.indexOf('terraform plan'),
    };
    expect(idx.check).toBeGreaterThanOrEqual(0);
    expect(idx.build).toBeGreaterThan(idx.check);
    expect(idx.materialize).toBeGreaterThan(idx.build);
    expect(idx.init).toBeGreaterThan(idx.materialize);
    expect(idx.validate).toBeGreaterThan(idx.init);
    expect(idx.tfplan).toBeGreaterThan(idx.validate);
  });

  it('CLI вызывается по реальному пути dist (workaround D7), не pnpm-shim', () => {
    for (const s of ['check', 'check:validate-tf', 'build', 'materialize', 'plan']) {
      const script = PKG.scripts[s] as string;
      expect(script).toMatch(/node (?:\.\.\/){2,3}packages\/pilot\/dist\/cli\/index\.js/);
      expect(script).not.toMatch(/(^|&|\s)ycsf\b/);
    }
  });

  it('стадии изолированы: check, check:validate-tf, build, materialize, test', () => {
    expect(PKG.scripts.check).toMatch(/\bcheck( --validate-tf)?$/);
    expect(PKG.scripts['check:validate-tf']).toMatch(/check --validate-tf$/);
    expect(PKG.scripts.build).toMatch(/\bbuild$/);
    const m = PKG.scripts.materialize;
    expect(m).toMatch(/^cd infra && node /);
    expect(m).toContain('/packages/pilot/dist/cli/index.js');
    expect(m).toContain('-p ..');
    expect(m.trimEnd().endsWith('materialize')).toBe(true);
    expect(PKG.scripts.test).toBe('vitest run');
  });

  it('инфраструктура сборки: pnpm, tsconfig strict + composite, vitest-конфиг', () => {
    expect(PKG.packageManager).toMatch(/^pnpm@/);
    const ts = JSON.parse(readFileSync(join(ROOT, 'tsconfig.json'), 'utf8'));
    expect(ts.compilerOptions.strict).toBe(true);
    const vitest = readFileSync(join(ROOT, 'vitest.config.ts'), 'utf8');
    expect(vitest).toContain('test/**/*.spec.ts');
  });

  it('infra/main.tf пинит provider yandex ~> 0.145 (boundary-константа схемы)', () => {
    const tf = readFileSync(join(ROOT, 'infra/main.tf'), 'utf8');
    expect(tf).toMatch(/~> 0\.145\.0/);
  });
});
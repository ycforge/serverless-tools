import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PML_ENV_NOT_SET, PML_ENV_UNRESOLVED, type BuildConfig } from '../../src/contracts/index.js';
import { prepareBuildEnv } from '../../src/index.js';
import { createTempProject, removeTempProject, type TempProject } from '../helpers/temp-project.js';

// quickstart.md Sc1–Sc10 against the real prepareBuildEnv (hermetic — a
// BuildConfig object + optional snapshot; Sc10 uses a .env fixture).

// analytics — mixed build_env modes + interpolation in build_config (quickstart.md Setup)
const ANALYTICS: BuildConfig = {
  build_config: {
    image: {
      repository: 'cr.yandex/ya_mob_ya_lublu_yandex',
      tag: '{{$ANALYTICS_IMAGE_TAG}}',
    },
    dockerfile: '{{$ANALYTICS_DOCKERFILE}}',
    url: 'https://{{$REG}}/{{$REPO}}',
  },
  build_env: {
    NPM_TOKEN: null,
    HELLO_TEXT: 'привет, мир!',
    REGISTRY: '{{$DOCKER_REGISTRY}}',
  },
};

function expectInvalid(result: ReturnType<typeof prepareBuildEnv>): Extract<
  ReturnType<typeof prepareBuildEnv>,
  { kind: 'invalid' }
> {
  expect(result.kind).toBe('invalid');
  if (result.kind !== 'invalid') throw new Error('expected invalid result');
  return result;
}

describe('build-env quickstart (Sc1–Sc10)', () => {
  let project: TempProject;

  beforeEach(() => {
    project = createTempProject();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    removeTempProject(project);
  });

  it('Sc1: valid mixed build_env + build_config interpolation → ok (US-1/2, FR-001/002/003/006)', () => {
    const result = prepareBuildEnv('analytics', ANALYTICS, {
      ANALYTICS_IMAGE_TAG: 'v2',
      ANALYTICS_DOCKERFILE: 'Dockerfile',
      REG: 'foo',
      REPO: 'bar',
      NPM_TOKEN: 'tok',
      DOCKER_REGISTRY: 'reg.example',
    });
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.resolvedEnv).toEqual({
      NPM_TOKEN: 'tok',
      HELLO_TEXT: 'привет, мир!',
      REGISTRY: 'reg.example',
    });
    const config = result.buildConfig as {
      image: { repository: string; tag: string };
      dockerfile: string;
      url: string;
    };
    expect(config.image.tag).toBe('v2');
    expect(config.dockerfile).toBe('Dockerfile');
    expect(config.url).toBe('https://foo/bar');
  });

  it('Sc2: null build_env entry resolves from the snapshot (US-2, FR-004)', () => {
    const result = prepareBuildEnv(
      'user_service',
      { build_config: {}, build_env: { NPM_TOKEN: null } },
      { NPM_TOKEN: 's3cr3t' },
    );
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.resolvedEnv.NPM_TOKEN).toBe('s3cr3t');
  });

  it('Sc3: literal build_env passthrough, unchanged, no requirement (US-1 AC3, FR-005)', () => {
    const result = prepareBuildEnv(
      'analytics',
      { build_config: {}, build_env: { HELLO_TEXT: 'привет, мир!' } },
      {},
    );
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.resolvedEnv.HELLO_TEXT).toBe('привет, мир!');
  });

  it('Sc4: interpolated build_env substituted (US-2, FR-002)', () => {
    const result = prepareBuildEnv(
      'analytics',
      { build_config: {}, build_env: { REGISTRY: '{{$DOCKER_REGISTRY}}' } },
      { DOCKER_REGISTRY: 'reg.example' },
    );
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.resolvedEnv.REGISTRY).toBe('reg.example');
  });

  it('Sc5: unresolved-after-load → invalid, PML_ENV_UNRESOLVED with app/field/var; builder never invoked (US-3, FR-007/008)', () => {
    const result = prepareBuildEnv(
      'analytics',
      { build_config: { dockerfile: '{{$ANALYTICS_DOCKERFILE}}' }, build_env: {} },
      { ANALYTICS_DOCKERFILE: '' },
    );
    const invalid = expectInvalid(result);
    expect(invalid.errors.length).toBeGreaterThan(0);
    const diagnostic = invalid.errors[0];
    expect(diagnostic?.code).toBe(PML_ENV_UNRESOLVED);
    expect(diagnostic?.app).toBe('analytics');
    expect(diagnostic?.field).toBe('build_config');
    expect(diagnostic?.message).toContain('ANALYTICS_DOCKERFILE');
  });

  it('Sc6: cross-namespace splice — only {{$NAME}} substituted, ${...} untouched (FR-010 / SC-006)', () => {
    const result = prepareBuildEnv(
      'x',
      {
        build_config: { cmd: 'run ${TFO_VAR} --port {{$PORT}} ${resources.functions.fn.id}' },
        build_env: {},
      },
      { PORT: '8080' },
    );
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    const config = result.buildConfig as { cmd: string };
    expect(config.cmd).toBe('run ${TFO_VAR} --port 8080 ${resources.functions.fn.id}');
  });

  it('Sc7: empty build_config / build_env → ok, trivial empty resolved env (FR-015)', () => {
    const result = prepareBuildEnv('frontend', { build_config: {}, build_env: {} }, {});
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.resolvedEnv).toEqual({});
    expect(result.buildConfig).toEqual({});
  });

  it('Sc8: per-app isolation — each app resolves only its own config, model unchanged (FR-014)', () => {
    const snapshot = { A: 'a', B: 'b' };
    const ap = prepareBuildEnv('appA', { build_config: {}, build_env: { X: '{{$A}}' } }, snapshot);
    const bp = prepareBuildEnv('appB', { build_config: {}, build_env: { X: '{{$B}}' } }, snapshot);
    expect(ap.kind).toBe('ok');
    expect(bp.kind).toBe('ok');
    if (ap.kind !== 'ok' || bp.kind !== 'ok') return;
    expect(ap.resolvedEnv.X).toBe('a');
    expect(bp.resolvedEnv.X).toBe('b');
  });

  it('Sc9: multiple refs per line + duplicate ref resolve to the same value (US-1 AC2, Edge Case)', () => {
    const result = prepareBuildEnv(
      'a',
      {
        build_config: { url: 'https://{{$REG}}/{{$REPO}}?token={{$TOKEN}}' },
        build_env: { T: '{{$TOKEN}}' },
      },
      { REG: 'registry', REPO: 'my-repo', TOKEN: 't' },
    );
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    const config = result.buildConfig as { url: string };
    expect(config.url).toBe('https://registry/my-repo?token=t');
    expect(result.resolvedEnv.T).toBe('t');
  });

  it('Sc10: deterministic snapshot — binary identical output, .env file ignored, no defaults (FR-012/013, SC-002)', () => {
    project.write('.env', 'FOO=from_file\n');
    const snapshot = { FOO: 'bar' };
    const config: BuildConfig = {
      build_config: { v: '{{$FOO}}' },
      build_env: { F: '{{$FOO}}' },
    };
    const first = prepareBuildEnv('a', config, snapshot);
    const second = prepareBuildEnv('a', config, snapshot);
    expect(first).toEqual(second);
    expect(first.kind).toBe('ok');
    if (first.kind !== 'ok') return;
    expect(first.resolvedEnv.F).toBe('bar');
    const interpolated = first.buildConfig as { v: string };
    expect(interpolated.v).toBe('bar');
  });

  it('edge: PML_ENV_NOT_SET (load) and PML_ENV_UNRESOLVED (runtime) are distinct constants (FR-008)', () => {
    expect(PML_ENV_NOT_SET).not.toBe(PML_ENV_UNRESOLVED);
    const result = prepareBuildEnv(
      'a',
      { build_config: {}, build_env: { R: '{{$MISSING_AT_RUNTIME}}' } },
      {},
    );
    const invalid = expectInvalid(result);
    expect(invalid.errors.every((e) => e.code === PML_ENV_UNRESOLVED)).toBe(true);
    expect(invalid.errors.some((e) => e.code === PML_ENV_NOT_SET)).toBe(false);
  });

  it('SC-005: 5-app / 10-ENV project prepares well under 50ms (perf smoke)', () => {
    const snapshot: Record<string, string> = {};
    for (let i = 0; i < 10; i++) {
      snapshot[`APP_ENV_${i}`] = `value-${i}`;
    }
    for (let app = 0; app < 5; app++) {
      prepareBuildEnv(
        `app_${app}`,
        { build_config: { tag: '{{$APP_ENV_0}}' }, build_env: { E: '{{$APP_ENV_4}}' } },
        snapshot,
      );
    }
    const start = Date.now();
    for (let app = 0; app < 5; app++) {
      prepareBuildEnv(
        `app_${app}`,
        { build_config: { tag: '{{$APP_ENV_0}}' }, build_env: { E: '{{$APP_ENV_4}}' } },
        snapshot,
      );
    }
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(50);
  });
});
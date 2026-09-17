import { afterEach, describe, expect, it, vi } from 'vitest';

import { PML_ENV_UNRESOLVED, type BuildConfig } from '../../src/contracts/index.js';
import { prepareBuildEnv } from '../../src/build-env/index.js';

// US-3/US-4 (P1/P2) + spec `BuildEnvResolutionResult` invariant (research
// decision 7): success { kind:'ok' } and failure { kind:'invalid', errors }
// are mutually exclusive — never mixed; never throws for an unresolved var.
// Snapshot semantics (research decision 2 / SC-002).

const ANALYTICS: BuildConfig = {
  build_config: {
    image: { tag: '{{$ANALYTICS_IMAGE_TAG}}' },
    url: 'https://{{$REG}}/{{$REPO}}',
  },
  build_env: {
    NPM_TOKEN: null,
    HELLO_TEXT: 'привет, мир!',
    REGISTRY: '{{$DOCKER_REGISTRY}}',
  },
};

const OK_SNAPSHOT = {
  ANALYTICS_IMAGE_TAG: 'v2',
  REG: 'foo',
  REPO: 'bar',
  NPM_TOKEN: 'tok',
  DOCKER_REGISTRY: 'reg.example',
};

describe('prepareBuildEnv (spec BuildEnvResolutionResult invariant / research decision 7)', () => {
  it('valid mixed config → { kind: "ok" } with resolvedEnv + interpolated buildConfig', () => {
    const result = prepareBuildEnv('analytics', ANALYTICS, OK_SNAPSHOT);
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.resolvedEnv).toEqual({
      NPM_TOKEN: 'tok',
      HELLO_TEXT: 'привет, мир!',
      REGISTRY: 'reg.example',
    });
    expect(result.buildConfig).toEqual({
      image: { tag: 'v2' },
      url: 'https://foo/bar',
    });
  });

  it('unresolved var → { kind: "invalid" } with only PML_ENV_UNRESOLVED errors — never mixed', () => {
    const { DOCKER_REGISTRY: _missing, ...partial } = OK_SNAPSHOT;
    void _missing;
    const result = prepareBuildEnv('analytics', ANALYTICS, partial);
    expect(result.kind).toBe('invalid');
    if (result.kind !== 'invalid') return;
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.every((e) => e.code === PML_ENV_UNRESOLVED)).toBe(true);
  });

  it('never throws for an unresolved variable — returns errors instead (research decision 7)', () => {
    expect(() =>
      prepareBuildEnv('a', { build_config: { x: '{{$MISSING}}' }, build_env: {} }, {}),
    ).not.toThrow();
  });
});

describe('prepareBuildEnv snapshot semantics (research decision 2 / SC-002)', () => {
  const CONFIG: BuildConfig = {
    build_config: { x: '{{$FOO}}' },
    build_env: { F: '{{$FOO}}' },
  };

  it('injected snapshot is hermetic and parallel-safe; same inputs → binary identical output', () => {
    const snapshot = { FOO: 'bar' };
    const first = prepareBuildEnv('a', CONFIG, snapshot);
    const second = prepareBuildEnv('a', CONFIG, snapshot);
    expect(first).toEqual(second);
  });

  it('defaults to the real process.env recorded once at entry (vi.stubEnv path works)', () => {
    vi.stubEnv('PILOT_TEST_STUB_VAR', 'stubbed');
    const result = prepareBuildEnv('a', {
      build_config: { v: '{{$PILOT_TEST_STUB_VAR}}' },
      build_env: {},
    });
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.buildConfig).toEqual({ v: 'stubbed' });
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});
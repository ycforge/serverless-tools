import { describe, expect, it } from 'vitest';

import { PML_ENV_UNRESOLVED } from '../../src/contracts/index.js';
import { resolveBuildEnv } from '../../src/build-env/resolve.js';

// US-2 (P1) + FR-004/005/002/006/014/015, research decision 3: build_env
// resolution in declaration order — null → snapshot, literal → as-is,
// interpolated → substitute; Record<string,string> no-null (FR-006).

const CTX = { appId: 'analytics', file: 'analytics/build_config.yaml' };

describe('resolveBuildEnv (US-2, FR-004/005/002, research decision 3)', () => {
  it('resolves null / literal / interpolated entries in declaration order into all-string Record', () => {
    const { resolvedEnv, errors } = resolveBuildEnv(
      {
        NPM_TOKEN: null,
        HELLO_TEXT: 'привет, мир!',
        REGISTRY: '{{$DOCKER_REGISTRY}}',
      },
      CTX,
      { NPM_TOKEN: 'tok', DOCKER_REGISTRY: 'reg.example' },
    );
    expect(errors).toEqual([]);
    expect(resolvedEnv).toEqual({
      NPM_TOKEN: 'tok',
      HELLO_TEXT: 'привет, мир!',
      REGISTRY: 'reg.example',
    });
    expect(Object.keys(resolvedEnv)).toEqual(['NPM_TOKEN', 'HELLO_TEXT', 'REGISTRY']);
  });

  it('null entry with empty-string snapshot value → PML_ENV_UNRESOLVED (field = ENV_NAME, FR-004/007)', () => {
    const { resolvedEnv, errors } = resolveBuildEnv({ NPM_TOKEN: null }, CTX, {
      NPM_TOKEN: '',
    });
    expect('NPM_TOKEN' in resolvedEnv).toBe(false);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      code: PML_ENV_UNRESOLVED,
      app: 'analytics',
      field: 'NPM_TOKEN',
      file: 'analytics/build_config.yaml',
    });
    expect(errors[0]?.message).toContain('NPM_TOKEN');
  });

  it('null entry with unset snapshot value → PML_ENV_UNRESOLVED (US-2 AC2)', () => {
    const { errors } = resolveBuildEnv({ NPM_TOKEN: null }, CTX, {});
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ code: PML_ENV_UNRESOLVED, field: 'NPM_TOKEN' });
  });

  it('literal entry is passed as-is with no requirement (FR-005)', () => {
    const { resolvedEnv, errors } = resolveBuildEnv({ HELLO_TEXT: 'hi' }, CTX, {});
    expect(errors).toEqual([]);
    expect(resolvedEnv).toEqual({ HELLO_TEXT: 'hi' });
  });

  it('interpolated entry is substituted (FR-002); an unresolved interpolated var → PML_ENV_UNRESOLVED field = ENV_NAME (US-2 AC3)', () => {
    const { resolvedEnv, errors } = resolveBuildEnv({ REGISTRY: '{{$DOCKER_REGISTRY}}' }, CTX, {
      DOCKER_REGISTRY: 'reg.example',
    });
    expect(errors).toEqual([]);
    expect(resolvedEnv.REGISTRY).toBe('reg.example');

    const unresolved = resolveBuildEnv({ REGISTRY: '{{$UNDEFINED}}' }, CTX, {});
    expect(unresolved.errors).toHaveLength(1);
    expect(unresolved.errors[0]).toMatchObject({
      code: PML_ENV_UNRESOLVED,
      field: 'REGISTRY',
    });
    expect(unresolved.errors[0]?.message).toContain('UNDEFINED');
  });
});

describe('resolveBuildEnv — empty input (FR-015)', () => {
  it('empty build_env → trivial empty resolved env, not an error', () => {
    const { resolvedEnv, errors } = resolveBuildEnv({}, CTX, {});
    expect(errors).toEqual([]);
    expect(resolvedEnv).toEqual({});
  });
});

describe('resolveBuildEnv — per-app isolation (FR-014, research decision 6/1)', () => {
  it('two apps resolve only their own BuildConfig; the loaded build_env stays unchanged', () => {
    const envA = { X: '{{$A}}' };
    const envB = { X: '{{$B}}' };
    const a = resolveBuildEnv(envA, { appId: 'appA', file: 'appA/build_config.yaml' }, { A: 'a', B: 'b' });
    const b = resolveBuildEnv(envB, { appId: 'appB', file: 'appB/build_config.yaml' }, { A: 'a', B: 'b' });
    expect(a.resolvedEnv).toEqual({ X: 'a' });
    expect(b.resolvedEnv).toEqual({ X: 'b' });
    expect(a.errors).toEqual([]);
    expect(b.errors).toEqual([]);
    expect(envA).toEqual({ X: '{{$A}}' });
    expect(envB).toEqual({ X: '{{$B}}' });
  });
});
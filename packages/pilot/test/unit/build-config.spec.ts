import { afterEach, describe, expect, it } from 'vitest';

import { PML_INVALID } from '../../src/contracts/index.js';
import { loadAppBuildConfig } from '../../src/model/build-config.js';
import {
  createTempProject,
  removeTempProject,
  type TempProject,
} from '../helpers/temp-project.js';

// US-1 AC3 / US-5 / FR-003 / FR-011: <app>/build_config.yaml → BuildConfig.
// `build_config` is opaque to C (builder validates internals, FR-011);
// `build_env` is string | null. Missing file → empty BuildConfig.

let project: TempProject | undefined;

afterEach(() => {
  if (project) {
    removeTempProject(project);
    project = undefined;
  }
});

function makeProject(files: Record<string, string>): string {
  project = createTempProject(files);
  return project.root;
}

describe('loadAppBuildConfig (US-1, FR-003/FR-011)', () => {
  it('reads build_config (opaque) + build_env (string | null)', () => {
    const root = makeProject({
      'analytics/build_config.yaml': `version: 1
build_config:
  dockerfile: Dockerfile
  meta:
    tag: v1
    nested: { value: 1 }
build_env:
  NPM_TOKEN:
  IMAGE_TAG: "latest"
`,
    });
    const result = loadAppBuildConfig(root, 'analytics');
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.build_config.build_config).toEqual({
      dockerfile: 'Dockerfile',
      meta: { tag: 'v1', nested: { value: 1 } },
    });
    expect(result.build_config.build_env).toEqual({ NPM_TOKEN: null, IMAGE_TAG: 'latest' });
  });

  it('ignores arbitrary builder-specific build_config internals (FR-011)', () => {
    const root = makeProject({
      'analytics/build_config.yaml': `version: 1
build_config:
  whatever_the_builder_wants:
    - list
  other: { deep: [1, 2, 3] }
`,
    });
    const result = loadAppBuildConfig(root, 'analytics');
    expect(result.kind).toBe('ok');
  });
});

describe('loadAppBuildConfig — missing file / partial config (US-5, FR-003, spec Edge Case)', () => {
  it('returns { build_config: {}, build_env: {} } when <app>/build_config.yaml is absent', () => {
    const root = makeProject({});
    const result = loadAppBuildConfig(root, 'simple_app');
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.build_config).toEqual({ build_config: {}, build_env: {} });
  });

  it('accepts a file with only build_env (build_config defaults to {})', () => {
    const root = makeProject({
      'simple_app/build_config.yaml': 'version: 1\nbuild_env:\n  TOKEN: "abc"\n',
    });
    const result = loadAppBuildConfig(root, 'simple_app');
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.build_config).toEqual({
      build_config: {},
      build_env: { TOKEN: 'abc' },
    });
  });
});

describe('loadAppBuildConfig — shape validation (data-model validation rules)', () => {
  it('rejects a non-mapping build_config with PML_INVALID', () => {
    const root = makeProject({
      'a/build_config.yaml': 'version: 1\nbuild_config: [1, 2]\n',
    });
    const result = loadAppBuildConfig(root, 'a');
    expect(result.kind).toBe('invalid');
    if (result.kind !== 'invalid') return;
    expect(result.errors[0]?.code).toBe(PML_INVALID);
  });

  it('rejects a non-string/non-null build_env value with PML_INVALID', () => {
    const root = makeProject({
      'a/build_config.yaml': 'version: 1\nbuild_env:\n  TOKEN: 42\n',
    });
    const result = loadAppBuildConfig(root, 'a');
    expect(result.kind).toBe('invalid');
    if (result.kind !== 'invalid') return;
    expect(result.errors[0]?.code).toBe(PML_INVALID);
  });
});
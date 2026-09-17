import { describe, expect, it } from 'vitest';

import { PML_ENV_UNRESOLVED } from '../../src/contracts/index.js';
import {
  interpolateBuildConfig,
  interpolateString,
} from '../../src/build-env/interpolate.js';

// US-1 (P1/P2) + FR-001/002/003/007/008/010: `{{$NAME}}` substitution over
// build_config string leaves (deep) and build_env values; literal passthrough;
// cross-namespace untouched; unresolved → PML_ENV_UNRESOLVED fail-fast.

const CTX = { appId: 'analytics', file: 'analytics/build_config.yaml' };

describe('interpolateBuildConfig (FR-001/FR-003, US-1)', () => {
  it('interpolates {{$NAME}} in deep leaves: nested objects + arrays, non-string scalars skipped (FR-001)', () => {
    const buildConfig = {
      image: {
        repository: 'cr.yandex/example',
        tag: '{{$ANALYTICS_IMAGE_TAG}}',
      },
      dockerfile: ['{{$ANALYTICS_DOCKERFILE}}', '{{$SECOND}}'],
      port: 8080,
      flags: { enabled: true, replicaCount: 3 },
    };
    const { buildConfig: out, errors } = interpolateBuildConfig(buildConfig, CTX, {
      ANALYTICS_IMAGE_TAG: 'v2',
      ANALYTICS_DOCKERFILE: 'Dockerfile',
      SECOND: 'x',
    });
    expect(errors).toEqual([]);
    expect(out).toEqual({
      image: { repository: 'cr.yandex/example', tag: 'v2' },
      dockerfile: ['Dockerfile', 'x'],
      port: 8080,
      flags: { enabled: true, replicaCount: 3 },
    });
  });

  it('zero-to-more occurrences per line; a literal (no refs) string passes through unchanged (FR-003, US-1 AC2/AC3)', () => {
    const { buildConfig: multi, errors: first } = interpolateBuildConfig(
      { url: 'prefix-{{$A}}-{{$B}}' },
      CTX,
      { A: '1', B: '2' },
    );
    expect(first).toEqual([]);
    expect(multi).toEqual({ url: 'prefix-1-2' });

    const { buildConfig: literal, errors: second } = interpolateBuildConfig(
      { text: 'привет, мир!' },
      CTX,
      {},
    );
    expect(second).toEqual([]);
    expect(literal).toEqual({ text: 'привет, мир!' });
  });

  it('produces a FRESH interpolated tree — the input build_config is never mutated (research decision 1)', () => {
    const buildConfig = { tag: '{{$T}}', nested: { a: '{{$A}}' } };
    const { buildConfig: out, errors } = interpolateBuildConfig(buildConfig, CTX, {
      T: 't',
      A: 'a',
    });
    expect(errors).toEqual([]);
    expect(out).toEqual({ tag: 't', nested: { a: 'a' } });
    expect(buildConfig).toEqual({ tag: '{{$T}}', nested: { a: '{{$A}}' } });
  });
});

describe('interpolateString (FR-002, US-2)', () => {
  it('substitutes {{$NAME}} in build_env string values, carrying the entry field (FR-002)', () => {
    const { value, errors } = interpolateString('{{$DOCKER_REGISTRY}}', CTX, 'REGISTRY', {
      DOCKER_REGISTRY: 'reg.example',
    });
    expect(errors).toEqual([]);
    expect(value).toBe('reg.example');
  });
});

describe('cross-namespace: never matches ${...} / ${resources...} (FR-010, SC-006, research decision 4)', () => {
  it('substitutes only {{$NAME}}; Terraform and B→Materializer splices stay untouched', () => {
    const text = 'run ${TFO_VAR} --port {{$PORT}} ${resources.functions.fn.id}';
    const { value, errors } = interpolateString(text, CTX, 'build_config', { PORT: '8080' });
    expect(errors).toEqual([]);
    expect(value).toBe('run ${TFO_VAR} --port 8080 ${resources.functions.fn.id}');
  });
});

describe('residual guard (US-3, FR-007/008, SC-003/004)', () => {
  it('empty-string snapshot value → PML_ENV_UNRESOLVED (app/field/var); ref NOT silently substituted', () => {
    const { value, errors } = interpolateString('{{$ANALYTICS_DOCKERFILE}}', CTX, 'build_config', {
      ANALYTICS_DOCKERFILE: '',
    });
    expect(value).toBe('{{$ANALYTICS_DOCKERFILE}}');
    expect(errors).toHaveLength(1);
    const diagnostic = errors[0];
    expect(diagnostic).toMatchObject({
      code: PML_ENV_UNRESOLVED,
      app: 'analytics',
      field: 'build_config',
      file: 'analytics/build_config.yaml',
    });
    expect(diagnostic?.message).toContain('ANALYTICS_DOCKERFILE');
  });

  it('absent var reference → the same PML_ENV_UNRESOLVED diagnostic (US-3)', () => {
    const { errors } = interpolateString('{{$MISSING}}', CTX, 'build_config', {});
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      code: PML_ENV_UNRESOLVED,
      app: 'analytics',
      field: 'build_config',
      file: 'analytics/build_config.yaml',
    });
  });

  it('collects ALL unresolved refs in one pass (multiple per string, one diagnostic each)', () => {
    const { errors } = interpolateString('{{$A}} {{$B}}', CTX, 'build_config', {});
    expect(errors).toHaveLength(2);
    expect(errors.map((e) => e.message)).toEqual([
      expect.stringContaining('A'),
      expect.stringContaining('B'),
    ]);
  });
});
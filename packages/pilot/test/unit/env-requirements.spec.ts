import { describe, expect, it } from 'vitest';

import { PML_ENV_NOT_SET, type BuildConfig } from '../../src/contracts/index.js';
import {
  checkEnvRequirements,
  extractEnvRequirements,
} from '../../src/model/env-requirements.js';

// US-4 / FR-009 / FR-010 / research decision 4: `{{$NAME}}` extraction from
// build_config string leaves + build_env values; bare `null` build_env entries
// are requirements too; presence in process.env checked at load; collect-all.

const BC_WITH_REFS: BuildConfig = {
  build_config: {
    dockerfile: '{{$ANALYTICS_DOCKERFILE}}',
    meta: { tag: 'v1', path: '{{$IMAGE_PATH}}' },
  },
  build_env: {
    NPM_TOKEN: null,
    LITERAL: 'a literal value',
    REF: '{{$REF_VAR}}',
  },
};

const NO_ENV = {};

describe('extractEnvRequirements (FR-009/FR-010, research decision 4)', () => {
  it('extracts {{$NAME}} from nested build_config string leaves + build_env values', () => {
    const requirements = extractEnvRequirements('analytics', BC_WITH_REFS, NO_ENV);
    const byName = new Map(requirements.map((r) => [r.name, r]));
    expect(byName.get('ANALYTICS_DOCKERFILE')).toMatchObject({
      name: 'ANALYTICS_DOCKERFILE',
      source: 'build_config',
      app_id: 'analytics',
    });
    expect(byName.get('IMAGE_PATH')).toMatchObject({
      name: 'IMAGE_PATH',
      source: 'build_config',
    });
    expect(byName.get('REF_VAR')).toMatchObject({ name: 'REF_VAR', source: 'build_env' });
    expect(byName.size).toBe(4);
  });

  it('treats a bare null build_env entry as a requirement', () => {
    const requirements = extractEnvRequirements('analytics', BC_WITH_REFS, NO_ENV);
    expect(requirements.find((r) => r.name === 'NPM_TOKEN')).toMatchObject({
      name: 'NPM_TOKEN',
      source: 'build_env',
      isSet: false,
    });
  });

  it('does not require literal build_env values', () => {
    const requirements = extractEnvRequirements('analytics', BC_WITH_REFS, NO_ENV);
    const names = new Set(requirements.map((r) => r.name));
    expect(names.has('LITERAL')).toBe(false);
  });

  it('ignores non-interpolated build_config strings', () => {
    const bc: BuildConfig = {
      build_config: { dockerfile: 'Dockerfile', note: 'no refs here' },
      build_env: {},
    };
    const requirements = extractEnvRequirements('a', bc, NO_ENV);
    expect(requirements).toEqual([]);
  });
});

describe('checkEnvRequirements (US-4, FR-009, collect-all)', () => {
  it('reports PML_ENV_NOT_SET for each missing {{$NAME}}/null env — both names, collect-all', () => {
    const { requirements, errors } = checkEnvRequirements(
      'analytics',
      BC_WITH_REFS,
      'analytics/build_config.yaml',
      NO_ENV,
    );
    expect(errors.length).toBeGreaterThanOrEqual(4);
    const byCode = errors.filter((e) => e.code === PML_ENV_NOT_SET);
    expect(byCode).toHaveLength(4);
    const fields = byCode.map((e) => e.field).sort();
    expect(fields).toEqual(['ANALYTICS_DOCKERFILE', 'IMAGE_PATH', 'NPM_TOKEN', 'REF_VAR'].sort());
    for (const error of byCode) {
      expect(error).toMatchObject({
        code: PML_ENV_NOT_SET,
        file: 'analytics/build_config.yaml',
        app: 'analytics',
      });
    }
    const req = new Map(requirements.map((r) => [r.name, r]));
    expect(req.get('ANALYTICS_DOCKERFILE')).toMatchObject({ source: 'build_config', isSet: false });
    expect(req.get('NPM_TOKEN')).toMatchObject({ source: 'build_env', isSet: false });
  });

  it('passes with isSet: true when env vars are present (US-4 AC2, FR-010)', () => {
    const env = {
      ANALYTICS_DOCKERFILE: 'Dockerfile',
      IMAGE_PATH: 'img',
      NPM_TOKEN: 'secret',
      REF_VAR: 'ref',
    };
    const { requirements, errors } = checkEnvRequirements(
      'analytics',
      BC_WITH_REFS,
      'analytics/build_config.yaml',
      env,
    );
    expect(errors).toEqual([]);
    const req = new Map(requirements.map((r) => [r.name, r]));
    expect(req.get('ANALYTICS_DOCKERFILE')).toMatchObject({ isSet: true });
    expect(req.get('NPM_TOKEN')).toMatchObject({ isSet: true });
  });
});
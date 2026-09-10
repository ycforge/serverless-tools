import { describe, expect, it } from 'vitest';

import { checkEnvRequirements } from '../../src/model/env-requirements.js';
import { PML_ENV_NOT_SET } from '../../src/contracts/index.js';

describe('build-env (T050)', () => {
  it('AC1: build_env with API_KEY set → 0 PML_ENV_NOT_SET for API_KEY', () => {
    const env = { API_KEY: 'secret123' };
    const buildConfig = { build_config: {}, build_env: { API_KEY: null } };
    const { errors } = checkEnvRequirements('user_service', buildConfig, 'test.yaml', env);
    expect(errors.filter((e) => e.code === PML_ENV_NOT_SET && e.field === 'API_KEY')).toHaveLength(0);
  });

  it('AC2: build_env with API_KEY NOT set → PML_ENV_NOT_SET', () => {
    const env: Record<string, string | undefined> = {};
    const buildConfig = { build_config: {}, build_env: { API_KEY: null } };
    const { errors } = checkEnvRequirements('user_service', buildConfig, 'test.yaml', env);
    const apiErrors = errors.filter((e) => e.code === PML_ENV_NOT_SET && e.field === 'API_KEY');
    expect(apiErrors).toHaveLength(1);
    expect(apiErrors[0]?.app).toBe('user_service');
  });

  it('AC3: build_config with {{$ENTRY_POINT}} NOT set → PML_ENV_NOT_SET', () => {
    const env: Record<string, string | undefined> = {};
    const buildConfig = {
      build_config: { entry: '{{$ENTRY_POINT}}' },
      build_env: {},
    };
    const { errors } = checkEnvRequirements('analytics', buildConfig, 'test.yaml', env);
    const entryErrors = errors.filter((e) => e.code === PML_ENV_NOT_SET && e.field === 'ENTRY_POINT');
    expect(entryErrors).toHaveLength(1);
  });

  it('edge: no apps → 0 diagnostics', () => {
    const env: Record<string, string | undefined> = {};
    const buildConfig = { build_config: {}, build_env: {} };
    const { errors } = checkEnvRequirements('empty', buildConfig, 'test.yaml', env);
    expect(errors).toHaveLength(0);
  });
});

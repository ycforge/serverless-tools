import { describe, expectTypeOf, it } from 'vitest';

import { PML_ENV_UNRESOLVED } from '../../src/contracts/index.js';
import type {
  BuildConfig,
  BuildEnvResolutionResult,
  EnvUnresolvedError,
  EnvValue,
  PreparedBuildEnv,
  ProjectModelDiagnostic,
} from '../../src/contracts/index.js';
import { prepareBuildEnv } from '../../src/index.js';

// Type-level contract tests for the spec 012 build-env public surface
// (contracts/build-env.json). Mirrors test/types/project-model.test-d.ts.
// PML_* constants asserted via the generic `expectTypeOf<typeof X>()` form
// (keeps the literal type).

declare const envValue: EnvValue;
declare const result: BuildEnvResolutionResult;
declare const prepared: PreparedBuildEnv;
declare const envError: EnvUnresolvedError;

const SNAPSHOT = { FOO: 'bar' };

describe('build-env public types (spec 012)', () => {
  it('EnvValue is the build_env entry kind grammar (contracts/build-env.json #/definitions/envValue)', () => {
    expectTypeOf(envValue).toEqualTypeOf<
      | { readonly kind: 'null' }
      | { readonly kind: 'literal'; readonly value: string }
      | { readonly kind: 'interpolated'; readonly refs: readonly string[] }
    >();
  });

  it('BuildEnvResolutionResult is ok | invalid — never mixed (#/definitions/buildEnvResolutionResult)', () => {
    expectTypeOf(result).toEqualTypeOf<
      | {
          readonly kind: 'ok';
          readonly resolvedEnv: Record<string, string>;
          readonly buildConfig: unknown;
        }
      | { readonly kind: 'invalid'; readonly errors: readonly ProjectModelDiagnostic[] }
    >();
  });

  it('PreparedBuildEnv is appId / resolvedEnv / buildConfig (#/definitions/preparedBuildEnv)', () => {
    expectTypeOf(prepared).toEqualTypeOf<{
      readonly appId: string;
      readonly resolvedEnv: Record<string, string>;
      readonly buildConfig: unknown;
    }>();
  });

  it('EnvUnresolvedError extends Error with fixed code + diagnostics', () => {
    expectTypeOf(envError).toMatchTypeOf<Error>();
    expectTypeOf<EnvUnresolvedError['code']>().toEqualTypeOf<'PML_ENV_UNRESOLVED'>();
    expectTypeOf<EnvUnresolvedError['diagnostics']>().toEqualTypeOf<
      readonly ProjectModelDiagnostic[]
    >();
  });

  it('PML_ENV_UNRESOLVED is the additive runtime code constant', () => {
    expectTypeOf<typeof PML_ENV_UNRESOLVED>().toEqualTypeOf<'PML_ENV_UNRESOLVED'>();
  });

  it('prepareBuildEnv signature: (appId, buildConfig, envSnapshot?) → BuildEnvResolutionResult', () => {
    expectTypeOf(prepareBuildEnv).parameter(0).toEqualTypeOf<string>();
    expectTypeOf(prepareBuildEnv).parameter(1).toEqualTypeOf<BuildConfig>();
    expectTypeOf(prepareBuildEnv)
      .parameter(2)
      .toEqualTypeOf<Readonly<Record<string, string | undefined>> | undefined>();
    expectTypeOf(prepareBuildEnv).returns.toEqualTypeOf<BuildEnvResolutionResult>();
  });

  it('prepareBuildEnv is callable with the documented invocation (quickstart 012)', () => {
    const r = prepareBuildEnv('analytics', SNAPSHOT as unknown as BuildConfig, SNAPSHOT);
    expectTypeOf(r).toEqualTypeOf<BuildEnvResolutionResult>();
  });
});
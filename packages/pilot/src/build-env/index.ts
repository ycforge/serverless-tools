/**
 * build-env runtime-prep entry (spec 012).
 *
 * `prepareBuildEnv` validates + interpolates ONE app's `BuildConfig` into
 * builder-ready materialized input AFTER load-time validation (spec 011): a
 * resolved `build_env` (`Record<string,string>`, no null) and an interpolated
 * `build_config` (opaque to C, FR-011). It does NOT construct a `BuildContext`
 * — spec 021 maps `resolvedEnv`/`buildConfig` into spec 002 shapes (FR-009).
 *
 * Env values are read from a snapshot captured ONCE at entry (research
 * decision 2 / SC-002): the optional `envSnapshot` override is purely for
 * hermetic tests; the default records `{ ...process.env }`.
 */

import {
  PML_ENV_UNRESOLVED,
  isEnvRef,
  type BuildConfig,
  type BuildEnvResolutionResult,
  type ProjectModelDiagnostic,
} from '../contracts/index.js';
import { ENV_REF_RE } from '../model/env-requirements.js';
import { diag } from '../model/errors.js';
import { forEachStringLeaf } from '../model/string-leaves.js';
import { interpolateBuildConfig, type InterpolateContext } from './interpolate.js';
import { resolveBuildEnv } from './resolve.js';

export function prepareBuildEnv(
  appId: string,
  buildConfig: BuildConfig,
  envSnapshot?: Readonly<Record<string, string | undefined>>,
): BuildEnvResolutionResult {
  const env: Readonly<Record<string, string | undefined>> =
    envSnapshot !== undefined ? envSnapshot : { ...process.env };
  const file = `${appId}/build_config.yaml`;
  const context: InterpolateContext = { appId, file };

  const configResult = interpolateBuildConfig(buildConfig.build_config, context, env);
  const envResult = resolveBuildEnv(buildConfig.build_env, context, env);

  const alreadyReported = new Set<string>([
    ...configResult.unresolved,
    ...envResult.unresolved,
  ]);
  const errors: ProjectModelDiagnostic[] = [
    ...configResult.errors,
    ...envResult.errors,
    ...assertNoResidual(configResult.buildConfig, envResult.resolvedEnv, context, alreadyReported),
  ];

  if (errors.length > 0) {
    return { kind: 'invalid', errors };
  }
  return {
    kind: 'ok',
    resolvedEnv: envResult.resolvedEnv,
    buildConfig: configResult.buildConfig,
  };
}

/**
 * SC-004 final guard: after substitution, no residual `{{$NAME}}` may survive
 * in the interpolated `build_config` or `resolvedEnv`. Any residual found here
 * corresponds to a ref already reported during substitution; distinct names
 * that somehow slipped through are still fail-fast diagnosed.
 */
function assertNoResidual(
  interpolatedBuildConfig: unknown,
  resolvedEnv: Record<string, string>,
  context: InterpolateContext,
  alreadyReported: ReadonlySet<string>,
): ProjectModelDiagnostic[] {
  const errors: ProjectModelDiagnostic[] = [];
  const seen = new Set(alreadyReported);

  const scanString = (value: string, field: string): void => {
    if (!isEnvRef(value)) return;
    for (const match of value.matchAll(ENV_REF_RE)) {
      const name = match[1];
      if (name !== undefined && !seen.has(name)) {
        seen.add(name);
        errors.push(
          diag({
            code: PML_ENV_UNRESOLVED,
            message: `residual '{{$${name}}}' left in ${field} for app '${context.appId}'`,
            file: context.file,
            app: context.appId,
            field,
          }),
        );
      }
    }
  };

  forEachStringLeaf(interpolatedBuildConfig, (leaf) => scanString(leaf, 'build_config'));
  for (const [name, value] of Object.entries(resolvedEnv)) scanString(value, name);
  return errors;
}
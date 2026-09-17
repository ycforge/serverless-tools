/**
 * `{{$NAME}}` substitution over build_config string leaves (spec 012,
 * US-1/FR-001/002/003/007/008/010). String-only Project C runtime: operates
 * on the already-loaded model, never imports `yaml`.
 *
 * Substitution grammar (research decision 4): the capturing `ENV_REF_RE`
 * (`/\{\{\$([A-Z0-9_]+)\}\}/g`, shared with the 011 requirement extractor).
 * `${...}` (Terraform) and `${resources...}` (B→Materializer) never match —
 * cross-namespace safety by construction (FR-010 / SC-006).
 */

import { PML_ENV_UNRESOLVED, type ProjectModelDiagnostic } from '../contracts/index.js';
import { ENV_REF_RE } from '../model/env-requirements.js';
import { diag } from '../model/errors.js';
import { forEachStringLeaf } from '../model/string-leaves.js';

/**
 * Per-app diagnostic context: every `PML_ENV_UNRESOLVED` diagnostic names the
 * app and its build_config source file (FR-008).
 */
export interface InterpolateContext {
  readonly appId: string;
  readonly file: string;
}

/** Result of substituting one string: the new value + accumulated diagnostics. */
export interface InterpolatedString {
  readonly value: string;
  readonly errors: readonly ProjectModelDiagnostic[];
  /** Names of `{{$NAME}}` refs that could not be resolved (deduplicated). */
  readonly unresolved: readonly string[];
}

/**
 * Substitutes every `{{$NAME}}` in a single string. A ref whose snapshot value
 * is empty/unset is NOT silently substituted (Constitution V): a
 * `PML_ENV_UNRESOLVED` diagnostic is recorded and the ref is left in place so
 * the caller's fail-fast path never ships residual `{{$` to a builder.
 */
export function interpolateString(
  value: string,
  context: InterpolateContext,
  field: string,
  env: Readonly<Record<string, string | undefined>>,
): InterpolatedString {
  const errors: ProjectModelDiagnostic[] = [];
  const unresolved = new Set<string>();
  const result = value.replace(ENV_REF_RE, (match, rawName: unknown) => {
    const name = typeof rawName === 'string' ? rawName : '';
    const resolved = env[name];
    if (resolved !== undefined && resolved !== '') {
      return resolved;
    }
    if (!unresolved.has(name)) {
      unresolved.add(name);
      errors.push(
        diag({
          code: PML_ENV_UNRESOLVED,
          message: `ENV '${name}' is unresolved (${field} for app '${context.appId}')`,
          file: context.file,
          app: context.appId,
          field,
        }),
      );
    }
    return match;
  });
  return { value: result, errors, unresolved: [...unresolved] };
}

/** Result of interpolating a whole `build_config`: fresh tree + diagnostics. */
export interface InterpolatedBuildConfig {
  readonly buildConfig: unknown;
  readonly errors: readonly ProjectModelDiagnostic[];
  readonly unresolved: readonly string[];
}

/**
 * Interpolates every string leaf of `build_config` (deep, shared
 * `forEachStringLeaf` walk — FR-001) producing a FRESH tree; the input is
 * never mutated (research decision 1). field is `build_config` (SC-005).
 */
export function interpolateBuildConfig(
  buildConfig: Record<string, unknown>,
  context: InterpolateContext,
  env: Readonly<Record<string, string | undefined>>,
): InterpolatedBuildConfig {
  const errors: ProjectModelDiagnostic[] = [];
  const unresolved = new Set<string>();
  const interpolated = forEachStringLeaf(buildConfig, (leaf, setLeaf) => {
    const result = interpolateString(leaf, context, 'build_config', env);
    errors.push(...result.errors);
    for (const name of result.unresolved) unresolved.add(name);
    setLeaf(result.value);
  });
  return { buildConfig: interpolated, errors, unresolved: [...unresolved] };
}
/**
 * Public build-env runtime-prep contracts of `@ycforge/pilot` (Project C,
 * spec 012). Type-only + pure re-exports; stays zero-runtime-dependency
 * like the rest of `src/contracts/`.
 *
 * The `PML_ENV_UNRESOLVED` runtime code is added additively to the shared
 * project-model catalog (`contracts/project-model.json` #/errorCodes),
 * distinct from load-time `PML_ENV_NOT_SET` (spec FR-008 decision).
 */

import type { ProjectModelDiagnostic } from './project-model.js';

export { PML_ENV_UNRESOLVED } from './project-model.js';

/**
 * Typed interpretation of ONE `build_env` record entry (spec data-model.md):
 * - `null` — strict requirement: take `process.env[ENV_NAME]`;
 * - `literal` — no `{{$…}}`, passed as-is (FR-005);
 * - `interpolated` — contains ≥1 `{{$NAME}}`; `refs` = deduplicated names.
 */
export type EnvValue =
  | { readonly kind: 'null' }
  | { readonly kind: 'literal'; readonly value: string }
  | { readonly kind: 'interpolated'; readonly refs: readonly string[] };

/**
 * Per-app result of `build_env` resolution + `build_config` interpolation.
 * Success and failure are mutually exclusive (spec invariant) — either a
 * fully resolved env + interpolated opaque config, or a fail-fast
 * `PML_ENV_UNRESOLVED` error set. Never a mixed state (research decision 7).
 */
export type BuildEnvResolutionResult =
  | {
      readonly kind: 'ok';
      readonly resolvedEnv: Record<string, string>;
      readonly buildConfig: unknown;
    }
  | { readonly kind: 'invalid'; readonly errors: readonly ProjectModelDiagnostic[] };

/**
 * Public per-app materialized input: what spec 021 wires into spec 002
 * `BuildContext` (`resolvedEnv → buildEnv`, `buildConfig → buildConfig`).
 * Not a BuildContext itself (FR-009 — reuse shapes, don't invent build API).
 */
export interface PreparedBuildEnv {
  readonly appId: string;
  readonly resolvedEnv: Record<string, string>;
  readonly buildConfig: unknown;
}

/**
 * Runtime error aggregating one or more `PML_ENV_UNRESOLVED` diagnostics
 * (FR-015). Type mirror of the runtime class in `src/build-env/errors.ts`;
 * consumers receive plain diagnostics from `prepareBuildEnv` (never a throw).
 */
export interface EnvUnresolvedError extends Error {
  readonly code: 'PML_ENV_UNRESOLVED';
  readonly diagnostics: readonly ProjectModelDiagnostic[];
}
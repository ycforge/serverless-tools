/**
 * Materializer-dispatch public contracts of `@ycforge/pilot` (Project C, spec 014).
 *
 * Type-only + pure MTL_* constants. ZERO runtime dependencies — mirror of
 * `contracts/materialize.json`. The dispatch/runtime implementation lives in
 * `src/materialize/`, never here.
 *
 * Codes follow `contracts/materialize.json` (#/errorCodes) and are compared
 * via the constants below, never string literals (Constitution V).
 */

import type { TerraformResource } from './terraform.js';

/**
 * Flat descriptor of the artifact being dispatched (data-model.md).
 * Built from one `ProjectModel.apps` entry: one app → one descriptor.
 *
 * Invariants: `id === name === app.app_id`; `type` is the app builder id
 * (the dispatch key from `builders.yaml`), NOT a full `package-scope:kind`
 * artifact type.
 */
export interface ArtifactDescriptor {
  readonly id: string;
  readonly name: string;
  readonly type: string;
}

/**
 * Dispatch options. `infraDir` is reserved for the API surface;
 * the actual I/O is executed by `writeGeneratedTerraform` (FR-015).
 */
export interface DispatchOptions {
  readonly infraDir?: string;
}

/**
 * A single materializer-dispatch problem (contracts/materialize.json
 * #/definitions/dispatchDiagnostic). Emitted when selection
 * (MTL_COLLISION / MTL_UNHANDLED_ARTIFACT) or materialization
 * (MTL_MATERIALIZE_FAILED / MTL_FILENAME_COLLISION /
 * MTL_INVALID_TERRAFORM_ADDRESS / MTL_OUTPUT_NAME_COLLISION) fails.
 * Codes are compared via MTL_* constants, never string literals.
 */
export interface DispatchDiagnostic {
  readonly code: string;
  readonly message: string;
  readonly artifactId?: string;
  readonly materializerIds?: string[];
  readonly materializerId?: string;
  readonly type?: string;
  readonly name?: string;
  readonly outputName?: string;
  readonly filename?: string;
}

/**
 * One serialized `.tf.json` file — part of `DispatchResultOk.generatedFiles`.
 * `filename` is `<app_id>.ycsf.tf.json` or `00-ycsf-outputs.tf.json`;
 * `content` is deterministic Terraform JSON (sorted keys).
 */
export interface GeneratedTfFile {
  readonly filename: string;
  readonly content: string;
}

/**
 * Result of `dispatch`. `invalid` is atomic: either ALL Phase-1 selection
 * errors (collect-all, `materialize` never called — FR-017) OR a single
 * `MTL_MATERIALIZE_FAILED` (Phase 2, abort-on-first — FR-006). No partial
 * `resources` are ever returned.
 */
export type DispatchResult =
  | {
      readonly kind: 'ok';
      readonly resources: readonly TerraformResource[];
      readonly generatedFiles: readonly GeneratedTfFile[];
    }
  | { readonly kind: 'invalid'; readonly errors: readonly DispatchDiagnostic[] };

/**
 * Materializer-dispatch error codes (contracts/materialize.json #/errorCodes).
 * Compared via these constants, never string literals (Constitution V).
 */

export const MTL_COLLISION = 'MTL_COLLISION' as const;
export const MTL_UNHANDLED_ARTIFACT = 'MTL_UNHANDLED_ARTIFACT' as const;
export const MTL_MATERIALIZE_FAILED = 'MTL_MATERIALIZE_FAILED' as const;
export const MTL_FILENAME_COLLISION = 'MTL_FILENAME_COLLISION' as const;
export const MTL_INVALID_TERRAFORM_ADDRESS = 'MTL_INVALID_TERRAFORM_ADDRESS' as const;
export const MTL_OUTPUT_NAME_COLLISION = 'MTL_OUTPUT_NAME_COLLISION' as const;
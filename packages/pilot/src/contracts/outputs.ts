/**
 * Public contracts of the outputs feature (spec 016): `.ycsf/outputs.yaml`
 * load/build API, OUT_* diagnostic codes and result shapes. Mirror of
 * `specs/016-outputs/contracts/outputs.json` (#/errorCodes).
 *
 * Type-only + pure OUT_* constants — ZERO runtime dependencies (Constitution
 * V; research 4). Codes are compared via the constants below, never string
 * literals. The YAML format carries `version: 1`.
 */

import type { GeneratedTfFile } from './materialize.js';
import type { TerraformResource } from './terraform.js';

// ─── Error Codes ────────────────────────────────────────────────────────────

/** `.ycsf/outputs.yaml` absent when `loadOutputs` is called (FR-002). Throws, never a validation result. */
export const OUT_MISSING_FILE = 'OUT_MISSING_FILE' as const;

/** `version` key absent or not equal to `1` (FR-003, Constitution III). */
export const OUT_VERSION = 'OUT_VERSION' as const;

/**
 * Structural invalidity (FR-004): YAML syntax errors / duplicate YAML keys
 * (parse gate uniqueKeys) / unknown top-level keys / `outputs` missing or
 * not a mapping / `value` not a string / `description` not a string or absent /
 * key name violates grammar `[a-z][a-z0-9_]*`. Collected for ALL errors.
 */
export const OUT_INVALID = 'OUT_INVALID' as const;

/**
 * User output name starts with `ycsf_` (reserved for auto-generated outputs;
 * Constitution V).
 */
export const OUT_RESERVED_PREFIX = 'OUT_RESERVED_PREFIX' as const;

/**
 * `value` is not a valid 3-segment IDL reference per `ResourceReference`
 * grammar (contract 002): each segment must match `[a-z][a-z0-9_]*`.
 */
export const OUT_INVALID_VALUE = 'OUT_INVALID_VALUE' as const;

/**
 * IDL reference (`domain.name.property`) cannot be resolved: domain not in
 * `DOMAIN_TO_TF_TYPE` or `domain.name` not in IDL index. Message contains
 * the reference + alphabetically ordered available IDLs.
 */
export const OUT_UNRESOLVED_IDL = 'OUT_UNRESOLVED_IDL' as const;

/**
 * Output name appears more than once in the merged file (user-user, user-auto,
 * auto-auto). Collect-all; all-or-nothing.
 */
export const OUT_DUPLICATE_NAME = 'OUT_DUPLICATE_NAME' as const;

/**
 * Auto-generated output name does NOT start with `ycsf_` (materializer
 * contract violation; Constitution V).
 */
export const OUT_INVALID_AUTO_PREFIX = 'OUT_INVALID_AUTO_PREFIX' as const;

// ─── Types ──────────────────────────────────────────────────────────────────

/** One output value shape (reuses OutputValue from spec 014 serialize.ts). */
export interface OutputValue {
  readonly value: string;
  readonly description?: string;
}

/** Parsed `.ycsf/outputs.yaml` document (`version: 1`). */
export interface OutputsYaml {
  readonly version: 1;
  readonly outputs: Readonly<Record<string, OutputValue>>;
}

/**
 * Validation problem reported by buildOutputs. Compared via OUT_* codes.
 * `availableIdls` is set on OUT_UNRESOLVED_IDL; `name` identifies the failing
 * output. `file`/`line`/`column` are filled ONLY by the loader for structural
 * OUT_INVALID/OUT_VERSION (pattern 015 `ExtensionsDiagnostic`) — build-phase
 * diagnostics (pure transform) never populate them.
 */
export interface OutputsDiagnostic {
  readonly code: string;
  readonly message: string;
  readonly name?: string;
  readonly file?: string;
  readonly field?: string;
  readonly line?: number;
  readonly column?: number;
  readonly availableIdls?: readonly string[];
}

/** Result of `loadOutputs(rootDir)`. The `invalid` branch uses OutputsDiagnostic with file/line/column populated. */
export type OutputsLoadResult =
  | { kind: 'ok'; data: OutputsYaml }
  | { kind: 'invalid'; errors: readonly OutputsDiagnostic[] };

/** Input for the pure `buildOutputs` function. */
export interface BuildOutputsInput {
  readonly outputsYaml: OutputsYaml;
  readonly materializerOutputs: ReadonlyMap<string, OutputValue>;
  readonly resources: readonly TerraformResource[];
}

/** Result of `buildOutputs(input)`. All-or-nothing: any error negates the whole transform. */
export type BuildOutputsResult =
  | { kind: 'ok'; file: GeneratedTfFile }
  | { kind: 'invalid'; errors: readonly OutputsDiagnostic[] };
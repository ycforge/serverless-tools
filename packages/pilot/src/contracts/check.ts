// spec 020 ycsf-check — public contracts: CheckResult, CheckOptions, YckDiagnostic, YCK_* codes.
// Type-only + pure constants: zero runtime dependencies (Constitution V).
import type { ExtensionsDiagnostic } from './extensions.js';
import type { MovesDiagnostic } from './moves.js';
import type { OutputsDiagnostic } from './outputs.js';
import type { ProjectModelDiagnostic } from './project-model.js';

// ─── Error Codes ────────────────────────────────────────────────────────────

/** Extension target IDL does not exist in generated model (C1, FR-008). */
export const YCK_MISSING_TARGET = 'YCK_MISSING_TARGET' as const;

/** Extension patch contains {{$ENV}} reference (C7, FR-011). */
export const YCK_ENV_IN_PATCH = 'YCK_ENV_IN_PATCH' as const;

/** Resource reference from resources.yaml has no matching generated TF resource (C4, FR-014). */
export const YCK_REF_UNRESOLVED = 'YCK_REF_UNRESOLVED' as const;

/** terraform validate reported errors (C13, FR-017). */
export const YCK_TERRAFORM_INVALID = 'YCK_TERRAFORM_INVALID' as const;

/** terraform binary not found in PATH (C13, FR-019). */
export const YCK_TERRAFORM_UNAVAILABLE = 'YCK_TERRAFORM_UNAVAILABLE' as const;

// ─── Types ──────────────────────────────────────────────────────────────────

/** Check-specific diagnostic shape (YCK_* family). */
export interface YckDiagnostic {
  readonly code: string;
  readonly message: string;
  /** IDL target that failed validation (C1, C7). */
  readonly target?: string;
  /** IDL resource reference string (C4). */
  readonly resourceRef?: string;
  /** Field path within patch where issue was found (C7). */
  readonly field?: string;
  /** File path where the referenced contract lives (C4). */
  readonly file?: string;
  /** Available IDLs in generated model when target was missing (C1). */
  readonly availableIdls?: readonly string[];
}

/** Union of all diagnostic families. */
export type Diagnostic =
  | ProjectModelDiagnostic
  | ExtensionsDiagnostic
  | OutputsDiagnostic
  | MovesDiagnostic
  | YckDiagnostic;

/** Unified result of all check categories (FR-004). */
export interface CheckResult {
  /** All diagnostics from all categories — collect-all, never abort-on-first (D-4). */
  readonly diagnostics: readonly Diagnostic[];
}

/** Options for ycsf check invocation (FR-006, D-6). */
export interface CheckOptions {
  /** Enable terraform validate final step (C13). Default: false. */
  readonly validateTf?: boolean;
  /** Override path to generated .ycsf.tf.json files (default: <rootDir>/.ycsf/). */
  readonly generatedDir?: string;
}

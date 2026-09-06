/**
 * Public contracts of the extensions feature (spec 015): `.ycsf/extensions.yaml`
 * load/apply API, EXT_* diagnostic codes and result shapes. Mirrors contract
 * versioning rules — codes live here, consumers compare against the EXT_*
 * constants (Constitution V), the YAML format carries `version: 1`.
 */

import type { ProjectModelDiagnostic } from './project-model.js';
import type { TerraformResource } from './terraform.js';

export const EXT_MISSING_FILE = 'EXT_MISSING_FILE' as const;
export const EXT_VERSION = 'EXT_VERSION' as const;
export const EXT_INVALID = 'EXT_INVALID' as const;
export const EXT_UNRESOLVED_TARGET = 'EXT_UNRESOLVED_TARGET' as const;
export const EXT_DUPLICATE_TARGET = 'EXT_DUPLICATE_TARGET' as const;

/** One `.ycsf/extensions.yaml` rule: an IDL target and a deep-merge patch. */
export interface ExtensionRule {
  readonly target: string;
  readonly patch: Record<string, unknown>;
}

/** Parsed `.ycsf/extensions.yaml` document (`version: 1`). */
export interface ExtensionsYaml {
  readonly version: 1;
  readonly extensions: readonly ExtensionRule[];
}

/**
 * Validation problem reported by `applyExtensions`. Compared via EXT_* codes.
 * `availableIdls` is set on EXT_UNRESOLVED_TARGET to list IDL-addressable
 * resources (alphabetical); `target` identifies the failing rule.
 */
export interface ExtensionsDiagnostic {
  readonly code: string;
  readonly message: string;
  readonly target?: string;
  readonly file?: string;
  readonly field?: string;
  readonly line?: number;
  readonly column?: number;
  readonly availableIdls?: readonly string[];
}

/** Result of `loadExtensions(rootDir)`. The `invalid` branch reuses the model-loading diagnostic shape (spec 011). */
export type ExtensionsLoadResult =
  | { kind: 'ok'; data: ExtensionsYaml }
  | { kind: 'invalid'; errors: readonly ProjectModelDiagnostic[] };

/** Result of `applyExtensions(resources, extensions)`. All-or-nothing: any error negates the whole transform. */
export type ApplyExtensionsResult =
  | { kind: 'ok'; resources: readonly TerraformResource[] }
  | { kind: 'invalid'; errors: readonly ExtensionsDiagnostic[] };
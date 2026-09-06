/**
 * Public registry contracts of `@ycforge/pilot` (Project C, spec 013).
 *
 * Type-only + pure constants. ZERO runtime dependencies — no yaml, no import().
 * Anything touching runtime lives in `src/registry/`, not here.
 *
 * Codes follow `contracts/plugin-registry.json` (#/errorCodes) and are compared
 * via the constants below, never string literals (Constitution V).
 */

import type { ProjectModelDiagnostic } from './project-model.js';

/**
 * Shape detection result: the module is a builder or materializer plugin.
 */
export type PluginKind = 'builder' | 'materializer';

/**
 * One successfully loaded and recognized registry entry.
 */
export interface PluginEntry {
  readonly id: string;
  readonly packageName: string;
  readonly kind: PluginKind;
  readonly module: unknown;
}

/**
 * Immutable registry of loaded plugins (research decision 6: frozen ReadonlyMap).
 */
export interface PluginRegistry {
  readonly records: ReadonlyMap<string, PluginEntry>;
}

/**
 * Error loading a single plugin entry (FR-009/010/011).
 */
export interface PluginLoadError {
  readonly id: string;
  readonly packageName: string;
  readonly code: string;
  readonly message: string;
}

/**
 * Result of `loadRegistry(rootDir)`.
 *
 * - `kind: 'ok'` — all plugins loaded, immutable registry.
 * - `kind: 'invalid'` — structural or load errors (collect-all, FR-015).
 *
 * A missing `.ycsf/builders.yaml` is NOT represented here — it throws an
 * Error with code `BRG_MISSING_FILE` (per user decision, symmetric with
 * spec 011 `loadProjectModel`).
 */
export type PluginRegistryLoadResult =
  | { kind: 'ok'; registry: PluginRegistry }
  | { kind: 'invalid'; errors: readonly RegistryError[] };

/**
 * Result of `validateBuilders(projectModel, registry)`.
 */
export type BuilderRegistryValidationResult =
  | { kind: 'ok' }
  | { kind: 'invalid'; errors: readonly ProjectModelDiagnostic[] };

/**
 * Discriminated union: structural diagnostics (file/line/column) or
 * plugin-load errors (id/packageName). Both carry `code` + `message`.
 */
export type RegistryError = ProjectModelDiagnostic | PluginLoadError;

/**
 * Stable machine-readable `BRG_*` codes (contracts/plugin-registry.json
 * #/errorCodes). Compared via these constants, never string literals.
 */

export const BRG_MISSING_FILE = 'BRG_MISSING_FILE';
export const BRG_VERSION = 'BRG_VERSION';
export const BRG_DUPLICATE_KEY = 'BRG_DUPLICATE_KEY';
export const BRG_KEY_COLLISION = 'BRG_KEY_COLLISION';
export const BRG_INVALID = 'BRG_INVALID';
export const BRG_PACKAGE_NOT_FOUND = 'BRG_PACKAGE_NOT_FOUND';
export const BRG_NOT_A_PLUGIN = 'BRG_NOT_A_PLUGIN';
export const BRG_LOAD_ERROR = 'BRG_LOAD_ERROR';
export const BRG_UNKNOWN_BUILDER = 'BRG_UNKNOWN_BUILDER';

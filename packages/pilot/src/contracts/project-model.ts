/**
 * Public project-model contracts of `@ycforge/pilot` (Project C).
 *
 * These types are type-only + pure predicates and MUST stay dependency-free
 * (Constitution: contacts stay portable for plugin authors). Anything touching
 * the `yaml` runtime parser lives in `src/model/`, never here.
 *
 * Codes follow `contracts/project-model.json` (#/errorCodes) and are compared
 * via the constants below, never string literals (Constitution V).
 */

/**
 * A buildable source unit from `.ycsf/apps.yaml` (Constitution VI: apps =
 * managed). `app_id` is the stable logical identity.
 */
export interface App {
  readonly app_id: string;
  readonly source_path: string;
  readonly builder: string;
  /** app_id dependencies (build order); empty if absent in YAML. */
  readonly depends_on: string[];
}

/**
 * External infrastructure/logical resource from `.ycsf/resources.yaml`
 * (Constitution VI: always external, reference only).
 */
export interface Resource {
  readonly domain: string;
  readonly resource_id: string;
  /** Currently empty `{}`; NOT an input to materializers. */
  readonly properties: Record<string, unknown>;
}

/**
 * Content of `<app>/build_config.yaml`. `build_config` is opaque to C (the
 * builder validates its internals, FR-011); `build_env` maps ENV_NAME to a
 * literal string or `null` (take from process env).
 */
export interface BuildConfig {
  readonly build_config: Record<string, unknown>;
  readonly build_env: Record<string, string | null>;
}

/**
 * A required environment variable discovered during model load.
 */
export interface EnvRequirement {
  readonly name: string;
  /** "build_config" | "build_env" — where it was found. */
  readonly source: 'build_config' | 'build_env';
  /** The app that declared it. */
  readonly app_id: string;
  /** Presence in process.env at load time. */
  readonly isSet: boolean;
}

/**
 * Validated acyclic directed graph built from all apps' `depends_on`.
 */
export interface DependsOnGraph {
  /** app_id → its depends_on targets. */
  readonly adjacency: ReadonlyMap<string, readonly string[]>;
  /** Valid DAG order; empty if the graph is not acyclic. */
  readonly topologicalOrder: readonly string[];
}

/**
 * Root result of loading + validating all `.ycsf/*.yaml` files.
 */
export interface ProjectModel {
  readonly apps: ReadonlyMap<string, App>;
  /** domain → (resource_id → Resource). */
  readonly resources: ReadonlyMap<string, ReadonlyMap<string, Resource>>;
  /** app_id → BuildConfig (absent apps → empty config). */
  readonly build_configs: ReadonlyMap<string, BuildConfig>;
  /** ENV name → requirement. */
  readonly env_requirements: ReadonlyMap<string, EnvRequirement>;
  readonly depends_on_graph: DependsOnGraph;
}

/**
 * A single validation problem (FR-015 requires file/app/field/message).
 */
export interface ProjectModelDiagnostic {
  readonly code: string;
  readonly message: string;
  readonly file: string;
  readonly app?: string;
  readonly identity?: string;
  readonly field?: string;
  readonly line?: number;
  readonly column?: number;
}

/**
 * Error aggregating one or more {@link ProjectModelDiagnostic}.
 * `code` mirrors the first diagnostic's code (data-model.md).
 */
export class ProjectModelError extends Error {
  readonly code: string;
  readonly diagnostics: readonly ProjectModelDiagnostic[];

  constructor(diagnostics: readonly ProjectModelDiagnostic[]) {
    super(diagnostics.map((d) => d.message).join('\n'));
    this.name = 'ProjectModelError';
    this.code = diagnostics[0]?.code ?? PML_INVALID;
    this.diagnostics = diagnostics;
  }
}

/**
 * Result of `loadProjectModel` — the loader never throws for a *validation*
 * failure; it throws only for I/O catastrophes (e.g. missing `.ycsf/apps.yaml`).
 */
export type ProjectModelLoadResult =
  | { kind: 'ok'; model: ProjectModel }
  | { kind: 'invalid'; errors: readonly ProjectModelError[] };

/**
 * Stable machine-readable `PML_*` codes (contracts/project-model.json
 * #/errorCodes). Compared via these constants, never string literals.
 */
export const PML_VERSION = 'PML_VERSION';
export const PML_PARSE = 'PML_PARSE';
export const PML_INVALID = 'PML_INVALID';
export const PML_DUPLICATE_APP_ID = 'PML_DUPLICATE_APP_ID';
export const PML_DUPLICATE_RESOURCE_ID = 'PML_DUPLICATE_RESOURCE_ID';
export const PML_DUPLICATE_KEY = 'PML_DUPLICATE_KEY';
export const PML_DEPENDS_SELF = 'PML_DEPENDS_SELF';
export const PML_DEPENDS_UNKNOWN = 'PML_DEPENDS_UNKNOWN';
export const PML_DEPENDS_CYCLE = 'PML_DEPENDS_CYCLE';
export const PML_IDENTITY_COLLISION = 'PML_IDENTITY_COLLISION';
export const PML_ENV_NOT_SET = 'PML_ENV_NOT_SET';
export const PML_ENV_UNRESOLVED = 'PML_ENV_UNRESOLVED';

/**
 * Pure predicate: is `value` an `{{$NAME}}` interpolation reference
 * (research decision 4 / spec FR-010)?
 */
export function isEnvRef(value: string): boolean {
  return ENV_REF_RE.test(value);
}

/**
 * Pure predicate: is `version` the supported `.ycsf` format version (1)?
 */
export function isVersion(value: unknown): value is 1 {
  return value === 1;
}

const ENV_REF_RE = /\{\{\$[A-Z0-9_]+\}\}/;

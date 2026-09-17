/**
 * Draft reference types for @ycforge/builders-core (spec 018).
 *
 * Mockup for the plan phase — NOT wired into any src/. The shipped package
 * re-declares these as standalone structural types in src/types.ts /
 * src/catalog.ts / src/diagnostics.ts with ZERO imports from
 * `@ycforge/pilot/contracts` (research D-RE-4). Structural compatibility with
 * the spec 002 contracts is verified by a conformance type-test in
 * `packages/pilot/test/types/builders-core-contract.test-d.ts`.
 */

/** BuildContext — structural replica of spec 002. */
export interface BuildContext {
  readonly projectRoot: string;
  readonly sourcePath?: string;
  readonly buildConfig: unknown;
  readonly buildEnv: Record<string, string>;
  readonly outputDir: string;
}

/** Generic Artifact — structural replica of spec 002 (FR-003 of 002). */
export interface Artifact<T = unknown> {
  readonly type: string;
  readonly value: T;
}

/** Builder shape detected by the registry (013) as `build: Function`. */
export interface Builder {
  build(context: BuildContext): Promise<Artifact>;
}

/** Value shapes (IDEA §8; forward contract for 019). */
export interface FunctionArtifactValue {
  readonly archivePath: string;
  readonly entryPoint: string;
}
export interface DockerArtifactValue {
  readonly image: string; // "<repository>@sha256:<hex64>" — immutable
}
export interface FrontendArtifactValue {
  readonly directory: string;
}

/** Builder build_config schemas (app-level, versionless per spec 011). */
export interface NestjsFunctionBuildConfig {
  readonly entry?: string; // default "src/main.ts"
  readonly runtime?: string; // default "nodejs20"
  readonly external?: readonly string[]; // default []
  readonly out_filename?: string; // default "function.zip"
}
export interface DockerBuildConfig {
  readonly image?: { readonly repository: string; readonly tag?: string }; // repository required
  readonly dockerfile?: string; // default "Dockerfile"
}
export interface ViteBuildConfig {
  readonly out_dir?: string; // default "dist"
  readonly root?: string; // default "."
  readonly command?: string; // default "vite build"
}

/** Artifact-type catalog (FR-003). */
export const BUILDER_IDS = ['nestjs-function', 'docker', 'vite'] as const;
export type BuilderId = (typeof BUILDER_IDS)[number];

export const ARTIFACT_CATALOG = {
  'nestjs-function': { artifactType: 'ycforge:function' },
  docker: { artifactType: 'ycforge:docker-image' },
  vite: { artifactType: 'ycforge:frontend' },
} as const;
export type ArtifactType = (typeof ARTIFACT_CATALOG)[BuilderId]['artifactType'];

/** BLC_* diagnostic constants and carrier (Constitution V: constants, not literals). */
export const BLC_INVALID_CONFIG = 'BLC_INVALID_CONFIG';
export const BLC_MISSING_SOURCE = 'BLC_MISSING_SOURCE';
export const BLC_ENTRY_NOT_FOUND = 'BLC_ENTRY_NOT_FOUND';
export const BLC_BUILD_FAILED = 'BLC_BUILD_FAILED';
export const BLC_ENV_NOT_RESOLVED = 'BLC_ENV_NOT_RESOLVED';
export const BLC_IMAGE_DIGEST_UNAVAILABLE = 'BLC_IMAGE_DIGEST_UNAVAILABLE';
export const BLC_ARCHIVE_FAILED = 'BLC_ARCHIVE_FAILED';

export interface BuilderDiagnostic {
  readonly code: string;
  readonly message: string;
}
export class BuilderError extends Error implements BuilderDiagnostic {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'BuilderError';
    this.code = code;
  }
}
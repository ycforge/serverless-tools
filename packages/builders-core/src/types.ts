/**
 * Standalone structural types for @ycforge/builders-core (spec 018).
 *
 * These are structural replicas of the spec 002 contract shapes
 * (`@ycforge/pilot/contracts/builder.ts`) with ZERO imports from pilot
 * (research D-RE-4 / Constitution I). Structural conformance is pinned by the
 * compile-time conformance test `packages/pilot/test/types/builders-core-contract.test-d.ts`.
 */

/** Input of a single build invocation (structural replica of spec 002). */
export interface BuildContext {
  readonly projectRoot: string;
  readonly sourcePath?: string;
  readonly buildConfig: unknown;
  readonly buildEnv: Record<string, string>;
  readonly outputDir: string;
}

/** Typed build result; `type` follows `<package-scope>:<kind>` (spec 002). */
export interface Artifact<T = unknown> {
  readonly type: string;
  readonly value: T;
}

/** The closed set of artifact types produced by this catalog (FR-003/004). */
export type ArtifactType = 'ycforge:function' | 'ycforge:docker-image' | 'ycforge:frontend';

/** Runtime mirror of {@link ArtifactType} (CATALOG_FORWARD_CONTRACT). */
export const ARTIFACT_TYPES: readonly ArtifactType[] = Object.freeze([
  'ycforge:function',
  'ycforge:docker-image',
  'ycforge:frontend',
]);

/** A single `build` invocation returns exactly one Artifact (spec 002). */
export interface Builder {
  build(context: BuildContext): Promise<Artifact>;
}

/** `Artifact.value` of `ycforge:function` (IDEA §8; forward contract for 019). */
export interface FunctionArtifactValue {
  readonly archivePath: string;
  readonly entryPoint: string;
}

/** `Artifact.value` of `ycforge:docker-image` — immutable digest form. */
export interface DockerArtifactValue {
  readonly image: string; // "<repository>@sha256:<hex64>" — never a mutable tag (FR-011)
}

/** `Artifact.value` of `ycforge:frontend` — absolute path to static output. */
export interface FrontendArtifactValue {
  readonly directory: string;
}

/** App-level `build_config` for builder `nestjs-function` (versionless, spec 011). */
export interface NestjsFunctionBuildConfig {
  readonly entry?: string; // default "src/main.ts"
  readonly runtime?: string; // default "nodejs20"
  readonly external?: readonly string[]; // default []
  readonly out_filename?: string; // default "function.zip"
}

/** App-level `build_config` for builder `docker` (versionless, spec 011). */
export interface DockerBuildConfig {
  readonly image?: { readonly repository: string; readonly tag?: string }; // repository required
  readonly dockerfile?: string; // default "Dockerfile"
}

/** App-level `build_config` for builder `vite` (versionless, spec 011). */
export interface ViteBuildConfig {
  readonly out_dir?: string; // default "dist"
  readonly root?: string; // default "."
  readonly command?: string; // default "vite build"
}
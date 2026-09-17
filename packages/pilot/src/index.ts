// Internal entry point of @ycforge/pilot (Project C orchestration runtime).
// Not part of the public contract — plugin authors must use
// `@ycforge/pilot/contracts` only.

export { loadProjectModel } from './model/loader.js';
export type { ProjectModelLoadResult } from './contracts/index.js';
export { prepareBuildEnv } from './build-env/index.js';
export type { BuildEnvResolutionResult } from './contracts/index.js';
export { loadRegistry, validateBuilders } from './registry/index.js';
export type { PluginRegistryLoadResult, BuilderRegistryValidationResult } from './contracts/index.js';
export { dispatch } from './materialize/dispatch.js';
export type { ArtifactDescriptor, DispatchResult, DispatchOptions } from './contracts/index.js';
export { writeGeneratedTerraform } from './materialize/write.js';
export type { GeneratedTfFile } from './contracts/index.js';
export { loadExtensions, applyExtensions, deepMerge } from './extensions/index.js';
export type {
  ExtensionRule,
  ExtensionsYaml,
  ExtensionsLoadResult,
  ApplyExtensionsResult,
  ExtensionsDiagnostic,
} from './contracts/index.js';
export { loadMoves } from './moves/loader.js';
export { buildMoves, buildMovedFile } from './moves/build.js';
export type { MovesLoadResult, BuildMovesResult, MovesYaml, MoveEntry, MoveEndpoint } from './contracts/index.js';
export { loadOutputs, buildOutputs } from './outputs/index.js';
export type {
  OutputsYaml,
  OutputsLoadResult,
  BuildOutputsInput,
  BuildOutputsResult,
  OutputsDiagnostic,
  OutputValue,
} from './contracts/index.js';
export { check } from './check/index.js';
export type { CheckResult, CheckOptions } from './check/index.js';
export { buildApps } from './build/index.js';
export type { BuildAppsResult, BuiltArtifact, BuildAppsOptions } from './contracts/build.js';

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

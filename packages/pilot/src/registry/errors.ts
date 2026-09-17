import type {
  PluginLoadError,
  RegistryError,
} from '../contracts/registry.js';
import type { ProjectModelDiagnostic } from '../contracts/project-model.js';

/**
 * Single source of truth for registry diagnostics is the public contract
 * module (`src/contracts/registry.ts`): structural/load errors are the
 * `RegistryError = ProjectModelDiagnostic | PluginLoadError` union
 * (data-model.md «RegistryError / PluginDiagnostic», note I7 from analyze).
 * This runtime module only carries the diagnostic factory.
 */
export type { PluginLoadError, RegistryError, ProjectModelDiagnostic };

// Re-export the shared diag factory: registry structural diagnostics reuse
// the project-model diagnostic shape (research 8).
export { diag } from '../model/errors.js';
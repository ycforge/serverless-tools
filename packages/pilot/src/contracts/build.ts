// spec 021 ycsf-cli — buildApps result types (data-model §3).
import type { PluginRegistry } from './registry.js';
import type { ProjectModel } from './project-model.js';
import type { Artifact } from './builder.js';
import type { Diagnostic } from './check.js';

/** Result of buildApps orchestration (spec 021, D-RE-1). */
export type BuildAppsResult =
  | {
      readonly kind: 'ok';
      readonly projectModel: ProjectModel;
      readonly registry: PluginRegistry;
      readonly artifacts: readonly BuiltArtifact[];
    }
  | {
      readonly kind: 'invalid';
      readonly errors: readonly Diagnostic[];
    };

/** One successfully built app artifact. */
export interface BuiltArtifact {
  readonly appId: string;
  readonly artifact: Artifact;
}

/** Options for buildApps invocation. */
export interface BuildAppsOptions {
  readonly target?: string;
}

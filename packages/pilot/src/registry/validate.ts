import type { ProjectModel } from '../contracts/project-model.js';
import type { BuilderRegistryValidationResult, PluginRegistry } from '../contracts/registry.js';
import { BRG_UNKNOWN_BUILDER } from '../contracts/registry.js';
import { diag } from './errors.js';

export function validateBuilders(
  projectModel: ProjectModel,
  registry: PluginRegistry,
): BuilderRegistryValidationResult {
  const errors: import('../contracts/project-model.js').ProjectModelDiagnostic[] = [];
  const availableBuilders = [...registry.records.keys()].sort().join(', ');

  for (const [appId, app] of projectModel.apps) {
    if (!registry.records.has(app.builder)) {
      errors.push(
        diag({
          code: BRG_UNKNOWN_BUILDER,
          message: `app '${appId}' uses unknown builder '${app.builder}'; available builders: ${availableBuilders}`,
          file: '.ycsf/apps.yaml',
          app: appId,
          field: 'builder',
        }),
      );
    }
  }

  if (errors.length > 0) {
    return { kind: 'invalid', errors };
  }
  return { kind: 'ok' };
}

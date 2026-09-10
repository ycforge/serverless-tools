// spec 021 ycsf-cli — buildApps orchestrator (D-RE-1, D-RE-11, D-RE-12).
import type { BuildAppsOptions, BuildAppsResult, BuiltArtifact } from '../contracts/build.js';
import type { Diagnostic } from '../contracts/check.js';
import type { PluginLoadError, RegistryError } from '../contracts/registry.js';
import { CLI_APP_NOT_FOUND, CLI_BUILD_FAILED, CLI_MISSING_PROJECT_DIR } from '../cli/errors.js';
import { loadProjectModel } from '../model/loader.js';
import { prepareBuildEnv } from '../build-env/index.js';
import { loadRegistry, validateBuilders } from '../registry/index.js';
import { getBuilder } from '../registry/shape.js';

function toDiagnostic(err: RegistryError): Diagnostic {
  if (isPluginLoadError(err)) {
    return { code: err.code, message: err.message, file: '.ycsf/builders.yaml' };
  }
  return err;
}

function isPluginLoadError(err: RegistryError): err is PluginLoadError {
  return (err as PluginLoadError).packageName !== undefined;
}

export async function buildApps(
  rootDir: string,
  options?: BuildAppsOptions,
): Promise<BuildAppsResult> {
  // 1. Load project model
  let modelResult: ReturnType<typeof loadProjectModel>;
  try {
    modelResult = loadProjectModel(rootDir);
  } catch {
    return {
      kind: 'invalid',
      errors: [
        {
          code: CLI_MISSING_PROJECT_DIR,
          message: `missing .ycsf/apps.yaml — '${rootDir}' is not a serverless-tools project root`,
          file: '.ycsf/apps.yaml',
        },
      ],
    };
  }
  if (modelResult.kind === 'invalid') {
    const diagnostics: Diagnostic[] = [];
    for (const err of modelResult.errors) {
      diagnostics.push(...err.diagnostics);
    }
    return { kind: 'invalid', errors: diagnostics };
  }
  const projectModel = modelResult.model;

  // 2. Filter by --target if specified (D-RE-12: filter on the model level,
  //    before any subsequent step so an unknown app fails fast).
  let appsToBuild: typeof projectModel.apps;
  if (options?.target) {
    const app = projectModel.apps.get(options.target);
    if (!app) {
      const available = [...projectModel.apps.keys()].join(', ');
      return {
        kind: 'invalid',
        errors: [
          {
            code: CLI_APP_NOT_FOUND,
            message: `app '${options.target}' not found in apps.yaml; available: ${available}`,
            file: '.ycsf/apps.yaml',
          },
        ],
      };
    }
    appsToBuild = new Map([[options.target, app]]);
  } else {
    appsToBuild = projectModel.apps;
  }

  // 3. Prepare build env for the (possibly filtered) apps
  const envDiagnostics: Diagnostic[] = [];
  const resolvedEnvs = new Map<string, Record<string, string>>();
  for (const [appId, buildConfig] of projectModel.build_configs) {
    if (!appsToBuild.has(appId)) continue;
    const result = prepareBuildEnv(appId, buildConfig);
    if (result.kind === 'invalid') {
      envDiagnostics.push(...result.errors);
    } else {
      resolvedEnvs.set(appId, result.resolvedEnv);
    }
  }
  if (envDiagnostics.length > 0) {
    return { kind: 'invalid', errors: envDiagnostics };
  }

  // 4. Load registry
  let registryResult;
  try {
    registryResult = await loadRegistry(rootDir);
  } catch {
    return {
      kind: 'invalid',
      errors: [
        {
          code: CLI_BUILD_FAILED,
          message: 'builders registry could not be loaded',
          file: '.ycsf/builders.yaml',
        },
      ],
    };
  }
  if (registryResult.kind === 'invalid') {
    return { kind: 'invalid', errors: registryResult.errors.map(toDiagnostic) };
  }
  const registry = registryResult.registry;

  // 5. Validate builders
  const validation = validateBuilders(projectModel, registry);
  if (validation.kind === 'invalid') {
    return { kind: 'invalid', errors: validation.errors };
  }

  // 6. Run builders for each app
  const artifacts: BuiltArtifact[] = [];
  for (const [appId, app] of appsToBuild) {
    options?.onAppProgress?.(appId);
    const entry = registry.records.get(app.builder);
    if (!entry) {
      // Should not reach here after validateBuilders, but defensive
      continue;
    }
    const builder = getBuilder(entry.module);
    if (!builder) {
      return {
        kind: 'invalid',
        errors: [
          {
            code: CLI_BUILD_FAILED,
            message: `builder '${app.builder}' for app '${appId}' is not a valid builder module`,
            file: '.ycsf/builders.yaml',
            app: appId,
          },
        ],
      };
    }

    const resolvedEnv = resolvedEnvs.get(appId) ?? {};
    const outputDir = `${rootDir}/.ycsf/artifacts/${appId}`;
    const context = {
      projectRoot: rootDir,
      sourcePath: app.source_path,
      buildConfig: projectModel.build_configs.get(appId)?.build_config ?? {},
      buildEnv: resolvedEnv,
      outputDir,
    };

    try {
      const artifact = await builder.build(context);
      artifacts.push({ appId, artifact });
    } catch (err) {
      return {
        kind: 'invalid',
        errors: [
          {
            code: CLI_BUILD_FAILED,
            message: `build failed for app '${appId}': ${err instanceof Error ? err.message : String(err)}`,
            file: '.ycsf/apps.yaml',
            app: appId,
          },
        ],
      };
    }
  }

  return { kind: 'ok', projectModel, registry, artifacts };
}
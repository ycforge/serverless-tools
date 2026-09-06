import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  ProjectModelError,
  type App,
  type BuildConfig,
  type EnvRequirement,
  type ProjectModel,
  type ProjectModelDiagnostic,
  type ProjectModelLoadResult,
  type Resource,
} from '../contracts/index.js';

import { extractApps } from './apps.js';
import { loadAppBuildConfig } from './build-config.js';
import { buildDependsOnGraph } from './depends-on.js';
import { checkEnvRequirements } from './env-requirements.js';
import { parseYaml } from './parse.js';
import { checkIdentityCollision, extractResources } from './resources.js';

const APPS_FILE = '.ycsf/apps.yaml';
const RESOURCES_FILE = '.ycsf/resources.yaml';

/**
 * Load + validate a project model from a repo root (`.ycsf/apps.yaml` is
 * mandatory, `.ycsf/resources.yaml` and per-app `build_config.yaml` optional).
 *
 * Single sync pass; all validation failures are collected and returned as
 * `{ kind: 'invalid', errors }`. Throws ONLY for I/O catastrophes — a missing
 * or unreadable `.ycsf/apps.yaml` (data-model.md load flow).
 */
export function loadProjectModel(rootDir: string): ProjectModelLoadResult {
  const appsPath = join(rootDir, '.ycsf', 'apps.yaml');
  if (!existsSync(appsPath)) {
    throw new Error(`missing ${APPS_FILE} — '${rootDir}' is not a serverless-tools project root`);
  }
  const appsYaml = readFileSync(appsPath, 'utf8');

  const diagnostics: ProjectModelDiagnostic[] = [];

  const parsedApps = parseYaml(appsYaml, APPS_FILE);
  if (parsedApps.kind !== 'ok') {
    return invalid(parsedApps.errors);
  }
  const appsResult = extractApps(parsedApps.data, APPS_FILE);
  if (appsResult.kind !== 'ok') {
    return invalid(appsResult.errors);
  }
  const apps = appsResult.apps;

  const resourcesResult = loadResources(rootDir);
  if (resourcesResult.kind === 'invalid') {
    diagnostics.push(...resourcesResult.errors);
    return invalid(diagnostics);
  }
  const resources = resourcesResult.resources;

  const buildConfigs = new Map<string, BuildConfig>();
  for (const app of apps) {
    const config = loadAppBuildConfig(rootDir, app.app_id);
    if (config.kind === 'ok') {
      buildConfigs.set(app.app_id, config.build_config);
    } else {
      diagnostics.push(...config.errors);
    }
  }

  const envRequirements = new Map<string, EnvRequirement>();
  for (const app of apps) {
    const config = buildConfigs.get(app.app_id);
    if (!config) continue;
    const { requirements, errors: envErrors } = checkEnvRequirements(
      app.app_id,
      config,
      `${app.app_id}/build_config.yaml`,
    );
    for (const requirement of requirements) {
      envRequirements.set(requirement.name, requirement);
    }
    diagnostics.push(...envErrors);
  }

  const graphResult = buildDependsOnGraph(apps);
  if (graphResult.kind === 'invalid') {
    diagnostics.push(...graphResult.errors);
  }

  const appsById = new Map(apps.map((app) => [app.app_id, app]));
  diagnostics.push(...checkIdentityCollision(appsById, resources));

  if (diagnostics.length > 0) {
    return invalid(diagnostics);
  }

  const model: ProjectModel = {
    apps: appsById,
    resources,
    build_configs: buildConfigs,
    env_requirements: envRequirements,
    depends_on_graph: graphResult.graph,
  };
  return { kind: 'ok', model };
}

type ResourcesLoadResult =
  | { kind: 'ok'; resources: Map<string, Map<string, Resource>> }
  | { kind: 'invalid'; errors: readonly ProjectModelDiagnostic[] };

function loadResources(rootDir: string): ResourcesLoadResult {
  const path = join(rootDir, '.ycsf', 'resources.yaml');
  if (!existsSync(path)) {
    return { kind: 'ok', resources: new Map() };
  }
  const text = readFileSync(path, 'utf8');
  const parsed = parseYaml(text, RESOURCES_FILE);
  if (parsed.kind !== 'ok') {
    return { kind: 'invalid', errors: parsed.errors };
  }
  return extractResources(parsed.data, RESOURCES_FILE);
}

export function invalid(errors: readonly ProjectModelDiagnostic[]): ProjectModelLoadResult {
  return { kind: 'invalid', errors: [new ProjectModelError(errors)] };
}

export type { App, BuildConfig, EnvRequirement, ProjectModel, ProjectModelDiagnostic, Resource };
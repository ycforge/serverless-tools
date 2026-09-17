import {
  PML_ENV_NOT_SET,
  type BuildConfig,
  type EnvRequirement,
  type ProjectModelDiagnostic,
} from '../contracts/index.js';

import { diag } from './errors.js';
import { forEachStringLeaf } from './string-leaves.js';

/**
 * `{{$ENV}}` extraction + presence validation (US-4, FR-009/FR-010, research
 * decision 4). Interpolation refs in build_config string leaves and build_env
 * values are required; a bare `null` build_env entry is a requirement too.
 * Presence checked against `process.env` at load; interpolation itself is
 * spec 012 (out of scope here).
 */
export const ENV_REF_RE = /\{\{\$([A-Z0-9_]+)\}\}/g;

/**
 * Pure extraction of required env names from a {@link BuildConfig}.
 * `env` is defaulted to `process.env` so presence is observable immediately.
 */
export function extractEnvRequirements(
  appId: string,
  buildConfig: BuildConfig,
  env: Readonly<Record<string, string | undefined>> = process.env,
): readonly EnvRequirement[] {
  const requirements = new Map<string, EnvRequirement>();

  const stringLeaves: string[] = [];
  forEachStringLeaf(buildConfig.build_config, (leaf) => {
    stringLeaves.push(leaf);
  });
  for (const leaf of stringLeaves) {
    for (const match of leaf.matchAll(ENV_REF_RE)) {
      const name = match[1];
      if (name !== undefined) {
        addRequirement(requirements, appId, name, 'build_config', env);
      }
    }
  }

  for (const [name, value] of Object.entries(buildConfig.build_env)) {
    if (value === null) {
      addRequirement(requirements, appId, name, 'build_env', env);
      continue;
    }
    for (const match of value.matchAll(ENV_REF_RE)) {
      const refName = match[1];
      if (refName !== undefined) {
        addRequirement(requirements, appId, refName, 'build_env', env);
      }
    }
  }

  return [...requirements.values()];
}

/**
 * Extract + collect PML_ENV_NOT_SET diagnostics for every required name absent
 * from `env` (collect-all, not first-failure).
 */
export function checkEnvRequirements(
  appId: string,
  buildConfig: BuildConfig,
  file: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): { requirements: readonly EnvRequirement[]; errors: readonly ProjectModelDiagnostic[] } {
  const requirements = extractEnvRequirements(appId, buildConfig, env);
  const errors = requirements
    .filter((requirement) => !requirement.isSet)
    .map((requirement) =>
      diag({
        code: PML_ENV_NOT_SET,
        message: `required ENV '${requirement.name}' is not set (${requirement.source} for app '${appId}')`,
        file,
        app: appId,
        field: requirement.name,
      }),
    );
  return { requirements, errors };
}

function addRequirement(
  requirements: Map<string, EnvRequirement>,
  appId: string,
  name: string,
  source: 'build_config' | 'build_env',
  env: Readonly<Record<string, string | undefined>>,
): void {
  if (requirements.has(name)) return;
  const value = env[name];
  const isSet = value !== undefined && value !== '';
  requirements.set(name, { name, source, app_id: appId, isSet });
}
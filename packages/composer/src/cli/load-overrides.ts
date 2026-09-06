import { resolve } from 'node:path';

import { loadOverrideFile } from '../compose/overrides/override-yaml.js';
import type { OverrideFile } from '../compose/overrides/override-types.js';
import { resolveReferencesInValue } from '../resource/reference-resolver.js';
import type { EnvMapping, ResourceIndex } from '../resource/types.js';
import { IOError, CLIError } from './errors.js';

export async function loadGlobalOverrides(projectRoot: string): Promise<OverrideFile | null> {
  return loadFromRoot(resolve(projectRoot, 'openapi'), 'global overrides');
}

export async function loadAppOverrides(appPath: string): Promise<OverrideFile | null> {
  return loadFromRoot(appPath, 'app overrides');
}

async function loadFromRoot(root: string, label: string): Promise<OverrideFile | null> {
  try {
    return await loadOverrideFile(root);
  } catch (error) {
    if (error instanceof CLIError) {
      throw error;
    }
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw new IOError(`Failed to load ${label}: ${error instanceof Error ? error.message : String(error)}`, 'OVERRIDES_LOAD_ERROR');
  }
}

export interface OverridesConfig {
  global: OverrideFile | null;
  app: OverrideFile | null;
}

export async function loadOverrides(
  projectRoot: string,
  appPath: string,
): Promise<OverridesConfig> {
  const [global, app] = await Promise.all([
    loadGlobalOverrides(projectRoot),
    loadAppOverrides(appPath),
  ]);

  if (global !== null && app !== null && global.sourcePath === app.sourcePath) {
    return { global: null, app };
  }

  return { global, app };
}

export function overridePrecedence(
  overrides: OverridesConfig,
  appId: string,
): { hasGlobal: boolean; localEntries: Array<{ appId: string; file: OverrideFile }> } {
  const localEntries =
    overrides.app !== null ? [{ appId, file: overrides.app }] : [];
  return { hasGlobal: overrides.global !== null, localEntries };
}

export function overrideTargetCount(overrides: OverridesConfig): number {
  return (overrides.global?.rules.length ?? 0) + (overrides.app?.rules.length ?? 0);
}

function resolveOverrideFile(
  file: OverrideFile | null,
  envMapping: EnvMapping,
  index: ResourceIndex,
): OverrideFile | null {
  if (file === null) {
    return null;
  }
  return {
    version: file.version,
    sourcePath: file.sourcePath,
    rules: file.rules.map((rule) => ({
      ...rule,
      value: resolveReferencesInValue(rule.value, envMapping, index),
    })),
  };
}

/**
 * Pure pre-pass for compile (010 T033): every `${resources...}` template found
 * in override rule `value` trees is resolved against the resource index BEFORE
 * the patches are applied to the spec. Values are never mutated in place.
 */
export function resolveOverrideValues(
  overrides: OverridesConfig,
  envMapping: EnvMapping,
  index: ResourceIndex,
): OverridesConfig {
  return {
    global: resolveOverrideFile(overrides.global, envMapping, index),
    app: resolveOverrideFile(overrides.app, envMapping, index),
  };
}
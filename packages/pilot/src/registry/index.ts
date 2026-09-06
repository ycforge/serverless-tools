import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { PluginRegistry, PluginRegistryLoadResult } from '../contracts/registry.js';
import { BRG_MISSING_FILE } from '../contracts/registry.js';
import { parseBuildersYaml } from './builders-yaml.js';
import { loadPlugins } from './load.js';
import { validateBuilders } from './validate.js';

export { validateBuilders };

const BUILDERS_FILE = '.ycsf/builders.yaml';

export async function loadRegistry(rootDir: string): Promise<PluginRegistryLoadResult> {
  const filePath = join(rootDir, BUILDERS_FILE);

  // I/O failure = throw (per user decision, symmetric with spec 011 loadProjectModel)
  if (!existsSync(filePath)) {
    throw new Error(`missing ${BUILDERS_FILE} (BRG_MISSING_FILE)`);
  }

  const text = readFileSync(filePath, 'utf8');
  const parsed = parseBuildersYaml(text, BUILDERS_FILE);

  // Structural error → fail-fast, no dynamic import (SC-004)
  if (parsed.kind === 'invalid') {
    return { kind: 'invalid', errors: parsed.errors };
  }

  // Convert to entries map for loadPlugins
  const entries = new Map<string, { id: string; packageName: string; kind: 'builder' | 'materializer' }>();
  for (const [id, packageName] of Object.entries(parsed.data.builders)) {
    entries.set(id, { id, packageName, kind: 'builder' });
  }
  for (const [id, packageName] of Object.entries(parsed.data.materializers)) {
    entries.set(id, { id, packageName, kind: 'materializer' });
  }

  const { entries: loaded, errors: loadErrors } = await loadPlugins(entries);

  if (loadErrors.length > 0) {
    return { kind: 'invalid', errors: loadErrors };
  }

  // Build frozen immutable registry (research decision 6: ReadonlyMap + freeze)
  const records = Object.freeze(new Map(loaded)) as ReadonlyMap<string, import('../contracts/registry.js').PluginEntry>;
  const registry: PluginRegistry = { records };
  return { kind: 'ok', registry };
}

import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

import type { PluginRegistry, PluginRegistryLoadResult } from '../contracts/registry.js';
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
    entries.set(`builder:${id}`, { id, packageName, kind: 'builder' });
  }
  for (const [id, packageName] of Object.entries(parsed.data.materializers)) {
    entries.set(`materializer:${id}`, { id, packageName, kind: 'materializer' });
  }

  // spec 028 (FR-018): bare specifiers resolve from the CONSUMER project graph
  // (pnpm/subpath exports aware), anchored at the registry root — plugin
  // packages must be reachable from the user project, not from pilot's own
  // module graph (BBC-5).
  const requireFromConsumer = createRequire(join(rootDir, 'package.json'));
  const resolveFrom = (specifier: string): string => {
    const resolved = requireFromConsumer.resolve(specifier);
    // createRequire.resolve resolves the "require" condition (…/index.cjs for
    // tsup dual builds); prefer the sibling ESM build so the imported
    // namespace matches what a plain ESM import() of the same specifier sees
    // (import condition) — avoids the CJS double-`default` wrap.
    if (resolved.endsWith('.cjs')) {
      const esmTwin = `${resolved.slice(0, -4)}.js`;
      if (existsSync(esmTwin)) return esmTwin;
    }
    return resolved;
  };
  const { entries: loaded, errors: loadErrors } = await loadPlugins(entries, {
    resolveFrom,
  });

  if (loadErrors.length > 0) {
    return { kind: 'invalid', errors: loadErrors };
  }

  // Build frozen immutable registry (research decision 6: ReadonlyMap + freeze).
  // spec 028 (T035): keys are `<kind>:<id>` — loadPlugins already qualifies them
  // (FR-019, two section namespaces coexist in a single Map). Raw `id` stays in
  // PluginEntry.id for diagnostics (D-5, texts unchanged).
  const records = Object.freeze(new Map(loaded)) as ReadonlyMap<string, import('../contracts/registry.js').PluginEntry>;
  const registry: PluginRegistry = { records };
  return { kind: 'ok', registry };
}

import type { PluginEntry, PluginLoadError } from '../contracts/registry.js';
import { BRG_LOAD_ERROR, BRG_NOT_A_PLUGIN, BRG_PACKAGE_NOT_FOUND } from '../contracts/registry.js';
import { detectPluginKind } from './shape.js';

export interface LoadPluginsResult {
  readonly entries: Map<string, PluginEntry>;
  readonly errors: PluginLoadError[];
}

export async function loadPlugins(
  entries: ReadonlyMap<string, { id: string; packageName: string; kind: 'builder' | 'materializer' }>,
): Promise<LoadPluginsResult> {
  const loaded = new Map<string, PluginEntry>();
  const errors: PluginLoadError[] = [];

  const tasks = [...entries.values()].map(async (entry) => {
    try {
      const ns = (await import(entry.packageName)) as Record<string, unknown>;
      const detectedKind = detectPluginKind(ns);
      if (detectedKind === null) {
        errors.push({
          id: entry.id,
          packageName: entry.packageName,
          code: BRG_NOT_A_PLUGIN,
          message: `module '${entry.packageName}' does not export a Builder or Materializer (BRG_NOT_A_PLUGIN)`,
        });
        return;
      }
      loaded.set(entry.id, {
        id: entry.id,
        packageName: entry.packageName,
        kind: entry.kind,
        module: ns,
      });
    } catch (err: unknown) {
      const error = err as { code?: string; message?: string };
      const code = error.code === 'ERR_MODULE_NOT_FOUND'
        ? BRG_PACKAGE_NOT_FOUND
        : BRG_LOAD_ERROR;
      errors.push({
        id: entry.id,
        packageName: entry.packageName,
        code,
        message: code === BRG_PACKAGE_NOT_FOUND
          ? `package '${entry.packageName}' not found (BRG_PACKAGE_NOT_FOUND)`
          : `module '${entry.packageName}' failed to load (BRG_LOAD_ERROR)`,
      });
    }
  });

  await Promise.all(tasks);

  return { entries: loaded, errors };
}

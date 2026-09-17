import { pathToFileURL } from 'node:url';

import type { PluginEntry, PluginLoadError } from '../contracts/registry.js';
import { BRG_LOAD_ERROR, BRG_NOT_A_PLUGIN, BRG_PACKAGE_NOT_FOUND } from '../contracts/registry.js';
import { detectPluginKind } from './shape.js';

export interface LoadPluginsResult {
  readonly entries: Map<string, PluginEntry>;
  readonly errors: PluginLoadError[];
}

/**
 * spec 028 (T034): options for `loadPlugins`. `resolveFrom` is additive — a
 * consumer-graph resolver anchored at the project root
 * (`createRequire(<root>/package.json).resolve`, pnpm/subpath-exports aware).
 * It applies to BARE specifiers only; relative/absolute paths keep today's
 * plain-`import()` semantics (legacy/fixture convenience, FR-020 — zero
 * regression for existing specifier forms).
 */
export interface LoadPluginsOptions {
  readonly resolveFrom?: (specifier: string) => string;
}

function isBareSpecifier(specifier: string): boolean {
  return !specifier.startsWith('.') && !specifier.startsWith('/') && !specifier.startsWith('file:');
}

export async function loadPlugins(
  entries: ReadonlyMap<string, { id: string; packageName: string; kind: 'builder' | 'materializer' }>,
  options: LoadPluginsOptions = {},
): Promise<LoadPluginsResult> {
  const loaded = new Map<string, PluginEntry>();
  const errors: PluginLoadError[] = [];

  const tasks = [...entries.values()].map(async (entry) => {
    let importTarget = entry.packageName;
    try {
      if (isBareSpecifier(entry.packageName)) {
        if (options.resolveFrom !== undefined) {
          let resolved: string;
          try {
            resolved = options.resolveFrom(entry.packageName);
          } catch {
            errors.push({
              id: entry.id,
              packageName: entry.packageName,
              code: BRG_PACKAGE_NOT_FOUND,
              message: `package '${entry.packageName}' is not reachable from the project node_modules — declare it as a dependency of the consumer project (BRG_PACKAGE_NOT_FOUND)`,
            });
            return;
          }
          importTarget = pathToFileURL(resolved).href;
        }
      }
      const ns = (await import(importTarget)) as Record<string, unknown>;
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
      // spec 028 (T035): records are keyed `<kind>:<key>` so a raw key may
      // coexist in builders AND materializers (FR-019). PluginEntry.id stays RAW
      // — diagnostics and selection print the raw id (D-5, texts unchanged).
      loaded.set(`${entry.kind}:${entry.id}`, {
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
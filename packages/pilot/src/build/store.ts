import { readdir, readFile } from 'node:fs/promises';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Artifact } from '../contracts/builder.js';
import type { AppIdArtifactMap } from '../contracts/materialize.js';

/**
 * Artifact store (spec 028, FR-006/FR-009; plan D-4).
 *
 * `ycsf build` writes one descriptor per app: `.ycsf/artifacts/<appId>/artifact.json`
 * = `{ "version": 1, "type": …, "value": … }`. Standalone `ycsf materialize`
 * reads the store — or an explicit `--artifacts <dir>` root — so its pipeline
 * output is byte-identical to the integrated build→materialize pass (SC-002).
 *
 * The store is a CODE-file contract, not a `.ycsf/*.yaml` format (NG-2):
 * `version: 1` is versioned like the 022 cache manifest. Deterministic reads
 * (sorted app ids) — SC-007.
 */

/** Contract version of the artifact-store descriptor (022 manifest analogy). */
export const ARTIFACT_STORE_VERSION = 1;

/** Writes the store descriptor into the per-app output directory (canonical JSON). */
export function writeStoreDescriptor(appOutputDir: string, artifact: Artifact): void {
  mkdirSync(appOutputDir, { recursive: true });
  const descriptor = { version: ARTIFACT_STORE_VERSION, type: artifact.type, value: artifact.value };
  writeFileSync(join(appOutputDir, 'artifact.json'), JSON.stringify(descriptor), 'utf8');
}

interface StoreDescriptor {
  readonly version: number;
  readonly type: string;
  readonly value?: unknown;
}

/** Reads one descriptor file; every failure is an actionable fail-fast (V). */
async function readDescriptorFile(filePath: string): Promise<StoreDescriptor> {
  let text: string;
  try {
    text = await readFile(filePath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(
        `missing artifact store descriptor ${filePath} — run \`ycsf build\` first or pass \`--artifacts <dir>\` (supported: ${ARTIFACT_STORE_VERSION})`,
      );
    }
    throw err;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(
      `invalid artifact store descriptor ${filePath} — run \`ycsf build\` to regenerate (supported: ${ARTIFACT_STORE_VERSION})`,
    );
  }

  const record = parsed as Record<string, unknown>;
  if (record['version'] !== ARTIFACT_STORE_VERSION) {
    throw new Error(
      `unsupported artifact store version ${String(record['version'])} in ${filePath} (supported: ${ARTIFACT_STORE_VERSION}) — run \`ycsf build\` to regenerate the store`,
    );
  }
  if (typeof record['type'] !== 'string') {
    throw new Error(
      `invalid artifact store descriptor ${filePath}: missing "type" — run \`ycsf build\` to regenerate (supported: ${ARTIFACT_STORE_VERSION})`,
    );
  }
  return { version: ARTIFACT_STORE_VERSION, type: record['type'], value: record['value'] };
}

/** Reads `${rootDir}/<appId>/artifact.json` for every app dir; absent root → empty map. */
async function readStoreDescriptorsFromRoot(rootDir: string): Promise<AppIdArtifactMap> {
  const store = new Map<string, Artifact>();

  let entries;
  try {
    entries = await readdir(rootDir, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return store;
    }
    throw err;
  }

  // Deterministic iteration order (SC-007) regardless of readdir ordering.
  for (const appName of entries.filter((e) => e.isDirectory()).map((e) => e.name).sort()) {
    const descriptor = await readDescriptorFile(join(rootDir, appName, 'artifact.json'));
    store.set(appName, { type: descriptor.type, value: descriptor.value });
  }
  return store;
}

/** Reads the default store `<rootDir>/.ycsf/artifacts/`. */
export async function readStoreDescriptors(rootDir: string): Promise<AppIdArtifactMap> {
  return readStoreDescriptorsFromRoot(join(rootDir, '.ycsf', 'artifacts'));
}

/** Reads an explicit `--artifacts <dir>` root (same per-app descriptor structure). */
export async function readStoreDescriptorsFrom(dir: string): Promise<AppIdArtifactMap> {
  return readStoreDescriptorsFromRoot(dir);
}
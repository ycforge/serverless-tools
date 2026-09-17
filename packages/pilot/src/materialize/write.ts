import { mkdir, readdir, unlink, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

import type { GeneratedTfFile } from '../contracts/index.js';

/**
 * writeGeneratedTerraform — the ONLY fs-touching module of the dispatch
 * surface (FR-015/016, research 6). Pure I/O:
 *  - validates ALL C-owned filenames (`<name>.ycsf.tf.json` for per-app files
 *    plus `<name>-ycsf-outputs.tf.json` for the spec-016 outputs file,
 *    basename-safe) BEFORE creating dirs or writing anything (A3: traversal
 *    rejects);
 *  - recursive mkdir of `infraDir`;
 *  - writes every generated file;
 *  - removes stale C-owned generated files not in the current set (including
 *    legacy `00-ycsf-outputs.tf.json`, spec 016 SC-007);
 *    user `*.tf` files are never read, written or deleted (FR-015).
 */

/** Per-app generated file glob (`<app_id>.ycsf.tf.json`, spec 014). */
const FILENAME_RE = /^[A-Za-z0-9_-]+\.ycsf\.tf\.json$/;
/** Outputs merged file glob (`99-ycsf-outputs.tf.json`, spec 016 FR-020). */
const OUTPUTS_FILENAME_RE = /^[A-Za-z0-9_-]+-ycsf-outputs\.tf\.json$/;

function isCGeneratedFilename(name: string): boolean {
  return FILENAME_RE.test(name) || OUTPUTS_FILENAME_RE.test(name);
}

function assertSafeFilename(filename: string): void {
  if (!isCGeneratedFilename(filename) || basename(filename) !== filename) {
    throw new Error(
      `invalid filename '${filename}' — expected a safe basename matching '<name>.ycsf.tf.json' or '<name>-ycsf-outputs.tf.json'`,
    );
  }
}

export async function writeGeneratedTerraform(
  infraDir: string,
  files: readonly GeneratedTfFile[],
): Promise<void> {
  for (const file of files) {
    assertSafeFilename(file.filename);
  }

  await mkdir(infraDir, { recursive: true });

  const current = new Set<string>();
  for (const file of files) {
    current.add(file.filename);
    await writeFile(join(infraDir, file.filename), file.content, 'utf8');
  }

  const existing = await readdir(infraDir);
  for (const name of existing) {
    if (!isCGeneratedFilename(name)) continue;
    if (current.has(name)) continue;
    await unlink(join(infraDir, name));
  }
}
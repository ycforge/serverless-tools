import { mkdir, readdir, unlink, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

import type { GeneratedTfFile } from '../contracts/index.js';

/**
 * writeGeneratedTerraform — the ONLY fs-touching module of the dispatch
 * surface (FR-015/016, research 6). Pure I/O:
 *  - validates ALL filenames (`^[A-Za-z0-9_-]+\.ycsf\.tf\.json$`, basename-safe)
 *    BEFORE creating dirs or writing anything (A3: traversal rejects);
 *  - recursive mkdir of `infraDir`;
 *  - writes every generated file;
 *  - removes stale C-owned `*.ycsf.tf.json` not in the current set;
 *    user `*.tf` files are never read, written or deleted (FR-015).
 */

/** Ownership + validity glob for generated files. */
const FILENAME_RE = /^[A-Za-z0-9_-]+\.ycsf\.tf\.json$/;

function assertSafeFilename(filename: string): void {
  if (!FILENAME_RE.test(filename) || basename(filename) !== filename) {
    throw new Error(
      `invalid filename '${filename}' — expected a safe basename matching '<name>.ycsf.tf.json'`,
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
    if (!name.endsWith('.ycsf.tf.json')) continue;
    if (current.has(name)) continue;
    await unlink(join(infraDir, name));
  }
}
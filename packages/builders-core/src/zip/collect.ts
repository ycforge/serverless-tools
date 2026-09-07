/**
 * Recursive directory collect for zip staging (DQ-1): files only, relative
 * forward-slash paths, no directory entries. `.DS_Store` is never packaged.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import type { ZipEntryInput } from './writer.js';

function collectInto(dir: string, relPrefix: string, out: ZipEntryInput[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.DS_Store') continue;
    const full = join(dir, entry.name);
    const rel = relPrefix === '' ? entry.name : `${relPrefix}/${entry.name}`;
    if (entry.isDirectory()) {
      collectInto(full, rel, out);
    } else if (entry.isFile() || entry.isSymbolicLink()) {
      const stats = statSync(full);
      out.push({ path: rel, data: readFileSync(full), mtime: Math.floor(stats.mtimeMs / 1000) });
    }
  }
}

export function collectDir(dir: string): ZipEntryInput[] {
  const out: ZipEntryInput[] = [];
  collectInto(dir, '', out);
  return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
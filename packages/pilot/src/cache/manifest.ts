// spec 022 — manifest I/O
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
import type { CacheManifest } from '../contracts/cache.js';
import { CACHE_CORRUPTED, CACHE_VERSION_MISMATCH, CACHE_WRITE_FAILED } from '../cli/errors.js';

export function getCacheDir(projectRoot: string, cacheDirOpt?: string): string {
  if (!cacheDirOpt) return join(projectRoot, '.ycsf', 'cache');
  if (isAbsolute(cacheDirOpt)) return cacheDirOpt;
  return join(projectRoot, cacheDirOpt);
}

export async function loadManifest(cacheDir: string): Promise<{ manifest: CacheManifest | null; warning?: string }> {
  const path = join(cacheDir, 'manifest.json');
  try {
    const text = await readFile(path, 'utf8');
    const parsed = JSON.parse(text) as CacheManifest;
    if ((parsed as unknown as { version: unknown }).version !== 1) {
      return { manifest: null, warning: CACHE_VERSION_MISMATCH };
    }
    if (!parsed.entries || typeof parsed.entries !== 'object') {
      return { manifest: null, warning: CACHE_CORRUPTED };
    }
    return { manifest: parsed };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return { manifest: null };
    // corrupted JSON or I/O
    const msg = err instanceof SyntaxError ? CACHE_CORRUPTED : CACHE_CORRUPTED;
    // version mismatch already handled; fallback to corrupted
    // Check if it's JSON parse error
    if (err instanceof SyntaxError) return { manifest: null, warning: CACHE_CORRUPTED };
    // For any other error, treat as corrupted
    // If error message contains version mismatch we already returned
    return { manifest: null, warning: msg };
  }
}

export async function saveManifest(cacheDir: string, manifest: CacheManifest): Promise<void> {
  const path = join(cacheDir, 'manifest.json');
  const tmp = path + '.tmp';
  try {
    await mkdir(cacheDir, { recursive: true });
    await writeFile(tmp, JSON.stringify(manifest, null, 2), 'utf8');
    await rename(tmp, path);
  } catch {
    // warning but not throw per FR-026
    try { process.stderr.write(`! ${CACHE_WRITE_FAILED}: failed to write cache manifest\n`); } catch {
      // ignore stderr failures
    }
  }
}

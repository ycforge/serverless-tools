import { describe, it, expect } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { saveManifest, loadManifest, getCacheDir } from '../../src/cache/manifest.js';
import { CACHE_CORRUPTED, CACHE_VERSION_MISMATCH } from '../../src/cli/errors.js';
describe('manifest', () => {
  it('save then load round-trip', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'manifest-'));
    const cacheDir = join(dir, '.ycsf', 'cache');
    const m = { version: 1 as const, entries: { app: { fingerprint: 'a'.repeat(64), effectiveFingerprint: 'b'.repeat(64), artifactType: 'ycforge:function', createdAt: new Date().toISOString(), dependsOnFingerprints: [] } } };
    await saveManifest(cacheDir, m);
    const loaded = await loadManifest(cacheDir);
    expect(loaded.manifest?.entries['app']?.effectiveFingerprint).toBe('b'.repeat(64));
    await rm(dir, { recursive: true, force: true });
  });
  it('corrupted JSON', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'manifest-c-'));
    const cacheDir = join(dir, 'c');
    await import('node:fs/promises').then(async ({ mkdir }) => await mkdir(cacheDir, { recursive: true }));
    await writeFile(join(cacheDir, 'manifest.json'), '{broken', 'utf8');
    const loaded = await loadManifest(cacheDir);
    expect(loaded.manifest).toBeNull();
    expect(loaded.warning).toBe(CACHE_CORRUPTED);
    await rm(dir, { recursive: true, force: true });
  });
  it('version mismatch', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'manifest-v-'));
    const cacheDir = join(dir, 'c');
    await import('node:fs/promises').then(async ({ mkdir }) => await mkdir(cacheDir, { recursive: true }));
    await writeFile(join(cacheDir, 'manifest.json'), JSON.stringify({ version: 999, entries: {} }), 'utf8');
    const loaded = await loadManifest(cacheDir);
    expect(loaded.warning).toBe(CACHE_VERSION_MISMATCH);
    await rm(dir, { recursive: true, force: true });
  });
  it('getCacheDir', () => {
    expect(getCacheDir('/root', '/tmp/x')).toBe('/tmp/x');
    expect(getCacheDir('/root', 'custom')).toBe('/root/custom');
    expect(getCacheDir('/root')).toBe('/root/.ycsf/cache');
  });
});

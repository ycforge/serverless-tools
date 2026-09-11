import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { checkCache } from '../../src/cache/index.js';
import { saveBlob } from '../../src/cache/blobs.js';
describe('checkCache', () => {
  it('noCache -> no_cache', async () => {
    const r = await checkCache({ noCache: true, effectiveFingerprint: 'a'.repeat(64), appId: 'app', manifest: null, cacheDir: '/tmp', own: { filesHash: 'a'.repeat(64), buildConfigHash: 'b'.repeat(64), buildEnvHash: 'c'.repeat(64), builder: 'b@1' }, depFingerprints: [] });
    expect(r.reason).toBe('no_cache');
  });
  it('no entry -> no_entry', async () => {
    const r = await checkCache({ effectiveFingerprint: 'a'.repeat(64), appId: 'app', manifest: { version: 1, entries: {} }, cacheDir: '/tmp', own: { filesHash: 'a'.repeat(64), buildConfigHash: 'b'.repeat(64), buildEnvHash: 'c'.repeat(64), builder: 'b@1' }, depFingerprints: [] });
    expect(r.reason).toBe('no_entry');
  });
  it('hit when blob valid', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cache-hit-'));
    const cacheDir = join(dir, 'cache');
    const artDir = join(dir, 'art');
    await mkdir(artDir, { recursive: true });
    const fp = 'a'.repeat(64);
    await saveBlob(cacheDir, fp, { type: 'ycforge:function', value: {} }, artDir);
    const manifest = { version: 1 as const, entries: { app: { fingerprint: fp, effectiveFingerprint: fp, artifactType: 'ycforge:function', createdAt: new Date().toISOString(), dependsOnFingerprints: [], filesHash: 'a'.repeat(64), buildConfigHash: 'b'.repeat(64), buildEnvHash: 'c'.repeat(64), builder: 'b@1' } } };
    const r = await checkCache({ effectiveFingerprint: fp, appId: 'app', manifest, cacheDir, own: { filesHash: 'a'.repeat(64), buildConfigHash: 'b'.repeat(64), buildEnvHash: 'c'.repeat(64), builder: 'b@1' }, depFingerprints: [] });
    expect(r.hit).toBe(true);
    await rm(dir, { recursive: true, force: true });
  });
});

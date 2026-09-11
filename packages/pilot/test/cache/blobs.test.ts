import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { saveBlob, restoreBlob, hasValidBlob } from '../../src/cache/blobs.js';
describe('blobs', () => {
  it('save then restore', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'blobs-'));
    const cacheDir = join(dir, 'cache');
    const artDir = join(dir, 'art');
    await mkdir(artDir, { recursive: true });
    await writeFile(join(artDir, 'file.txt'), 'hello');
    const fp = 'a'.repeat(64);
    await saveBlob(cacheDir, fp, { type: 'ycforge:function', value: { x: 1 } }, artDir);
    expect(await hasValidBlob(cacheDir, fp)).toBe(true);
    const dest = join(dir, 'dest');
    const art = await restoreBlob(cacheDir, fp, dest);
    expect(art?.type).toBe('ycforge:function');
    await rm(dir, { recursive: true, force: true });
  });
  it('missing blob', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'blobs2-'));
    expect(await hasValidBlob(join(dir, 'cache'), 'b'.repeat(64))).toBe(false);
    expect(await restoreBlob(join(dir, 'cache'), 'b'.repeat(64), join(dir, 'dest'))).toBeNull();
    await rm(dir, { recursive: true, force: true });
  });
});

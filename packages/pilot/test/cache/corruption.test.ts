import { describe, it, expect } from 'vitest';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadManifest } from '../../src/cache/manifest.js';
describe('corruption', () => {
  it('corrupted manifest', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'corr-'));
    await mkdir(join(dir, 'c'), { recursive: true });
    await writeFile(join(dir, 'c', 'manifest.json'), '{broken', 'utf8');
    const l = await loadManifest(join(dir, 'c'));
    expect(l.manifest).toBeNull();
    await rm(dir, { recursive: true, force: true });
  });
});

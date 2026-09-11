import { describe, it, expect } from 'vitest';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { computeFilesHash, hashString } from '../../src/cache/fingerprint.js';
describe('filesHash excludes', () => {
  it('git, node_modules, cache, artifacts, infra excluded', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ex-'));
    await mkdir(join(dir, 'src'), { recursive: true });
    await writeFile(join(dir, 'src', 'a.ts'), 'data');
    await mkdir(join(dir, '.git'), { recursive: true });
    await writeFile(join(dir, '.git', 'x'), 'git');
    await mkdir(join(dir, 'node_modules'), { recursive: true });
    await writeFile(join(dir, 'node_modules', 'y'), 'nm');
    await mkdir(join(dir, '.ycsf', 'cache'), { recursive: true });
    await writeFile(join(dir, '.ycsf', 'cache', 'm'), 'c');
    await mkdir(join(dir, '.ycsf', 'artifacts'), { recursive: true });
    await writeFile(join(dir, '.ycsf', 'artifacts', 'a'), 'art');
    await mkdir(join(dir, 'infra'), { recursive: true });
    await writeFile(join(dir, 'infra', 'f.tf'), 'infra');
    const h1 = await computeFilesHash(dir, 'src');
    // modify excluded file should not change hash
    await writeFile(join(dir, '.git', 'x'), 'changed');
    const h2 = await computeFilesHash(dir, 'src');
    expect(h1).toBe(h2);
    await rm(dir, { recursive: true, force: true });
  });
});

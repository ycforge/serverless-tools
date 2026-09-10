import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { rm } from 'node:fs/promises';
import { buildApps } from '../../src/build/index.js';

const fixtureRootDir = resolve(import.meta.dirname, '../check/fixtures/canonical');
const cacheDir = resolve(fixtureRootDir, '.ycsf', 'cache');
const artifactsDir = resolve(fixtureRootDir, '.ycsf', 'artifacts');

describe('cache integration', () => {
  it('first build miss second hit', async () => {
    await rm(cacheDir, { recursive: true, force: true });
    await rm(artifactsDir, { recursive: true, force: true });
    const r1 = await buildApps(fixtureRootDir);
    expect(r1.kind).toBe('ok');
    if (r1.kind !== 'ok') throw new Error('');
    expect(r1.cache?.misses).toBe(2);
    const r2 = await buildApps(fixtureRootDir);
    expect(r2.kind).toBe('ok');
    if (r2.kind !== 'ok') throw new Error('');
    expect(r2.cache?.hits).toBe(2);
  });
});
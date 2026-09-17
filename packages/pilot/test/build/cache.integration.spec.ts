import { describe, it, expect } from 'vitest';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { buildApps } from '../../src/build/index.js';

const canonicalFixture = resolve(import.meta.dirname, '../check/fixtures/canonical');

/** Fresh isolated copy of the canonical fixture: 024-style per-test sandbox. */
async function isolatedFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'pilot-cache-'));
  await cp(canonicalFixture, root, { recursive: true });
  await rm(join(root, '.ycsf', 'cache'), { recursive: true, force: true });
  await rm(join(root, '.ycsf', 'artifacts'), { recursive: true, force: true });
  return root;
}

describe('cache integration', () => {
  it('first build miss second hit', async () => {
    const rootDir = await isolatedFixture();
    try {
      const r1 = await buildApps(rootDir);
      expect(r1.kind).toBe('ok');
      if (r1.kind !== 'ok') throw new Error('');
      expect(r1.cache?.misses).toBe(2);
      const r2 = await buildApps(rootDir);
      expect(r2.kind).toBe('ok');
      if (r2.kind !== 'ok') throw new Error('');
      expect(r2.cache?.hits).toBe(2);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });
});
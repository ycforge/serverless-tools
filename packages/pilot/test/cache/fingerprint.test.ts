import { describe, it, expect } from 'vitest';
import { mkdtemp, writeFile, mkdir, symlink, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { canonicalJson, computeFilesHash, computeOwnFingerprint, computeEffectiveFingerprint, hashString } from '../../src/cache/fingerprint.js';

describe('fingerprint', () => {
  it('canonicalJson sorted keys', () => {
    expect(canonicalJson({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
    expect(canonicalJson({ z: { b:2, a:1 } })).toBe('{"z":{"a":1,"b":2}}');
  });
  it('filesHash stable and excludes', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fp-'));
    await mkdir(join(dir, 'src'), { recursive: true });
    await writeFile(join(dir, 'src', 'a.ts'), 'hello');
    await writeFile(join(dir, 'src', 'b.ts'), 'world');
    await mkdir(join(dir, '.git'), { recursive: true });
    await writeFile(join(dir, '.git', 'x'), 'ignore');
    await mkdir(join(dir, 'node_modules'), { recursive: true });
    await writeFile(join(dir, 'node_modules', 'y'), 'ignore2');
    const h1 = await computeFilesHash(dir, 'src');
    const h2 = await computeFilesHash(dir, 'src');
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[a-f0-9]{64}$/);
    await rm(dir, { recursive: true, force: true });
  });
  it('empty dir hash', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fp-empty-'));
    await mkdir(join(dir, 'empty'), { recursive: true });
    const h = await computeFilesHash(dir, 'empty');
    expect(h).toBe(hashString(''));
    await rm(dir, { recursive: true, force: true });
  });
  it('ownFingerprint 64 hex', () => {
    const fp = computeOwnFingerprint({ filesHash: 'a'.repeat(64), buildConfig: {}, buildEnv: {}, builder: 'test@1.0.0' });
    expect(fp).toMatch(/^[a-f0-9]{64}$/);
  });
  it('effective no deps equals own', () => {
    const own = 'a'.repeat(64);
    expect(computeEffectiveFingerprint(own, [])).toBe(own);
  });
  it('effective sorted', () => {
    const own = 'a'.repeat(64);
    const r1 = computeEffectiveFingerprint(own, ['b'.repeat(64), 'c'.repeat(64)]);
    const r2 = computeEffectiveFingerprint(own, ['c'.repeat(64), 'b'.repeat(64)]);
    expect(r1).toBe(r2);
  });
});

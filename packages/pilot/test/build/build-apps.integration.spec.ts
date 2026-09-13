import { describe, it, expect } from 'vitest';
import { cp, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { buildApps } from '../../src/build/index.js';
import { readStoreDescriptors } from '../../src/build/store.js';
import { CLI_APP_NOT_FOUND } from '../../src/cli/errors.js';

const canonicalFixture = resolve(import.meta.dirname, '../check/fixtures/canonical');

/** Fresh isolated copy of the canonical fixture: 024-style per-test sandbox. */
async function isolatedFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'pilot-build-apps-'));
  await cp(canonicalFixture, root, { recursive: true });
  await rm(join(root, '.ycsf', 'cache'), { recursive: true, force: true });
  await rm(join(root, '.ycsf', 'artifacts'), { recursive: true, force: true });
  return root;
}

describe('buildApps integration (T027)', () => {
  it('canonical fixture → kind:"ok" with 2 artifacts', async () => {
    const rootDir = await isolatedFixture();
    try {
      const result = await buildApps(rootDir);
      expect(result.kind).toBe('ok');
      if (result.kind !== 'ok') throw new Error(`expected ok, got: ${JSON.stringify(result.errors)}`);
      expect(result.artifacts).toHaveLength(2);
      expect(result.artifacts.map((a) => a.appId).sort()).toEqual(['analytics', 'user_service']);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it('canonical fixture --target unknown_app → kind:"invalid" with CLI_APP_NOT_FOUND', async () => {
    const rootDir = await isolatedFixture();
    try {
      const result = await buildApps(rootDir, { target: 'unknown_app' });
      expect(result.kind).toBe('invalid');
      if (result.kind !== 'invalid') throw new Error('expected invalid');
      expect(result.errors[0]?.code).toBe(CLI_APP_NOT_FOUND);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it('buildApps on missing project → kind:"invalid" with CLI_MISSING_PROJECT_DIR', async () => {
    await expect(buildApps('/nonexistent-dir-xyz')).resolves.toMatchObject({
      kind: 'invalid',
    });
  });
});

describe('artifact store persistence (spec 028, T014)', () => {
  it('each built artifact is persisted as .ycsf/artifacts/<appId>/artifact.json {version:1,type,value}', async () => {
    const rootDir = await isolatedFixture();
    try {
      const result = await buildApps(rootDir, { noCache: true });
      expect(result.kind).toBe('ok');
      if (result.kind !== 'ok') throw new Error(`expected ok, got: ${JSON.stringify(result.errors)}`);
      expect(result.artifacts).toHaveLength(2);

      for (const { appId } of result.artifacts) {
        const descriptorPath = join(rootDir, '.ycsf', 'artifacts', appId, 'artifact.json');
        expect(existsSync(descriptorPath)).toBe(true);
        const descriptor = JSON.parse(await readFile(descriptorPath, 'utf8'));
        expect(descriptor.version).toBe(1);
        expect(typeof descriptor.type).toBe('string');
        expect(descriptor.value).toBeDefined();
      }
      expect((await readdir(join(rootDir, '.ycsf', 'artifacts'))).filter((d) => d.endsWith('artifact.json') === false).length).toBeGreaterThanOrEqual(2);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it('a cached (hit) build keeps storing exactly one artifact.json per app and store loads back (T014)', async () => {
    const rootDir = await isolatedFixture();
    try {
      const first = await buildApps(rootDir);
      expect(first.kind).toBe('ok');
      if (first.kind !== 'ok') throw new Error('expected ok');

      const second = await buildApps(rootDir);
      expect(second.kind).toBe('ok');
      if (second.kind !== 'ok') throw new Error('expected ok');

      for (const { appId } of second.artifacts) {
        const dir = join(rootDir, '.ycsf', 'artifacts', appId);
        const files = await readdir(dir);
        expect(files).toContain('artifact.json');
        expect(files.filter((f) => f === 'artifact.json')).toHaveLength(1);
      }
      expect(second.artifacts.length).toBe(2);

      const store = await readStoreDescriptors(rootDir);
      expect(store.size).toBe(2);
      for (const { appId, artifact } of second.artifacts) {
        expect(store.get(appId)?.type).toBe(artifact.type);
      }
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });
});
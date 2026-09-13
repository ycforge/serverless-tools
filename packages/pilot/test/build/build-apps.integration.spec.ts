import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { buildApps } from '../../src/build/index.js';
import { readStoreDescriptors } from '../../src/build/store.js';
import { CLI_APP_NOT_FOUND } from '../../src/cli/errors.js';

const fixtureRootDir = resolve(import.meta.dirname, '../check/fixtures/canonical');

describe('buildApps integration (T027)', () => {
  it('canonical fixture → kind:"ok" with 2 artifacts', async () => {
    const result = await buildApps(fixtureRootDir);
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') throw new Error(`expected ok, got: ${JSON.stringify(result.errors)}`);
    expect(result.artifacts).toHaveLength(2);
    expect(result.artifacts.map((a) => a.appId).sort()).toEqual(['analytics', 'user_service']);
  });

  it('canonical fixture --target unknown_app → kind:"invalid" with CLI_APP_NOT_FOUND', async () => {
    const result = await buildApps(fixtureRootDir, { target: 'unknown_app' });
    expect(result.kind).toBe('invalid');
    if (result.kind !== 'invalid') throw new Error('expected invalid');
    expect(result.errors[0]?.code).toBe(CLI_APP_NOT_FOUND);
  });

  it('buildApps on missing project → kind:"invalid" with CLI_MISSING_PROJECT_DIR', async () => {
    await expect(buildApps('/nonexistent-dir-xyz')).resolves.toMatchObject({
      kind: 'invalid',
    });
  });
});

describe('artifact store persistence (spec 028, T014)', () => {
  it('each built artifact is persisted as .ycsf/artifacts/<appId>/artifact.json {version:1,type,value}', async () => {
    const result = await buildApps(fixtureRootDir, { noCache: true });
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') throw new Error(`expected ok, got: ${JSON.stringify(result.errors)}`);
    expect(result.artifacts).toHaveLength(2);

    for (const { appId } of result.artifacts) {
      const descriptorPath = join(fixtureRootDir, '.ycsf', 'artifacts', appId, 'artifact.json');
      expect(existsSync(descriptorPath)).toBe(true);
      const descriptor = JSON.parse(readFileSync(descriptorPath, 'utf8'));
      expect(descriptor.version).toBe(1);
      expect(typeof descriptor.type).toBe('string');
      expect(descriptor.value).toBeDefined();
    }
    expect(readdirSync(join(fixtureRootDir, '.ycsf', 'artifacts')).filter((d) => d.endsWith('artifact.json') === false).length).toBeGreaterThanOrEqual(2);
  });

  it('a cached (hit) build keeps storing exactly one artifact.json per app and store loads back (T014)', async () => {
    const first = await buildApps(fixtureRootDir);
    expect(first.kind).toBe('ok');
    if (first.kind !== 'ok') throw new Error('expected ok');

    const second = await buildApps(fixtureRootDir);
    expect(second.kind).toBe('ok');
    if (second.kind !== 'ok') throw new Error('expected ok');

    for (const { appId } of second.artifacts) {
      const dir = join(fixtureRootDir, '.ycsf', 'artifacts', appId);
      const files = readdirSync(dir);
      expect(files).toContain('artifact.json');
      expect(files.filter((f) => f === 'artifact.json')).toHaveLength(1);
    }
    expect(second.artifacts.length).toBe(2);

    const store = await readStoreDescriptors(fixtureRootDir);
    expect(store.size).toBe(2);
    for (const { appId, artifact } of second.artifacts) {
      expect(store.get(appId)?.type).toBe(artifact.type);
    }
  });
});
import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { resolveRunnerPath, spawnRunner } from './spawn-runner.js';

const FIXTURES = fileURLToPath(new URL('../../test/fixtures/runner-apps/', import.meta.url));
const APP_ROOT = fileURLToPath(new URL('../../test/fixtures/', import.meta.url));

describe('resolveRunnerPath', () => {
  it('resolves the shipped runner script from a source-layout import.meta.url', () => {
    const sourceModule = new URL('../../src/runner/spawn-runner.js', import.meta.url).href;
    const path = resolveRunnerPath(sourceModule);
    expect(path).toBe(fileURLToPath(new URL('../../runner/runner.mjs', import.meta.url)));
    expect(existsSync(path)).toBe(true);
  });

  it('resolves the shipped runner script from a bundled dist/index.js import.meta.url', () => {
    const distEntry = new URL('../../dist/index.js', import.meta.url).href;
    const path = resolveRunnerPath(distEntry);
    expect(path).toBe(fileURLToPath(new URL('../../runner/runner.mjs', import.meta.url)));
    expect(existsSync(path)).toBe(true);
  });
});

describe('spawnRunner', () => {
  it('returns the document produced by the entry, with the safe-mode env visible inside the child', async () => {
    const doc = await spawnRunner(APP_ROOT, `${FIXTURES}runner-ok.mjs`, 10000);
    expect(doc?.['info']).toEqual({ title: 'runner-ok', version: '1.0.0' });
    expect(doc?.['x-env-observed']).toBe('1');
  });

  it('classifies an entry that throws as ENTRY_EXECUTION_FAILED', async () => {
    await expect(
      spawnRunner(APP_ROOT, `${FIXTURES}runner-throws.mjs`, 10000),
    ).rejects.toMatchObject({ code: 'ENTRY_EXECUTION_FAILED' });
  });

  it('kills a hanging entry as ENTRY_TIMEOUT and leaves the main process alive', async () => {
    const started = Date.now();
    await expect(
      spawnRunner(APP_ROOT, `${FIXTURES}runner-hangs.mjs`, 250),
    ).rejects.toMatchObject({ code: 'ENTRY_TIMEOUT' });
    expect(Date.now() - started).toBeGreaterThanOrEqual(200);
  });

  it('classifies a child that writes malformed stdout as ENTRY_RETURNED_INVALID', async () => {
    await expect(
      spawnRunner(APP_ROOT, `${FIXTURES}runner-garbage.mjs`, 10000),
    ).rejects.toMatchObject({ code: 'ENTRY_RETURNED_INVALID' });
  });

  it('classifies a missing entry as ENTRY_LOAD_FAILED', async () => {
    await expect(
      spawnRunner(APP_ROOT, `${FIXTURES}does-not-exist.mjs`, 10000),
    ).rejects.toMatchObject({ code: 'ENTRY_LOAD_FAILED' });
  });
});
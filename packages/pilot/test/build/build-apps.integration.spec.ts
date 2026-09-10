import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { buildApps } from '../../src/build/index.js';
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
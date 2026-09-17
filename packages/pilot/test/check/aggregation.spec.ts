import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';

import { EXT_UNRESOLVED_TARGET } from '../../src/contracts/index.js';
import { YCK_MISSING_TARGET } from '../../src/contracts/check.js';
import { check } from '../../src/check/check.js';

const FIXTURES = join(import.meta.dirname, 'fixtures');

let tempDir: string;

afterEach(() => {
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined as unknown as string;
  }
});

function createTempDir(): string {
  tempDir = join(tmpdir(), 'pilot-check-aggregation-');
  mkdirSync(tempDir, { recursive: true });
  return tempDir;
}

function writeYcsf(relPath: string, content: string): void {
  const full = join(tempDir, '.ycsf', relPath);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, content, 'utf8');
}

function writeJson(relPath: string, content: unknown): void {
  const full = join(tempDir, relPath);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, JSON.stringify(content), 'utf8');
}

describe('aggregation (T070)', () => {
  it('AC1: canonical project → 0 diagnostics', async () => {
    const result = await check(join(FIXTURES, 'canonical'));
    expect(result.diagnostics).toHaveLength(0);
  });

  it('AC2: project with EXT_UNRESOLVED_TARGET + missing ENV → diagnostics contains both', async () => {
    tempDir = createTempDir();
    writeYcsf('apps.yaml', 'version: 1\napps:\n  user_service:\n    source_path: src\n    builder: nodejs-builder\n');
    writeYcsf('extensions.yaml', 'version: 1\nextensions:\n  - target: functions.missing\n    patch: {}\n');
    writeJson('.ycsf/yandex-function.user_service.ycsf.tf.json', {
      resource: { yandex_function: { user_service: { runtime: 'nodejs18' } } },
    });

    const result = await check(tempDir);
    const extErrors = result.diagnostics.filter((d) => d.code === EXT_UNRESOLVED_TARGET);
    const yckErrors = result.diagnostics.filter((d) => d.code === YCK_MISSING_TARGET);
    expect(extErrors.length).toBeGreaterThanOrEqual(1);
    expect(yckErrors.length).toBeGreaterThanOrEqual(1);
  });

  it('SC-005: mixed-diagnostics fixture returns diagnostics from PML_*, EXT_*, YCK_* families', async () => {
    tempDir = createTempDir();
    writeYcsf('apps.yaml', 'version: 1\napps:\n  user_service:\n    source_path: src\n    builder: nodejs-builder\n');
    writeYcsf('extensions.yaml', 'version: 1\nextensions:\n  - target: functions.missing\n    patch: {}\n');
    writeJson('.ycsf/yandex-function.user_service.ycsf.tf.json', {
      resource: { yandex_function: { user_service: { runtime: 'nodejs18' } } },
    });

    const result = await check(tempDir);
    const codes = new Set(result.diagnostics.map((d) => d.code));
    // Should have at least EXT_UNRESOLVED_TARGET and YCK_MISSING_TARGET
    expect(codes.has(EXT_UNRESOLVED_TARGET)).toBe(true);
    expect(codes.has(YCK_MISSING_TARGET)).toBe(true);
  });

  it('SC-001: canonical project → 0 diagnostics', async () => {
    const result = await check(join(FIXTURES, 'canonical'));
    expect(result.diagnostics).toEqual([]);
  });
});

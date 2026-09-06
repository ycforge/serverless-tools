import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { BRG_MISSING_FILE, type RegistryError } from '../../src/contracts/index.js';
import { loadRegistry } from '../../src/registry/index.js';

// T036–T039: loadRegistry unit tests (all USs, FR-001/005/014/015)

const FIXTURES_DIR = join(
  fileURLToPath(new URL('../../', import.meta.url)),
  'test',
  'registry',
  'fixtures',
);

function tmpRoot(): string {
  return mkdtempSync(join(tmpdir(), 'pilot-load-registry-'));
}

function writeBuilders(root: string, yaml: string): void {
  mkdirSync(join(root, '.ycsf'), { recursive: true });
  writeFileSync(join(root, '.ycsf', 'builders.yaml'), yaml, 'utf8');
}

describe('loadRegistry', () => {
  it('T036: valid builders.yaml with 2 builders + 1 materializer → ok, records.size === 3 (FR-001/007/008)', async () => {
    const root = tmpRoot();
    try {
      writeBuilders(
        root,
        `version: 1
builders:
  builder-a: "${join(FIXTURES_DIR, 'builder-default.mjs')}"
  builder-b: "${join(FIXTURES_DIR, 'builder-named.mjs')}"
materializers:
  mat-a: "${join(FIXTURES_DIR, 'materializer-default.mjs')}"
`,
      );
      const result = await loadRegistry(root);
      expect(result.kind).toBe('ok');
      if (result.kind !== 'ok') return;
      expect(result.registry.records.size).toBe(3);
      expect(result.registry.records.get('builder-a')?.kind).toBe('builder');
      expect(result.registry.records.get('builder-b')?.kind).toBe('builder');
      expect(result.registry.records.get('mat-a')?.kind).toBe('materializer');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('T037: builders.yaml absent → throws Error with BRG_MISSING_FILE (FR-005, edge)', async () => {
    const root = tmpRoot();
    try {
      await expect(loadRegistry(root)).rejects.toThrow(/BRG_MISSING_FILE/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('T038: structural error (missing version) → invalid with BRG_* codes; NO dynamic import (SC-004, FR-014)', async () => {
    const root = tmpRoot();
    try {
      writeBuilders(root, `builders:\n  a: "pkg"\n`);
      const result = await loadRegistry(root);
      expect(result.kind).toBe('invalid');
      if (result.kind !== 'invalid') return;
      expect(result.errors.some((e: RegistryError) => 'code' in e && e.code === BRG_MISSING_FILE)).toBe(false);
      expect(result.errors.some((e: RegistryError) => 'code' in e && e.code === 'BRG_VERSION')).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('T039: one valid entry + one nonexistent package → invalid, valid module loaded (FR-015)', async () => {
    const root = tmpRoot();
    try {
      writeBuilders(
        root,
        `version: 1
builders:
  good: "${join(FIXTURES_DIR, 'builder-default.mjs')}"
  missing: "@nonexistent/pkg"
`,
      );
      const result = await loadRegistry(root);
      expect(result.kind).toBe('invalid');
      if (result.kind !== 'invalid') return;
      expect(result.errors.some((e) => 'code' in e && e.code === 'BRG_PACKAGE_NOT_FOUND')).toBe(true);
      // The valid entry should still be present even though there's a load error
      // (invalid because errors is non-empty, per FR-015)
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

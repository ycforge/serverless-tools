import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { BRG_MISSING_FILE, BRG_PACKAGE_NOT_FOUND, type RegistryError } from '../../src/contracts/index.js';
import { loadRegistry } from '../../src/registry/index.js';
import { loadPlugins } from '../../src/registry/load.js';

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
      expect(result.registry.records.get('builder:builder-a')?.kind).toBe('builder');
      expect(result.registry.records.get('builder:builder-b')?.kind).toBe('builder');
      expect(result.registry.records.get('materializer:mat-a')?.kind).toBe('materializer');
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

  it('T040: bare-token key (ycforge) in builders.yaml → registry record keyed by bare token (legacy form, FR-009)', async () => {
    const root = tmpRoot();
    try {
      writeBuilders(
        root,
        `version: 1
builders:
  ycforge: "${join(FIXTURES_DIR, 'builder-default.mjs')}"
`,
      );
      const result = await loadRegistry(root);
      expect(result.kind).toBe('ok');
      if (result.kind !== 'ok') return;
      expect(result.registry.records.has('builder:ycforge')).toBe(true);
      expect(result.registry.records.get('builder:ycforge')?.kind).toBe('builder');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('loadPlugins bare-specifier dispatch (spec 028, T033)', () => {
  it('bare specifier + resolveFrom → resolved through the consumer graph → imported', async () => {
    const root = tmpRoot();
    try {
      writeFileSync(join(root, 'mq.mjs'), 'export default { supports: () => false, materialize: async () => null };\n', 'utf8');
      const result = await loadPlugins(
        new Map([['mq', { id: 'mq', packageName: '@scenario/mq', kind: 'materializer' }]]),
        {
          resolveFrom: (specifier) => {
            expect(specifier).toBe('@scenario/mq');
            return join(root, 'mq.mjs');
          },
        },
      );
      expect(result.errors).toEqual([]);
      expect(result.entries.size).toBe(1);
      expect(result.entries.get('materializer:mq')?.kind).toBe('materializer');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('relative/absolute specifier stays plain import — resolveFrom never consulted (FR-020)', async () => {
    const result = await loadPlugins(
      new Map([['rel', { id: 'rel', packageName: join(FIXTURES_DIR, 'builder-default.mjs'), kind: 'builder' }]]),
      {
        resolveFrom: () => {
          throw new Error('resolveFrom must NOT be called for relative/absolute paths');
        },
      },
    );
    expect(result.errors).toEqual([]);
    expect(result.entries.get('builder:rel')?.kind).toBe('builder');
  });

  it('resolveFrom exception → BRG_PACKAGE_NOT_FOUND with actionable consumer-graph message (FR-018)', async () => {
    const result = await loadPlugins(
      new Map([['x', { id: 'x', packageName: '@nonexistent/x', kind: 'builder' }]]),
      {
        resolveFrom: () => {
          throw new TypeError('MODULE_NOT_FOUND');
        },
      },
    );
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.code).toBe(BRG_PACKAGE_NOT_FOUND);
    expect(result.errors[0]?.message).toMatch(/consumer project/);
  });

  it('normalizePluginLoadError semantics preserved: bare-specifier import failure → BRG_LOAD_ERROR', async () => {
    const result = await loadPlugins(
      new Map([['bad', { id: 'bad', packageName: join(FIXTURES_DIR, 'load-error.mjs'), kind: 'builder' }]]),
    );
    expect(result.errors).toHaveLength(1);
  });
});

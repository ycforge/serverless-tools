import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { Artifact } from '../../src/contracts/index.js';
import {
  ARTIFACT_STORE_VERSION,
  readStoreDescriptors,
  readStoreDescriptorsFrom,
  writeStoreDescriptor,
} from '../../src/build/store.js';

// spec 028, FR-006/FR-009, plan D-4 (T003). Artifact store descriptor
// `.ycsf/artifacts/<appId>/artifact.json` = `{ version: 1, type, value }`.
// RED (written BEFORE `build/store.ts` exists): import failure.

describe('artifact store (spec 028, T003)', () => {
  const tmpDir = (): string => mkdtempSync(join(tmpdir(), 'ycsf-artifact-store-'));

  it('write→read round-trip: canonical { version, type, value } at <dir>/<appId>/artifact.json (FR-006)', async () => {
    const dir = tmpDir();
    try {
      const appId = 'user_service';
      const artifact: Artifact = {
        type: 'ycforge:function',
        value: { archivePath: '.ycsf/artifacts/user_service/fn.zip', entryPoint: 'main.handler' },
      };
      writeStoreDescriptor(join(dir, appId), artifact);

      const written = readFileSync(join(dir, appId, 'artifact.json'), 'utf8');
      expect(JSON.parse(written)).toEqual({
        version: ARTIFACT_STORE_VERSION,
        type: artifact.type,
        value: artifact.value,
      });

      const store = await readStoreDescriptorsFrom(dir);
      expect(store.size).toBe(1);
      expect(store.get(appId)).toEqual(artifact);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('readStoreDescriptors reads from <rootDir>/.ycsf/artifacts/<appId>/artifact.json', async () => {
    const root = tmpDir();
    try {
      const appId = 'analytics';
      const artifact: Artifact = {
        type: 'ycforge:docker-image',
        value: { image: 'cr.example/app@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
      };
      mkdirSync(join(root, '.ycsf', 'artifacts', appId), { recursive: true });
      writeStoreDescriptor(join(root, '.ycsf', 'artifacts', appId), artifact);

      const store = await readStoreDescriptors(root);
      expect(store.size).toBe(1);
      expect(store.get(appId)).toEqual(artifact);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('version mismatch → actionable throw naming the file (FR-009, D-4)', async () => {
    const root = tmpDir();
    try {
      const appId = 'frontend';
      mkdirSync(join(root, '.ycsf', 'artifacts', appId), { recursive: true });
      writeFileSync(
        join(root, '.ycsf', 'artifacts', appId, 'artifact.json'),
        JSON.stringify({ version: 99, type: 'ycforge:frontend', value: { directory: 'x' } }),
        'utf8',
      );
      await expect(readStoreDescriptors(root)).rejects.toThrow();
      await expect(readStoreDescriptors(root)).rejects.toThrow(/(version|1|ycsf build)/i);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('missing store dir → empty map, NOT a load error (D-4)', async () => {
    const root = tmpDir();
    try {
      const store = await readStoreDescriptors(root);
      expect(store.size).toBe(0);
      const from = await readStoreDescriptorsFrom(join(root, 'artifacts'));
      expect(from.size).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('malformed descriptor JSON → fail-fast throw naming the file (V)', async () => {
    const root = tmpDir();
    try {
      const appId = 'broken';
      mkdirSync(join(root, '.ycsf', 'artifacts', appId), { recursive: true });
      writeFileSync(join(root, '.ycsf', 'artifacts', appId, 'artifact.json'), '{not json', 'utf8');
      await expect(readStoreDescriptors(root)).rejects.toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
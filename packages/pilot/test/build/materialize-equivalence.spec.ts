import { describe, it, expect } from 'vitest';
import { cp, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runBuildAndMaterialize, runMaterializeGeneration } from '../../src/cli/pipeline.js';
import { loadProjectModel } from '../../src/model/loader.js';
import { loadRegistry } from '../../src/registry/index.js';

const canonicalFixture = resolve(import.meta.dirname, '../check/fixtures/canonical');

async function copyFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'pilot-mat-equiv-'));
  await cp(canonicalFixture, root, { recursive: true });
  return root;
}

async function readInfraFiles(root: string): Promise<{ filename: string; content: string }[]> {
  const dir = join(root, 'infra');
  const names = (await readdir(dir)).filter((n) => n.endsWith('.ycsf.tf.json')).sort();
  const files: { filename: string; content: string }[] = [];
  for (const name of names) {
    files.push({ filename: name, content: await readFile(join(dir, name), 'utf8') });
  }
  return files;
}

describe('standalone materialize ≡ runBuildAndMaterialize (T147)', () => {
  it('produces equivalent generated files on the canonical fixture', async () => {
    const rootA = await copyFixture();
    const rootB = await copyFixture();
    try {
      // plan/apply pipeline path: build → materialize generation.
      await runBuildAndMaterialize(rootA);
      const pipelineFiles = await readInfraFiles(rootA);

      // Standalone `ycsf materialize` path: load model + registry, then the
      // SAME shared generation step (dispatch → extensions → moves → outputs → write).
      const modelResult = loadProjectModel(rootB);
      expect(modelResult.kind).toBe('ok');
      if (modelResult.kind !== 'ok') throw new Error(`model load failed: ${JSON.stringify(modelResult.errors)}`);
      const registryResult = await loadRegistry(rootB);
      expect(registryResult.kind).toBe('ok');
      if (registryResult.kind !== 'ok') throw new Error(`registry load failed: ${JSON.stringify(registryResult.errors)}`);
      const generation = await runMaterializeGeneration(rootB, modelResult.model, registryResult.registry, {});
      expect(generation.files.length).toBeGreaterThan(0);
      const standaloneFiles = await readInfraFiles(rootB);

      expect(standaloneFiles.map((f) => f.filename)).toEqual(pipelineFiles.map((f) => f.filename));
      for (const file of standaloneFiles) {
        const pipelineFile = pipelineFiles.find((p) => p.filename === file.filename);
        expect(pipelineFile?.content).toBe(file.content);
      }

      // Both include the per-app files — the standalone materialize pipeline
      // now matches the plan/apply order (FR-011/FR-012).
      for (const app of ['user_service', 'analytics']) {
        expect(standaloneFiles.some((f) => f.filename === `${app}.ycsf.tf.json`)).toBe(true);
      }
    } finally {
      await rm(rootA, { recursive: true, force: true });
      await rm(rootB, { recursive: true, force: true });
    }
  });

  it('--target filters standalone materialize to that app only', async () => {
    const root = await copyFixture();
    try {
      const modelResult = loadProjectModel(root);
      if (modelResult.kind !== 'ok') throw new Error('model load failed');
      const registryResult = await loadRegistry(root);
      if (registryResult.kind !== 'ok') throw new Error('registry load failed');
      const generation = await runMaterializeGeneration(root, modelResult.model, registryResult.registry, {
        target: 'user_service',
      });
      expect(generation.files.map((f) => f.filename)).toEqual(['user_service.ycsf.tf.json']);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
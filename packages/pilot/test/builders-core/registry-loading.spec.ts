import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadProjectModel } from '../../src/index.js';
import { loadRegistry, validateBuilders } from '../../src/registry/index.js';
import { createTempProject, removeTempProject, type TempProject } from '../helpers/temp-project.js';

const BUILDERS_YAML = `version: 1
builders:
  nestjs-function: "@ycforge/builders-core/nestjs-function"
  docker: "@ycforge/builders-core/docker"
  vite: "@ycforge/builders-core/vite"
`;

const APPS_YAML = `version: 1
apps:
  user_service: { source_path: ./user_service, builder: nestjs-function }
  analytics: { source_path: ./analytics, builder: docker }
  frontend: { source_path: ./frontend, builder: vite }
`;

describe('registry loads @ycforge/builders-core subpaths (US4 / SC-002)', () => {
  let project: TempProject;

  beforeEach(() => {
    project = createTempProject();
  });

  afterEach(() => {
    removeTempProject(project);
  });

  it('Given builders.yaml with three subpath specifiers → 3 builder entries, no BRG_* errors (US4 AC1)', async () => {
    project.write('.ycsf/builders.yaml', BUILDERS_YAML);
    const result = await loadRegistry(project.root);
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.registry.records.size).toBe(3);
    for (const id of ['nestjs-function', 'docker', 'vite']) {
      expect(result.registry.records.get(id)?.kind).toBe('builder');
    }
  });

  it('registry entries expose the loaded module; each default export is Builder-shaped (build: Function)', async () => {
    project.write('.ycsf/builders.yaml', BUILDERS_YAML);
    const result = await loadRegistry(project.root);
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    for (const id of ['nestjs-function', 'docker', 'vite']) {
      const ns = result.registry.records.get(id)?.module as { default?: { build?: unknown } };
      expect(ns?.default).toBeTypeOf('object');
      expect(typeof ns?.default?.build).toBe('function');
    }
  });

  it('Given the same registry and apps user_service/analytics/frontend → validateBuilders ok (US4 AC2 / SC-002)', async () => {
    project.write('.ycsf/builders.yaml', BUILDERS_YAML);
    const registryResult = await loadRegistry(project.root);
    expect(registryResult.kind).toBe('ok');
    if (registryResult.kind !== 'ok') return;

    project.write('.ycsf/apps.yaml', APPS_YAML);
    const modelResult = loadProjectModel(project.root);
    expect(modelResult.kind).toBe('ok');
    if (modelResult.kind !== 'ok') return;

    const validation = validateBuilders(modelResult.model, registryResult.registry);
    expect(validation.kind).toBe('ok');
  });

  it('registry remains immutable (frozen records map)', async () => {
    project.write('.ycsf/builders.yaml', BUILDERS_YAML);
    const result = await loadRegistry(project.root);
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(Object.isFrozen(result.registry.records)).toBe(true);
  });
});
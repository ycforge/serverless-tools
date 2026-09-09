import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ARTIFACT_TYPES } from '@ycforge/materializers-core';
import yandexApiGateway from '@ycforge/materializers-core/yandex-api-gateway';
import yandexFunction from '@ycforge/materializers-core/yandex-function';
import yandexMessageQueue from '@ycforge/materializers-core/yandex-message-queue';
import yandexServerlessContainer from '@ycforge/materializers-core/yandex-serverless-container';
import yandexStorageBucket from '@ycforge/materializers-core/yandex-storage-bucket';

import { loadProjectModel } from '../../src/index.js';
import { selectArtifacts } from '../../src/materialize/select.js';
import { loadRegistry } from '../../src/registry/index.js';
import { createTempProject, removeTempProject, type TempProject } from '../helpers/temp-project.js';

// SC-002 / Sc6: the @ycforge/materializers-core subpath specifiers resolve as
// materializer registry entries and dispatch phase-1 selection matches every
// canonical app 1:1 (mirror of the builders-core registry-loading test).

const BUILDERS_YAML = `version: 1
materializers:
  yandex-function: "@ycforge/materializers-core/yandex-function"
  yandex-serverless-container: "@ycforge/materializers-core/yandex-serverless-container"
  yandex-api-gateway: "@ycforge/materializers-core/yandex-api-gateway"
  yandex-message-queue: "@ycforge/materializers-core/yandex-message-queue"
  yandex-storage-bucket: "@ycforge/materializers-core/yandex-storage-bucket"
`;

const APPS_YAML = `version: 1
apps:
  user_service:  { source_path: ./user_service,  builder: ycforge:function }
  analytics:     { source_path: ./analytics,     builder: ycforge:docker-image }
  frontend:      { source_path: ./frontend,      builder: ycforge:frontend }
  openapi:       { source_path: ./openapi,       builder: ycforge:api-gateway }
  notifications: { source_path: ./notifications, builder: ycforge:queue }
`;

const EXPECTED_MATCHES = {
  user_service: 'yandex-function',
  analytics: 'yandex-serverless-container',
  frontend: 'yandex-storage-bucket',
  openapi: 'yandex-api-gateway',
  notifications: 'yandex-message-queue',
} as const;

const MATERIALIZER_IDS = Object.values(EXPECTED_MATCHES);

describe('registry loads @ycforge/materializers-core subpaths, dispatch selects 1:1 (SC-002 / Sc6)', () => {
  let project: TempProject;

  beforeEach(() => {
    project = createTempProject();
  });

  afterEach(() => {
    removeTempProject(project);
  });

  it('Given builders.yaml with five subpath specifiers → 5 materializer records, zero errors (FR-001)', async () => {
    project.write('.ycsf/builders.yaml', BUILDERS_YAML);
    const result = await loadRegistry(project.root);
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.registry.records.size).toBe(5);
    for (const id of MATERIALIZER_IDS) {
      const record = result.registry.records.get(id);
      expect(record?.kind).toBe('materializer');
      expect(record?.packageName).toBe(`@ycforge/materializers-core/${id}`);
    }
  });

  it('Given the same registry and apps.yaml with five ycforge:* builders → selectArtifacts matches each app 1:1 (SC-002)', async () => {
    project.write('.ycsf/builders.yaml', BUILDERS_YAML);
    const registryResult = await loadRegistry(project.root);
    expect(registryResult.kind).toBe('ok');
    if (registryResult.kind !== 'ok') return;

    project.write('.ycsf/apps.yaml', APPS_YAML);
    const modelResult = loadProjectModel(project.root);
    expect(modelResult.kind).toBe('ok');
    if (modelResult.kind !== 'ok') return;

    const selection = selectArtifacts(modelResult.model, registryResult.registry);
    expect(selection.kind).toBe('ok');
    if (selection.kind !== 'ok') return;

    expect(selection.matches.size).toBe(5);
    for (const [appId, materializerId] of Object.entries(EXPECTED_MATCHES)) {
      expect(selection.matches.get(appId)).toBe(materializerId);
    }
    expect(selection.orderedAppIds).toEqual(['analytics', 'frontend', 'notifications', 'openapi', 'user_service']);
  });

  it('each subpath default export is Materializer-shaped (supports + materialize Functions)', () => {
    const materializers = [
      yandexFunction,
      yandexServerlessContainer,
      yandexApiGateway,
      yandexMessageQueue,
      yandexStorageBucket,
    ] as Array<{ supports?: unknown; materialize?: unknown }>;
    for (const materializer of materializers) {
      expect(typeof materializer.supports).toBe('function');
      expect(typeof materializer.materialize).toBe('function');
    }
  });

  it('root import exposes the 5-type artifact catalog (FR-003)', () => {
    expect(ARTIFACT_TYPES).toContain('ycforge:function');
    expect(ARTIFACT_TYPES).toContain('ycforge:docker-image');
    expect(ARTIFACT_TYPES).toContain('ycforge:frontend');
    expect(ARTIFACT_TYPES).toContain('ycforge:api-gateway');
    expect(ARTIFACT_TYPES).toContain('ycforge:queue');
  });
});
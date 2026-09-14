import { describe, it, expect, afterEach } from 'vitest';
import { cpSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { createTempProject, removeTempProject, type TempProject } from '../helpers/temp-project.js';
import { buildApps } from '../../src/build/index.js';
import { readStoreDescriptors, readStoreDescriptorsFrom } from '../../src/build/store.js';
import { loadRegistry } from '../../src/registry/index.js';
import { loadProjectModel } from '../../src/index.js';
import { runMaterializeGeneration } from '../../src/cli/pipeline.js';

const BUILDER_FUNCTION = resolve(import.meta.dirname, './fixtures/builder-function.mjs');
const COMPOSER_BUILDER = resolve(import.meta.dirname, '../../../composer/dist/builder/index.js');
const CORES_FUNCTION = resolve(import.meta.dirname, '../../../materializers-core/dist/yandex-function/index.js');
const CORES_GATEWAY = resolve(import.meta.dirname, '../../../materializers-core/dist/yandex-api-gateway/index.js');

function readInfra(root: string): Record<string, string> {
  const dir = join(root, 'infra');
  return readdirSync(dir)
    .filter((f) => f.endsWith('.ycsf.tf.json'))
    .sort()
    .reduce((acc, f) => {
      acc[f] = readFileSync(join(dir, f), 'utf8');
      return acc;
    }, {} as Record<string, string>);
}

function createStoreProject(): TempProject {
  const project = createTempProject({
    'package.json': '{ "name": "store-fixture", "private": true }',
    '.ycsf/apps.yaml': `version: 1
apps:
  user_service: { source_path: user_service, builder: ycforge:function }
  openapi: { source_path: openapi, builder: ycforge:api-gateway }
`,
    'user_service/build_config.yaml': 'version: 1\n',
    'dist/user_service.zip': 'spec-028-function-archive-bytes',
    'openapi/build_config.yaml': `version: 1
openapi_entry: openapi.yaml
`,
    'openapi/openapi.yaml': `openapi: "3.0.0"
info:
  title: spec-028-store
  version: v1
paths:
  /hello:
    get:
      summary: hello
      x-yc-apigateway-integration:
        function_id: "\u0024{resources.functions.user_service.id}"
`,
    'openapi/auth.yaml': `version: 1
defaultScheme: authorizer
schemes:
  authorizer:
    type: function
    function: functions.user_service
`,
    '.ycsf/outputs.yaml': `version: 1
outputs:
  user_function_id:
    value: "functions.user_service.id"
`,
  });
  project.write(
    '.ycsf/builders.yaml',
    `version: 1
builders:
  "ycforge:function": "${BUILDER_FUNCTION}"
  "ycforge:api-gateway": "${COMPOSER_BUILDER}"
materializers:
  yandex-function: "${CORES_FUNCTION}"
  yandex-api-gateway: "${CORES_GATEWAY}"
`,
  );
  return project;
}

describe('artifact store → standalone materialize (spec 028, T015)', () => {
  let project: TempProject | undefined;

  afterEach(() => {
    if (project) removeTempProject(project);
    project = undefined;
  });

  it('byte-identical integrated vs standalone; idempotent; --artifacts <dir> root semantics', async () => {
    project = createStoreProject();
    const root = project.root;

    const model = loadProjectModel(root);
    expect(model.kind).toBe('ok');
    if (model.kind !== 'ok') throw new Error(`model invalid: ${JSON.stringify(model.errors)}`);
    const registryResult = await loadRegistry(root);
    expect(registryResult.kind).toBe('ok');
    if (registryResult.kind !== 'ok') throw new Error(`registry invalid: ${JSON.stringify(registryResult.errors)}`);
    const registry = registryResult.registry;

    const previousCwd = process.cwd();
    process.chdir(root);
    try {
      const build = await buildApps(root, { noCache: true });
      expect(build.kind).toBe('ok');
      if (build.kind !== 'ok') throw new Error(`build failed: ${JSON.stringify(build.errors)}`);
      expect(build.artifacts.map((a) => a.appId).sort()).toEqual(['openapi', 'user_service']);

      const integratedArtifacts = new Map(build.artifacts.map(({ appId, artifact }) => [appId, artifact]));
      await runMaterializeGeneration(root, model.model, registry, {}, integratedArtifacts);
      const integrated = readInfra(root);
      expect(Object.keys(integrated).sort()).toEqual(['openapi.ycsf.tf.json', 'user_service.ycsf.tf.json']);

      const store = await readStoreDescriptors(root);
      expect(store.size).toBe(2);
      expect([...store.keys()].sort()).toEqual(['openapi', 'user_service']);
      for (const { appId, artifact } of build.artifacts) {
        expect(store.get(appId)?.type).toBe(artifact.type);
      }

      await runMaterializeGeneration(root, model.model, registry, {}, store);
      expect(readInfra(root)).toEqual(integrated);

      await runMaterializeGeneration(root, model.model, registry, {}, store);
      expect(readInfra(root)).toEqual(integrated);

      const artifactsDir = join(root, 'shared', 'artifacts-copy');
      mkdirSync(artifactsDir, { recursive: true });
      cpSync(join(root, '.ycsf', 'artifacts'), artifactsDir, { recursive: true });
      const storeFrom = await readStoreDescriptorsFrom(artifactsDir);
      expect(storeFrom.size).toBe(2);
      await runMaterializeGeneration(root, model.model, registry, {}, storeFrom);
      expect(readInfra(root)).toEqual(integrated);
    } finally {
      process.chdir(previousCwd);
    }
  });
});
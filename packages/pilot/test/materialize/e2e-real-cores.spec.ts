import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import yandexApiGateway from '@ycforge/materializers-core/yandex-api-gateway';
import yandexServerlessContainer from '@ycforge/materializers-core/yandex-serverless-container';
import yandexFunction from '@ycforge/materializers-core/yandex-function';
import yandexStorageBucket from '@ycforge/materializers-core/yandex-storage-bucket';

import type { ArtifactDescriptor, Materializer, PluginEntry, TerraformResource } from '../../src/contracts/index.js';
import { dispatch } from '../../src/materialize/dispatch.js';
import { makeRegistry, loadModel } from '../helpers/materialize-fixtures.js';
import { createTempProject, removeTempProject, type TempProject } from '../helpers/temp-project.js';

// Phase 6 (spec 025): E2E over the REAL @ycforge/materializers-core plugins.
// Verifies dispatch reaches real supports/materialize, descriptors carry the
// built `value` into selection, per-app files merge multiple resources yielded
// by one materializer (yandex-storage-bucket), declared outputs appear in
// `materializerOutputs`, and the NG-3 absolute-path defect on the
// yandex-function side is pinned from pilot.

type AnyCoreMaterializer = {
  readonly supports: (...args: readonly unknown[]) => boolean;
  readonly materialize: (...args: readonly unknown[]) => Promise<unknown>;
};

function wrapReal(
  id: string,
  real: AnyCoreMaterializer,
  seen: ArtifactDescriptor[],
): PluginEntry {
  const module: Materializer<ArtifactDescriptor> = {
    supports(artifact, context) {
      seen.push(artifact);
      return real.supports(artifact, context);
    },
    materialize(artifact, context) {
      return real.materialize(artifact, context) as Promise<TerraformResource>;
    },
  };
  return { id, packageName: `real:${id}`, kind: 'materializer', module };
}

function functionProject(): TempProject & { zipBytes: Buffer; expectedHash: string } {
  const project = createTempProject({
    '.ycsf/apps.yaml': `version: 1
apps:
  user_service: { source_path: user_service, builder: ycforge:function }
`,
  });
  const zipBytes = Buffer.from('ycsf-e2e-function-artifact', 'utf8');
  mkdirSync(join(project.root, 'dist'), { recursive: true });
  writeFileSync(join(project.root, 'dist', 'user_service.zip'), zipBytes);
  return { ...project, zipBytes, expectedHash: createHash('sha256').update(zipBytes).digest('hex') };
}

describe('e2e real materializers-core (spec 025, Phase 6)', () => {
  it('T032(a): real yandex-function dispatches a built zip artifact — selected by ycforge:function, outputs declared', async () => {
    const project = functionProject();
    const seen: ArtifactDescriptor[] = [];
    const entry = wrapReal(
      'yandex-function',
      yandexFunction as unknown as AnyCoreMaterializer,
      seen,
    );
    const model = loadModel(project);

    const previousCwd = process.cwd();
    process.chdir(project.root);
    try {
      const result = await dispatch(model, makeRegistry([entry]), {
        artifacts: new Map([
          ['user_service', { type: 'ycforge:function', value: { archivePath: 'dist/user_service.zip', entryPoint: 'handler' } }],
        ]),
      });

      expect(result.kind).toBe('ok');
      if (result.kind !== 'ok') return;

      expect(result.resources).toHaveLength(1);
      expect(result.resources[0]).toMatchObject({ type: 'yandex_function', name: 'user_service' });

      const file = result.generatedFiles[0];
      expect(file?.filename).toBe('user_service.ycsf.tf.json');
      const parsed = JSON.parse(file?.content ?? '{}') as {
        resource: {
          yandex_function: {
            user_service: {
              entrypoint: string;
              user_hash: string;
              content: { zip_filename: string };
            };
          };
        };
      };
      expect(parsed.resource.yandex_function.user_service.content.zip_filename).toBe('dist/user_service.zip');
      expect(parsed.resource.yandex_function.user_service.entrypoint).toBe('handler');
      expect(parsed.resource.yandex_function.user_service.user_hash).toBe(project.expectedHash);

      expect(result.materializerOutputs.get('user_service_function_id')).toEqual({
        value: 'yandex_function.user_service.id',
      });

      expect(seen).toHaveLength(1);
      expect(seen[0]).toMatchObject({ id: 'user_service', name: 'user_service', type: 'ycforge:function' });
      const value = seen[0]?.value as { archivePath?: string; entryPoint?: string } | undefined;
      expect(value?.archivePath).toBe('dist/user_service.zip');
      expect(value?.entryPoint).toBe('handler');
    } finally {
      process.chdir(previousCwd);
      removeTempProject(project);
    }
  });

  it('T032(b): NG-3 pinned — absolute archivePath → MTL_MATERIALIZE_FAILED with YMT_INVALID_ARTIFACT_VALUE in message', async () => {
    const project = functionProject();
    const seen: ArtifactDescriptor[] = [];
    const entry = wrapReal('yandex-function', yandexFunction as unknown as AnyCoreMaterializer, seen);
    const model = loadModel(project);
    const absolutePath = join(project.root, 'dist', 'user_service.zip');

    const previousCwd = process.cwd();
    process.chdir(project.root);
    try {
      const result = await dispatch(model, makeRegistry([entry]), {
        artifacts: new Map([
          ['user_service', { type: 'ycforge:function', value: { archivePath: absolutePath, entryPoint: 'handler' } }],
        ]),
      });

      expect(result.kind).toBe('invalid');
      if (result.kind !== 'invalid') return;
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]?.code).toBe('MTL_MATERIALIZE_FAILED');
      expect(result.errors[0]?.message).toContain('YMT_INVALID_ARTIFACT_VALUE');
      expect(result.errors[0]?.message).toContain('archivePath must be relative');
    } finally {
      process.chdir(previousCwd);
      removeTempProject(project);
    }
  });

  it('T032(c): all 4 real shapes dispatch ok — function, docker-image, frontend (multi-resource bucket merge), api-gateway', async () => {
    const project = createTempProject({
      '.ycsf/apps.yaml': `version: 1
apps:
  user_service: { source_path: user_service, builder: ycforge:function }
  analytics:    { source_path: analytics,    builder: ycforge:docker-image }
  frontend:     { source_path: frontend,     builder: ycforge:frontend }
  openapi:      { source_path: openapi,      builder: ycforge:api-gateway }
`,
    });

    const zipBytes = Buffer.from('ycsf-e2e-function-artifact', 'utf8');
    mkdirSync(join(project.root, 'dist'), { recursive: true });
    writeFileSync(join(project.root, 'dist', 'user_service.zip'), zipBytes);

    mkdirSync(join(project.root, 'frontend-build', 'assets'), { recursive: true });
    writeFileSync(join(project.root, 'frontend-build', 'index.html'), '<html></html>');
    writeFileSync(join(project.root, 'frontend-build', 'assets', 'app.js'), 'console.log(1)');

    mkdirSync(join(project.root, 'openapi'), { recursive: true });
    writeFileSync(
      join(project.root, 'openapi', 'openapi.yaml'),
      'openapi: 3.0.0\ninfo: { title: e2e, version: "1.0.0" }\npaths: {}\n',
    );

    const seen: ArtifactDescriptor[] = [];
    const registry = makeRegistry([
      wrapReal('yandex-function', yandexFunction as unknown as AnyCoreMaterializer, seen),
      wrapReal('yandex-serverless-container', yandexServerlessContainer as unknown as AnyCoreMaterializer, seen),
      wrapReal('yandex-storage-bucket', yandexStorageBucket as unknown as AnyCoreMaterializer, seen),
      wrapReal('yandex-api-gateway', yandexApiGateway as unknown as AnyCoreMaterializer, seen),
    ]);

    const model = loadModel(project);
    const previousCwd = process.cwd();
    process.chdir(project.root);
    try {
      const result = await dispatch(model, registry, {
        artifacts: new Map([
          ['user_service', { type: 'ycforge:function', value: { archivePath: 'dist/user_service.zip', entryPoint: 'handler' } }],
          ['analytics', { type: 'ycforge:docker-image', value: { image: 'cr.yandex/crp8/repo/analytics:latest' } }],
          ['frontend', { type: 'ycforge:frontend', value: { directory: 'frontend-build' } }],
          ['openapi', { type: 'ycforge:api-gateway', value: { specPath: 'openapi/openapi.yaml' } }],
        ]),
      });

      expect(result.kind).toBe('ok');
      if (result.kind !== 'ok') return;

      const types = result.resources.map((r) => r.type).sort();
      expect(types).toEqual([
        'yandex_api_gateway',
        'yandex_function',
        'yandex_serverless_container',
        'yandex_storage_bucket',
        'yandex_storage_object',
        'yandex_storage_object',
      ]);

      const names = result.resources.map((r) => r.name).sort();
      expect(names).toContain('user_service');
      expect(names).toContain('analytics');
      expect(names).toContain('frontend');
      expect(names).toContain('frontend_index_html');
      expect(names).toContain('frontend_assets_app_js');
      expect(names).toContain('openapi');

      const filenames = result.generatedFiles.map((f) => f.filename).sort();
      expect(filenames).toEqual([
        'analytics.ycsf.tf.json',
        'frontend.ycsf.tf.json',
        'openapi.ycsf.tf.json',
        'user_service.ycsf.tf.json',
      ]);

      // frontend.ycsf.tf.json must merge bucket + object resources into ONE file.
      const frontendFile = result.generatedFiles.find((f) => f.filename === 'frontend.ycsf.tf.json');
      const frontendParsed = JSON.parse(frontendFile?.content ?? '{}') as {
        resource: { yandex_storage_bucket: Record<string, unknown>; yandex_storage_object: Record<string, { key: string }> };
      };
      expect(Object.keys(frontendParsed.resource.yandex_storage_bucket)).toEqual(['frontend']);
      expect(Object.values(frontendParsed.resource.yandex_storage_object).map((o) => o.key).sort()).toEqual(['assets/app.js', 'index.html']);

      expect(result.materializerOutputs.get('user_service_function_id')?.value).toBe('yandex_function.user_service.id');
      expect(result.materializerOutputs.get('analytics_container_id')?.value).toBe('yandex_serverless_container.analytics.id');
      expect(result.materializerOutputs.get('frontend_bucket_id')?.value).toBe('yandex_storage_bucket.frontend.id');
      expect(result.materializerOutputs.get('openapi_gateway_id')?.value).toBe('yandex_api_gateway.openapi.id');

      // NG-3 cwd-dependent companion — pinned from pilot side.
      expect(existsSync(join(project.root, 'generated', 'openapi-openapi.yaml'))).toBe(true);

      // Descriptor carried `value` into supports for every shape.
      const byId = new Map(seen.map((d) => [d.id, d.value as Record<string, unknown> | undefined]));
      expect(byId.get('user_service')).toMatchObject({ archivePath: 'dist/user_service.zip' });
      expect(byId.get('analytics')).toMatchObject({ image: 'cr.yandex/crp8/repo/analytics:latest' });
      expect(byId.get('frontend')).toMatchObject({ directory: 'frontend-build' });
      expect(byId.get('openapi')).toMatchObject({ specPath: 'openapi/openapi.yaml' });
    } finally {
      process.chdir(previousCwd);
      removeTempProject(project);
    }
  });
});